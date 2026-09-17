// functions/src/chainIndexer/memberRoleManagerReconciliationRules.ts
//
// Firestore-read-only predicates used by reconciliationService.ts's classification pipeline.
// Kept separate from that orchestration so each rule is independently testable against a
// fabricated Firestore fixture (see functions/test/chainReconciliationRules.test.ts) without
// needing a chain call or the emulator.

import type { Firestore } from 'firebase-admin/firestore';
import { ethers } from 'ethers';

export interface MemberRoleManagerMatchResult {
  matched: boolean;
  matchedFirestoreRef: string | null; // e.g. 'users/{uid}'
}

/**
 * MemberRegistered/WalletLinked match rule: Firestore already knows about this wallet↔identity
 * link if some user doc has onChainIdentity.userIdHash == args.userIdHash AND that wallet address
 * appears among wallet.address / wallet.smartAccountAddress / onChainIdentity.linkedWallets —
 * reusing the same wallet-comparison shape already used by checkMemberIntegrity
 * (src/features/BackendChainParity/services/memberIntegrityService.ts:118-122).
 */
export async function findMatchingUserForMemberEvent(
  db: Firestore,
  args: { wallet: string; userIdHash: string }
): Promise<MemberRoleManagerMatchResult> {
  const snap = await db
    .collection('users')
    .where('onChainIdentity.userIdHash', '==', args.userIdHash)
    .limit(1)
    .get();

  if (snap.empty) return { matched: false, matchedFirestoreRef: null };

  const doc = snap.docs[0];
  const data = doc.data();
  const walletLower = args.wallet.toLowerCase();

  const linkedWallets: Array<{ address?: string }> = data.onChainIdentity?.linkedWallets ?? [];
  const knownAddresses = [data.wallet?.address, data.wallet?.smartAccountAddress, ...linkedWallets.map(w => w.address)]
    .filter((a): a is string => Boolean(a))
    .map(a => a.toLowerCase());

  const matched = knownAddresses.includes(walletLower);
  return { matched, matchedFirestoreRef: matched ? `users/${doc.id}` : null };
}

export interface SyncQueueMatch {
  found: boolean;
  syncQueueId: string | null;
  status: string | null;
}

/** Cross-references an event's txHash against blockchainSyncQueue, regardless of contract/action —
 *  the sync-queue schema is shared across every write site (see blockchainSyncQueueService.ts /
 *  utils/blockchainSyncQueue.ts), so this rule is reusable unchanged by later event-type slices. */
export async function findSyncQueueEntryForTxHash(
  db: Firestore,
  txHash: string
): Promise<SyncQueueMatch> {
  const snap = await db.collection('blockchainSyncQueue').where('txHash', '==', txHash).limit(1).get();

  if (snap.empty) return { found: false, syncQueueId: null, status: null };

  const doc = snap.docs[0];
  return { found: true, syncQueueId: doc.id, status: (doc.data().status as string) ?? null };
}

export interface RoleEventMatchResult {
  matched: boolean;
  matchedFirestoreRef: string | null; // e.g. 'records/{recordId}/permissionHistory/{eventId}'
}

/**
 * RoleGranted/RoleRevoked match rule: `recordId` isn't recoverable from the on-chain event (only
 * the one-way-hashed `recordIdHash`), so this has to be a collectionGroup scan over every
 * `permissionHistory` doc with that `recordIdHash`, then an in-memory check of whether any of its
 * `changes[]` entries has this exact target + role — mirroring the hash-at-read-time convention
 * `recordPermissionIntegrityService.ts` already uses (src/features/BackendChainParity/services/),
 * just in the reverse direction. No `firestore.rules`/index change needed: this runs entirely
 * through the Admin SDK (bypasses rules unconditionally), and it's a single equality filter with
 * no orderBy/range — Firestore auto-indexes that for collection-group scope by default.
 *
 * Producer-agnostic on purpose: both permissionsService.ts's direct grants and
 * trusteePermissionService.ts's trustee-driven grants write into the same permissionHistory
 * shape (just a different `context` field) — this rule doesn't need to know or care which wrote
 * a given doc.
 *
 * `userIdHash` is deliberately NOT part of the match condition. initializeRecordRole
 * (MemberRoleManager.sol:579, onlyAdmin) hardcodes the on-chain event's userIdHash to bytes32(0)
 * regardless of who triggered it, but its Firestore write (permissionPreparationService.ts)
 * records the real calling user's UID as `changedBy`/`changedByIdHash` — a genuine hash, never
 * bytes32(0). Requiring userIdHash === changedByIdHash here would produce a false "no match" for
 * every admin-initialized role grant, even though Firestore genuinely has the record.
 */
