// functions/src/chainIndexer/healthRecordCoreEventDecoders.ts
//
// Pure, no-I/O decoding for HealthRecordCore.sol's events — mirrors
// memberRoleManagerEventDecoders.ts's exact shape/conventions, just for the second contract this
// indexer covers. See that file's own header for the general decoding conventions (duck-typed
// minimal log shape, bigint-to-number normalization for enum args, etc.).
//
// HRC Slice 1 covers AdminTransferred only — HealthRecordCore's own onlyAdmin admin-key-rotation
// event, structurally identical in shape and purpose to MemberRoleManager's own AdminTransferred.
// Ships first as the canary validating the indexer's multi-contract plumbing end-to-end on the
// lowest-risk possible event, before the 13 remaining domain events (subject anchoring, hash
// versioning, verification, dispute, unaccepted flags) are added in later slices. HRC Slice 2
// originally added the subject-anchoring family as three events (RecordAnchored/RecordUnanchored/
// RecordReanchored) — RecordReanchored was later removed from the contract entirely (#816):
// reanchorRecord now emits RecordAnchored instead, since a reanchor is indistinguishable from an
// anchor once you're only looking at end state. RecordAnchored/RecordUnanchored are the two
// domain events that remain from that slice. HRC Slice 3 adds the hash-versioning family
// (RecordHashAdded/RecordHashRetracted) — RecordHashRetracted has a
// similar known gap (see healthRecordCoreReconciliationRules.ts). HRC Slice 4 adds the
// verification family (RecordVerified/VerificationRetracted/VerificationLevelModified), matched
// against the flat top-level `verifications` collection — recordIdHash is decoded here for
// completeness but deliberately excluded from the match key (see
// healthRecordCoreReconciliationRules.ts's findMatchingVerification for why). HRC Slice 5 adds the
// dispute family (RecordDisputed/DisputeRetracted/DisputeModification) — structurally identical to
// the verification family (same recordIdHash-excluded-from-match-key situation, confirmed in
// disputeService.ts), matched against the flat top-level `disputes` collection instead. HRC
// Slice 6 (final slice — every event on HealthRecordCore.sol is now covered) adds the unaccepted
// flags family (UnacceptedUpdateFlagged/UnacceptedUpdateFlagRevoked) — the cleanest match case on
// the whole contract: functions/src/handlers/unacceptedFlags.ts writes subjectIdHash/recordIdHash/
// reporterIdHash all as real hashes directly, zero recomputation and zero exclusions needed.
//
// HRC Slice 7 adds MemberRoleManagerUpdated — setMemberRoleManager(address) (onlyAdmin) previously
// updated its cross-contract pointer with no event at all, a contract-level blind spot; the
// contract was fixed to emit this event, mirroring MemberRoleManager.sol's own
// HealthRecordCoreUpdated exactly. This closes out every event now declared on
// HealthRecordCore.sol.
//
// Still not in scope for this indexer: UUPS's inherited `Upgraded` proxy event isn't a custom
// `event` declared in HealthRecordCore.sol — same out-of-scope status as MemberRoleManager's own
// proxy machinery.

export type HealthRecordCoreEventName =
  | 'AdminTransferred'
  | 'RecordAnchored'
  | 'RecordUnanchored'
  | 'RecordHashAdded'
  | 'RecordHashRetracted'
  | 'RecordVerified'
  | 'VerificationRetracted'
  | 'VerificationLevelModified'
  | 'RecordDisputed'
  | 'DisputeRetracted'
  | 'DisputeModification'
  | 'UnacceptedUpdateFlagged'
  | 'UnacceptedUpdateFlagRevoked'
  | 'MemberRoleManagerUpdated';

// ============================================================================
// AdminTransferred (HRC Slice 1)
// ============================================================================

export interface RawHealthRecordCoreAdminTransferredEventLog {
  eventName: 'AdminTransferred';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    oldAdmin: string;
    newAdmin: string;
    timestamp: bigint | number;
  };
}

export interface DecodedHealthRecordCoreAdminTransferredEvent {
  eventName: 'AdminTransferred';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    oldAdmin: string;
    newAdmin: string;
  };
}

