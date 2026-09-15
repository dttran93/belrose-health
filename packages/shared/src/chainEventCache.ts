// packages/shared/src/chainEventCache.ts
//
// Document shapes for the chain event indexer — the background process that watches on-chain
// events and caches them in Firestore, closing the one direction BackendChainParity has never
// covered: "does something exist on-chain that Firestore has no record of." See
// src/features/BackendChainParity/hooks/useMembersIntegrity.ts's header comment for the original
// problem statement this exists to solve.
//
// Two collections:
//   - chainEventCache — one doc per on-chain log, keyed by `${blockchainRef.txHash}_${logIndex}`
//     so re-scanning an overlapping block range is idempotent (a re-set of the same doc ID, never
//     a duplicate).
//   - chainIndexerCheckpoints — one singleton doc per contract, tracking how far the scan has
//     gotten, so each run resumes instead of rescanning from the deployment block.

import { BlockchainRef, BlockchainContract } from './blockchainAddresses';
import { TimestampLike } from './timestamp';

// Classification of a cached event once reconciled against Firestore — see
// functions/src/chainIndexer/reconciliationService.ts for the classification pipeline.
//   - 'matched' — Firestore already has a record of this specific action. Nothing to surface.
//   - 'sync_queue_confirmed_missing_write' — our app attempted this write (a blockchainSyncQueue
//     entry for this txHash is 'confirmed'), but the downstream Firestore data write never
//     landed. A genuine bug.
//   - 'legitimate_chain_only' — no sync-queue entry, and the transaction was signed by a wallet
//     linked to a real Firestore user — most likely that user interacting with their own
//     on-chain identity directly, outside the app. Expected, given this product's
//     patient-controlled design; informational only.
//   - 'admin_untracked' — no sync-queue entry, and the transaction was signed by our own admin
//     wallet. Since only our backend holds that key, this can only mean our own code failed to
//     instrument a call site (the same class of bug already found for
//     registerMemberOnChainComplete) — never user activity.
//   - 'deactivated_tracked' — MemberRegistered/WalletLinked only. No Firestore match, but the
//     identity's on-chain status is Inactive. A real instrumentation bug never self-deactivates
//     an account, so this is a strong signal the account was deliberately deactivated after the
//     fact (e.g. e2e test cleanup — see e2e/helpers/backend/staging.ts's deactivateOnChain, which
//     deactivates on-chain but deletes the Firestore user doc) rather than a missed write. Named
//     "tracked" rather than "untracked" — we're not missing anything here, we're accurately
//     recording that this identity is inactive on-chain.
//   - 'infrastructure' — HealthRecordCoreUpdated/AdminTransferred only. Both are onlyAdmin
//     contract-configuration events (repointing the linked HealthRecordCore address; rotating the
//     admin key) with no app call site and no Firestore collection that could ever represent
//     either action — running them through the matched/admin_untracked pipeline would always land
//     on admin_untracked with zero diagnostic value. This status means "expected, deliberate
//     configuration," not a bug.
//   - 'infrastructure_admin_mismatch' — same two events, but the on-chain caller didn't match our
//     configured admin wallet (getAdminWallet().address). Since onlyAdmin only ever accepts a call
//     from whoever the contract currently considers its admin, this is a real signal that our
//     ADMIN_WALLET_PRIVATE_KEY secret is out of sync with the contract's actual admin — e.g. an
//     untracked key rotation — not an instrumentation gap.
export type ChainEventReconciliationStatus =
  | 'unclassified'
  | 'matched'
  | 'sync_queue_confirmed_missing_write'
  | 'legitimate_chain_only'
  | 'admin_untracked'
  | 'deactivated_tracked'
  | 'infrastructure'
  | 'infrastructure_admin_mismatch';

export interface ChainEventCacheDoc {
  contract: BlockchainContract;
  eventName: string; // e.g. 'MemberRegistered' | 'WalletLinked'
  logIndex: number;
  // Reuses the existing BlockchainRef shape rather than loose txHash/blockNumber fields — gives
  // chainId + contractAddress for free, and matches how every other write in the app already
  // cites its on-chain provenance. Build via buildMemberRegistryRef/buildHealthRecordRef.
  blockchainRef: BlockchainRef;
  blockTimestamp: TimestampLike;
  // Decoded named event args, hashes/addresses as hex strings. Shape varies by eventName —
  // consumers narrow by checking eventName first (see eventDecoders.ts for what each produces).
  args: Record<string, unknown>;
  reconciliationStatus: ChainEventReconciliationStatus;
  matchedSyncQueueId: string | null;
  matchedFirestoreRef: string | null;
  reconciledAt: TimestampLike | null;
  indexedAt: TimestampLike;
}

export interface ChainIndexerCheckpoint {
  contract: BlockchainContract;
  // Which network/proxy this checkpoint's lastScannedBlock is relative to — also baked into the
  // doc's own ID (buildChainIndexerCheckpointDocId) so a future network or proxy-address change
  // (see ticket #474) naturally starts a fresh checkpoint instead of resuming a block number
  // that has no relationship to the new contract, rather than just being mislabeled.
  chainId: number;
  contractAddress: string;
  lastScannedBlock: number;
  lastRunAt: TimestampLike;
  lastRunStatus: 'ok' | 'error';
  lastError?: string;
}

/** Deterministic composite doc ID for chainEventCache — the idempotency mechanism. */
export function buildChainEventCacheDocId(txHash: string, logIndex: number): string {
  return `${txHash}_${logIndex}`;
}

/**
 * Deterministic doc ID for chainIndexerCheckpoints, keyed by contract + network + address so a
 * proxy/network change (ticket #474) can never resume scanning against the wrong contract from a
 * stale block number — it just starts a fresh checkpoint under a new ID instead.
 */
export function buildChainIndexerCheckpointDocId(
  contract: BlockchainContract,
  chainId: number,
  contractAddress: string
): string {
  return `${contract}_${chainId}_${contractAddress}`;
}
