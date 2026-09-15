// functions/src/chainIndexer/reconciliationService.ts
//
// Classifies one newly-cached chain event into one of four outcomes — see
// ChainEventReconciliationStatus's doc comment (packages/shared/src/chainEventCache.ts) for what
// each means. Ordered pipeline, cheapest/most-informative checks first:
//   1. Does Firestore already have a record of this specific action? → 'matched'
//   2. No Firestore match — does blockchainSyncQueue have a 'confirmed' entry for this txHash
//      whose downstream write never landed? → 'sync_queue_confirmed_missing_write' (a bug)
//   3. No sync-queue entry — was the tx signed by our own admin wallet? → 'admin_untracked' (also
//      a bug — only our backend holds that key, so this can only be our own code failing to
//      instrument a call site, never user activity)
//   4. Otherwise → 'legitimate_chain_only' (most likely the user's own wallet, used directly)
//
// Note for Slice 1 specifically: MemberRegistered/WalletLinked can ONLY ever be emitted by
// addMember/addMemberBatch, both onlyAdmin (see MemberRoleManager.sol) — so bucket 4 is
// structurally unreachable for this event pair; every unmatched Members event will always land
// in bucket 3. The pipeline still checks for it generically (rather than special-casing this
// event type) because later slices (e.g. Permissions' RoleGranted, which real users CAN call
// directly) genuinely need it.
//
// reconcileMemberEvent additionally checks for deactivation before bucket 2 — see
// isDeactivatedOnChain's own comment — producing a 5th outcome, 'deactivated_tracked', specific
// to Member events (deactivation isn't a meaningful concept for the role-event reconcilers).

import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import type { Provider } from 'ethers';
import type { ChainEventCacheDoc } from '../_shared';
import { MEMBER_ROLE_MANAGER } from '../_shared';
import { MemberRoleManager__factory } from '../_shared/typechain';
import {
  findMatchingUserForMemberEvent,
  findMatchingPermissionHistoryForRoleEvent,
  findMatchingPermissionHistoryForRoleChangedEvent,
  findMatchingUserForStatusEvent,
  findMatchingPermissionHistoryForOwnershipLeftEvent,
  findMatchingTrusteeHistoryForProposedEvent,
  findMatchingTrusteeHistoryForAcceptedEvent,
  findMatchingTrusteeHistoryForDeclinedEvent,
  findMatchingTrusteeHistoryForRevokedEvent,
  findMatchingTrusteeHistoryForLevelUpdatedEvent,
  findSyncQueueEntryForTxHash,
  type SyncQueueMatch,
} from './reconciliationRules';
import { getAdminWallet } from '../utils/adminWallet';

// Mirrors MemberRoleManager.sol's MemberStatus enum — see memberRegistry.ts's own statusMap and
// e2e/helpers/backend/staging.ts's own MEMBER_STATUS_INACTIVE constant.
const MEMBER_STATUS_INACTIVE = 1;

export type ReconciliationResult = Pick<
  ChainEventCacheDoc,
  'reconciliationStatus' | 'matchedSyncQueueId' | 'matchedFirestoreRef' | 'reconciledAt'
>;

/**
 * Buckets 2-4 of the pipeline — shared, unchanged, across every event type. Only bucket 1 ("does
 * Firestore already have a record of this specific action") varies per event type, since that's
 * the only step that needs to know the event's own shape; everything past it is generic.
 */
async function classifyUnmatchedEvent(
  db: Firestore,
  provider: Provider,
  txHash: string
): Promise<ReconciliationResult> {
  const syncQueueMatch: SyncQueueMatch = await findSyncQueueEntryForTxHash(db, txHash);
  if (syncQueueMatch.found && syncQueueMatch.status === 'confirmed') {
    return {
      reconciliationStatus: 'sync_queue_confirmed_missing_write',
      matchedSyncQueueId: syncQueueMatch.syncQueueId,
      matchedFirestoreRef: null,
      reconciledAt: Timestamp.now(),
    };
  }

  // One extra RPC call, acceptable since this only runs for the rare unmatched-event case.
  // Constructing the admin wallet doesn't itself make a network call — it's a pure key-derived
  // address — so this is cheap even though getAdminWallet() also attaches a provider internally.
  const adminAddress = getAdminWallet().address.toLowerCase();
  const tx = await provider.getTransaction(txHash);
  const signer = tx?.from?.toLowerCase();

  return {
    reconciliationStatus: signer === adminAddress ? 'admin_untracked' : 'legitimate_chain_only',
    matchedSyncQueueId: syncQueueMatch.syncQueueId,
    matchedFirestoreRef: null,
    reconciledAt: Timestamp.now(),
  };
}

