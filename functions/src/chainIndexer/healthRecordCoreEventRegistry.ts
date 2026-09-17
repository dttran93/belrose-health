// functions/src/chainIndexer/healthRecordCoreEventRegistry.ts
//
// Per-event-type dispatch table for HealthRecordCore.sol — mirrors
// memberRoleManagerEventRegistry.ts's exact shape/conventions for the second contract this
// indexer covers. See that file's own header for the general registry pattern.
//
// HRC Slice 1 covers AdminTransferred only. HRC Slice 2 adds the subject-anchoring family
// (RecordAnchored/RecordUnanchored — RecordReanchored was removed in #816; reanchorRecord now
// emits RecordAnchored instead). HRC Slice 3 adds the hash-versioning family
// (RecordHashAdded/RecordHashRetracted). HRC Slice 4 adds the verification family
// (RecordVerified/VerificationRetracted/VerificationLevelModified). HRC Slice 5 adds the dispute
// family (RecordDisputed/DisputeRetracted/DisputeModification). HRC Slice 6 adds the unaccepted
// flags family (UnacceptedUpdateFlagged/UnacceptedUpdateFlagRevoked). HRC Slice 7 (final slice —
// every event on HealthRecordCore.sol is now covered) adds MemberRoleManagerUpdated. See
// healthRecordCoreEventDecoders.ts's header for what's still deliberately out of scope (UUPS's
// inherited Upgraded event isn't a custom declared event).

import type { HealthRecordCore } from '../_shared/typechain';
import { HealthRecordCore__factory } from '../_shared/typechain';
import { HEALTH_RECORD_CORE } from '../_shared';
import type { ChainEventRegistryEntry, ChainIndexerContractConfig } from './chainIndexerContractConfig';
import {
  decodeHealthRecordCoreAdminTransferredEventLog,
  decodeRecordAnchoredEventLog,
  decodeRecordUnanchoredEventLog,
  decodeRecordHashAddedEventLog,
  decodeRecordHashRetractedEventLog,
  decodeRecordVerifiedEventLog,
  decodeVerificationRetractedEventLog,
  decodeVerificationLevelModifiedEventLog,
  decodeRecordDisputedEventLog,
  decodeDisputeRetractedEventLog,
  decodeDisputeModificationEventLog,
  decodeUnacceptedUpdateFlaggedEventLog,
  decodeUnacceptedUpdateFlagRevokedEventLog,
  decodeMemberRoleManagerUpdatedEventLog,
  type HealthRecordCoreEventName,
  type RawHealthRecordCoreAdminTransferredEventLog,
  type RawRecordAnchoredEventLog,
  type RawRecordUnanchoredEventLog,
  type RawRecordHashAddedEventLog,
  type RawRecordHashRetractedEventLog,
  type RawRecordVerifiedEventLog,
  type RawVerificationRetractedEventLog,
  type RawVerificationLevelModifiedEventLog,
  type RawRecordDisputedEventLog,
  type RawDisputeRetractedEventLog,
  type RawDisputeModificationEventLog,
  type RawUnacceptedUpdateFlaggedEventLog,
  type RawUnacceptedUpdateFlagRevokedEventLog,
  type RawMemberRoleManagerUpdatedEventLog,
} from './healthRecordCoreEventDecoders';
import {
  reconcileHealthRecordCoreAdminTransferredEvent,
  reconcileRecordAnchoredEvent,
  reconcileRecordUnanchoredEvent,
  reconcileRecordHashAddedEvent,
  reconcileRecordHashRetractedEvent,
  reconcileRecordVerifiedEvent,
  reconcileVerificationRetractedEvent,
  reconcileVerificationLevelModifiedEvent,
  reconcileRecordDisputedEvent,
  reconcileDisputeRetractedEvent,
  reconcileDisputeModificationEvent,
  reconcileUnacceptedUpdateFlaggedEvent,
  reconcileUnacceptedUpdateFlagRevokedEvent,
  reconcileMemberRoleManagerUpdatedEvent,
} from './healthRecordCoreReconciliationService';

