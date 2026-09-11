// functions/src/chainIndexer/chainEventIndexerService.ts
//
// Core, testable logic for the event-based on-chain indexer (Slice 1: MemberRoleManager's
// MemberRegistered/WalletLinked only — see the plan's "Deferred to follow-up tickets" section for
// what comes next).
//
// Per invocation: resume from the persisted checkpoint (seeded at the contract's deployment
// block on first run), scan forward in chunks up to `currentBlock - REORG_CONFIRMATION_BUFFER`
// (guards against reading logs that could still be reorged away on an L2), caching every event it
// finds and reconciling it against Firestore immediately. The checkpoint is persisted after
// *every* chunk (not just at the end) so a mid-run timeout loses at most one chunk's progress.

import { Firestore, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { ethers } from 'ethers';
import {
  MEMBER_ROLE_MANAGER,
  NETWORK_CORE,
  buildRpcUrl,
  buildChainEventCacheDocId,
  buildChainIndexerCheckpointDocId,
} from '../_shared';
import type { ChainEventCacheDoc, ChainIndexerCheckpoint } from '../_shared';
import { MemberRoleManager__factory } from '../_shared/typechain';
import type { MemberRoleManager } from '../_shared/typechain';
import {
  decodeMemberRoleManagerLog,
  type DecodedMemberRoleManagerEvent,
  type MemberRoleManagerEventName,
  type RawMemberRoleManagerLog,
} from './eventDecoders';
import { reconcileMemberRoleManagerEvent } from './reconciliationService';

const REORG_CONFIRMATION_BUFFER = 20; // blocks — guards against reading logs an L2 reorg could still drop. TBD could be adjusted based on chain behavior
const INITIAL_CHUNK_SIZE = 500;
const MIN_CHUNK_SIZE = 25;
// Caps the per-cycle "sweep lingering unclassified docs" pass (see sweepUnclassifiedEvents) so a
// large backlog of stuck docs can't itself cause this sweep to run long enough to be killed by
// the function timeout — any remainder just gets picked up on the next cycle.
const UNCLASSIFIED_SWEEP_LIMIT = 200;

export function getReadOnlyProvider(): ethers.JsonRpcProvider {
  const apiKey = process.env.ALCHEMY_API_KEY;
  const rpcUrl = apiKey ? buildRpcUrl(apiKey) : NETWORK_CORE.rpcUrlFallback;
  return new ethers.JsonRpcProvider(rpcUrl);
}

// Heuristic, provider-agnostic detection of a block-range/result-size error — Alchemy's exact
// wording varies by tier and isn't safe to hardcode, so this matches common substrings rather
// than one exact message. A misclassification is safe either way: worst case, an unrelated error
// triggers one unnecessary chunk-size halving before surfacing again unchanged at MIN_CHUNK_SIZE.
export function looksLikeBlockRangeError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('block range') ||
    message.includes('range is too large') ||
    message.includes('exceeds the range') ||
    message.includes('query returned more than') ||
    message.includes('response size exceeded')
  );
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 6;
}

// Keyed by contract + chainId + contractAddress (buildChainIndexerCheckpointDocId), not just the
// bare contract name — so a future network/proxy change (ticket #474) can never resume scanning
// the wrong contract from a stale block number. It just starts a brand-new checkpoint under a new
// ID instead, since chainId/contractAddress are baked into the ID itself. Always resolves to the
// same ID today (one network, one permanent proxy address per CLAUDE.md), but costs nothing to
// get right now versus a real data migration once a checkpoint doc actually exists in production.
async function getCheckpoint(db: Firestore, docId: string): Promise<ChainIndexerCheckpoint | null> {
  const snap = await db.collection('chainIndexerCheckpoints').doc(docId).get();
  return snap.exists ? (snap.data() as ChainIndexerCheckpoint) : null;
}

async function saveCheckpoint(
  db: Firestore,
  docId: string,
  chainId: number,
  contractAddress: string,
  lastScannedBlock: number,
  status: 'ok' | 'error',
  error?: string
): Promise<void> {
  const checkpoint: ChainIndexerCheckpoint = {
    contract: 'MemberRoleManager',
    chainId,
    contractAddress,
    lastScannedBlock,
    lastRunAt: Timestamp.now(),
    lastRunStatus: status,
    ...(error && { lastError: error }),
  };
  await db.collection('chainIndexerCheckpoints').doc(docId).set(checkpoint);
}