export async function findMatchingPermissionHistoryForRoleEvent(
  db: Firestore,
  args: { recordIdHash: string; targetIdHash: string; role: string }
): Promise<RoleEventMatchResult> {
  const snap = await db
    .collectionGroup('permissionHistory')
    .where('recordIdHash', '==', args.recordIdHash)
    .get();

  const targetIdHashLower = args.targetIdHash.toLowerCase();

  for (const doc of snap.docs) {
    const changes: Array<{ userId?: string; newRole?: string | null }> = doc.data().changes ?? [];
    const isMatch = changes.some(
      c =>
        c.newRole === args.role &&
        typeof c.userId === 'string' &&
        ethers.id(c.userId).toLowerCase() === targetIdHashLower
    );
    if (isMatch) return { matched: true, matchedFirestoreRef: doc.ref.path };
  }

  return { matched: false, matchedFirestoreRef: null };
}

/**
 * RoleChanged match rule (Slice 3): same collectionGroup-scan shape as
 * findMatchingPermissionHistoryForRoleEvent, but matches a `changes[]` entry recording an actual
 * role CHANGE — `action` of 'upgraded' or 'downgraded' (packages/shared/src/permissions.ts's
 * PermissionChange union), with both `previousRole`/`newRole` equal to the event's `oldRole`/
 * `newRole`. A 'granted'/'revoked' entry is never a valid match here even if the role values
 * happened to line up — those correspond to RoleGranted/RoleRevoked, not RoleChanged.
 *
 * userIdHash is excluded from the match condition for the same reason as
 * findMatchingPermissionHistoryForRoleEvent, applied conservatively even though RoleChanged has
 * no known bytes32(0) case of its own (every emission site — changeRole, changeRoleBatch,
 * voluntarilyLeaveOwnership, trustee level sync — is onlyActiveMember, never onlyAdmin): matching
 * on the actual permission-change content is the more direct and less assumption-laden check
 * regardless.
 */
export async function findMatchingPermissionHistoryForRoleChangedEvent(
  db: Firestore,
  args: { recordIdHash: string; targetIdHash: string; oldRole: string; newRole: string }
): Promise<RoleEventMatchResult> {
  const snap = await db
    .collectionGroup('permissionHistory')
    .where('recordIdHash', '==', args.recordIdHash)
    .get();

  const targetIdHashLower = args.targetIdHash.toLowerCase();

  for (const doc of snap.docs) {
    const changes: Array<{
      action?: string;
      userId?: string;
      previousRole?: string | null;
      newRole?: string | null;
    }> = doc.data().changes ?? [];
    const isMatch = changes.some(
      c =>
        (c.action === 'upgraded' || c.action === 'downgraded') &&
        c.previousRole === args.oldRole &&
        c.newRole === args.newRole &&
        typeof c.userId === 'string' &&
        ethers.id(c.userId).toLowerCase() === targetIdHashLower
    );
    if (isMatch) return { matched: true, matchedFirestoreRef: doc.ref.path };
  }

  return { matched: false, matchedFirestoreRef: null };
}

// Mirrors MemberRoleManager.sol's MemberStatus enum → label, exactly matching
// memberRegistry.ts's own statusMap (functions/src/handlers/memberRegistry.ts:305-310).
const MEMBER_STATUS_LABEL: Record<number, string> = {
  1: 'Inactive',
  2: 'Active',
  3: 'Verified',
  4: 'VerifiedProvider',
};

