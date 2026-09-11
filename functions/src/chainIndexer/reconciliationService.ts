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

import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import type { Provider } from 'ethers';
import type { ChainEventCacheDoc } from '../_shared';
import { findMatchingUserForMemberEvent, findSyncQueueEntryForTxHash } from './reconciliationRules';
import { getAdminWallet } from '../utils/adminWallet';

export type ReconciliationResult = Pick<
  ChainEventCacheDoc,
  'reconciliationStatus' | 'matchedSyncQueueId' | 'matchedFirestoreRef' | 'reconciledAt'
>;

export async function reconcileMemberRoleManagerEvent(
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

  const syncQueueMatch = await findSyncQueueEntryForTxHash(db, doc.blockchainRef.txHash);
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
  const tx = await provider.getTransaction(doc.blockchainRef.txHash);
  const signer = tx?.from?.toLowerCase();

  return {
    reconciliationStatus: signer === adminAddress ? 'admin_untracked' : 'legitimate_chain_only',
    matchedSyncQueueId: syncQueueMatch.syncQueueId,
    matchedFirestoreRef: null,
    reconciledAt: Timestamp.now(),
  };
}
