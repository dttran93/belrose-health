//src/features/CredibilityRecord/services/disputeService.ts

/**
 * Firestore-first: every write here (createDispute, retractDispute, modifyDispute) commits its
 * Firestore doc change first — chainStatus starts 'pending' — and updates the record's
 * credibility score off that write alone. The blockchain call is a separate, best-effort step
 * afterward, tracked via BlockchainSyncQueueService (startAttempt/recordSuccess/recordFailure):
 * success flips chainStatus to 'confirmed' and appends the onChainHistory event (so
 * onChainHistory only ever contains confirmed on-chain events); failure flips it to 'failed' and
 * leaves a durable sync-queue entry for a future reconciliation engine to retry. It does not gate
 * or revert the Firestore write, matching SubjectService's pattern.
 */

import { ethers, id } from 'ethers';
import {
  getFirestore,
  collection,
  updateDoc,
  arrayUnion,
  doc,
  Timestamp,
  query,
  where,
  getDocs,
  getDoc,
  setDoc,
} from 'firebase/firestore';
import * as Sentry from '@sentry/react';
import { EncryptionKeyManager } from '@/features/Encryption/services/encryptionKeyManager';
import { EncryptionService } from '@/features/Encryption/services/encryptionService';
import { RecordDecryptionService } from '@/features/Encryption/services/recordDecryptionService';
import { blockchainHealthRecordService } from './blockchainHealthRecordService';
import { arrayBufferToBase64, base64ToArrayBuffer } from '@/utils/dataFormattingUtils';
import { getVerificationId } from './verificationService';
import {
  onDisputeCreated,
  onDisputeModified,
  onDisputeRevoked,
  computeNormalizedCredibility,
} from './credibilityScoreService';
import {
  BlockchainSyncQueueService,
  getUserFacingErrorMessage,
} from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { WalletService } from '@/features/BlockchainWallet/services/walletService';
import {
  DisputeCulpability,
  DisputeDoc,
  DisputeSeverityOptions,
  EncryptedField,
  INITIAL_SCORE,
} from '@belrose/shared';
import { buildHealthRecordRef } from '@belrose/shared';
import { encryptNotificationTitle } from '@/features/Notifications/services/encryptNotificationTitle';

// ============================================================
// TYPES
// ============================================================

export type DisputeSeverity = 0 | 1 | 2 | 3; // 0 used in blockchain for returning errors
export type DisputeSeverityOptionNames = 'Negligible' | 'Moderate' | 'Major';

export type DisputeCulpabilityName =
  | 'Unknown'
  | 'No Fault'
  | 'Systemic'
  | 'Preventable'
  | 'Reckless'
  | 'Intentional';

export interface SeverityConfig {
  value: DisputeSeverityOptions;
  name: DisputeSeverityOptionNames;
  description: string;
  declarative: string;
  color: 'blue' | 'yellow' | 'red' | 'gray';
}

export interface CulpabilityConfig {
  value: DisputeCulpability;
  name: DisputeCulpabilityName;
  description: string;
  declarative: string;
}

/** Extended type with decrypted notes for display */
export interface DisputeDocDecrypted extends Omit<DisputeDoc, 'encryptedNotes'> {
  notes: string;
}

// ============================================================
// CONSTANTS
// ============================================================

export const SEVERITY_CONFIG: Record<DisputeSeverityOptions, SeverityConfig> = {
  1: {
    value: 1,
    name: 'Negligible',
    description:
      'A minor issue that does not significantly affect the usefulness or accuracy of the record. Unlikely to impact care decisions.',
    declarative: "Minor issue that doesn't affect clinical decisions",
    color: 'blue',
  },
  2: {
    value: 2,
    name: 'Moderate',
    description:
      'An issue that could potentially affect care decisions or treatment planning. Should be reviewed and corrected.',
    declarative: 'Noticeable error that could cause confusion',
    color: 'yellow',
  },
  3: {
    value: 3,
    name: 'Major',
    description:
      'A serious inaccuracy that could lead to incorrect diagnoses or harmful treatment decisions. Requires immediate attention.',
    declarative: 'Serious error that could affect patient safety',
    color: 'red',
  },
};

