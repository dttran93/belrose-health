// functions/src/chainIndexer/eventRegistry.ts
//
// Per-event-type dispatch table for the chain event indexer — mirrors
// functions/src/services/blockchainSyncRetryService.ts's REPLAY_REGISTRY shape: one generic
// executor (chainEventIndexerService.ts's scan/cache/reconcile loop) dispatching to a per-type
// entry for the two pieces that actually vary by event — how to filter/decode the raw log, and
// how to reconcile it against Firestore. Adding a new event type means adding one entry here and
// nowhere else in chainEventIndexerService.ts's loop logic.

import type { ethers, Provider } from 'ethers';
import type { Firestore } from 'firebase-admin/firestore';
import type { MemberRoleManager } from '../_shared/typechain';
import type { ChainEventCacheDoc } from '../_shared';
import {
  decodeMemberRoleManagerLog,
  decodeRoleEventLog,
  decodeRoleChangedEventLog,
  decodeMemberStatusChangedEventLog,
  decodeOwnershipVoluntarilyLeftEventLog,
  decodeTrusteeProposedAcceptedEventLog,
  decodeTrusteeDeclinedEventLog,
  decodeTrusteeRevokedEventLog,
  decodeTrusteeLevelUpdatedEventLog,
  type MemberRoleManagerEventName,
  type RawMemberRoleManagerLog,
  type RawRoleEventLog,
  type RawRoleChangedEventLog,
  type RawMemberStatusChangedEventLog,
  type RawOwnershipVoluntarilyLeftEventLog,
  type RawTrusteeProposedAcceptedEventLog,
  type RawTrusteeDeclinedEventLog,
  type RawTrusteeRevokedEventLog,
  type RawTrusteeLevelUpdatedEventLog,
} from './eventDecoders';
import {
  reconcileMemberEvent,
  reconcileRoleEvent,
  reconcileRoleChangedEvent,
  reconcileMemberStatusChangedEvent,
  reconcileOwnershipVoluntarilyLeftEvent,
  reconcileTrusteeProposedEvent,
  reconcileTrusteeAcceptedEvent,
  reconcileTrusteeDeclinedEvent,
  reconcileTrusteeRevokedEvent,
  reconcileTrusteeLevelUpdatedEvent,
  type ReconciliationResult,
} from './reconciliationService';

type AnyRawLog =
  | RawMemberRoleManagerLog
  | RawRoleEventLog
  | RawRoleChangedEventLog
  | RawMemberStatusChangedEventLog
  | RawOwnershipVoluntarilyLeftEventLog
  | RawTrusteeProposedAcceptedEventLog
  | RawTrusteeDeclinedEventLog
  | RawTrusteeRevokedEventLog
  | RawTrusteeLevelUpdatedEventLog;

type AnyDecoder =
  | typeof decodeMemberRoleManagerLog
  | typeof decodeRoleEventLog
  | typeof decodeRoleChangedEventLog
  | typeof decodeMemberStatusChangedEventLog
  | typeof decodeOwnershipVoluntarilyLeftEventLog
  | typeof decodeTrusteeProposedAcceptedEventLog
  | typeof decodeTrusteeDeclinedEventLog
  | typeof decodeTrusteeRevokedEventLog
  | typeof decodeTrusteeLevelUpdatedEventLog;

