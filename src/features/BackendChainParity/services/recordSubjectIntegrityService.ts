// src/features/BackendChainParity/services/recordSubjectIntegrityService.ts

import { ethers, id } from 'ethers';
import type { IntegrityStatus, SubjectComparison } from '../lib/types';
import { getHealthContract } from '../lib/contracts';
import { FileObject } from '@/types/core';

export interface RecordSubjectIntegrityItem {
  firestoreId: string;
  recordIdHash: string;
  backendSubjects: string[];
  onChainSubjects: string[];
  activeOnChainSubjects: string[];
  subjectComparisons: SubjectComparison[];
  integrityStatus: IntegrityStatus;
  error?: string;
}

export async function checkRecordSubjectIntegrity(
  record: FileObject
): Promise<RecordSubjectIntegrityItem> {
  const backendSubjects = record.subjects ?? [];
  const resolvedRecordIdHash = record.recordIdHash ?? id(record.id);

  // Pre-populate backend subjects as missing_from_chain so an early-return
  // (e.g. on error) still surfaces them in the UI.
  const initialSubjectComparisons: SubjectComparison[] = backendSubjects.map(uid => ({
    uid,
    userIdHash: ethers.id(uid).toLowerCase(),
    isActiveOnChain: false,
    syncStatus: 'missing_from_chain' as const,
  }));

  const base: Omit<RecordSubjectIntegrityItem, 'integrityStatus'> = {
    firestoreId: record.id,
    recordIdHash: resolvedRecordIdHash,
    backendSubjects,
    onChainSubjects: [],
    activeOnChainSubjects: [],
    subjectComparisons: initialSubjectComparisons,
  };

  try {
    const contract = getHealthContract();

    const rawOnChainSubjects: string[] = await contract.getRecordSubjects(resolvedRecordIdHash);
    const onChainSubjects = rawOnChainSubjects.map(h => h.toLowerCase());

    if (backendSubjects.length === 0 && onChainSubjects.length === 0) {
      return { ...base, integrityStatus: 'not_applicable' };
    }

    const subjectActiveResults = await Promise.all(
      onChainSubjects.map(async hash => ({
        hash,
        isActive: (await contract.isActiveSubject(resolvedRecordIdHash, hash)) as boolean,
      }))
    );
    const subjectActiveMap = new Map(subjectActiveResults.map(r => [r.hash, r.isActive]));
    const activeOnChainSubjects = subjectActiveResults.filter(r => r.isActive).map(r => r.hash);

    // ── Subject comparisons ──────────────────────────────────────────────────
    const subjectComparisons: SubjectComparison[] = [];
    const processedSubjectHashes = new Set<string>();

    for (const uid of backendSubjects) {
      const userIdHash = ethers.id(uid).toLowerCase();
      processedSubjectHashes.add(userIdHash);
      const isActiveOnChain = subjectActiveMap.get(userIdHash) ?? false;
      subjectComparisons.push({
        uid,
        userIdHash,
        isActiveOnChain,
        syncStatus: isActiveOnChain ? 'active_sync' : 'missing_from_chain',
      });
    }

    for (const hash of onChainSubjects) {
      if (!processedSubjectHashes.has(hash)) {
        const isActiveOnChain = subjectActiveMap.get(hash) ?? false;
        subjectComparisons.push({
          userIdHash: hash,
          isActiveOnChain,
          syncStatus: isActiveOnChain ? 'missing_from_backend' : 'removed_sync',
        });
      }
    }

    let integrityStatus: IntegrityStatus;
    if (subjectComparisons.some(s => s.syncStatus === 'missing_from_backend')) {
      integrityStatus = 'mismatch';
    } else if (subjectComparisons.some(s => s.syncStatus === 'missing_from_chain')) {
      integrityStatus = 'missing';
    } else {
      integrityStatus = 'synced';
    }

    return {
      ...base,
      onChainSubjects,
      activeOnChainSubjects,
      subjectComparisons,
      integrityStatus,
    };
  } catch (error) {
    return { ...base, integrityStatus: 'failed', error: String(error) };
  }
}
