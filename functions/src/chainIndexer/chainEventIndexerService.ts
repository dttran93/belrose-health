// functions/src/chainIndexer/chainEventIndexerService.ts
//
// Core, testable logic for the event-based on-chain indexer. Generic over which contract it's
// scanning (see chainIndexerContractConfig.ts's ChainIndexerContractConfig) — originally built
// hardcoded to MemberRoleManager only (Slice 1 onward), generalized when HealthRecordCore was
// added as a second contract. Every internal reference to a specific contract's proxy address,
// deployment block, or event registry now comes from the `config` parameter instead of a
// module-level constant.
//
// Per invocation: resume from the persisted checkpoint (seeded at the contract's deployment
// block on first run), scan forward in chunks up to `currentBlock - REORG_CONFIRMATION_BUFFER`
// (guards against reading logs that could still be reorged away on an L2), caching every event it
// finds and reconciling it against Firestore immediately. The checkpoint is persisted after
// *every* chunk (not just at the end) so a mid-run timeout loses at most one chunk's progress.

import { Firestore, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { ethers } from 'ethers';
import { buildRpcUrl, buildChainEventCacheDocId, buildChainIndexerCheckpointDocId } from '../_shared';
import type { ChainEventCacheDoc, ChainIndexerCheckpoint, BlockchainContract } from '../_shared';
import { NETWORK_CORE } from '../_shared';
import type {
  ChainIndexerContractConfig,
  QueryableChainContract,
  GenericRawChainLog,
  GenericDecodedChainEvent,
} from './chainIndexerContractConfig';
import { MEMBER_ROLE_MANAGER_INDEXER_CONFIG } from './memberRoleManagerEventRegistry';
import { HEALTH_RECORD_CORE_INDEXER_CONFIG } from './healthRecordCoreEventRegistry';

const REORG_CONFIRMATION_BUFFER = 20; // blocks — guards against reading logs an L2 reorg could still drop. TBD could be adjusted based on chain behavior
const INITIAL_CHUNK_SIZE = 500;
const MIN_CHUNK_SIZE = 25;
// Caps the per-cycle "sweep lingering unclassified docs" pass (see sweepUnclassifiedEvents) so a
// large backlog of stuck docs can't itself cause this sweep to run long enough to be killed by
// the function timeout — any remainder just gets picked up on the next cycle. Per-contract-per-
// cycle since sweepUnclassifiedEvents now scopes its query by contract (see that function's own
// comment) — one contract's backlog can no longer crowd out another's sweep budget.
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
// same ID today (one network, one permanent proxy address per contract, per CLAUDE.md), but costs
// nothing to get right now versus a real data migration once a checkpoint doc actually exists.
async function getCheckpoint(db: Firestore, docId: string): Promise<ChainIndexerCheckpoint | null> {
  const snap = await db.collection('chainIndexerCheckpoints').doc(docId).get();
  return snap.exists ? (snap.data() as ChainIndexerCheckpoint) : null;
}

async function saveCheckpoint(
  db: Firestore,
  docId: string,
  contract: BlockchainContract,
  chainId: number,
  contractAddress: string,
  lastScannedBlock: number,
  status: 'ok' | 'error',
  error?: string
): Promise<void> {
  const checkpoint: ChainIndexerCheckpoint = {
    contract,
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
async function queryFilterWithBackoff<TContract extends QueryableChainContract, TEventName extends string>(
  contract: TContract,
  eventName: TEventName,
  registry: ChainIndexerContractConfig<TContract, TEventName>['registry'],
  fromBlock: number,
  toBlock: number
): Promise<ChunkResult> {
  let attemptToBlock = toBlock;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const filter = registry[eventName].getFilter(contract);
      const logs = await contract.queryFilter(filter, fromBlock, attemptToBlock);
      return { logs: logs as unknown as ethers.EventLog[], toBlock: attemptToBlock };
    } catch (error) {
      const span = attemptToBlock - fromBlock + 1;
      if (!looksLikeBlockRangeError(error) || span <= MIN_CHUNK_SIZE) throw error;
      attemptToBlock = fromBlock + Math.max(MIN_CHUNK_SIZE, Math.floor(span / 2)) - 1;
    }
  }
}

/**
 * Builds the raw-log shape each registry entry's `decode` expects. `timestamp` is pulled off
 * generically here (every event registered anywhere carries it) — only the event-specific fields
 * come from the per-type `toRawArgs`. The union cast at the end is the one deliberate
 * dynamic-dispatch point in this file: the registry's whole point is one generic loop over
 * differently-shaped events, which necessarily costs static type-checking here (same tradeoff
 * already accepted in blockchainSyncRetryService.ts's REPLAY_REGISTRY) — correctness for this
 * seam leans on the per-event-type decoder tests instead.
 */
function toRawLog<TContract extends QueryableChainContract, TEventName extends string>(
  log: ethers.EventLog,
  eventName: TEventName,
  registry: ChainIndexerContractConfig<TContract, TEventName>['registry'],
  contractAddress: string,
  chainId: number
): GenericRawChainLog {
  return {
    eventName,
    transactionHash: log.transactionHash,
    blockNumber: log.blockNumber,
    index: log.index,
    contractAddress,
    chainId,
    args: {
      ...registry[eventName].toRawArgs(log),
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
 *
 * Scoped to config.contract via a `.where('contract', '==', ...)` filter — once there are two
 * contracts, a global cross-contract query would either need a second lookup to find the right
 * registry per doc, or risk one contract's backlog starving the other's sweep budget. Scoping the
 * query itself is simpler and needs no new Firestore index (an equality filter on a second field,
 * same as every other multi-`where` query already in this file/codebase).
 */
async function sweepUnclassifiedEvents<TContract extends QueryableChainContract, TEventName extends string>(
  db: Firestore,
  provider: ethers.Provider,
  config: ChainIndexerContractConfig<TContract, TEventName>
): Promise<number> {
  const snap = await db
    .collection('chainEventCache')
    .where('reconciliationStatus', '==', 'unclassified')
    .where('contract', '==', config.contract)
    .limit(UNCLASSIFIED_SWEEP_LIMIT)
    .get();

  let reconciled = 0;
  for (const doc of snap.docs) {
    const data = doc.data() as ChainEventCacheDoc;
    const entry = config.registry[data.eventName as TEventName];
    if (!entry) {
      // Shouldn't happen — every doc is written with an eventName this file itself just cached
      // it under — but a doc with an unrecognized eventName must never take down the whole sweep
      // batch; skip it and let it show up in logs instead.
      console.error(
        `⚠️ chainEventCache/${doc.id} has unrecognized eventName "${data.eventName}" for contract ${config.contract} — skipping sweep`
      );
      continue;
    }
    const classification = await entry.reconcile(db, provider, data);
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

export async function runChainEventIndexerCycle<TContract extends QueryableChainContract, TEventName extends string>(
  config: ChainIndexerContractConfig<TContract, TEventName>,
  db: Firestore = getFirestore(),
  provider: ethers.JsonRpcProvider = getReadOnlyProvider()
): Promise<ChainEventIndexerCycleResult> {
  const contract = config.connect(config.proxyAddress, provider);
  // Captured once per cycle from what's actually being queried (not re-read from global config
  // later at cache-write time) — see memberRoleManagerEventDecoders.ts's RawMemberRoleManagerLog
  // comment.
  const contractAddress = contract.target as string;
  const chainId = Number((await provider.getNetwork()).chainId);
  const checkpointDocId = buildChainIndexerCheckpointDocId(config.contract, chainId, contractAddress);

  // Runs first, independent of the forward scan below — catches any doc left stuck at
  // 'unclassified' by a prior interrupted run (see this function's own timeout — a real
  // production incident on 2026-09-11: no explicit timeoutSeconds meant every run was being
  // killed by Cloud Functions' 60s default mid-backfill, leaving events uncatchable by the
  // forward scan alone since the checkpoint had already moved past their blocks).
  const reconciledUnclassified = await sweepUnclassifiedEvents(db, provider, config);

  const checkpoint = await getCheckpoint(db, checkpointDocId);
  const startBlock = checkpoint ? checkpoint.lastScannedBlock + 1 : config.deploymentBlock;

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

      const eventNames = Object.keys(config.registry) as TEventName[];
      const results = await Promise.all(
        eventNames.map(name => queryFilterWithBackoff(contract, name, config.registry, cursor, chunkEnd))
      );
      // Every filter targets the same [cursor, chunkEnd] range and only backs off on the same
      // kind of error, so in practice they all land on the same actual toBlock; take the smallest
      // to stay safe if they ever diverge, and re-derive chunkSize from it so the next iteration
      // starts from whatever size actually worked rather than immediately re-triggering a range
      // error.
      const actualChunkEnd = Math.min(...results.map(r => r.toBlock));
      chunkSize = actualChunkEnd - cursor + 1;

      const logs = eventNames
        .flatMap((name, i) => results[i].logs.map(l => toRawLog(l, name, config.registry, contractAddress, chainId)))
        .filter(l => l.blockNumber <= actualChunkEnd);
      eventsFound += logs.length;

      for (const log of logs) {
        const decoded = config.registry[log.eventName as TEventName].decode(log);
        const wasNew = await cacheAndReconcile(db, provider, config, decoded);
        if (wasNew) newlyCached++;
      }

      await saveCheckpoint(db, checkpointDocId, config.contract, chainId, contractAddress, actualChunkEnd, 'ok');
      cursor = actualChunkEnd + 1;
      chunkSize = INITIAL_CHUNK_SIZE; // reset for the next chunk — no reason to stay small once one succeeds
    }
  } catch (error) {
    await saveCheckpoint(
      db,
      checkpointDocId,
      config.contract,
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
async function cacheAndReconcile<TContract extends QueryableChainContract, TEventName extends string>(
  db: Firestore,
  provider: ethers.Provider,
  config: ChainIndexerContractConfig<TContract, TEventName>,
  decoded: GenericDecodedChainEvent
): Promise<boolean> {
  const docId = buildChainEventCacheDocId(decoded.txHash, decoded.logIndex);
  const docRef = db.collection('chainEventCache').doc(docId);

  const doc: ChainEventCacheDoc = {
    contract: config.contract,
    eventName: decoded.eventName,
    logIndex: decoded.logIndex,
    // Built straight from what the decoded event itself captured at query time, not re-derived
    // via a build*Ref helper (which would silently re-read the contract's proxy/chainId fresh
    // from current config) — see memberRoleManagerEventDecoders.ts's comment.
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

  const classification = await config.registry[decoded.eventName as TEventName].reconcile(db, provider, doc);
  await docRef.update(classification);
  return true;
}

/** Every contract this indexer currently covers. Order matters for
 *  runChainEventIndexerCycleForAllContracts: MemberRoleManager first so its steady-state catch-up
 *  scan is never starved by HealthRecordCore's (much larger, one-time) initial historical
 *  backfill sharing the same function invocation's time budget. */
export const CHAIN_INDEXER_CONTRACTS = [MEMBER_ROLE_MANAGER_INDEXER_CONFIG, HEALTH_RECORD_CORE_INDEXER_CONFIG] as const;

/**
 * Runs one cycle for every registered contract, in order. Used by both the scheduled function and
 * the manual "Run Indexer Now" callable — see functions/src/handlers/chainEventIndexer.ts.
 *
 * One contract's cycle throwing (e.g. a transient RPC failure) must never cost another contract
 * its own scan window this tick — caught and recorded per-contract rather than propagated, since
 * each contract's own checkpoint doc already carries the durable 'error' status/lastError for
 * whichever one failed (see saveCheckpoint's catch branch above).
 */
export async function runChainEventIndexerCycleForAllContracts(
  db: Firestore = getFirestore(),
  provider: ethers.JsonRpcProvider = getReadOnlyProvider()
): Promise<Record<BlockchainContract, ChainEventIndexerCycleResult | { error: string }>> {
  const results = {} as Record<BlockchainContract, ChainEventIndexerCycleResult | { error: string }>;
  for (const config of CHAIN_INDEXER_CONTRACTS) {
    try {
      // Each element of CHAIN_INDEXER_CONTRACTS is a differently-instantiated
      // ChainIndexerContractConfig<TContract, TEventName> (MemberRoleManager's own event names vs
      // HealthRecordCore's own) — TypeScript can't infer a single TContract/TEventName pair that
      // fits every element of a heterogeneous tuple, so this cast erases to the widest shape
      // runChainEventIndexerCycle's generic signature accepts. Same "dynamic dispatch, tests carry
      // correctness" tradeoff already accepted for toRawLog's own union cast above.
      const genericConfig = config as unknown as ChainIndexerContractConfig<QueryableChainContract, string>;
      results[config.contract] = await runChainEventIndexerCycle(genericConfig, db, provider);
    } catch (error) {
      results[config.contract] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return results;
}