/**
 * MemberStatusChanged match rule (Slice 4): same `users` collection findMatchingUserForMemberEvent
 * already queries, just checking `onChainIdentity.onChainStatus[]` (the status-change history
 * array) for an entry whose label matches the event's `newStatus` instead of checking wallet
 * addresses. Like the role-event match rules, this doesn't correlate the exact txHash/timestamp
 * of a specific status change — it accepts "some entry with this status exists in the history" as
 * a match, the same looseness those rules already tolerate.
 */
export async function findMatchingUserForStatusEvent(
  db: Firestore,
  args: { userIdHash: string; newStatus: number }
): Promise<MemberRoleManagerMatchResult> {
  const snap = await db
    .collection('users')
    .where('onChainIdentity.userIdHash', '==', args.userIdHash)
    .limit(1)
    .get();

  if (snap.empty) return { matched: false, matchedFirestoreRef: null };

  const doc = snap.docs[0];
  const statusLabel = MEMBER_STATUS_LABEL[args.newStatus];
  const history: Array<{ status?: string }> = doc.data().onChainIdentity?.onChainStatus ?? [];
  const matched = statusLabel !== undefined && history.some(h => h.status === statusLabel);

  return { matched, matchedFirestoreRef: matched ? `users/${doc.id}` : null };
}

/**
 * OwnershipVoluntarilyLeft match rule (Slice 4): matches a `changes[]` entry recording a full
 * owner removal — `action: 'revoked'`, `previousRole: 'owner'`, `newRole: null`
 * (permissionsService.ts's removeOwner, no-demoteTo branch — permissionsService.ts:1703-1708).
 *
 * Unlike the RoleGranted/RoleChanged match rules, this ADDS a `changedByIdHash === userIdHash`
 * check — safe to do here specifically because voluntarilyLeaveOwnership is exclusively
 * self-service: the contract has no path for one owner to remove another (only `revokeRole` could
 * target someone else, and it explicitly cannot target an owner —
 * src/features/Permissions/services/blockchainRoleManagerService.ts:553's own comment). So a
 * `revoked, previousRole: owner` entry NOT authored by the leaving owner themselves can only be
 * unrelated Firestore noise, not a legitimate match for this specific on-chain event — the
 * opposite situation from RoleGranted's bytes32(0) case, where requiring identity equality would
 * have produced a false negative instead of ruling out a real false positive.
 */
export async function findMatchingPermissionHistoryForOwnershipLeftEvent(
  db: Firestore,
  args: { recordIdHash: string; userIdHash: string }
): Promise<RoleEventMatchResult> {
  const snap = await db
    .collectionGroup('permissionHistory')
    .where('recordIdHash', '==', args.recordIdHash)
    .get();

  const userIdHashLower = args.userIdHash.toLowerCase();

  for (const doc of snap.docs) {
    const data = doc.data();
    if (typeof data.changedByIdHash !== 'string' || data.changedByIdHash.toLowerCase() !== userIdHashLower) {
      continue;
    }

    const changes: Array<{ action?: string; userId?: string; previousRole?: string | null; newRole?: string | null }> =
      data.changes ?? [];
    const isMatch = changes.some(
      c =>
        c.action === 'revoked' &&
        c.previousRole === 'owner' &&
        c.newRole === null &&
        typeof c.userId === 'string' &&
        ethers.id(c.userId).toLowerCase() === userIdHashLower
    );
    if (isMatch) return { matched: true, matchedFirestoreRef: doc.ref.path };
  }

  return { matched: false, matchedFirestoreRef: null };
}

// ============================================================================
// Trustee events (Slice 5)
// ============================================================================

// Mirrors MemberRoleManager.sol's TrusteeLevel enum → label, exactly matching TrustLevel
// (src/features/Trustee/services/trusteeRelationshipService.ts:73).
const TRUSTEE_LEVEL_LABEL: Record<number, string> = {
  0: 'observer',
  1: 'custodian',
  2: 'controller',
};

export interface TrusteeEventMatchResult {
  matched: boolean;
  matchedFirestoreRef: string | null; // e.g. 'trusteeRelationships/{id}/trusteeHistory/{eventId}'
}

interface TrusteeHistoryEntry {
  action?: string;
  trustLevel?: string;
  changedByIdHash?: string;
}

