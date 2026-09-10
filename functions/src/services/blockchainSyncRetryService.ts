// functions/src/services/blockchainSyncRetryService.ts
//
// Admin-triggered retry for the subset of blockchainSyncQueue entries that are signed by the
// permanent server-held admin wallet (see utils/adminWallet.ts) rather than an end user's own
// smart-account key. Only these 5 operations are retryable this way — everything else in the
// queue (permission grants, subject anchoring, verify/dispute, trustee actions, vouches) is
// signed client-side by the acting user's own session and can only ever be resubmitted from
// their own browser; a Cloud Function has no access to that key. addMemberBatch/
// bootstrapDependentTrustee (createDependentAccount.ts) are ALSO admin-wallet-signed but
// deliberately excluded — addMemberBatch's wallet addresses are generated fresh in-memory per
// attempt and never persisted before it succeeds (and the handler's outer catch deletes any
// residue on failure), so there's no durable data to replay from; bootstrapDependentTrustee has
// a hard on-chain dependency on addMemberBatch already having succeeded.
//
// Each of the 5 original handlers (memberRegistry.ts, unacceptedFlags.ts) inlines its contract
// call amid flow-specific Firestore reads/validation that a targeted retry doesn't need (e.g.
// initializeRoleOnChain's original handler also does an on-chain getAllRecordParticipants
// pre-check + Firestore self-heal). Rather than refactor those 3 live, working handlers to share
// code with this internal ops tool, this file duplicates the small amount of contract-call logic
// per action — see the "If you change this call's args/ABI, update REPLAY_REGISTRY" comments at
// each original call site.

import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { ethers } from 'ethers';
import {
  BlockchainRef,
  MEMBER_ROLE_MANAGER,
  HEALTH_RECORD_CORE,
  buildMemberRegistryRef,
  buildHealthRecordRef,
  decodeRevertReason,
} from '../_shared/';
import { MemberRoleManager__factory, HealthRecordCore__factory } from '../_shared/typechain';
import type { MemberRoleManager, HealthRecordCore } from '../_shared/typechain';
import { getAdminWallet } from '../utils/adminWallet';

// ============================================================================
// TYPES
// ============================================================================

export type SupportedRetryAction =
  | 'addMember'
  | 'setUserStatus'
  | 'initializeRoleOnChain'
  | 'flagUnacceptedUpdate'
  | 'revokeUnacceptedFlag';

const SUPPORTED_RETRY_ACTIONS: readonly SupportedRetryAction[] = [
  'addMember',
  'setUserStatus',
  'initializeRoleOnChain',
  'flagUnacceptedUpdate',
  'revokeUnacceptedFlag',
];

interface SyncQueueDocData {
  contract: 'MemberRoleManager' | 'HealthRecordCore' | 'BelrosePaymaster';
  action: string;
  userId: string;
  userWalletAddress?: string;
  context: Record<string, unknown> & { type: string };
  status: 'pending' | 'confirmed' | 'failed' | 'retrying' | string;
  retryCount?: number;
}

interface ReplayOutcome {
  outcome: 'tx-confirmed' | 'already-done';
  txHash?: string;
  reason?: string;
}

interface ReplayDefinition {
  contractName: 'memberRoleManager' | 'healthRecordCore';
  methodName: string;
  buildArgs: (doc: SyncQueueDocData) => unknown[];
  /** Substrings of a decoded revert reason that mean "already applied on-chain" — a soft success, not a failure. */
  alreadyDoneSubstrings: string[];
  /**
   * Replays the downstream Firestore write the original handler would have made on success.
   * These 5 handlers are chain-first (Firestore only gets updated *after* the chain call
   * succeeds), so a failed original attempt never wrote it — retrying the chain call alone
   * without this would leave chain and Firestore newly *disagreeing*, which is worse than the
   * consistent-but-stale state before the retry. `blockchainRef` is null for the "already-done"
   * case, since there's no fresh transaction for this occurrence to cite.
   */
  applyFirestoreMirror: (params: {
    db: Firestore;
    doc: SyncQueueDocData;
    blockchainRef: BlockchainRef | null;
  }) => Promise<void>;
}