export function decodeHealthRecordCoreAdminTransferredEventLog(
  log: RawHealthRecordCoreAdminTransferredEventLog
): DecodedHealthRecordCoreAdminTransferredEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      oldAdmin: log.args.oldAdmin,
      newAdmin: log.args.newAdmin,
    },
  };
}

// ============================================================================
// RecordAnchored (HRC Slice 2)
// ============================================================================

export interface RawRecordAnchoredEventLog {
  eventName: 'RecordAnchored';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    recordIdHash: string;
    recordHash: string;
    subjectIdHash: string;
    timestamp: bigint | number;
  };
}

export interface DecodedRecordAnchoredEvent {
  eventName: 'RecordAnchored';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    recordIdHash: string;
    recordHash: string;
    subjectIdHash: string;
  };
}

export function decodeRecordAnchoredEventLog(log: RawRecordAnchoredEventLog): DecodedRecordAnchoredEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      recordIdHash: log.args.recordIdHash,
      recordHash: log.args.recordHash,
      subjectIdHash: log.args.subjectIdHash,
    },
  };
}

// ============================================================================
// RecordUnanchored (HRC Slice 2)
// ============================================================================

export interface RawRecordUnanchoredEventLog {
  eventName: 'RecordUnanchored';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    recordIdHash: string;
    subjectIdHash: string;
    timestamp: bigint | number;
  };
}

export interface DecodedRecordUnanchoredEvent {
  eventName: 'RecordUnanchored';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    recordIdHash: string;
    subjectIdHash: string;
  };
}

export function decodeRecordUnanchoredEventLog(
  log: RawRecordUnanchoredEventLog
): DecodedRecordUnanchoredEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      recordIdHash: log.args.recordIdHash,
      subjectIdHash: log.args.subjectIdHash,
    },
  };
}

// ============================================================================
// RecordHashAdded (HRC Slice 3)
// ============================================================================

export interface RawRecordHashAddedEventLog {
  eventName: 'RecordHashAdded';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    recordIdHash: string;
    newHash: string;
    // Not indexed in the Solidity event, but always the real caller's own hash — addRecordHash
    // has no admin/bytes32(0) stand-in path the way initializeRecordRole does for RoleGranted. See
    // healthRecordCoreReconciliationRules.ts's findMatchingRecordHashHistoryForAddedEvent for why
    // it's therefore safe to include in the match key.
    addedBy: string;
    timestamp: bigint | number;
  };
}

export interface DecodedRecordHashAddedEvent {
  eventName: 'RecordHashAdded';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    recordIdHash: string;
    newHash: string;
    addedBy: string;
  };
}

export function decodeRecordHashAddedEventLog(log: RawRecordHashAddedEventLog): DecodedRecordHashAddedEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      recordIdHash: log.args.recordIdHash,
      newHash: log.args.newHash,
      addedBy: log.args.addedBy,
    },
  };
}

// ============================================================================
// RecordHashRetracted (HRC Slice 3)
// ============================================================================

export interface RawRecordHashRetractedEventLog {
  eventName: 'RecordHashRetracted';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    recordIdHash: string;
    recordHash: string;
    timestamp: bigint | number;
  };
}

export interface DecodedRecordHashRetractedEvent {
  eventName: 'RecordHashRetracted';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    recordIdHash: string;
    recordHash: string;
  };
}

export function decodeRecordHashRetractedEventLog(
  log: RawRecordHashRetractedEventLog
): DecodedRecordHashRetractedEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      recordIdHash: log.args.recordIdHash,
      recordHash: log.args.recordHash,
    },
  };
}

// ============================================================================
// RecordVerified (HRC Slice 4)
// ============================================================================

export interface RawRecordVerifiedEventLog {
  eventName: 'RecordVerified';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    recordHash: string;
    // Decoded for completeness, deliberately excluded from the match key — see
    // healthRecordCoreReconciliationRules.ts's findMatchingVerification.
    recordIdHash: string;
    verifierIdHash: string;
    // VerificationLevel enum (uint8 under the hood) — same bigint-decoding note as
    // MemberStatusChanged's oldStatus/newStatus.
    level: bigint | number;
    timestamp: bigint | number;
  };
}