export const CULPABILITY_CONFIG: Record<DisputeCulpability, CulpabilityConfig> = {
  0: {
    value: 0,
    name: 'Unknown',
    description: 'Unknown why the error occurred.',
    declarative: 'Do not know why the mistake happened',
  },
  1: {
    value: 1,
    name: 'No Fault',
    description:
      'Unavoidable mistake, such as a false positive on a diagnostic test. No individual is responsible for the error.',
    declarative: 'Unavoidable mistake, no one to blame',
  },
  2: {
    value: 2,
    name: 'Systemic',
    description:
      'An organizational or process failure. The error stems from flawed procedures or systems.',
    declarative: 'Process or system issue, not individual error',
  },
  3: {
    value: 3,
    name: 'Preventable',
    description: 'An error that should have been caught through normal review processes.',
    declarative: 'Could have been caught with normal diligence',
  },
  4: {
    value: 4,
    name: 'Reckless',
    description: 'Careless disregard for accuracy or proper procedures.',
    declarative: 'Serious negligence in documentation',
  },
  5: {
    value: 5,
    name: 'Intentional',
    description: 'Deliberate falsification or manipulation of the record.',
    declarative: 'Deliberate falsification or manipulation',
  },
};

// Helper functions to access config
export const getSeverityConfig = (severity: DisputeSeverityOptions): SeverityConfig =>
  SEVERITY_CONFIG[severity];

export const getCulpabilityConfig = (culpability: DisputeCulpability): CulpabilityConfig =>
  CULPABILITY_CONFIG[culpability];

// Arrays for iterating in UI (forms, selects, etc.)
export const SEVERITY_OPTIONS = Object.values(SEVERITY_CONFIG);
export const CULPABILITY_OPTIONS = Object.values(CULPABILITY_CONFIG);

// ============================================================
// HELPERS
// ============================================================

/**
 * Generates a deterministic dispute document ID.
 * Format: {recordHash}_{disputerId}
 * This ensures one dispute per user per record hash.
 */
export function getDisputeId(recordHash: string, disputerId: string): string {
  return `${recordHash}_${disputerId}`;
}

/**
 * Encrypts notes using the record's encryption key
 */
async function encryptNotes(notes: string, recordId: string): Promise<EncryptedField> {
  const masterKey = await EncryptionKeyManager.getSessionKey();
  if (!masterKey) {
    throw new Error('Encryption session not active. Please unlock your encryption.');
  }

  const recordKey = await RecordDecryptionService.getRecordKey(recordId, masterKey);
  const encrypted = await EncryptionService.encryptText(notes, recordKey);

  return {
    encrypted: arrayBufferToBase64(encrypted.encrypted),
    iv: arrayBufferToBase64(encrypted.iv),
  };
}

/**
 * Decrypts notes using the record's encryption key
 */
async function decryptNotes(encryptedNotes: EncryptedField, recordId: string): Promise<string> {
  const masterKey = await EncryptionKeyManager.getSessionKey();
  if (!masterKey) {
    throw new Error('Encryption session not active. Please unlock your encryption.');
  }

  const recordKey = await RecordDecryptionService.getRecordKey(recordId, masterKey);
  const encryptedData = base64ToArrayBuffer(encryptedNotes.encrypted);
  const iv = base64ToArrayBuffer(encryptedNotes.iv);

  const decrypted = await EncryptionService.decryptText(encryptedData, recordKey, iv);

  return decrypted;
}

/**
 * Decrypts a DisputeDoc's notes field
 */