// Mirrors MemberRoleManager.sol's MemberStatus enum — see memberRegistry.ts's own statusMap.
const STATUS_LABEL_TO_ENUM: Record<string, number> = {
  Inactive: 1,
  Active: 2,
  Verified: 3,
  VerifiedProvider: 4,
};

// ============================================================================
// CONTRACT ACCESSORS
// ============================================================================

function getMemberRoleManagerContract(): MemberRoleManager {
  return MemberRoleManager__factory.connect(MEMBER_ROLE_MANAGER.proxy, getAdminWallet());
}

function getHealthRecordCoreContract(): HealthRecordCore {
  return HealthRecordCore__factory.connect(HEALTH_RECORD_CORE.proxy, getAdminWallet());
}

function requireContextString(doc: SyncQueueDocData, field: string): string {
  const value = doc.context[field];
  if (typeof value !== 'string' || !value) {
    throw new HttpsError('failed-precondition', `Sync entry is missing context.${field}`);
  }
  return value;
}

// ============================================================================
// REPLAY REGISTRY
// ============================================================================

const REPLAY_REGISTRY: Record<SupportedRetryAction, ReplayDefinition> = {
  // If you change memberRegistry.ts's registerMemberOnChain call, update this entry too.
  addMember: {
    contractName: 'memberRoleManager',
    methodName: 'addMember',
    buildArgs: doc => {
      if (!doc.userWalletAddress) {
        throw new HttpsError('failed-precondition', 'Sync entry is missing userWalletAddress');
      }
      return [doc.userWalletAddress, ethers.id(doc.userId)];
    },
    alreadyDoneSubstrings: ['Wallet already registered'],
    applyFirestoreMirror: async ({ db, doc, blockchainRef }) => {
      const walletAddress = doc.userWalletAddress!;
      const userRef = db.collection('users').doc(doc.userId);
      const userSnap = await userRef.get();
      const userData = userSnap.data();
      if (!userData) return; // user doc gone — nothing to mirror into

      const linkedWallets: Array<{ address?: string }> = userData.onChainIdentity?.linkedWallets ?? [];
      const alreadyLinked = linkedWallets.some(
        w => w.address?.toLowerCase() === walletAddress.toLowerCase()
      );
      if (alreadyLinked) return; // already mirrored — don't duplicate the array entry

      const isSmartAccount =
        walletAddress.toLowerCase() === userData.wallet?.smartAccountAddress?.toLowerCase();

      await userRef.update({
        'onChainIdentity.userIdHash': ethers.id(doc.userId),
        'onChainIdentity.linkedWallets': FieldValue.arrayUnion({
          address: walletAddress,
          type: isSmartAccount ? 'smart-account' : 'eoa',
          blockchainRef,
          linkedAt: Timestamp.now(),
          isWalletActive: true,
        }),
      });
    },
  },

  // If you change memberRegistry.ts's updateMemberStatus call, update this entry too.
  setUserStatus: {
    contractName: 'memberRoleManager',
    methodName: 'setUserStatus',
    buildArgs: doc => {
      const label = requireContextString(doc, 'newStatus');
      const statusEnum = STATUS_LABEL_TO_ENUM[label];
      if (!statusEnum) {
        throw new HttpsError('failed-precondition', `Unrecognized status label "${label}" in stored context`);
      }
      return [ethers.id(doc.userId), statusEnum];
    },
    alreadyDoneSubstrings: ['Already this status'],
    applyFirestoreMirror: async ({ db, doc, blockchainRef }) => {
      const label = doc.context.newStatus as string;
      await db
        .collection('users')
        .doc(doc.userId)
        .update({
          'onChainIdentity.onChainStatus': FieldValue.arrayUnion({
            status: label,
            statusUpdatedAt: Timestamp.now(),
            statusBlockchainRef: blockchainRef,
          }),
        });
    },
  },

  // If you change memberRegistry.ts's initializeRoleOnChain call, update this entry too.
  initializeRoleOnChain: {
    contractName: 'memberRoleManager',
    methodName: 'initializeRecordRole',
    buildArgs: doc => [
      requireContextString(doc, 'recordIdHash'),
      requireContextString(doc, 'targetWalletAddress'),
      requireContextString(doc, 'role'),
    ],
    alreadyDoneSubstrings: ['Record already initialized'],
    applyFirestoreMirror: async ({ db, doc, blockchainRef }) => {
      const recordId = requireContextString(doc, 'recordId');
      await db
        .collection('records')
        .doc(recordId)
        .update({
          blockchainRoleInitialization: {
            blockchainInitialized: true,
            blockchainInitializedAt: Timestamp.now(),
            blockchainRef,
          },
        });
    },
  },

  // If you change unacceptedFlags.ts's flagUnacceptedUpdate call, update this entry too.
  flagUnacceptedUpdate: {
    contractName: 'healthRecordCore',
    methodName: 'flagUnacceptedUpdate',
    buildArgs: doc => [
      ethers.id(requireContextString(doc, 'subjectId')),
      ethers.id(requireContextString(doc, 'recordId')),
      ethers.id(requireContextString(doc, 'reporterId')),
      requireContextString(doc, 'recordHash'),
    ],
    alreadyDoneSubstrings: ['Already flagged'],
    applyFirestoreMirror: async ({ db, doc, blockchainRef }) => {
      const subjectId = requireContextString(doc, 'subjectId');
      const recordId = requireContextString(doc, 'recordId');
      const reporterId = requireContextString(doc, 'reporterId');
      const recordHash = requireContextString(doc, 'recordHash');
      const flagRef = db.collection('unacceptedFlags').doc(`${subjectId}_${recordId}`);
      const flagSnap = await flagRef.get();
      if (flagSnap.exists) return; // already mirrored

      await flagRef.create({
        id: `${subjectId}_${recordId}`,
        subjectId,
        subjectIdHash: ethers.id(subjectId),
        recordId,
        recordIdHash: ethers.id(recordId),
        recordHash,
        reporterId,
        reporterIdHash: ethers.id(reporterId),
        isActive: true,
        createdAt: Timestamp.now(),
        chainStatus: 'confirmed',
        onChainHistory: [{ action: 'flagged', at: Timestamp.now(), blockchainRef }],
      });
    },
  },

  // If you change unacceptedFlags.ts's revokeUnacceptedFlag call, update this entry too.
  revokeUnacceptedFlag: {
    contractName: 'healthRecordCore',
    methodName: 'revokeUnacceptedFlag',
    buildArgs: doc => [
      ethers.id(requireContextString(doc, 'subjectId')),
      ethers.id(requireContextString(doc, 'recordId')),
    ],
    alreadyDoneSubstrings: ['Flag already revoked'],
    applyFirestoreMirror: async ({ db, doc, blockchainRef }) => {
      const subjectId = requireContextString(doc, 'subjectId');
      const recordId = requireContextString(doc, 'recordId');
      const flagRef = db.collection('unacceptedFlags').doc(`${subjectId}_${recordId}`);
      const flagSnap = await flagRef.get();
      if (!flagSnap.exists) return; // nothing to mirror into — the original flag was never written either

      await flagRef.update({
        isActive: false,
        lastModified: Timestamp.now(),
        chainStatus: 'confirmed',
        onChainHistory: FieldValue.arrayUnion({
          action: 'revoked',
          at: Timestamp.now(),
          blockchainRef,
        }),
      });
    },
  },
};