/**
 * A real instrumentation bug never self-deactivates an account, so an unmatched
 * MemberRegistered/WalletLinked event whose identity is currently Inactive on-chain is a strong
 * signal this isn't admin_untracked/sync_queue_confirmed_missing_write at all — it's most likely
 * deliberate deactivation after the fact (e2e test cleanup being the known case; see
 * e2e/helpers/backend/staging.ts's deactivateOnChain, which deactivates on-chain but deletes the
 * Firestore user doc, leaving exactly this shape behind). Checked before falling through to the
 * sync-queue/admin-wallet checks so this collapses into one accurate bucket regardless of an
 * implementation detail that shouldn't affect the classification: whether a sync-queue entry
 * happens to exist for this txHash (it does for e2e runs after registerMemberOnChainComplete
 * started tracking sync-queue entries, doesn't for older runs).
 */
async function isDeactivatedOnChain(provider: Provider, userIdHash: string): Promise<boolean> {
  const contract = MemberRoleManager__factory.connect(MEMBER_ROLE_MANAGER.proxy, provider);
  const status = await contract.userStatus(userIdHash);
  return Number(status) === MEMBER_STATUS_INACTIVE;
}

export async function reconcileMemberEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { wallet: string; userIdHash: string };

  const match = await findMatchingUserForMemberEvent(db, args);
  if (match.matched) {
    return {
      reconciliationStatus: 'matched',
      matchedSyncQueueId: null,
      matchedFirestoreRef: match.matchedFirestoreRef,
      reconciledAt: Timestamp.now(),
    };
  }

  if (await isDeactivatedOnChain(provider, args.userIdHash)) {
    return {
      reconciliationStatus: 'deactivated_tracked',
      matchedSyncQueueId: null,
      matchedFirestoreRef: null,
      reconciledAt: Timestamp.now(),
    };
  }

  return classifyUnmatchedEvent(db, provider, doc.blockchainRef.txHash);
}

/**
 * RoleGranted/RoleRevoked reconciler (Slice 2). Same 4-bucket shape as
 * reconcileMemberEvent, but bucket 1 checks records/{recordId}/permissionHistory
 * instead of users — see findMatchingPermissionHistoryForRoleEvent's own comment for why
 * userIdHash is deliberately excluded from that match. Unlike Slice 1's events (which can only
 * ever be admin-signed, per MemberRoleManager.sol's onlyAdmin gating), grantRole/revokeRole are
 * onlyActiveMember — callable directly by any real user — so bucket 4 ('legitimate_chain_only')
 * is genuinely reachable here, not just structurally present for future slices.
 */
export async function reconcileRoleEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { recordIdHash: string; targetIdHash: string; role: string };

  const match = await findMatchingPermissionHistoryForRoleEvent(db, args);
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
 * RoleChanged reconciler (Slice 3). Same 4-bucket shape and same call-site family as
 * reconcileRoleEvent (changeRole/changeRoleBatch/voluntarilyLeaveOwnership demotions/trustee
 * level sync — none onlyAdmin), so bucket 4 ('legitimate_chain_only') is reachable here too, for
 * the same reason it is for RoleGranted/RoleRevoked.
 */
