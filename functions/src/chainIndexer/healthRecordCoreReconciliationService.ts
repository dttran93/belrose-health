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
// HRC Slice 1 covers AdminTransferred only.

import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import type { Provider } from 'ethers';
import type { ChainEventCacheDoc } from '../_shared';
import { getAdminWallet } from '../utils/adminWallet';
import type { ReconciliationResult } from './chainIndexerContractConfig';

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
