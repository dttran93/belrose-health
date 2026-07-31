// src/features/Blockchain/services/blockchainSyncQueueService.ts
/**
 * Service to capture when blockchain fails to update. Used for auditing and debugging.
 * Captures universal information, contract, function, user, error message. And adds
 * custom data based on context
 */

import {
  DisputeCulpability,
  DisputeSeverityOptions,
  VerificationLevelOptions,
  TimestampLike,
  NETWORK_CORE,
  CONTRACT_ADDRESSES,
} from '@belrose/shared';
import {
  collection,
  addDoc,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  getFirestore,
  DocumentReference,
} from 'firebase/firestore';

// The contract being written to
export type BlockchainContract = 'MemberRoleManager' | 'HealthRecordCore' | 'BelrosePaymaster';

// chainId/contractAddress are known before a chain call is ever attempted (they're static
// config, not outcome data), so startAttempt stamps them on every entry — pending, confirmed,
// or failed — rather than each of recordSuccess/recordFailure re-deriving them separately.
const CONTRACT_ADDRESS_BY_NAME: Record<BlockchainContract, string> = {
  MemberRoleManager: CONTRACT_ADDRESSES.memberRoleManager,
  HealthRecordCore: CONTRACT_ADDRESSES.healthRecordCore,
  BelrosePaymaster: CONTRACT_ADDRESSES.paymaster,
};

// Base interface - always required
interface BaseSyncFailure {
  contract: BlockchainContract;
  action: string; // e.g., 'grantRole', 'anchorRecord', 'addMember'
  userId: string;
  userWalletAddress?: string;
  error: string;
}

// Context payload varies by operation type
export type SyncContext =
  | {
      type: 'permission';
      targetUserId: string;
      targetWalletAddress: string;
      role: string | string[];
      recordId: string | string[];
      recordIdHash: string | string[];
    }
  | { type: 'memberRegistry'; newStatus?: string }
  | { type: 'anchorRecord'; recordId: string; recordHash: string; subjectId: string }
  | { type: 'unanchorRecord'; recordId: string; subjectId: string }
  | { type: 'reanchorRecord'; recordId: string; recordHash: string; subjectId: string }
  | { type: 'addRecordHash'; recordId: string; recordHash: string }
  | { type: 'verification'; recordId: string; recordHash: string; level: VerificationLevelOptions }
  | { type: 'verification-retraction'; recordId: string; recordHash: string }
  | {
      type: 'verification-modification';
      recordId: string;
      recordHash: string;
      oldLevel: VerificationLevelOptions;
      newLevel: VerificationLevelOptions;
    }
  | {
      type: 'dispute';
      recordId: string;
      recordHash: string;
      severity: DisputeSeverityOptions;
      culpability: DisputeCulpability;
    }
  | { type: 'dispute-retraction'; recordId: string; recordHash: string }
  | {
      type: 'dispute-modification';
      recordId: string;
      recordHash: string;
      oldSeverity: DisputeSeverityOptions;
      oldCulpability: DisputeCulpability;
      newSeverity: DisputeSeverityOptions;
      newCulpability: DisputeCulpability;
    }
  | { type: 'flagUnacceptedUpdate'; recordId: string; recordHash: string; disputeId: string }
  | { type: 'resolveUnacceptedUpdate'; recordId: string; recordHash: string; disputeId: string }
  | {
      type: 'trustee-propose';
      trustorId: string;
      trustorIdHash: string;
      trusteeId: string;
      trusteeIdHash: string;
    }
  | {
      type: 'trustee-accept';
      trustorId: string;
      trustorIdHash: string;
      trusteeId: string;
      trusteeIdHash: string;
    }
  | {
      type: 'trustee-revoke';
      trustorId: string;
      trustorIdHash: string;
      trusteeId: string;
      trusteeIdHash: string;
    }
  | {
      type: 'trustee-decline';
      trustorId: string;
      trustorIdHash: string;
      trusteeId: string;
      trusteeIdHash: string;
    }
  | {
      type: 'trustee-level-update';
      trustorId: string;
      trustorIdHash: string;
      trusteeId: string;
      trusteeIdHash: string;
    }
  | { type: 'vouch'; voucherId: string; voucheeId: string }
  | { type: 'vouch-retraction'; voucherId: string; voucheeId: string };

export interface BlockchainSyncFailure extends BaseSyncFailure {
  context: SyncContext;
}

