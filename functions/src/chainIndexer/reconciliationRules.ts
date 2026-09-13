// functions/src/chainIndexer/reconciliationRules.ts
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
