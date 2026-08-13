// src/features/BackendChainParity/services/recordPermissionIntegrityService.ts

import { ethers, id } from 'ethers';
import { collection, getDocs, orderBy, query, limit, getFirestore } from 'firebase/firestore';
import { getMemberContract } from '../lib/contracts';
import type { IntegrityStatus } from '../lib/types';
import type { FileObject } from '@/types/core';
import type { BlockchainRef, PermissionChangeEvent, TimestampLike } from '@belrose/shared';

// ============================================================================
// TYPES
// ============================================================================

export type PermSyncStatus =
  | 'synced'
  | 'wrong_role'
  | 'missing_from_chain'
  | 'missing_from_backend';

export interface PermissionMemberComparison {
  userId?: string;
  userIdHash: string;
  firestoreRole: string | null;
  onChainRole: string | null;
  syncStatus: PermSyncStatus;
  lastBlockchainRef?: BlockchainRef;
  lastChangedAt?: TimestampLike | null;
}

export interface RecordPermissionIntegrityItem {
  recordId: string;
  recordIdHash: string;
  uploadedBy?: string;
  uploadedByIdHash?: string;
  firestoreMemberCount: number;
  onChainMemberCount: number;
  memberComparisons: PermissionMemberComparison[];
  recentHistory: PermissionChangeEvent[];
  integrityStatus: IntegrityStatus;
  error?: string;
}

// ============================================================================
// INTEGRITY CHECK
// ============================================================================

export async function checkRecordPermissionsIntegrity(
  record: FileObject
): Promise<RecordPermissionIntegrityItem> {
  const db = getFirestore();
  const recordId = record.id;
  const recordIdHash = id(recordId);

  // Build Firestore role maps keyed by lowercased userIdHash
  const firestoreRoleMap = new Map<string, string>(); // hash -> role
  const firestoreUserIdMap = new Map<string, string>(); // hash -> userId

  const roleArrays: Array<{ role: string; userIds: string[] }> = [
    { role: 'owner', userIds: (record as any).owners ?? [] },
    { role: 'administrator', userIds: (record as any).administrators ?? [] },
    { role: 'sharer', userIds: (record as any).sharers ?? [] },
    { role: 'viewer', userIds: (record as any).viewers ?? [] },
  ];

  for (const { role, userIds } of roleArrays) {
    for (const userId of userIds) {
      const hash = ethers.id(userId).toLowerCase();
      firestoreRoleMap.set(hash, role);
      firestoreUserIdMap.set(hash, userId);
    }
  }

  const firestoreMemberCount = firestoreRoleMap.size;

  const uploadedBy: string | undefined = (record as any).uploadedBy;
  const base: Omit<RecordPermissionIntegrityItem, 'integrityStatus'> = {
    recordId,
    recordIdHash,
    uploadedBy,
    uploadedByIdHash: uploadedBy ? ethers.id(uploadedBy).toLowerCase() : undefined,
    firestoreMemberCount,
    onChainMemberCount: 0,
    memberComparisons: [],
    recentHistory: [],
  };

  try {
    const contract = getMemberContract();

    // Fetch all role arrays + recent permissionHistory in parallel
    const [participants, historySnap] = await Promise.all([
      contract.getAllRecordParticipants(recordIdHash),
      getDocs(
        query(
          collection(db, 'records', recordId, 'permissionHistory'),
          orderBy('changedAt', 'desc'),
          limit(20)
        )
      ),
    ]);

    // Build on-chain role map: hash (lowercased) -> role
    const onChainRoleMap = new Map<string, string>();
    for (const h of participants.owners) onChainRoleMap.set((h as string).toLowerCase(), 'owner');
    for (const h of participants.admins) onChainRoleMap.set((h as string).toLowerCase(), 'administrator');
    for (const h of participants.sharers) onChainRoleMap.set((h as string).toLowerCase(), 'sharer');
    for (const h of participants.viewers) onChainRoleMap.set((h as string).toLowerCase(), 'viewer');

    const onChainMemberCount = onChainRoleMap.size;

    // Parse history and build lastTx per userId
    const recentHistory = historySnap.docs.map(d => d.data() as PermissionChangeEvent);

    // History is already desc by changedAt — first hit per user is the most recent
    const lastTxMap = new Map<
      string,
      { blockchainRef: BlockchainRef; changedAt: TimestampLike | null }
    >();
    for (const event of recentHistory) {
      for (const userId of event.affectedUserIds ?? []) {
        if (!lastTxMap.has(userId)) {
          lastTxMap.set(userId, { blockchainRef: event.blockchainRef, changedAt: event.changedAt });
        }
      }
    }

    // Build member comparisons — Firestore direction first
    const memberComparisons: PermissionMemberComparison[] = [];
    const processedHashes = new Set<string>();

    for (const [userIdHash, firestoreRole] of firestoreRoleMap) {
      processedHashes.add(userIdHash);
      const userId = firestoreUserIdMap.get(userIdHash);
      const onChainRole = onChainRoleMap.get(userIdHash) ?? null;
      const lastTx = userId ? lastTxMap.get(userId) : undefined;

      let syncStatus: PermSyncStatus;
      if (!onChainRole) {
        syncStatus = 'missing_from_chain';
      } else if (onChainRole !== firestoreRole) {
        syncStatus = 'wrong_role';
      } else {
        syncStatus = 'synced';
      }

      memberComparisons.push({
        userId,
        userIdHash,
        firestoreRole,
        onChainRole,
        syncStatus,
        lastBlockchainRef: lastTx?.blockchainRef,
        lastChangedAt: lastTx?.changedAt ?? null,
      });
    }

    // Chain direction — catch roles on chain with no matching Firestore entry
    for (const [userIdHash, onChainRole] of onChainRoleMap) {
      if (processedHashes.has(userIdHash)) continue;
      memberComparisons.push({
        userIdHash,
        firestoreRole: null,
        onChainRole,
        syncStatus: 'missing_from_backend',
      });
    }

    // Overall integrity status
    let integrityStatus: IntegrityStatus;
    if (firestoreMemberCount === 0 && onChainMemberCount === 0) {
      integrityStatus = 'not_applicable';
    } else if (
      memberComparisons.some(
        m => m.syncStatus === 'missing_from_backend' || m.syncStatus === 'wrong_role'
      )
    ) {
      integrityStatus = 'mismatch';
    } else if (memberComparisons.some(m => m.syncStatus === 'missing_from_chain')) {
      integrityStatus = 'missing';
    } else {
      integrityStatus = 'synced';
    }

    return {
      ...base,
      onChainMemberCount,
      memberComparisons,
      recentHistory,
      integrityStatus,
    };
  } catch (error) {
    return { ...base, integrityStatus: 'failed', error: String(error) };
  }
}