/**
 * Shared query + predicate-matching shell for all 5 trustee event match rules below.
 * trusteeHistory (unlike permissionHistory) already stores trustorIdHash/trusteeIdHash directly
 * on each entry (src/features/Trustee/services/writeTrusteeHistoryEvent.ts's
 * prepareTrusteeHistoryEventData), so both can be filtered server-side — no in-memory hash
 * recomputation needed, just the predicate check per event type.
 *
 * Known gap, not fixed here: bootstrapDependentTrustee (MemberRoleManager.sol, onlyAdmin) emits
 * both TrusteeProposed and TrusteeAccepted, and its Firestore counterpart
 * (functions/src/handlers/createDependentAccount.ts) writes the trusteeRelationships doc
 * directly — but never a matching trusteeHistory entry (only trusteeRelationshipService.ts, the
 * client-orchestrated path, writes those). So those two events will currently show as
 * admin_untracked even though Firestore genuinely has the relationship recorded — the same shape
 * of gap already found and ticketed for registerMemberOnChainComplete's missing sync-queue
 * tracking. Worth its own ticket (add trusteeHistory writes to createDependentAccount.ts), not
 * folded into this slice.
 */
async function findMatchingTrusteeHistory(
  db: Firestore,
  trustorIdHash: string,
  trusteeIdHash: string,
  predicate: (entry: TrusteeHistoryEntry) => boolean
): Promise<TrusteeEventMatchResult> {
  const snap = await db
    .collectionGroup('trusteeHistory')
    .where('trustorIdHash', '==', trustorIdHash)
    .where('trusteeIdHash', '==', trusteeIdHash)
    .get();

  for (const doc of snap.docs) {
    if (predicate(doc.data() as TrusteeHistoryEntry)) {
      return { matched: true, matchedFirestoreRef: doc.ref.path };
    }
  }

  return { matched: false, matchedFirestoreRef: null };
}

/**
 * TrusteeProposed match rule. Doesn't require an exact trustLevel match when the level is
 * unrecognized (shouldn't happen, but fails safe to "any propose entry" rather than a guaranteed
 * non-match) — matches the looseness precedent of not correlating every field precisely
 * elsewhere in this file.
 */
export async function findMatchingTrusteeHistoryForProposedEvent(
  db: Firestore,
  args: { trustorIdHash: string; trusteeIdHash: string; level: number }
): Promise<TrusteeEventMatchResult> {
  const levelLabel = TRUSTEE_LEVEL_LABEL[args.level];
  return findMatchingTrusteeHistory(
    db,
    args.trustorIdHash,
    args.trusteeIdHash,
    entry => entry.action === 'propose' && (levelLabel === undefined || entry.trustLevel === levelLabel)
  );
}

/**
 * TrusteeAccepted match rule. `trustLevel` is documented as present only on 'propose' and
 * 'level-update' entries (writeTrusteeHistoryEvent.ts's TrusteeHistoryEvent type) — not
 * necessarily on 'accept' — so this only checks the action, not the level.
 */
export async function findMatchingTrusteeHistoryForAcceptedEvent(
  db: Firestore,
  args: { trustorIdHash: string; trusteeIdHash: string }
): Promise<TrusteeEventMatchResult> {
  return findMatchingTrusteeHistory(
    db,
    args.trustorIdHash,
    args.trusteeIdHash,
    entry => entry.action === 'accept'
  );
}

export async function findMatchingTrusteeHistoryForDeclinedEvent(
  db: Firestore,
  args: { trustorIdHash: string; trusteeIdHash: string }
): Promise<TrusteeEventMatchResult> {
  return findMatchingTrusteeHistory(
    db,
    args.trustorIdHash,
    args.trusteeIdHash,
    entry => entry.action === 'decline'
  );
}

/**
 * TrusteeRevoked match rule. Adds a `changedByIdHash === revokedBy` check — safe here (unlike
 * RoleGranted's deliberately-excluded identity check) because revokeTrustee is exclusively
 * onlyActiveMember with no admin-stand-in path (either party revokes in person; there's no
 * bytes32(0) case the way initializeRecordRole has for RoleGranted).
 */