interface ChunkResult {
  logs: ethers.EventLog[];
  toBlock: number;
}

/** Fetches one event type's logs for [fromBlock, toBlock], halving the range on a size/limit
 *  error until it succeeds or hits MIN_CHUNK_SIZE (at which point the error is real, not a range
 *  problem, and is rethrown). Returns the logs found and the block the scan actually reached, so
 *  the caller knows how far it got even when it had to back off. */
async function queryFilterWithBackoff(
  contract: MemberRoleManager,
  eventName: MemberRoleManagerEventName,
  fromBlock: number,
  toBlock: number
): Promise<ChunkResult> {
  let attemptToBlock = toBlock;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const filter =
        eventName === 'MemberRegistered'
          ? contract.filters.MemberRegistered()
          : contract.filters.WalletLinked();
      const logs = await contract.queryFilter(filter, fromBlock, attemptToBlock);
      return { logs: logs as unknown as ethers.EventLog[], toBlock: attemptToBlock };
    } catch (error) {
      const span = attemptToBlock - fromBlock + 1;
      if (!looksLikeBlockRangeError(error) || span <= MIN_CHUNK_SIZE) throw error;
      attemptToBlock = fromBlock + Math.max(MIN_CHUNK_SIZE, Math.floor(span / 2)) - 1;
    }
  }
}

function toRawLog(
  log: ethers.EventLog,
  eventName: MemberRoleManagerEventName,
  contractAddress: string,
  chainId: number
): RawMemberRoleManagerLog {
  return {
    eventName,
    transactionHash: log.transactionHash,
    blockNumber: log.blockNumber,
    index: log.index,
    contractAddress,
    chainId,
    args: {
      wallet: log.args.wallet as string,
      userIdHash: log.args.userIdHash as string,
      timestamp: log.args.timestamp as bigint,
    },
  };
}

/**
 * Retroactively reconciles any already-cached event still stuck at 'unclassified' — e.g. a doc
 * from a prior cycle that got killed (timeout, crash) after caching but before finishing
 * reconciliation. Needs no re-scan of the chain: everything reconciliation needs (args,
 * blockchainRef) is already on the cached doc, and the checkpoint has already moved past these
 * blocks so a re-scan would never revisit them anyway — this sweep is the only way they'd ever
 * get classified. Bounded by UNCLASSIFIED_SWEEP_LIMIT so a large backlog can't itself risk timing
 * out; run again next cycle to pick up any remainder.
 */
async function sweepUnclassifiedEvents(db: Firestore, provider: ethers.Provider): Promise<number> {
  const snap = await db
    .collection('chainEventCache')
    .where('reconciliationStatus', '==', 'unclassified')
    .limit(UNCLASSIFIED_SWEEP_LIMIT)
    .get();

  let reconciled = 0;
  for (const doc of snap.docs) {
    const classification = await reconcileMemberRoleManagerEvent(
      db,
      provider,
      doc.data() as ChainEventCacheDoc
    );
    await doc.ref.update(classification);
    reconciled++;
  }
  return reconciled;
}

export interface ChainEventIndexerCycleResult {
  scannedFromBlock: number;
  scannedToBlock: number;
  eventsFound: number;
  newlyCached: number;
  reconciledUnclassified: number;
}