export interface DecodedRecordVerifiedEvent {
  eventName: 'RecordVerified';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    recordHash: string;
    recordIdHash: string;
    verifierIdHash: string;
    level: number;
  };
}

export function decodeRecordVerifiedEventLog(log: RawRecordVerifiedEventLog): DecodedRecordVerifiedEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      recordHash: log.args.recordHash,
      recordIdHash: log.args.recordIdHash,
      verifierIdHash: log.args.verifierIdHash,
      level: Number(log.args.level),
    },
  };
}

// ============================================================================
// VerificationRetracted (HRC Slice 4)
// ============================================================================

export interface RawVerificationRetractedEventLog {
  eventName: 'VerificationRetracted';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    recordHash: string;
    verifierIdHash: string;
    timestamp: bigint | number;
  };
}

export interface DecodedVerificationRetractedEvent {
  eventName: 'VerificationRetracted';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    recordHash: string;
    verifierIdHash: string;
  };
}

export function decodeVerificationRetractedEventLog(
  log: RawVerificationRetractedEventLog
): DecodedVerificationRetractedEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      recordHash: log.args.recordHash,
      verifierIdHash: log.args.verifierIdHash,
    },
  };
}

// ============================================================================
// VerificationLevelModified (HRC Slice 4)
// ============================================================================

export interface RawVerificationLevelModifiedEventLog {
  eventName: 'VerificationLevelModified';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    recordHash: string;
    verifierIdHash: string;
    oldLevel: bigint | number;
    newLevel: bigint | number;
    timestamp: bigint | number;
  };
}

export interface DecodedVerificationLevelModifiedEvent {
  eventName: 'VerificationLevelModified';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    recordHash: string;
    verifierIdHash: string;
    oldLevel: number;
    newLevel: number;
  };
}

export function decodeVerificationLevelModifiedEventLog(
  log: RawVerificationLevelModifiedEventLog
): DecodedVerificationLevelModifiedEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      recordHash: log.args.recordHash,
      verifierIdHash: log.args.verifierIdHash,
      oldLevel: Number(log.args.oldLevel),
      newLevel: Number(log.args.newLevel),
    },
  };
}

// ============================================================================
// RecordDisputed (HRC Slice 5)
// ============================================================================

export interface RawRecordDisputedEventLog {
  eventName: 'RecordDisputed';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    recordHash: string;
    // Decoded for completeness, deliberately excluded from the match key — same situation as
    // RecordVerified's recordIdHash, confirmed in disputeService.ts. See
    // healthRecordCoreReconciliationRules.ts's findMatchingDispute.
    recordIdHash: string;
    disputerIdHash: string;
    // DisputeSeverity/DisputeCulpability enums (uint8 under the hood) — same bigint-decoding note
    // as RecordVerified's level.
    severity: bigint | number;
    culpability: bigint | number;
    timestamp: bigint | number;
  };
}

export interface DecodedRecordDisputedEvent {
  eventName: 'RecordDisputed';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    recordHash: string;
    recordIdHash: string;
    disputerIdHash: string;
    severity: number;
    culpability: number;
  };
}

export function decodeRecordDisputedEventLog(log: RawRecordDisputedEventLog): DecodedRecordDisputedEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      recordHash: log.args.recordHash,
      recordIdHash: log.args.recordIdHash,
      disputerIdHash: log.args.disputerIdHash,
      severity: Number(log.args.severity),
      culpability: Number(log.args.culpability),
    },
  };
}

// ============================================================================
// DisputeRetracted (HRC Slice 5)
// ============================================================================

export interface RawDisputeRetractedEventLog {
  eventName: 'DisputeRetracted';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    recordHash: string;
    disputerIdHash: string;
    timestamp: bigint | number;
  };
}

export interface DecodedDisputeRetractedEvent {
  eventName: 'DisputeRetracted';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    recordHash: string;
    disputerIdHash: string;
  };
}