export async function findMatchingTrusteeHistoryForRevokedEvent(
  db: Firestore,
  args: { trustorIdHash: string; trusteeIdHash: string; revokedBy: string }
): Promise<TrusteeEventMatchResult> {
  const revokedByLower = args.revokedBy.toLowerCase();
  return findMatchingTrusteeHistory(
    db,
    args.trustorIdHash,
    args.trusteeIdHash,
    entry =>
      entry.action === 'revoke' &&
      typeof entry.changedByIdHash === 'string' &&
      entry.changedByIdHash.toLowerCase() === revokedByLower
  );
}

/**
 * TrusteeLevelUpdated match rule. Only the new level is stored on a 'level-update' entry (no
 * oldLevel field on trusteeHistory, unlike RoleChanged's oldRole/newRole pair on permissionHistory)
 * — matches on the new level only, same accepted looseness as TrusteeProposed.
 */
export async function findMatchingTrusteeHistoryForLevelUpdatedEvent(
  db: Firestore,
  args: { trustorIdHash: string; trusteeIdHash: string; newLevel: number }
): Promise<TrusteeEventMatchResult> {
  const levelLabel = TRUSTEE_LEVEL_LABEL[args.newLevel];
  return findMatchingTrusteeHistory(
    db,
    args.trustorIdHash,
    args.trusteeIdHash,
    entry => entry.action === 'level-update' && (levelLabel === undefined || entry.trustLevel === levelLabel)
  );
}

// ============================================================================
// Vouch events (Slice 6)
// ============================================================================

export interface VouchEventMatchResult {
  matched: boolean;
  matchedFirestoreRef: string | null; // e.g. 'vouches/{voucherId}_{voucheeId}'
}

interface VouchOnChainEventEntry {
  action?: string;
}

/**
 * Shared query + predicate-matching shell for both vouch match rules. Unlike permissionHistory/
 * trusteeHistory, `vouches` is a flat top-level collection (vouchService.ts's getVouchId:
 * `{voucherId}_{voucheeId}`) — but since the doc ID itself is built from plain UIDs, not hashes,
 * it's not derivable from the on-chain event either, so this is still a query by the stored
 * voucherIdHash/voucheeIdHash fields, not a doc lookup. At most one doc can ever match a given
 * (voucherIdHash, voucheeIdHash) pair (that's the whole point of the deterministic ID), so
 * `.limit(1)` is safe.
 */
async function findMatchingVouch(
  db: Firestore,
  voucherIdHash: string,
  voucheeIdHash: string,
  predicate: (entry: VouchOnChainEventEntry) => boolean
): Promise<VouchEventMatchResult> {
  const snap = await db
    .collection('vouches')
    .where('voucherIdHash', '==', voucherIdHash)
    .where('voucheeIdHash', '==', voucheeIdHash)
    .limit(1)
    .get();

  if (snap.empty) return { matched: false, matchedFirestoreRef: null };

  const doc = snap.docs[0];
  const history: VouchOnChainEventEntry[] = doc.data().onChainHistory ?? [];
  const matched = history.some(predicate);
  return { matched, matchedFirestoreRef: matched ? doc.ref.path : null };
}

/**
 * VouchGiven match rule. Matches on "some vouched/re-vouched entry exists in history" rather than
 * correlating the exact txHash/timestamp of this specific call — same looseness precedent as
 * RoleGranted/TrusteeProposed. A vouch that's since been retracted still counts: this only asks
 * whether Firestore ever recorded giving this vouch, not whether it's currently active.
 */
export async function findMatchingVouchForGivenEvent(
  db: Firestore,
  args: { voucherIdHash: string; voucheeIdHash: string }
): Promise<VouchEventMatchResult> {
  return findMatchingVouch(
    db,
    args.voucherIdHash,
    args.voucheeIdHash,
    entry => entry.action === 'vouched' || entry.action === 're-vouched'
  );
}

export async function findMatchingVouchForRetractedEvent(
  db: Firestore,
  args: { voucherIdHash: string; voucheeIdHash: string }
): Promise<VouchEventMatchResult> {
  return findMatchingVouch(db, args.voucherIdHash, args.voucheeIdHash, entry => entry.action === 'retracted');
}
