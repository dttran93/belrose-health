// src/features/CredibilityUser/services/vouchService.ts
//
// Orchestrates vouch operations: blockchain first, then Firestore.
// Mirrors the pattern of verificationService.ts.

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
import { ethers } from 'ethers';
import { blockchainVouchService } from './blockchainVouchService';
import { BlockchainSyncQueueService } from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { buildMemberRegistryRef, VouchDoc } from '@belrose/shared';

// ============================================================================
// HELPERS
// ============================================================================

export function getVouchId(voucherId: string, voucheeId: string): string {
  return `${voucherId}_${voucheeId}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ============================================================================
// WRITE FUNCTIONS
// ============================================================================

/**
 * Give a vouch to another user.
 * Blockchain first, then Firestore.
 *
 * @param voucherId  - Firebase UID of the voucher (caller)
 * @param voucheeId  - Firebase UID of the vouchee
 * @returns The vouch document ID
 */
export async function createVouch(voucherId: string, voucheeId: string): Promise<string> {
  const db = getFirestore();
  const vouchId = getVouchId(voucherId, voucheeId);
  const docRef = doc(db, 'vouches', vouchId);

  const existing = await getDoc(docRef);
  if (existing.exists() && existing.data()?.chainStatus === 'Active') {
    throw new Error('You are already vouching for this user.');
  }

  console.log('🤝 Creating vouch:', { voucherId, voucheeId });

  // Step 1: Blockchain
  let blockchainRef;
  try {
    const tx = await blockchainVouchService.giveVouch(voucheeId);
    blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
    console.log('✅ Blockchain: Vouch recorded');
  } catch (error) {
    console.error('❌ Blockchain vouch failed:', error);
    await BlockchainSyncQueueService.logFailure({
      contract: 'MemberRoleManager',
      action: 'giveVouch',
      userId: voucherId,
      error: getErrorMessage(error),
      context: { type: 'vouch', voucherId, voucheeId },
    });
    throw error;
  }

  // Step 2: Firestore
  const voucherIdHash = ethers.id(voucherId);
  const voucheeIdHash = ethers.id(voucheeId);

  try {
    if (existing.exists()) {
      // Re-vouching after retraction
      await updateDoc(docRef, {
        chainStatus: 'Active',
        onChainHistory: arrayUnion({
          action: 're-vouched' as const,
          at: Timestamp.now(),
          blockchainRef,
        }),
        lastModified: Timestamp.now(),
      });
      console.log('✅ Firestore: Vouch reactivated');
    } else {
      await setDoc(docRef, {
        voucherId,
        voucherIdHash,
        voucheeId,
        voucheeIdHash,
        chainStatus: 'Active',
        createdAt: Timestamp.now(),
        onChainHistory: [{ action: 'vouched' as const, at: Timestamp.now(), blockchainRef }],
      } satisfies Omit<VouchDoc, 'id'>);
      console.log('✅ Firestore: Vouch created');
    }
  } catch (error) {
    console.error('❌ Firestore write failed after confirmed blockchain vouch:', error);
    throw error;
  }

  console.log('✅ Vouch created successfully');
  return vouchId;
}

/**
 * Retract a previously given vouch.
 * Blockchain first, then Firestore.
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

  console.log('↩️ Retracting vouch:', { voucherId, voucheeId });

  // Step 1: Blockchain
  let blockchainRef;
  try {
    const tx = await blockchainVouchService.retractVouch(voucheeId);
    blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
    console.log('✅ Blockchain: Vouch retracted');
  } catch (error) {
    console.error('❌ Blockchain vouch retraction failed:', error);
    await BlockchainSyncQueueService.logFailure({
      contract: 'MemberRoleManager',
      action: 'retractVouch',
      userId: voucherId,
      error: getErrorMessage(error),
      context: { type: 'vouch-retraction', voucherId, voucheeId },
    });
    throw error;
  }

  // Step 2: Firestore
  try {
    await updateDoc(docRef, {
      chainStatus: 'Retracted',
      onChainHistory: arrayUnion({
        action: 'retracted' as const,
        at: Timestamp.now(),
        blockchainRef,
      }),
      lastModified: Timestamp.now(),
    });
    console.log('✅ Firestore: Vouch marked retracted');
  } catch (error) {
    console.error('❌ Firestore write failed after confirmed blockchain retraction:', error);
    throw error;
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