// Attempt logged before the chain call is made (Firestore-first flows only — see
// PermissionsService.grantAdmin). Distinct from BlockchainSyncFailure: this is opened
// as 'pending' regardless of outcome, not just on failure, so a client crash mid-transaction
// still leaves a durable record for reconciliation to find. No `error` field — that's only
// known once the attempt resolves, via recordFailure.
export interface BlockchainSyncAttempt extends Omit<BaseSyncFailure, 'error'> {
  context: SyncContext;
  // Path(s) back to the records/{id}/permissionHistory event(s) this attempt corresponds
  // to, so blockchainRef can be filled in once the chain call resolves. An array for batch
  // methods (grantRoleBatch etc.) — one chain transaction covers many records at once.
  permissionHistoryPath?: string | string[];
}

// Shape of a blockchainSyncQueue document as read from Firestore — extends the write type
// (either a failure-only legacy entry or a startAttempt-opened entry) with the fields added
// at write time.
export type SyncQueueRecord = (BlockchainSyncFailure | BlockchainSyncAttempt) & {
  id: string;
  status?: 'pending' | 'confirmed' | 'failed' | string;
  retryCount?: number;
  createdAt?: TimestampLike;
  lastAttemptAt?: TimestampLike;
  // Stamped by startAttempt on every entry — known upfront, not outcome data.
  chainId?: number;
  contractAddress?: string;
  // Only present once recordSuccess has run.
  txHash?: string;
  blockNumber?: number;
  error?: string;
};

// Decodes a standard Error(string) ABI revert: selector 0x08c379a0 + ABI-encoded string.
// Returns the human-readable reason, or null if the error doesn't contain one.
export function decodeRevertReason(error: string): string | null {
  const data = error.match(/0x08c379a0([0-9a-f]+)/i)?.[1];
  if (!data || data.length < 128) return null;
  try {
    const length = parseInt(data.slice(64, 128), 16);
    if (length === 0 || length > 1024) return null;
    const stringHex = data.slice(128, 128 + length * 2);
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = parseInt(stringHex.slice(i * 2, i * 2 + 2), 16);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

// Produces a user-facing error message from a caught error — prefers a decoded
// Solidity revert reason over the raw error text (viem errors are a multi-line
// dump of calldata/gas/signature that's meaningless to end users).
export function getUserFacingErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : undefined;
  if (raw) {
    const decoded = decodeRevertReason(raw);
    if (decoded) return decoded;
  }
  return raw ?? fallback;
}

export class BlockchainSyncQueueService {
  /**
   * Log any blockchain write failure for retry
   */
  static async logFailure(failure: BlockchainSyncFailure): Promise<void> {
    try {
      const db = getFirestore();
      await addDoc(collection(db, 'blockchainSyncQueue'), {
        ...failure,
        status: 'pending',
        retryCount: 0,
        createdAt: serverTimestamp(),
        lastAttemptAt: serverTimestamp(),
      });
      console.log(`📝 Logged ${failure.contract}.${failure.action} failure for retry`);
    } catch (logError) {
      console.error('❌ Failed to log blockchain sync failure:', logError);
    }
  }

  /**
   * Open a durable 'pending' record before attempting a chain write, for Firestore-first
   * flows where the chain call is best-effort and must not revert the Firestore write that
   * already succeeded. Call recordSuccess/recordFailure once the attempt resolves.
   */
  static async startAttempt(attempt: BlockchainSyncAttempt): Promise<DocumentReference> {
    const db = getFirestore();
    const ref = doc(collection(db, 'blockchainSyncQueue'));
    await setDoc(ref, {
      ...attempt,
      chainId: NETWORK_CORE.chainId,
      contractAddress: CONTRACT_ADDRESS_BY_NAME[attempt.contract],
      status: 'pending',
      retryCount: 0,
      createdAt: serverTimestamp(),
      lastAttemptAt: serverTimestamp(),
    });
    return ref;
  }

  static async recordSuccess(
    ref: DocumentReference,
    tx: { txHash: string; blockNumber: number }
  ): Promise<void> {
    await updateDoc(ref, {
      status: 'confirmed',
      ...tx,
      lastAttemptAt: serverTimestamp(),
    });
  }

  static async recordFailure(ref: DocumentReference, error: string): Promise<void> {
    try {
      await updateDoc(ref, {
        status: 'failed',
        error,
        lastAttemptAt: serverTimestamp(),
      });
    } catch (updateError) {
      console.error('❌ Failed to record blockchain sync attempt failure:', updateError);
    }
  }
}