async function decryptDisputeDoc(dispute: DisputeDoc): Promise<DisputeDocDecrypted> {
  let notes = '';

  if (dispute.encryptedNotes) {
    try {
      notes = await decryptNotes(dispute.encryptedNotes, dispute.recordId);
    } catch (error) {
      console.error('Failed to decrypt dispute notes:', error);
      notes = '[Unable to decrypt notes]';
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { encryptedNotes, ...rest } = dispute;
  return { ...rest, notes };
}

// ============================================================
// QUERY FUNCTIONS
// ============================================================

/**
 * Fetches all disputes for a record (across all versions/hashes).
 * Uses Firestore query on recordId field.
 *
 * @param recordId - The record ID to fetch disputes for
 * @param decrypt - Whether to decrypt notes (requires encryption session)
 * @returns Array of DisputeDocDecrypted objects
 */
export async function getDisputesByRecordId(
  recordId: string,
  decrypt: boolean = true
): Promise<DisputeDocDecrypted[]> {
  const db = getFirestore();
  const disputesRef = collection(db, 'disputes');

  const q = query(disputesRef, where('recordId', '==', recordId));
  const snapshot = await getDocs(q);

  const disputes = snapshot.docs.map(
    doc =>
      ({
        id: doc.id,
        ...doc.data(),
      }) as DisputeDoc
  );

  if (decrypt) {
    // Decrypt all notes in parallel
    const decrypted = await Promise.all(disputes.map(d => decryptDisputeDoc(d)));
    return decrypted;
  }

  // Return without decryption (notes will be empty)
  return disputes.map(d => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { encryptedNotes, ...rest } = d;
    return { ...rest, notes: '' };
  });
}

/**
 * Fetches all disputes filed BY a given user, across every record — this is D(u) from the
 * whitepaper's DisputeAccuracy(u) formula. No orderBy (avoids needing a composite index);
 * callers wanting the full set can sort client-side if needed.
 *
 * @param userId - The disputer's user ID
 */
export async function getDisputesByUserId(userId: string): Promise<DisputeDoc[]> {
  const db = getFirestore();
  const q = query(collection(db, 'disputes'), where('disputerId', '==', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }) as DisputeDoc);
}

/**
 * Fetches disputes with version information.
 *
 * @param recordId - The record ID
 * @param hashVersionMap - Map of recordHash -> versionNumber
 * @returns Array of disputes with version info attached
 */
export async function getDisputesWithVersionInfo(
  recordId: string,
  hashVersionMap: Map<string, number>
): Promise<DisputeDoc[]> {
  const disputes = await getDisputesByRecordId(recordId);
  const totalVersions = hashVersionMap.size;

  return disputes.map(d => ({
    ...d,
    versionNumber: hashVersionMap.get(d.recordHash) ?? 0,
    totalVersions,
  }));
}

// ============================================================
// DISPUTE FUNCTIONS
// ============================================================

/**
 * Creates a new dispute for a record hash.
 *
 * @param recordId - The record ID
 * @param recordHash - The content hash being disputed
 * @param disputerId - The user creating the dispute
 * @param severity - Dispute severity level (1-3)
 * @param culpability - Culpability level (0-5)
 * @param notes - Optional encrypted notes
 * @returns The dispute document ID
 */