export async function runChainEventIndexerCycle(
  db: Firestore = getFirestore(),
  provider: ethers.JsonRpcProvider = getReadOnlyProvider()
): Promise<ChainEventIndexerCycleResult> {
  const contract = MemberRoleManager__factory.connect(MEMBER_ROLE_MANAGER.proxy, provider);
  // Captured once per cycle from what's actually being queried (not re-read from global config
  // later at cache-write time) — see eventDecoders.ts's RawMemberRoleManagerLog comment.
  const contractAddress = contract.target as string;
  const chainId = Number((await provider.getNetwork()).chainId);
  const checkpointDocId = buildChainIndexerCheckpointDocId('MemberRoleManager', chainId, contractAddress);

  // Runs first, independent of the forward scan below — catches any doc left stuck at
  // 'unclassified' by a prior interrupted run (see this function's own timeout — a real
  // production incident on 2026-09-11: no explicit timeoutSeconds meant every run was being
  // killed by Cloud Functions' 60s default mid-backfill, leaving events uncatchable by the
  // forward scan alone since the checkpoint had already moved past their blocks).
  const reconciledUnclassified = await sweepUnclassifiedEvents(db, provider);

  const checkpoint = await getCheckpoint(db, checkpointDocId);
  const startBlock = checkpoint
    ? checkpoint.lastScannedBlock + 1
    : MEMBER_ROLE_MANAGER.deploymentBlock;

  const currentBlock = await provider.getBlockNumber();
  const targetBlock = currentBlock - REORG_CONFIRMATION_BUFFER;

  if (startBlock > targetBlock) {
    return {
      scannedFromBlock: startBlock,
      scannedToBlock: startBlock - 1,
      eventsFound: 0,
      newlyCached: 0,
      reconciledUnclassified,
    };
  }

  let cursor = startBlock;
  let chunkSize = INITIAL_CHUNK_SIZE;
  let eventsFound = 0;
  let newlyCached = 0;

  try {
    while (cursor <= targetBlock) {
      const chunkEnd = Math.min(cursor + chunkSize - 1, targetBlock);

      const [registered, linked] = await Promise.all([
        queryFilterWithBackoff(contract, 'MemberRegistered', cursor, chunkEnd),
        queryFilterWithBackoff(contract, 'WalletLinked', cursor, chunkEnd),
      ]);
      // Both calls target the same [cursor, chunkEnd] range and only back off on the same kind
      // of error, so in practice they land on the same actual toBlock; take the smaller to stay
      // safe if they ever diverge, and re-derive chunkSize from it so the next iteration starts
      // from whatever size actually worked rather than immediately re-triggering a range error.
      const actualChunkEnd = Math.min(registered.toBlock, linked.toBlock);
      chunkSize = actualChunkEnd - cursor + 1;

      const logs = [
        ...registered.logs.map(l => toRawLog(l, 'MemberRegistered', contractAddress, chainId)),
        ...linked.logs.map(l => toRawLog(l, 'WalletLinked', contractAddress, chainId)),
      ].filter(l => l.blockNumber <= actualChunkEnd);
      eventsFound += logs.length;

      for (const log of logs) {
        const decoded = decodeMemberRoleManagerLog(log);
        const wasNew = await cacheAndReconcile(db, provider, decoded);
        if (wasNew) newlyCached++;
      }

      await saveCheckpoint(db, checkpointDocId, chainId, contractAddress, actualChunkEnd, 'ok');
      cursor = actualChunkEnd + 1;
      chunkSize = INITIAL_CHUNK_SIZE; // reset for the next chunk — no reason to stay small once one succeeds
    }
  } catch (error) {
    await saveCheckpoint(
      db,
      checkpointDocId,
      chainId,
      contractAddress,
      cursor - 1,
      'error',
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }

  return {
    scannedFromBlock: startBlock,
    scannedToBlock: targetBlock,
    eventsFound,
    newlyCached,
    reconciledUnclassified,
  };
}

/** Writes the event to chainEventCache (idempotent via `.create()` — a doc that already exists,
 *  possibly already reconciled by a prior run, is left untouched) and reconciles it if new.
 *  Returns whether this was a newly-cached event. */
async function cacheAndReconcile(
  db: Firestore,
  provider: ethers.Provider,
  decoded: DecodedMemberRoleManagerEvent
): Promise<boolean> {
  const docId = buildChainEventCacheDocId(decoded.txHash, decoded.logIndex);
  const docRef = db.collection('chainEventCache').doc(docId);

  const doc: ChainEventCacheDoc = {
    contract: 'MemberRoleManager',
    eventName: decoded.eventName,
    logIndex: decoded.logIndex,
    // Built straight from what the decoded event itself captured at query time, not re-derived
    // via buildMemberRegistryRef (which would silently re-read MEMBER_ROLE_MANAGER.proxy/
    // NETWORK_CORE.chainId fresh from current config) — see eventDecoders.ts's comment.
    blockchainRef: {
      txHash: decoded.txHash,
      blockNumber: decoded.blockNumber,
      contractAddress: decoded.contractAddress,
      chainId: decoded.chainId,
    },
    blockTimestamp: Timestamp.fromMillis(decoded.blockTimestampSeconds * 1000),
    args: decoded.args,
    reconciliationStatus: 'unclassified',
    matchedSyncQueueId: null,
    matchedFirestoreRef: null,
    reconciledAt: null,
    indexedAt: Timestamp.now(),
  };

  try {
    await docRef.create(doc);
  } catch (error) {
    if (isAlreadyExistsError(error)) return false;
    throw error;
  }

  const classification = await reconcileMemberRoleManagerEvent(db, provider, doc);
  await docRef.update(classification);
  return true;
}