export async function reconcileRoleChangedEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { recordIdHash: string; targetIdHash: string; oldRole: string; newRole: string };

  const match = await findMatchingPermissionHistoryForRoleChangedEvent(db, args);
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
 * MemberStatusChanged reconciler (Slice 4). Admin-only (setUserStatus), same shape as
 * reconcileMemberEvent — including the same deactivation check, and for a very concrete reason
 * here specifically: e2e/helpers/backend/staging.ts's deactivateOnChain calls
 * setUserStatus(..., Inactive) directly, which emits exactly this event. An unmatched
 * MemberStatusChanged whose *current* on-chain status is Inactive is therefore just as likely to
 * be e2e cleanup noise as an unmatched MemberRegistered/WalletLinked is — same check, same
 * justification, reused verbatim rather than re-derived.
 */
export async function reconcileMemberStatusChangedEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { userIdHash: string; newStatus: number };

  const match = await findMatchingUserForStatusEvent(db, args);
  if (match.matched) {
    return {
      reconciliationStatus: 'matched',
      matchedSyncQueueId: null,
      matchedFirestoreRef: match.matchedFirestoreRef,
      reconciledAt: Timestamp.now(),
    };
  }

  if (await isDeactivatedOnChain(provider, args.userIdHash)) {
    return {
      reconciliationStatus: 'deactivated_tracked',
      matchedSyncQueueId: null,
      matchedFirestoreRef: null,
      reconciledAt: Timestamp.now(),
    };
  }

  return classifyUnmatchedEvent(db, provider, doc.blockchainRef.txHash);
}

/**
 * OwnershipVoluntarilyLeft reconciler (Slice 4). User-callable (onlyActiveMember), so bucket 4
 * ('legitimate_chain_only') is reachable, same as the other role-event reconcilers. No
 * deactivation check here — unlike MemberStatusChanged, this is a record-level role event, not an
 * identity-status one, and there's no known source (e2e or otherwise) of untracked
 * OwnershipVoluntarilyLeft noise the way there is for Member events.
 */
export async function reconcileOwnershipVoluntarilyLeftEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { recordIdHash: string; userIdHash: string };

  const match = await findMatchingPermissionHistoryForOwnershipLeftEvent(db, args);
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
 * Trustee event reconcilers (Slice 5). Same 4-bucket shape as the others; bucket 1 checks
 * trusteeRelationships/{id}/trusteeHistory instead of permissionHistory or users — see each
 * findMatchingTrusteeHistoryFor*Event's own comment for its specific match predicate.
 *
 * TrusteeProposed/TrusteeAccepted can be emitted by either proposeTrustee/acceptTrustee
 * (onlyActiveMember) or bootstrapDependentTrustee (onlyAdmin) — so both admin_untracked and
 * legitimate_chain_only are genuinely reachable for these two, unlike TrusteeDeclined/
 * TrusteeRevoked/TrusteeLevelUpdated, whose only emission sites are onlyActiveMember (structurally
 * user-only, the same asymmetry Slice 1's Members events have in the other direction — checked
 * generically here rather than special-cased, consistent with every other reconciler in this file).
 */
export async function reconcileTrusteeProposedEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { trustorIdHash: string; trusteeIdHash: string; level: number };

  const match = await findMatchingTrusteeHistoryForProposedEvent(db, args);
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

export async function reconcileTrusteeAcceptedEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { trustorIdHash: string; trusteeIdHash: string };

  const match = await findMatchingTrusteeHistoryForAcceptedEvent(db, args);
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

export async function reconcileTrusteeDeclinedEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { trustorIdHash: string; trusteeIdHash: string };

  const match = await findMatchingTrusteeHistoryForDeclinedEvent(db, args);
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

export async function reconcileTrusteeRevokedEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { trustorIdHash: string; trusteeIdHash: string; revokedBy: string };

  const match = await findMatchingTrusteeHistoryForRevokedEvent(db, args);
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

export async function reconcileTrusteeLevelUpdatedEvent(
  db: Firestore,
  provider: Provider,
  doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
): Promise<ReconciliationResult> {
  const args = doc.args as { trustorIdHash: string; trusteeIdHash: string; newLevel: number };

  const match = await findMatchingTrusteeHistoryForLevelUpdatedEvent(db, args);
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