export const HEALTH_RECORD_CORE_EVENT_REGISTRY: Record<
  HealthRecordCoreEventName,
  ChainEventRegistryEntry<HealthRecordCore>
> = {
  AdminTransferred: {
    getFilter: contract => contract.filters.AdminTransferred(),
    toRawArgs: log => ({
      oldAdmin: log.args.oldAdmin as string,
      newAdmin: log.args.newAdmin as string,
    }),
    decode: log => decodeHealthRecordCoreAdminTransferredEventLog(log as RawHealthRecordCoreAdminTransferredEventLog),
    reconcile: reconcileHealthRecordCoreAdminTransferredEvent,
  },
  RecordAnchored: {
    getFilter: contract => contract.filters.RecordAnchored(),
    toRawArgs: log => ({
      recordIdHash: log.args.recordIdHash as string,
      recordHash: log.args.recordHash as string,
      subjectIdHash: log.args.subjectIdHash as string,
    }),
    decode: log => decodeRecordAnchoredEventLog(log as RawRecordAnchoredEventLog),
    reconcile: reconcileRecordAnchoredEvent,
  },
  RecordUnanchored: {
    getFilter: contract => contract.filters.RecordUnanchored(),
    toRawArgs: log => ({
      recordIdHash: log.args.recordIdHash as string,
      subjectIdHash: log.args.subjectIdHash as string,
    }),
    decode: log => decodeRecordUnanchoredEventLog(log as RawRecordUnanchoredEventLog),
    reconcile: reconcileRecordUnanchoredEvent,
  },
  RecordHashAdded: {
    getFilter: contract => contract.filters.RecordHashAdded(),
    toRawArgs: log => ({
      recordIdHash: log.args.recordIdHash as string,
      newHash: log.args.newHash as string,
      addedBy: log.args.addedBy as string,
    }),
    decode: log => decodeRecordHashAddedEventLog(log as RawRecordHashAddedEventLog),
    reconcile: reconcileRecordHashAddedEvent,
  },
  RecordHashRetracted: {
    getFilter: contract => contract.filters.RecordHashRetracted(),
    toRawArgs: log => ({
      recordIdHash: log.args.recordIdHash as string,
      recordHash: log.args.recordHash as string,
    }),
    decode: log => decodeRecordHashRetractedEventLog(log as RawRecordHashRetractedEventLog),
    reconcile: reconcileRecordHashRetractedEvent,
  },
  RecordVerified: {
    getFilter: contract => contract.filters.RecordVerified(),
    toRawArgs: log => ({
      recordHash: log.args.recordHash as string,
      recordIdHash: log.args.recordIdHash as string,
      verifierIdHash: log.args.verifierIdHash as string,
      level: log.args.level,
    }),
    decode: log => decodeRecordVerifiedEventLog(log as RawRecordVerifiedEventLog),
    reconcile: reconcileRecordVerifiedEvent,
  },
  VerificationRetracted: {
    getFilter: contract => contract.filters.VerificationRetracted(),
    toRawArgs: log => ({
      recordHash: log.args.recordHash as string,
      verifierIdHash: log.args.verifierIdHash as string,
    }),
    decode: log => decodeVerificationRetractedEventLog(log as RawVerificationRetractedEventLog),
    reconcile: reconcileVerificationRetractedEvent,
  },
  VerificationLevelModified: {
    getFilter: contract => contract.filters.VerificationLevelModified(),
    toRawArgs: log => ({
      recordHash: log.args.recordHash as string,
      verifierIdHash: log.args.verifierIdHash as string,
      oldLevel: log.args.oldLevel,
      newLevel: log.args.newLevel,
    }),
    decode: log => decodeVerificationLevelModifiedEventLog(log as RawVerificationLevelModifiedEventLog),
    reconcile: reconcileVerificationLevelModifiedEvent,
  },
  RecordDisputed: {
    getFilter: contract => contract.filters.RecordDisputed(),
    toRawArgs: log => ({
      recordHash: log.args.recordHash as string,
      recordIdHash: log.args.recordIdHash as string,
      disputerIdHash: log.args.disputerIdHash as string,
      severity: log.args.severity,
      culpability: log.args.culpability,
    }),
    decode: log => decodeRecordDisputedEventLog(log as RawRecordDisputedEventLog),
    reconcile: reconcileRecordDisputedEvent,
  },
  DisputeRetracted: {
    getFilter: contract => contract.filters.DisputeRetracted(),
    toRawArgs: log => ({
      recordHash: log.args.recordHash as string,
      disputerIdHash: log.args.disputerIdHash as string,
    }),
    decode: log => decodeDisputeRetractedEventLog(log as RawDisputeRetractedEventLog),
    reconcile: reconcileDisputeRetractedEvent,
  },
  DisputeModification: {
    getFilter: contract => contract.filters.DisputeModification(),
    toRawArgs: log => ({
      recordHash: log.args.recordHash as string,
      disputerIdHash: log.args.disputerIdHash as string,
      oldSeverity: log.args.oldSeverity,
      newSeverity: log.args.newSeverity,
      oldCulpability: log.args.oldCulpability,
      newCulpability: log.args.newCulpability,
    }),
    decode: log => decodeDisputeModificationEventLog(log as RawDisputeModificationEventLog),
    reconcile: reconcileDisputeModificationEvent,
  },
  UnacceptedUpdateFlagged: {
    getFilter: contract => contract.filters.UnacceptedUpdateFlagged(),
    toRawArgs: log => ({
      subjectIdHash: log.args.subjectIdHash as string,
      recordIdHash: log.args.recordIdHash as string,
      reporterIdHash: log.args.reporterIdHash as string,
      recordHash: log.args.recordHash as string,
    }),
    decode: log => decodeUnacceptedUpdateFlaggedEventLog(log as RawUnacceptedUpdateFlaggedEventLog),
    reconcile: reconcileUnacceptedUpdateFlaggedEvent,
  },
  UnacceptedUpdateFlagRevoked: {
    getFilter: contract => contract.filters.UnacceptedUpdateFlagRevoked(),
    toRawArgs: log => ({
      subjectIdHash: log.args.subjectIdHash as string,
      recordIdHash: log.args.recordIdHash as string,
      reporterIdHash: log.args.reporterIdHash as string,
    }),
    decode: log => decodeUnacceptedUpdateFlagRevokedEventLog(log as RawUnacceptedUpdateFlagRevokedEventLog),
    reconcile: reconcileUnacceptedUpdateFlagRevokedEvent,
  },
  MemberRoleManagerUpdated: {
    getFilter: contract => contract.filters.MemberRoleManagerUpdated(),
    toRawArgs: log => ({ newAddress: log.args.newAddress as string }),
    decode: log => decodeMemberRoleManagerUpdatedEventLog(log as RawMemberRoleManagerUpdatedEventLog),
    reconcile: reconcileMemberRoleManagerUpdatedEvent,
  },
};

/** Everything chainEventIndexerService.ts's generic loop needs to run a full cycle against
 *  HealthRecordCore — see chainIndexerContractConfig.ts's own doc comment for why this shape
 *  exists (multi-contract support). */
export const HEALTH_RECORD_CORE_INDEXER_CONFIG: ChainIndexerContractConfig<
  HealthRecordCore,
  HealthRecordCoreEventName
> = {
  contract: 'HealthRecordCore',
  connect: HealthRecordCore__factory.connect,
  proxyAddress: HEALTH_RECORD_CORE.proxy,
  deploymentBlock: HEALTH_RECORD_CORE.deploymentBlock,
  registry: HEALTH_RECORD_CORE_EVENT_REGISTRY,
};
