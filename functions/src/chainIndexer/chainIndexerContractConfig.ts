// functions/src/chainIndexer/chainIndexerContractConfig.ts
//
// Shared generic types that let chainEventIndexerService.ts's scan/cache/reconcile loop run
// against any contract, not just MemberRoleManager. Introduced when the indexer became
// multi-contract (adding HealthRecordCore) — before this file existed, the loop, the registry
// entry shape, and the cached-doc `contract` field were all hardcoded to MemberRoleManager.
//
// Deliberately has zero dependency on any contract-specific file (memberRoleManagerEventRegistry.ts,
// healthRecordCoreEventRegistry.ts, etc.) — those depend on this file, never the other way, so
// there's no risk of a circular import as more contracts are added.

import type { ethers, Provider } from 'ethers';
import type { Firestore } from 'firebase-admin/firestore';
import type { BlockchainContract, ChainEventCacheDoc } from '../_shared';

/** The minimal structural shape the generic loop needs from a typechain contract instance —
 *  satisfied by MemberRoleManager, HealthRecordCore, or any future contract's generated typechain
 *  class without needing a shared base class or any change to those generated files.
 *
 *  `queryFilter`'s return type is deliberately loose (`Promise<any[]>`, not `Promise<ethers.EventLog[]>`)
 *  — typechain generates each contract's queryFilter as a generic method returning
 *  `TypedEventLog<TCEvent>[]`, whose `args` field structurally conflicts with plain
 *  `ethers.EventLog`'s `Result`-typed `args` once TCEvent can't be pinned down against this
 *  interface's non-generic filter parameter. `queryFilterWithBackoff` already casts the result
 *  through `unknown` before use, so no safety is lost — same "this seam leans on the per-event-type
 *  decoder tests, not the type checker" tradeoff already documented there. */
export interface QueryableChainContract {
  readonly target: string | ethers.Addressable;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryFilter(filter: ethers.DeferredTopicFilter, fromBlock?: number, toBlock?: number): Promise<any[]>;
}

/** Every Raw*EventLog shape across every slice of every contract already carries exactly these
 *  fields — the generic loop only ever touches these, never a contract's own event-specific `args`
 *  shape, so it never needs to import that contract's own big discriminated union. Every concrete
 *  Raw*EventLog type (e.g. RawMemberRoleManagerLog) is already structurally assignable here. */
export interface GenericRawChainLog {
  eventName: string;
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: Record<string, unknown>;
}

/** Mirrors GenericRawChainLog for the decoded shape every Decoded*Event type already satisfies. */
export interface GenericDecodedChainEvent {
  eventName: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: Record<string, unknown>;
}

/** What every reconciler returns, regardless of contract or event type — a plain Pick off
 *  ChainEventCacheDoc, unrelated to any single contract's own classification pipeline. Single
 *  source of truth: memberRoleManagerReconciliationService.ts and
 *  healthRecordCoreReconciliationService.ts both import this rather than each declaring their own. */
export type ReconciliationResult = Pick<
  ChainEventCacheDoc,
  'reconciliationStatus' | 'matchedSyncQueueId' | 'matchedFirestoreRef' | 'reconciledAt'
>;

/** Generalized form of the per-event dispatch-table entry each contract's own eventRegistry file
 *  declares (e.g. memberRoleManagerEventRegistry.ts's CHAIN_EVENT_REGISTRY) — same 4 responsibilities
 *  as before (filter/decode/reconcile the raw log), parameterized over the contract type so each
 *  registry can key itself by that contract's own event-name union while staying assignable to the
 *  generic loop below. */
export interface ChainEventRegistryEntry<TContract extends QueryableChainContract> {
  getFilter: (contract: TContract) => ethers.DeferredTopicFilter;
  // Pulls the event-specific fields off a raw ethers EventLog's .args — timestamp is handled
  // once, generically, by chainEventIndexerService.ts's toRawLog, since every event registered
  // anywhere carries it.
  toRawArgs: (log: ethers.EventLog) => Record<string, unknown>;
  decode: (log: GenericRawChainLog) => GenericDecodedChainEvent;
  reconcile: (
    db: Firestore,
    provider: Provider,
    doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
  ) => Promise<ReconciliationResult>;
}

/** One descriptor per contract — everything chainEventIndexerService.ts's loop needs to run a full
 *  scan/cache/reconcile cycle without knowing at compile time which contract it's scanning. */
export interface ChainIndexerContractConfig<
  TContract extends QueryableChainContract,
  TEventName extends string,
> {
  contract: BlockchainContract;
  connect: (address: string, provider: ethers.Provider) => TContract;
  proxyAddress: string;
  deploymentBlock: number;
  registry: Record<TEventName, ChainEventRegistryEntry<TContract>>;
}
