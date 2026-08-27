// src/features/CredibilityUser/services/vouchService.ts
//
// Firestore-first: createVouch and retractVouch commit their Firestore doc change first —
// chainStatus starts 'Pending' — before the blockchain call. The blockchain call is a separate,
// best-effort step afterward, tracked via BlockchainSyncQueueService
// (startAttempt/recordSuccess/recordFailure): success flips chainStatus to 'Active'/'Retracted'
// and appends the onChainHistory event (so onChainHistory only ever contains confirmed on-chain
// events); failure flips it to 'Failed' and leaves a durable sync-queue entry for a future
// reconciliation engine to retry. It does not gate or revert the Firestore write, matching
// SubjectService's pattern (see also verificationService.ts / disputeService.ts).

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  Timestamp,
  collection,
  where,
  query,
  getDocs,
} from 'firebase/firestore';
import * as Sentry from '@sentry/react';
import { ethers } from 'ethers';
import { blockchainVouchService } from './blockchainVouchService';
import {
  BlockchainSyncQueueService,
  getUserFacingErrorMessage,
} from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { WalletService } from '@/features/BlockchainWallet/services/walletService';
import { buildMemberRegistryRef, VouchDoc } from '@belrose/shared';

// ============================================================================
// HELPERS
// ============================================================================

export function getVouchId(voucherId: string, voucheeId: string): string {
  return `${voucherId}_${voucheeId}`;
}

// ============================================================================
// WRITE FUNCTIONS
// ============================================================================

/**
 * Give a vouch to another user.
 * Firestore-first: see the file header comment for the full pattern.
 *
 * @param voucherId  - Firebase UID of the voucher (caller)
 * @param voucheeId  - Firebase UID of the vouchee
 * @returns The vouch document ID
 */
export async function createVouch(voucherId: string, voucheeId: string): Promise<string> {
  // firestore.rules also rejects this (voucheeId != caller), but that surfaces as a generic
  // "Missing or insufficient permissions" error — check it here first so the caller gets a
  // clear, actionable message instead.
  if (voucherId === voucheeId) {
    throw new Error('You cannot vouch for yourself.');
  }

  const db = getFirestore();
  const vouchId = getVouchId(voucherId, voucheeId);
  const docRef = doc(db, 'vouches', vouchId);

  const existing = await getDoc(docRef);
  if (existing.exists() && existing.data()?.chainStatus === 'Active') {
    throw new Error('You are already vouching for this user.');
  }

  // Fails before any write if the caller has no wallet linked — without one the blockchain
  // step below can never succeed, so don't leave a permanently stuck Firestore doc behind.
  const userWalletAddress = await WalletService.requireUserWalletAddress(voucherId);

  console.log('🤝 Creating vouch:', { voucherId, voucheeId });

  // Step 1: Firestore first — this is what the user experiences as "vouch created".
  // chainStatus starts 'Pending'; onChainHistory is filled in once the chain call below
  // resolves, so it only ever contains confirmed on-chain events.
  const voucherIdHash = ethers.id(voucherId);
  const voucheeIdHash = ethers.id(voucheeId);

  try {
    if (existing.exists()) {
      // Re-vouching after retraction
      await updateDoc(docRef, {
        chainStatus: 'Pending',
        lastModified: Timestamp.now(),
      });
      console.log('✅ Firestore: Vouch reactivated');
    } else {
      await setDoc(docRef, {
        voucherId,
        voucherIdHash,
        voucheeId,
        voucheeIdHash,
        chainStatus: 'Pending',
        createdAt: Timestamp.now(),
        onChainHistory: [],
      } satisfies Omit<VouchDoc, 'id'>);
      console.log('✅ Firestore: Vouch created');
    }
  } catch (firestoreError) {
    Sentry.captureException(firestoreError, {
      tags: { feature: 'credibility', action: 'createVouch' },
    });
    throw firestoreError;
  }

  console.log('✅ Vouch created successfully');

  // Step 2: Blockchain — best-effort, does not revert the Firestore write above. Failure is
  // tracked in the sync queue for a future reconciliation engine to retry.
  const syncRef = await BlockchainSyncQueueService.startAttempt({
    contract: 'MemberRoleManager',
    action: 'giveVouch',
    userId: voucherId,
    userWalletAddress,
    permissionHistoryPath: docRef.path,
    context: { type: 'vouch', voucherId, voucheeId },
  });

  try {
    const tx = await blockchainVouchService.giveVouch(voucheeId);
    const blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
    const vouchAction: 'vouched' | 're-vouched' = existing.exists() ? 're-vouched' : 'vouched';
    const vouchedEvent = { action: vouchAction, at: Timestamp.now(), blockchainRef };

    await updateDoc(docRef, {
      chainStatus: 'Active',
      onChainHistory: arrayUnion(vouchedEvent),
    });
    await BlockchainSyncQueueService.recordSuccess(syncRef, tx);
    console.log('✅ Blockchain: Vouch recorded');
  } catch (error) {
    console.error('⚠️ Blockchain vouch failed:', error);
    const errorMessage = getUserFacingErrorMessage(error, 'Blockchain transaction failed');
    await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    try {
      await updateDoc(docRef, { chainStatus: 'Failed' });
    } catch {
      // Non-fatal — the sync queue entry above is the durable record for reconciliation
    }
  }

  return vouchId;
}