export function decodeDisputeRetractedEventLog(log: RawDisputeRetractedEventLog): DecodedDisputeRetractedEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      recordHash: log.args.recordHash,
      disputerIdHash: log.args.disputerIdHash,
    },
  };
}

// ============================================================================
// DisputeModification (HRC Slice 5)
// ============================================================================

export interface RawDisputeModificationEventLog {
  eventName: 'DisputeModification';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    recordHash: string;
    disputerIdHash: string;
    oldSeverity: bigint | number;
    newSeverity: bigint | number;
    oldCulpability: bigint | number;
    newCulpability: bigint | number;
    timestamp: bigint | number;
  };
}

export interface DecodedDisputeModificationEvent {
  eventName: 'DisputeModification';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    recordHash: string;
    disputerIdHash: string;
    oldSeverity: number;
    newSeverity: number;
    oldCulpability: number;
    newCulpability: number;
  };
}

export function decodeDisputeModificationEventLog(
  log: RawDisputeModificationEventLog
): DecodedDisputeModificationEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      recordHash: log.args.recordHash,
      disputerIdHash: log.args.disputerIdHash,
      oldSeverity: Number(log.args.oldSeverity),
      newSeverity: Number(log.args.newSeverity),
      oldCulpability: Number(log.args.oldCulpability),
      newCulpability: Number(log.args.newCulpability),
    },
  };
}

// ============================================================================
// UnacceptedUpdateFlagged (HRC Slice 6)
// ============================================================================

export interface RawUnacceptedUpdateFlaggedEventLog {
  eventName: 'UnacceptedUpdateFlagged';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    subjectIdHash: string;
    recordIdHash: string;
    reporterIdHash: string;
    recordHash: string;
    timestamp: bigint | number;
  };
}

export interface DecodedUnacceptedUpdateFlaggedEvent {
  eventName: 'UnacceptedUpdateFlagged';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    subjectIdHash: string;
    recordIdHash: string;
    reporterIdHash: string;
    recordHash: string;
  };
}

export function decodeUnacceptedUpdateFlaggedEventLog(
  log: RawUnacceptedUpdateFlaggedEventLog
): DecodedUnacceptedUpdateFlaggedEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      subjectIdHash: log.args.subjectIdHash,
      recordIdHash: log.args.recordIdHash,
      reporterIdHash: log.args.reporterIdHash,
      recordHash: log.args.recordHash,
    },
  };
}

// ============================================================================
// UnacceptedUpdateFlagRevoked (HRC Slice 6)
// ============================================================================

export interface RawUnacceptedUpdateFlagRevokedEventLog {
  eventName: 'UnacceptedUpdateFlagRevoked';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    subjectIdHash: string;
    recordIdHash: string;
    reporterIdHash: string;
    timestamp: bigint | number;
  };
}

export interface DecodedUnacceptedUpdateFlagRevokedEvent {
  eventName: 'UnacceptedUpdateFlagRevoked';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    subjectIdHash: string;
    recordIdHash: string;
    reporterIdHash: string;
  };
}

export function decodeUnacceptedUpdateFlagRevokedEventLog(
  log: RawUnacceptedUpdateFlagRevokedEventLog
): DecodedUnacceptedUpdateFlagRevokedEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      subjectIdHash: log.args.subjectIdHash,
      recordIdHash: log.args.recordIdHash,
      reporterIdHash: log.args.reporterIdHash,
    },
  };
}

// ============================================================================
// MemberRoleManagerUpdated (HRC Slice 7)
// ============================================================================

export interface RawMemberRoleManagerUpdatedEventLog {
  eventName: 'MemberRoleManagerUpdated';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    newAddress: string;
    timestamp: bigint | number;
  };
}

export interface DecodedMemberRoleManagerUpdatedEvent {
  eventName: 'MemberRoleManagerUpdated';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    newAddress: string;
  };
}

export function decodeMemberRoleManagerUpdatedEventLog(
  log: RawMemberRoleManagerUpdatedEventLog
): DecodedMemberRoleManagerUpdatedEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      newAddress: log.args.newAddress,
    },
  };
}
