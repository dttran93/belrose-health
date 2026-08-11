//src/features/Credibility/services/verificationService.ts

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  arrayUnion,
  Timestamp,
  collection,
  where,
  query,
  getDocs,
} from 'firebase/firestore';
import { blockchainHealthRecordService } from './blockchainHealthRecordService';
import { FileText, Lock, LucideIcon, MapPin, X } from 'lucide-react';
import { getDisputeId } from './disputeService';
import {
  onVerificationCreated,
  onVerificationModified,
  onVerificationRevoked,
} from './credibilityScoreService';
import { BlockchainSyncQueueService } from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { VerificationDoc, VerificationLevelOptions } from '@belrose/shared';
import { buildHealthRecordRef, BlockchainRef } from '@belrose/shared';
import { encryptNotificationTitle } from '@/features/Notifications/services/encryptNotificationTitle';
import { id } from 'ethers';

// ============================================================
// TYPES
// ============================================================

export type VerificationLevel = 0 | 1 | 2 | 3;
export type VerificationLevelOptionName = 'Provenance' | 'Content' | 'Full';

export interface VerificationConfig {
  value: VerificationLevelOptions;
  name: VerificationLevelOptionName;
  icon: LucideIcon;
  description: string;
  declarative: string;
}

// ============================================================
// CONSTANTS
// ============================================================

export const VERIFICATION_LEVEL_CONFIG: Record<VerificationLevelOptions, VerificationConfig> = {
  3: {
    value: 3,
    name: 'Full',
    icon: Lock,
    declarative:
      'I created this record or am willing to verify both the content and provenance of the record.',
    description:
      'The verifier is vouching for both the content and the provenance of this record. They are either the provider who originally created the record or directly verified that the record is complete and accuate',
  },
  2: {
    value: 2,
    name: 'Content',
    icon: FileText,
    declarative:
      'I am vouching for the content of the record, but I did not observe the original interaction described.',
    description:
      'The verifier is vouching for the content of the record. They may not have originally created the record or directly observed the interaction, however they have certified they agree with its content.',
  },
  1: {
    value: 1,
    name: 'Provenance',
    icon: MapPin,
    declarative:
      'I am confirming that the origin of the record is correct. I am not verifying the accuracy of its content.',
    description:
      'The verifier is confirming the origin of the record is correctly stated. They are not verifying the completeness and accuracy of the content itself.',
  },
};

// Helper functions to access config
export const getVerificationConfig = (
  verificationLevel: VerificationLevelOptions
): VerificationConfig => VERIFICATION_LEVEL_CONFIG[verificationLevel];

// Arrays for iterating in UI (forms, selects, etc.)
export const VERIFICATION_OPTIONS = Object.values(VERIFICATION_LEVEL_CONFIG);

// ============================================================
// HELPERS
// ============================================================

/**
 * Generates a deterministic verification document ID.
 * Format: {recordHash}_{verifierId}
 * This ensures one verification per user per record hash.
 */