/**
 * Retract a previously given vouch.
 * Firestore-first: see the file header comment for the full pattern.
 *
 * @param voucherId  - Firebase UID of the voucher (caller)
 * @param voucheeId  - Firebase UID of the vouchee
 */
export async function retractVouch(voucherId: string, voucheeId: string): Promise<void> {
  const db = getFirestore();
  const vouchId = getVouchId(voucherId, voucheeId);
  const docRef = doc(db, 'vouches', vouchId);

  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) {
    throw new Error('Vouch not found.');
  }

  const data = snapshot.data();
  if (data?.chainStatus !== 'Active') {
    throw new Error('No active vouch to retract.');
  }

  if (data.voucherId !== voucherId) {
    throw new Error('You can only retract your own vouches.');
  }

  // Fails before any write if the caller has no wallet linked.
  const userWalletAddress = await WalletService.requireUserWalletAddress(voucherId);

  console.log('↩️ Retracting vouch:', { voucherId, voucheeId });

  // Step 1: Firestore first
  try {
    await updateDoc(docRef, {
      chainStatus: 'Pending',
      lastModified: Timestamp.now(),
    });
    console.log('✅ Firestore: Vouch marked pending retraction');
  } catch (firestoreError) {
    Sentry.captureException(firestoreError, {
      tags: { feature: 'credibility', action: 'retractVouch' },
    });
    throw firestoreError;
  }

  // Step 2: Blockchain — best-effort, does not revert the Firestore write above.
  const syncRef = await BlockchainSyncQueueService.startAttempt({
    contract: 'MemberRoleManager',
    action: 'retractVouch',
    userId: voucherId,
    userWalletAddress,
    permissionHistoryPath: docRef.path,
    context: { type: 'vouch-retraction', voucherId, voucheeId },
  });

  try {
    const tx = await blockchainVouchService.retractVouch(voucheeId);
    const blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);

    await updateDoc(docRef, {
      chainStatus: 'Retracted',
      onChainHistory: arrayUnion({
        action: 'retracted' as const,
        at: Timestamp.now(),
        blockchainRef,
      }),
    });
    await BlockchainSyncQueueService.recordSuccess(syncRef, tx);
    console.log('✅ Blockchain: Vouch retracted');
  } catch (error) {
    console.error('⚠️ Blockchain vouch retraction failed:', error);
    const errorMessage = getUserFacingErrorMessage(error, 'Blockchain transaction failed');
    await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    try {
      await updateDoc(docRef, { chainStatus: 'Failed' });
    } catch {
      // Non-fatal — the sync queue entry above is the durable record for reconciliation
    }
  }

  console.log('✅ Vouch retracted successfully');
}

// ============================================================================
// READ FUNCTIONS
// ============================================================================

/**
 * Get the vouch document between two users, or null if none exists.
 */
export async function getVouch(voucherId: string, voucheeId: string): Promise<VouchDoc | null> {
  const db = getFirestore();
  const vouchId = getVouchId(voucherId, voucheeId);
  try {
    const snapshot = await getDoc(doc(db, 'vouches', vouchId));
    if (!snapshot.exists()) return null;
    return { id: snapshot.id, ...snapshot.data() } as VouchDoc;
  } catch {
    return null;
  }
}

/**
 * Get all vouches a user has given (any status).
 */
export async function getVouchesGiven(voucherId: string): Promise<VouchDoc[]> {
  const db = getFirestore();
  const q = query(collection(db, 'vouches'), where('voucherId', '==', voucherId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }) as VouchDoc);
}

/**
 * Get all vouches a user has received (any status).
 */
export async function getVouchesReceived(voucheeId: string): Promise<VouchDoc[]> {
  const db = getFirestore();
  const q = query(collection(db, 'vouches'), where('voucheeId', '==', voucheeId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }) as VouchDoc);
}

/**
 * Get only active vouches a user has given.
 */
export async function getActiveVouchesGiven(voucherId: string): Promise<VouchDoc[]> {
  const db = getFirestore();
  const q = query(
    collection(db, 'vouches'),
    where('voucherId', '==', voucherId),
    where('chainStatus', '==', 'Active')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }) as VouchDoc);
}

/**
 * Get only active vouches a user has received.
 */
export async function getActiveVouchesReceived(voucheeId: string): Promise<VouchDoc[]> {
  const db = getFirestore();
  const q = query(
    collection(db, 'vouches'),
    where('voucheeId', '==', voucheeId),
    where('chainStatus', '==', 'Active')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }) as VouchDoc);
}