export async function createDispute(
  recordId: string,
  recordHash: string,
  disputerId: string,
  severity: DisputeSeverityOptions,
  culpability: DisputeCulpability,
  notes?: string,
  recordTitle?: string
): Promise<string> {
  const db = getFirestore();

  // CHECK 1: Ensure record exists before allowing dispute creation
  const recordRef = doc(db, 'records', recordId);
  const recordSnap = await getDoc(recordRef);

  if (!recordSnap.exists()) {
    throw new Error('Record not found.');
  }

  // Snapshot the record's current credibility score — the "before" baseline that
  // ValidationWeight compares against once the evaluation window elapses. Falls back to
  // INITIAL_SCORE for records with no verification/dispute activity yet (credibility field
  // not written until the first scoreEvent).
  const recordScoreAtCreation: number = recordSnap.data()?.credibility?.score ?? INITIAL_SCORE;

  // CHECK 2: Ensure there isn't already an existing active dispute
  const disputeId = getDisputeId(recordHash, disputerId);
  const docRef = doc(db, 'disputes', disputeId);
  const existing = await getDoc(docRef);

  if (existing.exists()) {
    const data = existing.data();

    if (data?.isActive && data?.chainStatus === 'confirmed') {
      throw new Error('You have already disputed this record. Use modify to update.');
    }

    console.log('Retrying failed or pending dispute...');
  }

  // CHECK 3: You cannot both dispute and verify the same recordHash
  const verificationId = getVerificationId(recordHash, disputerId);
  const verificationDocRef = doc(db, 'verifications', verificationId);
  const verificationExisting = await getDoc(verificationDocRef);

  if (verificationExisting.exists()) {
    const verificationData = verificationExisting.data();
    if (verificationData?.isActive) {
      throw new Error('You cannot both verify and dispute the same record hash');
    }
  }

  // Encrypt notes if provided
  let encryptedNotes: EncryptedField | null = null;
  let notesHash = '';

  if (notes && notes.trim()) {
    encryptedNotes = await encryptNotes(notes, recordId);
    notesHash = ethers.keccak256(ethers.toUtf8Bytes(notes));
  }

  // Fails before any write if the caller has no wallet linked — without one the blockchain
  // step below can never succeed, so don't leave a permanently stuck Firestore doc behind.
  const userWalletAddress = await WalletService.requireUserWalletAddress(disputerId);

  console.log('🔄 Creating dispute:', { recordId, recordHash, severity, culpability });

  // Encrypt title for notifications
  const titleData = recordTitle ? await encryptNotificationTitle(recordTitle, recordId) : null;

  // NormalizedCredibility(disputer), frozen at TRUE first creation only — reactivating an
  // existing (retracted) dispute reuses the value already on the doc rather than recomputing,
  // same anti-gaming rationale as recordScoreAtCreation/validationWeight below.
  const normalizedCredibilityAtCreation = existing.exists()
    ? ((existing.data()?.normalizedCredibilityAtCreation as number | undefined) ?? 1.0)
    : await computeNormalizedCredibility(disputerId);

  // Step 1: Firestore first — this is what the user experiences as "dispute created".
  // chainStatus starts 'pending'; onChainHistory is filled in once the chain call below
  // resolves, so it only ever contains confirmed on-chain events.
  try {
    if (existing.exists()) {
      // Reactivating a previously-retracted/failed dispute deliberately does NOT touch
      // recordScoreAtCreation or validationWeight — both stay exactly as they were from the
      // dispute's true first filing. Letting reactivation reset the baseline would let a
      // disputer choose a favorable comparison point (e.g. reactivate right when the record's
      // score happens to be momentarily high, then hope for reversion before the evaluation
      // window closes) — a timing-gaming vector on ValidationWeight/DisputeAccuracy. A stale
      // baseline on a reactivated dispute is fine and ungameable: the disputer is stuck with
      // whatever was true when they genuinely first disputed it.
      await updateDoc(docRef, {
        severity,
        culpability,
        encryptedNotes,
        notesHash,
        isActive: true,
        chainStatus: 'pending',
        error: null,
        lastModified: Timestamp.now(),
      });
      console.log('✅ Firestore: Dispute reactivated');
    } else {
      await setDoc(docRef, {
        recordHash,
        recordId,
        recordIdHash: id(recordId),
        disputerId,
        disputerIdHash: id(disputerId),
        severity,
        culpability,
        encryptedNotes,
        notesHash,
        isActive: true,
        createdAt: Timestamp.now(),
        chainStatus: 'pending',
        onChainHistory: [],
        recordScoreAtCreation,
        validationWeight: 0,
        normalizedCredibilityAtCreation,
        ...(titleData ?? {}),
      });
      console.log('✅ Firestore: Dispute created');
    }
  } catch (firestoreError) {
    Sentry.captureException(firestoreError, {
      tags: { feature: 'credibility', action: 'createDispute', recordId },
    });
    throw firestoreError;
  }

  // Step 2: Update credibility score — reflects immediately off the Firestore write,
  // independent of blockchain confirmation timing.
  await onDisputeCreated(
    recordId,
    recordHash,
    severity,
    culpability,
    normalizedCredibilityAtCreation
  );
  console.log('✅ Dispute created successfully');

  // Step 3: Blockchain — best-effort, does not revert the Firestore write above. Failure is
  // tracked in the sync queue for a future reconciliation engine to retry.
  const syncRef = await BlockchainSyncQueueService.startAttempt({
    contract: 'HealthRecordCore',
    action: 'createDispute',
    userId: disputerId,
    userWalletAddress,
    permissionHistoryPath: docRef.path,
    context: { type: 'dispute', recordId, recordHash, severity, culpability },
  });

  try {
    console.log('🔗 Writing dispute to blockchain...');
    const tx = await blockchainHealthRecordService.disputeRecord(
      recordId,
      recordHash,
      severity,
      culpability,
      notesHash
    );
    const blockchainRef = buildHealthRecordRef(tx.txHash, tx.blockNumber);
    const disputedEvent = { action: 'disputed' as const, at: Timestamp.now(), blockchainRef };

    await updateDoc(docRef, {
      chainStatus: 'confirmed',
      onChainHistory: arrayUnion(disputedEvent),
    });
    await BlockchainSyncQueueService.recordSuccess(syncRef, tx);
    console.log('✅ Blockchain: Dispute recorded');
  } catch (error) {
    console.error('⚠️ Blockchain dispute creation failed:', error);
    const errorMessage = getUserFacingErrorMessage(error, 'Blockchain transaction failed');
    await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    try {
      await updateDoc(docRef, { chainStatus: 'failed' });
    } catch {
      // Non-fatal — the sync queue entry above is the durable record for reconciliation
    }
  }

  return disputeId;
}