export interface ChainEventRegistryEntry {
  getFilter: (contract: MemberRoleManager) => ethers.DeferredTopicFilter;
  // Pulls the event-specific fields off a raw ethers EventLog's .args — timestamp is handled
  // once, generically, by chainEventIndexerService.ts's toRawLog, since every event registered
  // here carries it.
  toRawArgs: (log: ethers.EventLog) => Record<string, unknown>;
  decode: (log: AnyRawLog) => ReturnType<AnyDecoder>;
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
    reconcile: reconcileMemberEvent,
  },
  WalletLinked: {
    getFilter: contract => contract.filters.WalletLinked(),
    toRawArgs: log => ({ wallet: log.args.wallet as string, userIdHash: log.args.userIdHash as string }),
    decode: log => decodeMemberRoleManagerLog(log as RawMemberRoleManagerLog),
    reconcile: reconcileMemberEvent,
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
  RoleChanged: {
    getFilter: contract => contract.filters.RoleChanged(),
    toRawArgs: log => ({
      recordIdHash: log.args.recordIdHash as string,
      targetIdHash: log.args.targetIdHash as string,
      oldRole: log.args.oldRole as string,
      newRole: log.args.newRole as string,
      userIdHash: log.args.userIdHash as string,
    }),
    decode: log => decodeRoleChangedEventLog(log as RawRoleChangedEventLog),
    reconcile: reconcileRoleChangedEvent,
  },
  MemberStatusChanged: {
    getFilter: contract => contract.filters.MemberStatusChanged(),
    toRawArgs: log => ({
      userIdHash: log.args.userIdHash as string,
      oldStatus: log.args.oldStatus,
      newStatus: log.args.newStatus,
      changedBy: log.args.changedBy as string,
    }),
    decode: log => decodeMemberStatusChangedEventLog(log as RawMemberStatusChangedEventLog),
    reconcile: reconcileMemberStatusChangedEvent,
  },
  OwnershipVoluntarilyLeft: {
    getFilter: contract => contract.filters.OwnershipVoluntarilyLeft(),
    toRawArgs: log => ({
      recordIdHash: log.args.recordIdHash as string,
      userIdHash: log.args.userIdHash as string,
    }),
    decode: log => decodeOwnershipVoluntarilyLeftEventLog(log as RawOwnershipVoluntarilyLeftEventLog),
    reconcile: reconcileOwnershipVoluntarilyLeftEvent,
  },
  TrusteeProposed: {
    getFilter: contract => contract.filters.TrusteeProposed(),
    toRawArgs: log => ({
      trustorIdHash: log.args.trustorIdHash as string,
      trusteeIdHash: log.args.trusteeIdHash as string,
      level: log.args.level,
    }),
    decode: log => decodeTrusteeProposedAcceptedEventLog(log as RawTrusteeProposedAcceptedEventLog),
    reconcile: reconcileTrusteeProposedEvent,
  },
  TrusteeAccepted: {
    getFilter: contract => contract.filters.TrusteeAccepted(),
    toRawArgs: log => ({
      trustorIdHash: log.args.trustorIdHash as string,
      trusteeIdHash: log.args.trusteeIdHash as string,
      level: log.args.level,
    }),
    decode: log => decodeTrusteeProposedAcceptedEventLog(log as RawTrusteeProposedAcceptedEventLog),
    reconcile: reconcileTrusteeAcceptedEvent,
  },
  TrusteeDeclined: {
    getFilter: contract => contract.filters.TrusteeDeclined(),
    toRawArgs: log => ({
      trustorIdHash: log.args.trustorIdHash as string,
      trusteeIdHash: log.args.trusteeIdHash as string,
    }),
    decode: log => decodeTrusteeDeclinedEventLog(log as RawTrusteeDeclinedEventLog),
    reconcile: reconcileTrusteeDeclinedEvent,
  },
  TrusteeRevoked: {
    getFilter: contract => contract.filters.TrusteeRevoked(),
    toRawArgs: log => ({
      trustorIdHash: log.args.trustorIdHash as string,
      trusteeIdHash: log.args.trusteeIdHash as string,
      revokedBy: log.args.revokedBy as string,
    }),
    decode: log => decodeTrusteeRevokedEventLog(log as RawTrusteeRevokedEventLog),
    reconcile: reconcileTrusteeRevokedEvent,
  },
  TrusteeLevelUpdated: {
    getFilter: contract => contract.filters.TrusteeLevelUpdated(),
    toRawArgs: log => ({
      trustorIdHash: log.args.trustorIdHash as string,
      trusteeIdHash: log.args.trusteeIdHash as string,
      oldLevel: log.args.oldLevel,
      newLevel: log.args.newLevel,
    }),
    decode: log => decodeTrusteeLevelUpdatedEventLog(log as RawTrusteeLevelUpdatedEventLog),
    reconcile: reconcileTrusteeLevelUpdatedEvent,
  },
};
