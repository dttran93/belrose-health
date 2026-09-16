// functions/src/chainIndexer/healthRecordCoreReconciliationService.ts
//
// Reconciles HealthRecordCore.sol's events against Firestore — mirrors
// memberRoleManagerReconciliationService.ts's exact conventions for the second contract this
// indexer covers. See that file's own header comment for the general 4-bucket classification
// pipeline (matched → sync_queue_confirmed_missing_write → admin_untracked →
// legitimate_chain_only) — findSyncQueueEntryForTxHash and classifyUnmatchedEvent are both
// already fully contract-agnostic (blockchainSyncQueue and getAdminWallet() are shared across
// every contract, since one admin wallet signs writes for all of them), so they're reused
// unchanged here rather than reimplemented.
//
// HRC Slice 1 covers AdminTransferred only. HRC Slice 2 adds the subject-anchoring family
// (RecordAnchored/RecordUnanchored/RecordReanchored). HRC Slice 3 adds the hash-versioning family
// (RecordHashAdded/RecordHashRetracted). HRC Slice 4 adds the verification family
// (RecordVerified/VerificationRetracted/VerificationLevelModified). HRC Slice 5 adds the dispute
// family (RecordDisputed/DisputeRetracted/DisputeModification). HRC Slice 6 (final slice) adds the
// unaccepted flags family (UnacceptedUpdateFlagged/UnacceptedUpdateFlagRevoked).

import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import type { Provider } from 'ethers';
import type { ChainEventCacheDoc } from '../_shared';
import { getAdminWallet } from '../utils/adminWallet';
import type { ReconciliationResult } from './chainIndexerContractConfig';
import { classifyUnmatchedEvent } from './memberRoleManagerReconciliationService';
import {
  findMatchingSubjectHistoryForAnchoredEvent,
  findMatchingSubjectHistoryForUnanchoredEvent,
  findMatchingSubjectHistoryForReanchoredEvent,
  findMatchingRecordHashHistoryForAddedEvent,
  findMatchingRecordHashHistoryForRetractedEvent,
  findMatchingVerificationForVerifiedEvent,
  findMatchingVerificationForRetractedEvent,
  findMatchingVerificationForLevelModifiedEvent,
  findMatchingDisputeForDisputedEvent,
  findMatchingDisputeForRetractedEvent,
  findMatchingDisputeForModificationEvent,
  findMatchingUnacceptedFlagForFlaggedEvent,
  findMatchingUnacceptedFlagForRevokedEvent,
} from './healthRecordCoreReconciliationRules';

export type { ReconciliationResult };

/**
 * AdminTransferred reconciler (HRC Slice 1). Byte-for-byte the same logic as MemberRoleManager's
 * own reconcileAdminTransferredEvent — transferAdmin() is onlyAdmin on both contracts, so
 * `oldAdmin` (emitted before reassignment) IS the signer, no provider.getTransaction round trip
 * needed. Skips the matched/admin_untracked pipeline entirely: no Firestore collection could ever
 * represent "this admin was rotated," and the app never calls transferAdmin at all (only ever run
 * out-of-band, e.g. a Hardhat script), so bucket 2 (sync_queue_confirmed_missing_write) is just as
 * structurally unreachable as bucket 1 (matched) — running this through classifyUnmatchedEvent
 * would always land on admin_untracked, wrongly implying a bug every time it fires.
 *
 * 'infrastructure' is the default (expected, deliberate configuration); 'infrastructure_admin_mismatch'
 * flags a real security signal — the on-chain caller didn't match our configured
 * ADMIN_WALLET_PRIVATE_KEY-derived address, e.g. because the admin key was rotated without
 * updating our secret.
 */
export async function reconcileHealthRecordCoreAdminTransferredEvent(
  _db: Firestore,
  _provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { oldAdmin: string; newAdmin: string };
  const adminAddress = getAdminWallet().address.toLowerCase();
  const isMismatch = args.oldAdmin.toLowerCase() !== adminAddress;
  return {
    reconciliationStatus: isMismatch ? 'infrastructure_admin_mismatch' : 'infrastructure',
    matchedSyncQueueId: null,
    matchedFirestoreRef: null,
    reconciledAt: Timestamp.now(),
  };
}

/**
 * Subject-anchoring reconcilers (HRC Slice 2). Same 4-bucket shape as MemberRoleManager's own
 * reconcilers; bucket 1 checks records/{recordId}/subjectHistory instead of a MemberRoleManager
 * collection — see healthRecordCoreReconciliationRules.ts's own comments for each match rule's
 * specific predicate. All three events are onlyActiveMember + onlyRecordParticipant with no
 * admin-stand-in path (resolvedSubject — whether self or via a Controller trustee — is always a
 * genuine participant's identity), so legitimate_chain_only is reachable for all three, same
 * reasoning already established for MemberRoleManager's RoleGranted/OwnershipVoluntarilyLeft.
 */
export async function reconcileRecordAnchoredEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { recordIdHash: string; subjectIdHash: string };

  const match = await findMatchingSubjectHistoryForAnchoredEvent(db, args);
  if (match.matched) {
    return {
      reconciliationStatus: 'matched',
      matchedSyncQueueId: null,
      matchedFirestoreRef: match.matchedFirestoreRef,
      reconciledAt: Timestamp.now(),
    };
  }

  return classifyUnmatchedEvent(db, provider, doc.blockchainRef.txHash);
}

export async function reconcileRecordUnanchoredEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { recordIdHash: string; subjectIdHash: string };

  const match = await findMatchingSubjectHistoryForUnanchoredEvent(db, args);
  if (match.matched) {
    return {
      reconciliationStatus: 'matched',
      matchedSyncQueueId: null,
      matchedFirestoreRef: match.matchedFirestoreRef,
      reconciledAt: Timestamp.now(),
    };
  }

  return classifyUnmatchedEvent(db, provider, doc.blockchainRef.txHash);
}

/**
 * RecordReanchored reconciler. Otherwise identical in shape to its siblings above; its match rule
 * (findMatchingSubjectHistoryForReanchoredEvent) can never return matched: true today — no
 * Firestore action represents "reanchored" yet — so this will always fall through to
 * classifyUnmatchedEvent until that gap is separately closed. See that match rule's own comment.
 */
export async function reconcileRecordReanchoredEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { recordIdHash: string; subjectIdHash: string };

  const match = await findMatchingSubjectHistoryForReanchoredEvent(db, args);
  if (match.matched) {
    return {
      reconciliationStatus: 'matched',
      matchedSyncQueueId: null,
      matchedFirestoreRef: match.matchedFirestoreRef,
      reconciledAt: Timestamp.now(),
    };
  }

  return classifyUnmatchedEvent(db, provider, doc.blockchainRef.txHash);
}

/**
 * Hash-versioning reconcilers (HRC Slice 3). Same 4-bucket shape as the subject-anchoring
 * reconcilers above; bucket 1 checks records/{recordId}/recordHashHistory instead of
 * subjectHistory. Both addRecordHash (onlyActiveMember+onlyRecordParticipant) and
 * retractRecordHash (onlyActiveMember+onlyOwnerOrAdmin) are user-callable, not admin-only, so
 * legitimate_chain_only is reachable for both — even for RecordHashRetracted, whose match rule can
 * never actually succeed today (see findMatchingRecordHashHistoryForRetractedEvent's own
 * comment): "the app never calls this" and "only admin can call this" are independent facts here.
 */
export async function reconcileRecordHashAddedEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { recordIdHash: string; newHash: string; addedBy: string };

  const match = await findMatchingRecordHashHistoryForAddedEvent(db, args);
  if (match.matched) {
    return {
      reconciliationStatus: 'matched',
      matchedSyncQueueId: null,
      matchedFirestoreRef: match.matchedFirestoreRef,
      reconciledAt: Timestamp.now(),
    };
  }

  return classifyUnmatchedEvent(db, provider, doc.blockchainRef.txHash);
}

/**
 * RecordHashRetracted reconciler. Otherwise identical in shape to reconcileRecordHashAddedEvent;
 * its match rule (findMatchingRecordHashHistoryForRetractedEvent) can never return matched: true
 * today — no Firestore action represents "retracted" yet, since retractRecordHash is never called
 * from the frontend — so this will always fall through to classifyUnmatchedEvent until that gap
 * is separately closed. See that match rule's own comment.
 */
export async function reconcileRecordHashRetractedEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { recordIdHash: string; recordHash: string };

  const match = await findMatchingRecordHashHistoryForRetractedEvent(db, args);
  if (match.matched) {
    return {
      reconciliationStatus: 'matched',
      matchedSyncQueueId: null,
      matchedFirestoreRef: match.matchedFirestoreRef,
      reconciledAt: Timestamp.now(),
    };
  }

  return classifyUnmatchedEvent(db, provider, doc.blockchainRef.txHash);
}

/**
 * Verification reconcilers (HRC Slice 4). Same 4-bucket shape as the others; bucket 1 checks the
 * flat `verifications` collection instead of a subcollection — see
 * findMatchingVerification*'s own comments. RecordVerified is
 * onlyActiveMember+onlyRecordParticipant (also reachable indirectly via anchorRecord's self-verify
 * path); VerificationRetracted/VerificationLevelModified have no role modifier at all — any
 * registered wallet. None of this changes the reconciler's shape: classifyUnmatchedEvent's
 * admin-vs-other-signer check works identically regardless of how permissive the on-chain gate
 * was; legitimate_chain_only is simply reachable by an even wider set of callers than usual.
 */
export async function reconcileRecordVerifiedEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { recordHash: string; verifierIdHash: string };

  const match = await findMatchingVerificationForVerifiedEvent(db, args);
  if (match.matched) {
    return {
      reconciliationStatus: 'matched',
      matchedSyncQueueId: null,
      matchedFirestoreRef: match.matchedFirestoreRef,
      reconciledAt: Timestamp.now(),
    };
  }

  return classifyUnmatchedEvent(db, provider, doc.blockchainRef.txHash);
}

export async function reconcileVerificationRetractedEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { recordHash: string; verifierIdHash: string };

  const match = await findMatchingVerificationForRetractedEvent(db, args);
  if (match.matched) {
    return {
      reconciliationStatus: 'matched',
      matchedSyncQueueId: null,
      matchedFirestoreRef: match.matchedFirestoreRef,
      reconciledAt: Timestamp.now(),
    };
  }

  return classifyUnmatchedEvent(db, provider, doc.blockchainRef.txHash);
}

export async function reconcileVerificationLevelModifiedEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { recordHash: string; verifierIdHash: string };

  const match = await findMatchingVerificationForLevelModifiedEvent(db, args);
  if (match.matched) {
    return {
      reconciliationStatus: 'matched',
      matchedSyncQueueId: null,
      matchedFirestoreRef: match.matchedFirestoreRef,
      reconciledAt: Timestamp.now(),
    };
  }

  return classifyUnmatchedEvent(db, provider, doc.blockchainRef.txHash);
}

/**
 * Dispute reconcilers (HRC Slice 5). Structurally identical to the verification reconcilers
 * above — bucket 1 checks the flat `disputes` collection instead. RecordDisputed is
 * onlyActiveMember+onlyRecordParticipant; DisputeRetracted/DisputeModification have no role
 * modifier at all — same reachability story as verifications, reused rather than re-derived.
 */
export async function reconcileRecordDisputedEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { recordHash: string; disputerIdHash: string };

  const match = await findMatchingDisputeForDisputedEvent(db, args);
  if (match.matched) {
    return {
      reconciliationStatus: 'matched',
      matchedSyncQueueId: null,
      matchedFirestoreRef: match.matchedFirestoreRef,
      reconciledAt: Timestamp.now(),
    };
  }

  return classifyUnmatchedEvent(db, provider, doc.blockchainRef.txHash);
}

export async function reconcileDisputeRetractedEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { recordHash: string; disputerIdHash: string };

  const match = await findMatchingDisputeForRetractedEvent(db, args);
  if (match.matched) {
    return {
      reconciliationStatus: 'matched',
      matchedSyncQueueId: null,
      matchedFirestoreRef: match.matchedFirestoreRef,
      reconciledAt: Timestamp.now(),
    };
  }

  return classifyUnmatchedEvent(db, provider, doc.blockchainRef.txHash);
}

export async function reconcileDisputeModificationEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { recordHash: string; disputerIdHash: string };

  const match = await findMatchingDisputeForModificationEvent(db, args);
  if (match.matched) {
    return {
      reconciliationStatus: 'matched',
      matchedSyncQueueId: null,
      matchedFirestoreRef: match.matchedFirestoreRef,
      reconciledAt: Timestamp.now(),
    };
  }

  return classifyUnmatchedEvent(db, provider, doc.blockchainRef.txHash);
}

/**
 * Unaccepted-flag reconcilers (HRC Slice 6, final slice). Same 4-bucket shape as the others;
 * bucket 1 checks the flat `unacceptedFlags` collection — the cleanest match case on this whole
 * contract (see findMatchingUnacceptedFlag's own comment). Both events are onlyAdmin — reuses the
 * exact "structurally admin-only ⇒ legitimate_chain_only unreachable" reasoning already
 * established for MemberRoleManager's admin-only events, not re-derived; the pipeline still checks
 * bucket 4 generically anyway (same "don't special-case" precedent already stated in
 * memberRoleManagerReconciliationService.ts's own header comment).
 */
export async function reconcileUnacceptedUpdateFlaggedEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { subjectIdHash: string; recordIdHash: string; reporterIdHash: string };

  const match = await findMatchingUnacceptedFlagForFlaggedEvent(db, args);
  if (match.matched) {
    return {
      reconciliationStatus: 'matched',
      matchedSyncQueueId: null,
      matchedFirestoreRef: match.matchedFirestoreRef,
      reconciledAt: Timestamp.now(),
    };
  }

  return classifyUnmatchedEvent(db, provider, doc.blockchainRef.txHash);
}

export async function reconcileUnacceptedUpdateFlagRevokedEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { subjectIdHash: string; recordIdHash: string; reporterIdHash: string };

  const match = await findMatchingUnacceptedFlagForRevokedEvent(db, args);
  if (match.matched) {
    return {
      reconciliationStatus: 'matched',
      matchedSyncQueueId: null,
      matchedFirestoreRef: match.matchedFirestoreRef,
      reconciledAt: Timestamp.now(),
    };
  }

  return classifyUnmatchedEvent(db, provider, doc.blockchainRef.txHash);
}