/**
 * Retracts (deactivates) a dispute.
 * Firestore-first: see the file header comment for the full pattern.
 *
 * @param recordHash - The content hash of the dispute to retract
 * @param disputerId - The user retracting the dispute
 */
export async function retractDispute(recordHash: string, disputerId: string): Promise<void> {
  const disputeId = getDisputeId(recordHash, disputerId);

  const db = getFirestore();
  const docRef = doc(db, 'disputes', disputeId);
  const snapshot = await getDoc(docRef);

  if (!snapshot.exists()) {
    throw new Error('Dispute not found');
  }

  const data = snapshot.data();
  if (!data?.isActive) {
    throw new Error('Dispute is already inactive');
  }

  if (data.disputerId !== disputerId) {
    throw new Error('You can only retract your own disputes');
  }

  // Fails before any write if the caller has no wallet linked.
  const userWalletAddress = await WalletService.requireUserWalletAddress(disputerId);

  console.log('🔄 Retracting dispute:', { recordHash, disputerId });

  // Step 1: Firestore first
  try {
    await updateDoc(docRef, {
      isActive: false,
      chainStatus: 'pending',
      lastModified: Timestamp.now(),
    });
    console.log('✅ Firestore: Dispute marked inactive');
  } catch (firestoreError) {
    Sentry.captureException(firestoreError, {
      tags: { feature: 'credibility', action: 'retractDispute', recordId: data.recordId },
    });
    throw firestoreError;
  }

  // Step 2: Credibility score
  const normalizedCredibilityAtCreation =
    (data.normalizedCredibilityAtCreation as number | undefined) ?? 1.0;
  await onDisputeRevoked(
    data.recordId,
    recordHash,
    data.severity,
    data.culpability,
    normalizedCredibilityAtCreation
  );

  // Step 3: Blockchain — best-effort, does not revert the Firestore write above.
  const syncRef = await BlockchainSyncQueueService.startAttempt({
    contract: 'HealthRecordCore',
    action: 'retractDispute',
    userId: disputerId,
    userWalletAddress,
    permissionHistoryPath: docRef.path,
    context: { type: 'dispute-retraction', recordId: data.recordId, recordHash },
  });

  try {
    const tx = await blockchainHealthRecordService.retractDispute(recordHash);
    const blockchainRef = buildHealthRecordRef(tx.txHash, tx.blockNumber);

    await updateDoc(docRef, {
      chainStatus: 'confirmed',
      onChainHistory: arrayUnion({
        action: 'retracted' as const,
        at: Timestamp.now(),
        blockchainRef,
      }),
    });
    await BlockchainSyncQueueService.recordSuccess(syncRef, tx);
    console.log('✅ Blockchain: Dispute retracted');
  } catch (error) {
    console.error('⚠️ Blockchain retraction failed:', error);
    const errorMessage = getUserFacingErrorMessage(error, 'Blockchain transaction failed');
    await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    try {
      await updateDoc(docRef, { chainStatus: 'failed' });
    } catch {
      // Non-fatal — the sync queue entry above is the durable record for reconciliation
    }
  }

  console.log('✅ Dispute retracted successfully');
}

/**
 * Modifies a dispute's severity and culpability.
 * Firestore-first: see the file header comment for the full pattern.
 * Note: Notes cannot be modified after creation (hash is on-chain).
 *
 * @param recordHash - The content hash of the dispute to modify
 * @param disputerId - The user modifying the dispute
 * @param newSeverity - New severity level
 * @param newCulpability - New culpability level
 */
