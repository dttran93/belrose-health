// functions/src/chainIndexer/reconciliationRules.ts
//
// Firestore-read-only predicates used by reconciliationService.ts's classification pipeline.
// Kept separate from that orchestration so each rule is independently testable against a
// fabricated Firestore fixture (see functions/test/chainReconciliationRules.test.ts) without
// needing a chain call or the emulator.

import type { Firestore } from 'firebase-admin/firestore';

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