// ============================================================================
// EXECUTOR
// ============================================================================

/**
 * Retries one blockchainSyncQueue entry. Rejects (via HttpsError, doc left untouched) if the
 * entry doesn't exist, is already confirmed, is already mid-retry, or its action isn't one of
 * the 5 supported operations. Otherwise: simulates the call first (staticCall — zero gas) to
 * distinguish "already applied on-chain" from a genuine failure before ever sending a real
 * transaction, applies the downstream Firestore mirror write on either success path, and always
 * increments retryCount exactly once regardless of outcome.
 */
export async function executeReplay(docId: string, adminUid: string): Promise<ReplayOutcome> {
  const db = getFirestore();
  const docRef = db.collection('blockchainSyncQueue').doc(docId);

  const doc = await db.runTransaction(async tx => {
    const snap = await tx.get(docRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Sync queue entry not found');
    const data = snap.data() as SyncQueueDocData;

    if (data.status === 'confirmed') {
      throw new HttpsError('failed-precondition', 'This entry is already confirmed');
    }
    if (data.status === 'retrying') {
      throw new HttpsError('failed-precondition', 'A retry is already in progress for this entry');
    }
    if (!SUPPORTED_RETRY_ACTIONS.includes(data.action as SupportedRetryAction)) {
      throw new HttpsError(
        'invalid-argument',
        `"${data.action}" is not a supported retry operation`
      );
    }

    tx.update(docRef, { status: 'retrying' });
    return data;
  });

  const def = REPLAY_REGISTRY[doc.action as SupportedRetryAction];
  const contract =
    def.contractName === 'memberRoleManager'
      ? getMemberRoleManagerContract()
      : getHealthRecordCoreContract();
  // Dynamic dispatch by method name — the registry's whole point is one generic executor over
  // differently-shaped contract calls, which necessarily costs static ABI type-checking here.
  const method = (contract as unknown as Record<string, any>)[def.methodName];
  const args = def.buildArgs(doc);

  const baseUpdate = {
    retryCount: FieldValue.increment(1),
    retriedBy: adminUid,
    lastRetryAt: Timestamp.now(),
  };

  const buildRef = (txHash: string, blockNumber: number): BlockchainRef =>
    def.contractName === 'memberRoleManager'
      ? buildMemberRegistryRef(txHash, blockNumber)
      : buildHealthRecordRef(txHash, blockNumber);

  const applyMirror = async (blockchainRef: BlockchainRef | null) => {
    try {
      await def.applyFirestoreMirror({ db, doc, blockchainRef });
    } catch (mirrorError) {
      // The chain action itself succeeded — don't fail the retry over a downstream Firestore
      // write, but leave a trace so an admin can follow up manually.
      console.error(`⚠️ Retry succeeded on-chain but Firestore mirror failed for ${docId}:`, mirrorError);
      await docRef.update({
        mirrorWriteError: mirrorError instanceof Error ? mirrorError.message : String(mirrorError),
      });
    }
  };

  // Simulate first — zero gas — to detect "already applied on-chain" without ever sending a
  // real transaction for a call we know will revert.
  try {
    await method.staticCall(...args);
  } catch (simError) {
    const raw = simError instanceof Error ? simError.message : String(simError);
    const decoded = decodeRevertReason(raw);
    const isAlreadyDone = decoded && def.alreadyDoneSubstrings.some(s => decoded.includes(s));

    if (isAlreadyDone) {
      await applyMirror(null);
      await docRef.update({
        ...baseUpdate,
        status: 'confirmed',
        resolutionType: 'already-done',
        softSuccessReason: decoded,
      });
      return { outcome: 'already-done', reason: decoded! };
    }

    await docRef.update({
      ...baseUpdate,
      status: 'failed',
      lastRetryError: decoded ?? raw,
    });
    throw new HttpsError('internal', decoded ?? raw);
  }

  // Simulation succeeded — send the real transaction.
  const tx = await method(...args);
  const receipt = await tx.wait();
  if (!receipt) {
    await docRef.update({ ...baseUpdate, status: 'failed', lastRetryError: 'Transaction was dropped or replaced' });
    throw new HttpsError('internal', 'Transaction was dropped or replaced');
  }

  const blockchainRef = buildRef(tx.hash, receipt.blockNumber);
  await applyMirror(blockchainRef);
  await docRef.update({
    ...baseUpdate,
    status: 'confirmed',
    resolutionType: 'tx-confirmed',
    confirmedTxHash: tx.hash,
  });

  return { outcome: 'tx-confirmed', txHash: tx.hash };
}