export async function modifyDispute(
  recordHash: string,
  disputerId: string,
  newSeverity: DisputeSeverityOptions,
  newCulpability: DisputeCulpability
): Promise<void> {
  const disputeId = getDisputeId(recordHash, disputerId);
  const db = getFirestore();
  const docRef = doc(db, 'disputes', disputeId);
  const snapshot = await getDoc(docRef);

  if (!snapshot.exists()) {
    throw new Error('Dispute not found');
  }

  const data = snapshot.data();
  if (!data?.isActive) {
    throw new Error('Cannot modify an inactive dispute');
  }

  if (data.disputerId !== disputerId) {
    throw new Error('You can only modify your own dispute');
  }

  const oldSeverity = data.severity;
  const oldCulpability = data.culpability;

  if (oldSeverity === newSeverity && oldCulpability === newCulpability) {
    throw new Error('New values are the same as current values');
  }

  // Fails before any write if the caller has no wallet linked.
  const userWalletAddress = await WalletService.requireUserWalletAddress(disputerId);

  console.log('🔄 Modifying dispute:', {
    recordHash,
    oldSeverity,
    newSeverity,
    oldCulpability,
    newCulpability,
  });

  // Step 1: Firestore first
  try {
    await updateDoc(docRef, {
      severity: newSeverity,
      culpability: newCulpability,
      chainStatus: 'pending',
      lastModified: Timestamp.now(),
    });
    console.log('✅ Firestore: Dispute updated');
  } catch (firestoreError) {
    Sentry.captureException(firestoreError, {
      tags: { feature: 'credibility', action: 'modifyDispute', recordId: data.recordId },
    });
    throw firestoreError;
  }

  // Step 2: Credibility score
  const normalizedCredibilityAtCreation =
    (data.normalizedCredibilityAtCreation as number | undefined) ?? 1.0;
  await onDisputeModified(
    data.recordId,
    recordHash,
    oldSeverity,
    oldCulpability,
    newSeverity,
    newCulpability,
    normalizedCredibilityAtCreation
  );

  // Step 3: Blockchain — best-effort, does not revert the Firestore write above.
  const syncRef = await BlockchainSyncQueueService.startAttempt({
    contract: 'HealthRecordCore',
    action: 'modifyDispute',
    userId: disputerId,
    userWalletAddress,
    permissionHistoryPath: docRef.path,
    context: {
      type: 'dispute-modification',
      recordId: data.recordId,
      recordHash,
      oldSeverity,
      oldCulpability,
      newSeverity,
      newCulpability,
    },
  });

  try {
    const tx = await blockchainHealthRecordService.modifyDispute(
      recordHash,
      newSeverity,
      newCulpability
    );
    const blockchainRef = buildHealthRecordRef(tx.txHash, tx.blockNumber);

    await updateDoc(docRef, {
      chainStatus: 'confirmed',
      onChainHistory: arrayUnion({
        action: 'modified' as const,
        at: Timestamp.now(),
        blockchainRef,
        fromSeverity: oldSeverity,
        toSeverity: newSeverity,
        fromCulpability: oldCulpability,
        toCulpability: newCulpability,
      }),
    });
    await BlockchainSyncQueueService.recordSuccess(syncRef, tx);
    console.log('✅ Blockchain: Dispute modified');
  } catch (error) {
    console.error('⚠️ Blockchain modification failed:', error);
    const errorMessage = getUserFacingErrorMessage(error, 'Blockchain transaction failed');
    await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    try {
      await updateDoc(docRef, { chainStatus: 'failed' });
    } catch {
      // Non-fatal — the sync queue entry above is the durable record for reconciliation
    }
  }

  console.log('✅ Dispute modified successfully');
}

/**
 * Gets a single dispute by recordHash and disputerId.
 * Returns null if not found or on permission error.
 *
 * @param recordHash - The content hash
 * @param disputerId - The disputer's user ID
 * @param decrypt - Whether to decrypt notes
 * @returns The dispute document or null if not found
 */
export async function getDispute(
  recordHash: string,
  disputerId: string,
  decrypt: boolean = true
): Promise<DisputeDocDecrypted | null> {
  const disputeId = getDisputeId(recordHash, disputerId);

  const db = getFirestore();

  try {
    const snapshot = await getDoc(doc(db, 'disputes', disputeId));

    if (!snapshot.exists()) return null;

    const dispute = { id: snapshot.id, ...snapshot.data() } as DisputeDoc;

    if (decrypt) {
      return await decryptDisputeDoc(dispute);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { encryptedNotes, ...rest } = dispute;
    return { ...rest, notes: '' };
  } catch (error) {
    // Permission denied likely means doc doesn't exist for this user
    console.debug('Dispute not found or not accessible:', disputeId);
    return null;
  }
}