export function getVerificationId(recordHash: string, verifierId: string): string {
  return `${recordHash}_${verifierId}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ============================================================
// QUERY FUNCTIONS
// ============================================================

/**
 * Fetches all verifications for a record (across all versions/hashes).
 * Uses Firestore query on recordId field.
 *
 * @param recordId - The record ID to fetch verifications for
 * @returns Array of VerificationDoc objects
 */
export async function getVerificationsByRecordId(recordId: string): Promise<VerificationDoc[]> {
  const db = getFirestore();
  const verificationsRef = collection(db, 'verifications');

  // Query all verifications where recordId matches
  const q = query(verificationsRef, where('recordId', '==', recordId));
  const snapshot = await getDocs(q);

  return snapshot.docs.map(
    doc =>
      ({
        id: doc.id,
        ...doc.data(),
      }) as VerificationDoc
  );
}

/**
 * Fetches all verifications made BY a given user, across every record — this is R(u) from the
 * whitepaper's AvgRecordCredibility(u) formula. No orderBy (avoids needing a composite index);
 * callers wanting the full set can sort client-side if needed.
 *
 * @param userId - The verifier's user ID
 */
export async function getVerificationsByUserId(userId: string): Promise<VerificationDoc[]> {
  const db = getFirestore();
  const q = query(collection(db, 'verifications'), where('verifierId', '==', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }) as VerificationDoc);
}

/**
 * Fetches verifications with version information.
 * Groups verifications by hash and includes version numbers.
 *
 * @param recordId - The record ID
 * @param hashVersionMap - Map of recordHash -> versionNumber (from record's version history)
 * @returns Array of verifications with version info attached
 */
export async function getVerificationsWithVersionInfo(
  recordId: string,
  hashVersionMap: Map<string, number>
): Promise<VerificationDoc[]> {
  const verifications = await getVerificationsByRecordId(recordId);
  const totalVersions = hashVersionMap.size;

  return verifications.map(v => ({
    ...v,
    versionNumber: hashVersionMap.get(v.recordHash) ?? 0,
    totalVersions,
  }));
}

// ============================================================
// VERIFICATION FUNCTIONS
// ============================================================

/**
 * Create a new verification for a record.
 *
 * @param recordId - The record ID
 * @param recordHash - The content hash being verified
 * @param verifierId - The user creating the verification
 * @param level - The verification level (1, 2, or 3)
 * @returns The verification document ID
 */
export async function createVerification(
  recordId: string,
  recordHash: string,
  verifierId: string,
  level: VerificationLevelOptions,
  recordTitle?: string
): Promise<string> {
  const db = getFirestore();

  // CHECK 1: Ensure record exists
  const recordRef = doc(db, 'records', recordId);
  const recordSnap = await getDoc(recordRef);

  if (!recordSnap.exists()) {
    throw new Error('Record not found.');
  }

  // CHECK 2: Check for existing verification
  const verificationId = getVerificationId(recordHash, verifierId);
  const docRef = doc(db, 'verifications', verificationId);
  const existing = await getDoc(docRef);

  if (existing.exists()) {
    const data = existing.data();

    // If it's already confirmed on-chain and active, block it.
    if (data?.isActive && data?.chainStatus === 'confirmed') {
      throw new Error('You have already verified this record. Use modify to update.');
    }

    console.log('Retrying failed or pending verification...');
  }

  // CHECK 3: You cannot both dispute and verify the same recordHash
  const disputeId = getDisputeId(recordHash, verifierId);
  const disputeDocRef = doc(db, 'disputes', disputeId);
  const disputeExisting = await getDoc(disputeDocRef);

  if (disputeExisting.exists()) {
    const disputeData = disputeExisting.data();
    if (disputeData?.isActive) {
      throw new Error('You cannot both verify and dispute the same record hash');
    }
  }

  console.log('🔄 Creating verification:', { recordId, recordHash, level });

  const titleData = recordTitle ? await encryptNotificationTitle(recordTitle, recordId) : null;

  // Step 1: Write to blockchain
  let blockchainRef;
  try {
    console.log('🔗 Writing verification to blockchain...');
    const tx = await blockchainHealthRecordService.verifyRecord(recordId, recordHash, level);
    blockchainRef = buildHealthRecordRef(tx.txHash, tx.blockNumber);
    console.log('✅ Blockchain: Verification recorded');
  } catch (error) {
    console.error('❌ Blockchain verification failed:', error);
    await BlockchainSyncQueueService.logFailure({
      contract: 'HealthRecordCore',
      action: 'verifyRecord',
      userId: verifierId,
      error: getErrorMessage(error),
      context: { type: 'verification', recordId, recordHash, level },
    });
    throw error;
  }

  // Step 2: Firestore
  try {
    const verifiedEvent = { action: 'verified' as const, at: Timestamp.now(), blockchainRef };
    if (existing.exists()) {
      await updateDoc(docRef, {
        level,
        isActive: true,
        chainStatus: 'confirmed',
        onChainHistory: arrayUnion(verifiedEvent),
        error: null,
        lastModified: Timestamp.now(),
      });
      console.log('✅ Firestore: Verification reactivated');
    } else {
      await setDoc(docRef, {
        recordHash,
        recordId,
        verifierId,
        verifierIdHash: id(verifierId),
        level,
        isActive: true,
        createdAt: Timestamp.now(),
        chainStatus: 'confirmed',
        onChainHistory: [verifiedEvent],
        ...(titleData ?? {}),
      });
      console.log('✅ Firestore: Verification created');
    }
  } catch (error) {
    console.error('❌ Firestore write failed after confirmed blockchain tx:', error);
    throw error;
  }

  // Step 3: Credibility score
  await onVerificationCreated(recordId, recordHash, level, blockchainRef!);
  console.log('✅ Verification created successfully');
  return verificationId;
}

/**
 * Mirror a self-verification that already happened on-chain as part of anchorRecord's
 * selfVerifyLevel nudge (see HealthRecordCore._maybeSelfVerify).
 *
 * Unlike createVerification, this does NOT call verifyRecord on-chain — that already ran inside
 * the anchor transaction. Calling it again would revert with "Already verified this hash" since
 * _maybeSelfVerify already set currentlyVerified[recordHash][verifierIdHash] = true.
 *
 * _maybeSelfVerify silently no-ops (does not emit RecordVerified) if the verifier already
 * verified this hash or is actively disputing it, and the anchor tx result gives no way to tell
 * whether it actually fired. This mirrors those same guards so we never write a Firestore
 * verification doc for a self-verify the contract silently skipped. Returns null when skipped.
 */
export async function recordSelfVerification(
  recordId: string,
  recordHash: string,
  verifierId: string,
  level: VerificationLevelOptions,
  blockchainRef: BlockchainRef,
  recordTitle?: string
): Promise<string | null> {
  const db = getFirestore();

  const verificationId = getVerificationId(recordHash, verifierId);
  const docRef = doc(db, 'verifications', verificationId);
  const existing = await getDoc(docRef);

  // Mirrors _maybeSelfVerify's "already verified this hash" no-op guard.
  if (existing.exists()) {
    const data = existing.data();
    if (data?.isActive && data?.chainStatus === 'confirmed') {
      return null;
    }
  }

  // Mirrors _maybeSelfVerify's "actively disputing this hash" no-op guard.
  const disputeId = getDisputeId(recordHash, verifierId);
  const disputeExisting = await getDoc(doc(db, 'disputes', disputeId));
  if (disputeExisting.exists() && disputeExisting.data()?.isActive) {
    return null;
  }

  console.log('🔄 Mirroring self-verification from anchor tx:', { recordId, recordHash, level });

  const titleData = recordTitle ? await encryptNotificationTitle(recordTitle, recordId) : null;
  const verifiedEvent = { action: 'verified' as const, at: Timestamp.now(), blockchainRef };

  if (existing.exists()) {
    await updateDoc(docRef, {
      level,
      isActive: true,
      chainStatus: 'confirmed',
      onChainHistory: arrayUnion(verifiedEvent),
      error: null,
      lastModified: Timestamp.now(),
    });
    console.log('✅ Firestore: Self-verification reactivated');
  } else {
    await setDoc(docRef, {
      recordHash,
      recordId,
      verifierId,
      verifierIdHash: id(verifierId),
      level,
      isActive: true,
      createdAt: Timestamp.now(),
      chainStatus: 'confirmed',
      onChainHistory: [verifiedEvent],
      ...(titleData ?? {}),
    });
    console.log('✅ Firestore: Self-verification created');
  }

  await onVerificationCreated(recordId, recordHash, level, blockchainRef);
  console.log('✅ Self-verification mirrored successfully');
  return verificationId;
}

/**
 * Retract an existing verification.
 * Atomic operation: blockchain first, then Firestore.
 *
 * @param recordHash - The content hash of the verification to retract
 * @param verifierId - The user retracting the verification
 */
export async function retractVerification(recordHash: string, verifierId: string): Promise<void> {
  // CHECK 1: Find the verification and make sure it is active
  const verificationId = getVerificationId(recordHash, verifierId);

  const db = getFirestore();
  const docRef = doc(db, 'verifications', verificationId);
  const snapshot = await getDoc(docRef);

  if (!snapshot.exists()) {
    throw new Error('Verification not found');
  }

  const data = snapshot.data();
  if (!data?.isActive) {
    throw new Error('Verification is already inactive');
  }

  // CHECK 2: You can only retract your own verification
  if (data.verifierId !== verifierId) {
    throw new Error('You can only retract your own verifications');
  }

  console.log('🔄 Retracting verification:', { recordHash, verifierId });

  // Step 1: Blockchain only
  let blockchainRef;
  try {
    const tx = await blockchainHealthRecordService.retractVerification(recordHash);
    blockchainRef = buildHealthRecordRef(tx.txHash, tx.blockNumber);
    console.log('✅ Blockchain: Verification retracted');
  } catch (error) {
    console.error('❌ Blockchain retraction failed:', error);
    await BlockchainSyncQueueService.logFailure({
      contract: 'HealthRecordCore',
      action: 'retractVerification',
      userId: verifierId,
      error: getErrorMessage(error),
      context: { type: 'verification-retraction', recordId: data.recordId, recordHash },
    });
    throw error;
  }

  // Step 2: Firestore
  try {
    await updateDoc(docRef, {
      isActive: false,
      lastModified: Timestamp.now(),
      chainStatus: 'confirmed',
      onChainHistory: arrayUnion({
        action: 'retracted' as const,
        at: Timestamp.now(),
        blockchainRef,
      }),
    });
    console.log('✅ Firestore: Verification marked inactive');
  } catch (error) {
    console.error('❌ Firestore write failed after confirmed blockchain retraction:', error);
    throw error;
  }

  // Step 3: Credibility score
  await onVerificationRevoked(data.recordId, data.recordHash, data.level, blockchainRef!);
  console.log('✅ Verification retracted successfully');
}

/**
 * Modify the level of an existing verification.
 * Atomic operation: blockchain first, then Firestore.
 *
 * @param recordHash - The content hash of the verification to modify
 * @param verifierId - The user modifying the verification
 * @param newLevel - The new verification level
 */
export async function modifyVerificationLevel(
  recordHash: string,
  verifierId: string,
  newLevel: VerificationLevelOptions
): Promise<void> {
  // CHECK 1: Make sure that the verification exists and is active
  const verificationId = getVerificationId(recordHash, verifierId);
  const db = getFirestore();
  const docRef = doc(db, 'verifications', verificationId);
  const snapshot = await getDoc(docRef);

  if (!snapshot.exists()) {
    throw new Error('Verification not found');
  }

  const data = snapshot.data();
  if (!data?.isActive) {
    throw new Error('Cannot modify an inactive verification');
  }

  // CHECK 2: Ensure user owns this verification
  if (data.verifierId !== verifierId) {
    throw new Error('You can only modify your own verification');
  }

  // CHECK 3: Make sure that the verification level is different
  const oldLevel = data.level;
  if (oldLevel === newLevel) {
    throw new Error('New level is the same as current level');
  }

  console.log('🔄 Modifying verification level:', { recordHash, oldLevel, newLevel });

  // Step 1: Blockchain only
  let blockchainRef;
  try {
    const tx = await blockchainHealthRecordService.modifyVerificationLevel(recordHash, newLevel);
    blockchainRef = buildHealthRecordRef(tx.txHash, tx.blockNumber);
    console.log('✅ Blockchain: Verification level updated');
  } catch (error) {
    console.error('❌ Blockchain modification failed:', error);
    await BlockchainSyncQueueService.logFailure({
      contract: 'HealthRecordCore',
      action: 'modifyVerificationLevel',
      userId: verifierId,
      error: getErrorMessage(error),
      context: {
        type: 'verification-modification',
        recordId: data.recordId,
        recordHash,
        oldLevel,
        newLevel,
      },
    });
    throw error;
  }

  // Step 2: Firestore
  try {
    await updateDoc(docRef, {
      level: newLevel,
      lastModified: Timestamp.now(),
      chainStatus: 'confirmed',
      onChainHistory: arrayUnion({
        action: 'modified' as const,
        at: Timestamp.now(),
        blockchainRef,
        fromLevel: oldLevel,
        toLevel: newLevel,
      }),
    });
    console.log('✅ Firestore: Verification level updated');
  } catch (error) {
    console.error('❌ Firestore write failed after confirmed blockchain modification:', error);
    throw error;
  }

  // Step 3: Credibility score
  await onVerificationModified(data.recordId, recordHash, oldLevel, newLevel, blockchainRef!);
  console.log('✅ Verification level modified successfully');
}

/**
 * Get a specific verification by record hash and verifier ID.
 *
 * @param recordHash - The content hash
 * @param verifierId - The verifier's user ID
 * @returns The verification document or null if not found
 */
export async function getVerification(
  recordHash: string,
  verifierId: string
): Promise<VerificationDoc | null> {
  const verificationId = getVerificationId(recordHash, verifierId);

  const db = getFirestore();
  try {
    const snapshot = await getDoc(doc(db, 'verifications', verificationId));

    if (!snapshot.exists()) return null;

    return { id: snapshot.id, ...snapshot.data() } as VerificationDoc;
  } catch (error) {
    console.debug('Verification not found or not accessible:', verificationId);
    return null;
  }
}
