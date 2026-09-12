// functions/src/chainIndexer/eventRegistry.ts
//
// Per-event-type dispatch table for the chain event indexer — mirrors
// functions/src/services/blockchainSyncRetryService.ts's REPLAY_REGISTRY shape: one generic
// executor (chainEventIndexerService.ts's scan/cache/reconcile loop) dispatching to a per-type
// entry for the two pieces that actually vary by event — how to filter/decode the raw log, and
// how to reconcile it against Firestore. Adding a new event type means adding one entry here and
// nowhere else in chainEventIndexerService.ts's loop logic.
//
// RoleChanged is intentionally NOT registered yet (Slice 3) — it shares call sites with
// RoleGranted/RoleRevoked (changeRole, voluntarilyLeaveOwnership demotions, trustee level sync)
// but needs its own match rule (oldRole/newRole against a permissionHistory `changes[]` entry
// with action 'upgraded'/'downgraded', not a simple grant/revoke check) and its own review pass.

import type { ethers, Provider } from 'ethers';
import type { Firestore } from 'firebase-admin/firestore';
import type { MemberRoleManager } from '../_shared/typechain';
import type { ChainEventCacheDoc } from '../_shared';
import {
  decodeMemberRoleManagerLog,
  decodeRoleEventLog,
  type MemberRoleManagerEventName,
  type RawMemberRoleManagerLog,
  type RawRoleEventLog,
} from './eventDecoders';
import { reconcileMemberRoleManagerEvent, reconcileRoleEvent, type ReconciliationResult } from './reconciliationService';

export interface ChainEventRegistryEntry {
  getFilter: (contract: MemberRoleManager) => ethers.DeferredTopicFilter;
  // Pulls the event-specific fields off a raw ethers EventLog's .args — timestamp is handled
  // once, generically, by chainEventIndexerService.ts's toRawLog, since every event registered
  // here carries it.
  toRawArgs: (log: ethers.EventLog) => Record<string, unknown>;
  decode: (log: RawMemberRoleManagerLog | RawRoleEventLog) => ReturnType<typeof decodeMemberRoleManagerLog | typeof decodeRoleEventLog>;
  reconcile: (
    db: Firestore,
    provider: Provider,
    doc: Pick<ChainEventCacheDoc, 'args' | 'blockchainRef'>
  ) => Promise<ReconciliationResult>;
}

export const CHAIN_EVENT_REGISTRY: Record<MemberRoleManagerEventName, ChainEventRegistryEntry> = {
  MemberRegistered: {
    getFilter: contract => contract.filters.MemberRegistered(),
    toRawArgs: log => ({ wallet: log.args.wallet as string, userIdHash: log.args.userIdHash as string }),
    decode: log => decodeMemberRoleManagerLog(log as RawMemberRoleManagerLog),
    reconcile: reconcileMemberRoleManagerEvent,
  },
  WalletLinked: {
    getFilter: contract => contract.filters.WalletLinked(),
    toRawArgs: log => ({ wallet: log.args.wallet as string, userIdHash: log.args.userIdHash as string }),
    decode: log => decodeMemberRoleManagerLog(log as RawMemberRoleManagerLog),
    reconcile: reconcileMemberRoleManagerEvent,
  },
  RoleGranted: {
    getFilter: contract => contract.filters.RoleGranted(),
    toRawArgs: log => ({
      recordIdHash: log.args.recordIdHash as string,
      targetIdHash: log.args.targetIdHash as string,
      role: log.args.role as string,
      userIdHash: log.args.userIdHash as string,
    }),
    decode: log => decodeRoleEventLog(log as RawRoleEventLog),
    reconcile: reconcileRoleEvent,
  },
  RoleRevoked: {
    getFilter: contract => contract.filters.RoleRevoked(),
    toRawArgs: log => ({
      recordIdHash: log.args.recordIdHash as string,
      targetIdHash: log.args.targetIdHash as string,
      role: log.args.role as string,
      userIdHash: log.args.userIdHash as string,
    }),
    decode: log => decodeRoleEventLog(log as RawRoleEventLog),
    reconcile: reconcileRoleEvent,
  },
};
