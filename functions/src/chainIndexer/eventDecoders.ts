// functions/src/chainIndexer/eventDecoders.ts
//
// Pure, no-I/O decoding: a raw on-chain log → the args shape chainEventIndexerService caches.
// Deliberately duck-typed against a minimal log shape (not ethers' full EventLog type) so these
// are trivial to unit-test with fabricated fixtures — see functions/test/chainEventDecoders.test.ts.
//
// Slice 1 covers MemberRoleManager's MemberRegistered/WalletLinked — both admin-only-triggered
// (addMember/addMemberBatch), both carrying the identical (wallet, userIdHash, timestamp) shape.
// Slice 2 adds RoleGranted/RoleRevoked — a genuinely different (recordIdHash, targetIdHash, role,
// userIdHash, timestamp) shape, so they get their own Raw*/Decoded* types and decode function
// below rather than overloading the Member* ones. Slice 3 adds RoleChanged — same call-site
// family as Slice 2 (changeRole, voluntarilyLeaveOwnership demotions, trustee level sync), but a
// genuinely different match shape again (oldRole/newRole against a role CHANGE, not a grant/
// revoke) — see reconciliationRules.ts's findMatchingPermissionHistoryForRoleChangedEvent. Slice 4
// adds MemberStatusChanged (admin-only, setUserStatus — same call-site shape as Slice 1) and
// OwnershipVoluntarilyLeft (user-callable, the "leave with no replacement role" case of
// voluntarilyLeaveOwnership — a narrow variant of Slice 3's shape). Slice 5 adds the 5 Trustee
// events (Proposed/Accepted/Declined/Revoked/LevelUpdated) — matched against
// trusteeRelationships/{id}/trusteeHistory, a subcollection parallel to permissionHistory that
// (unlike permissionHistory) already stores trustorIdHash/trusteeIdHash directly on each event,
// so no in-memory hash recomputation is needed at match time — see reconciliationRules.ts.
// Slice 6 adds VouchGiven/VouchRetracted — both onlyActiveMember (giveVouch/retractVouch), same
// (voucherIdHash, voucheeIdHash, timestamp) shape as each other, matched against the flat
// top-level `vouches` collection (vouchService.ts), which — like trusteeHistory — already stores
// both hashes directly on the doc, so this is a plain two-field equality query, not even a
// collectionGroup scan.

export type MemberRoleManagerEventName =
  | 'MemberRegistered'
  | 'WalletLinked'
  | 'RoleGranted'
  | 'RoleRevoked'
  | 'RoleChanged'
  | 'MemberStatusChanged'
  | 'OwnershipVoluntarilyLeft'
  | 'TrusteeProposed'
  | 'TrusteeAccepted'
  | 'TrusteeDeclined'
  | 'TrusteeRevoked'
  | 'TrusteeLevelUpdated'
  | 'VouchGiven'
  | 'VouchRetracted';

// Minimal shape of what ethers' queryFilter returns for these two events — just enough to
// decode, not the full EventLog surface.
export interface RawMemberRoleManagerLog {
  eventName: MemberRoleManagerEventName;
  transactionHash: string;
  blockNumber: number;
  index: number; // log index within the block
  // The address/chainId actually used to query this log this cycle (contract.target and the
  // provider's own resolved network) — threaded straight through rather than re-derived later
  // from global config (MEMBER_ROLE_MANAGER.proxy / NETWORK_CORE.chainId) at cache-write time.
  // Keeps a cached doc's blockchainRef a true record of what was actually queried, immune to
  // whatever those constants happen to say by the time the doc is written. See
  // chainEventIndexerService.ts's checkpoint comment for the other half of this concern
  // (multi-network/proxy-migration safety) that this alone doesn't solve.
  contractAddress: string;
  chainId: number;
  args: {
    wallet: string;
    userIdHash: string;
    timestamp: bigint | number;
  };
}

export interface DecodedMemberRoleManagerEvent {
  eventName: MemberRoleManagerEventName;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  // Seconds since epoch, straight from the event's own `timestamp` arg (the contract emits
  // block.timestamp) — no extra provider.getBlock() round trip needed.
  blockTimestampSeconds: number;
  args: {
    wallet: string;
    userIdHash: string;
  };
}

export function decodeMemberRoleManagerLog(
  log: RawMemberRoleManagerLog
): DecodedMemberRoleManagerEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      wallet: log.args.wallet,
      userIdHash: log.args.userIdHash,
    },
  };
}

// ============================================================================
// RoleGranted / RoleRevoked (Slice 2)
// ============================================================================

export type RoleEventName = 'RoleGranted' | 'RoleRevoked';

export interface RawRoleEventLog {
  eventName: RoleEventName;
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    recordIdHash: string;
    targetIdHash: string;
    // `role` is a non-indexed `string` in the Solidity event, so ethers decodes it straight to a
    // plain JS string (e.g. "administrator") — not a hash, no topic/ABI decoding needed here.
    // Byte-for-byte identical to Firestore's RecordRole values (packages/shared/src/
    // permissions.ts), so no translation layer is needed in the match rule either.
    role: string;
    // Hardcoded to bytes32(0) on-chain for the one admin-only emission site
    // (initializeRecordRole — MemberRoleManager.sol:579), NOT derived from the real caller. Never
    // treat this as a reliable "who did this" signal for that case — see
    // reconciliationRules.ts's findMatchingPermissionHistoryForRoleEvent for why the match rule
    // deliberately never requires this to equal Firestore's changedByIdHash.
    userIdHash: string;
    timestamp: bigint | number;
  };
}

export interface DecodedRoleEvent {
  eventName: RoleEventName;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    recordIdHash: string;
    targetIdHash: string;
    role: string;
    userIdHash: string;
  };
}

export function decodeRoleEventLog(log: RawRoleEventLog): DecodedRoleEvent {
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
      targetIdHash: log.args.targetIdHash,
      role: log.args.role,
      userIdHash: log.args.userIdHash,
    },
  };
}

// ============================================================================
// RoleChanged (Slice 3)
// ============================================================================

export interface RawRoleChangedEventLog {
  eventName: 'RoleChanged';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    recordIdHash: string;
    targetIdHash: string;
    // Both non-indexed strings, decoded by ethers straight to plain JS strings — same as
    // RoleGranted/RoleRevoked's `role` arg, no hash/topic decoding involved.
    oldRole: string;
    newRole: string;
    userIdHash: string;
    timestamp: bigint | number;
  };
}

export interface DecodedRoleChangedEvent {
  eventName: 'RoleChanged';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    recordIdHash: string;
    targetIdHash: string;
    oldRole: string;
    newRole: string;
    userIdHash: string;
  };
}

export function decodeRoleChangedEventLog(log: RawRoleChangedEventLog): DecodedRoleChangedEvent {
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
      targetIdHash: log.args.targetIdHash,
      oldRole: log.args.oldRole,
      newRole: log.args.newRole,
      userIdHash: log.args.userIdHash,
    },
  };
}

// ============================================================================
// MemberStatusChanged (Slice 4)
// ============================================================================

export interface RawMemberStatusChangedEventLog {
  eventName: 'MemberStatusChanged';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    userIdHash: string;
    // MemberStatus enum (uint8 under the hood) — ethers v6 decodes every Solidity integer width
    // uniformly as bigint, same as `timestamp`, regardless that this one only ever takes values
    // 0-4. Converted to `number` in the decoded shape below.
    oldStatus: bigint | number;
    newStatus: bigint | number;
    // setUserStatus is onlyAdmin, so this is always msg.sender = the admin wallet's own address —
    // a real address, not a hash, unlike RoleGranted/RoleChanged's userIdHash arg.
    changedBy: string;
    timestamp: bigint | number;
  };
}

export interface DecodedMemberStatusChangedEvent {
  eventName: 'MemberStatusChanged';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    userIdHash: string;
    oldStatus: number;
    newStatus: number;
    changedBy: string;
  };
}

export function decodeMemberStatusChangedEventLog(
  log: RawMemberStatusChangedEventLog
): DecodedMemberStatusChangedEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      userIdHash: log.args.userIdHash,
      oldStatus: Number(log.args.oldStatus),
      newStatus: Number(log.args.newStatus),
      changedBy: log.args.changedBy,
    },
  };
}

// ============================================================================
// OwnershipVoluntarilyLeft (Slice 4)
// ============================================================================

export interface RawOwnershipVoluntarilyLeftEventLog {
  eventName: 'OwnershipVoluntarilyLeft';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    recordIdHash: string;
    // The caller's own identity — voluntarilyLeaveOwnership is exclusively self-service (the
    // contract has no path for one owner to remove another; see
    // reconciliationRules.ts's findMatchingPermissionHistoryForOwnershipLeftEvent), so this is
    // always the leaving owner's own hash, never someone else's.
    userIdHash: string;
    timestamp: bigint | number;
  };
}

export interface DecodedOwnershipVoluntarilyLeftEvent {
  eventName: 'OwnershipVoluntarilyLeft';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    recordIdHash: string;
    userIdHash: string;
  };
}

export function decodeOwnershipVoluntarilyLeftEventLog(
  log: RawOwnershipVoluntarilyLeftEventLog
): DecodedOwnershipVoluntarilyLeftEvent {
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
      userIdHash: log.args.userIdHash,
    },
  };
}

// ============================================================================
// TrusteeProposed / TrusteeAccepted (Slice 5)
// ============================================================================

export type TrusteeProposedAcceptedEventName = 'TrusteeProposed' | 'TrusteeAccepted';

export interface RawTrusteeProposedAcceptedEventLog {
  eventName: TrusteeProposedAcceptedEventName;
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    trustorIdHash: string;
    trusteeIdHash: string;
    // TrusteeLevel enum (Observer=0, Custodian=1, Controller=2) — same bigint-decoding note as
    // MemberStatusChanged's oldStatus/newStatus.
    level: bigint | number;
    timestamp: bigint | number;
  };
}

export interface DecodedTrusteeProposedAcceptedEvent {
  eventName: TrusteeProposedAcceptedEventName;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    trustorIdHash: string;
    trusteeIdHash: string;
    level: number;
  };
}

export function decodeTrusteeProposedAcceptedEventLog(
  log: RawTrusteeProposedAcceptedEventLog
): DecodedTrusteeProposedAcceptedEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      trustorIdHash: log.args.trustorIdHash,
      trusteeIdHash: log.args.trusteeIdHash,
      level: Number(log.args.level),
    },
  };
}

// ============================================================================
// TrusteeDeclined (Slice 5)
// ============================================================================

export interface RawTrusteeDeclinedEventLog {
  eventName: 'TrusteeDeclined';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    trustorIdHash: string;
    trusteeIdHash: string;
    timestamp: bigint | number;
  };
}

export interface DecodedTrusteeDeclinedEvent {
  eventName: 'TrusteeDeclined';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    trustorIdHash: string;
    trusteeIdHash: string;
  };
}

export function decodeTrusteeDeclinedEventLog(
  log: RawTrusteeDeclinedEventLog
): DecodedTrusteeDeclinedEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      trustorIdHash: log.args.trustorIdHash,
      trusteeIdHash: log.args.trusteeIdHash,
    },
  };
}

// ============================================================================
// TrusteeRevoked (Slice 5)
// ============================================================================

export interface RawTrusteeRevokedEventLog {
  eventName: 'TrusteeRevoked';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    trustorIdHash: string;
    trusteeIdHash: string;
    // Whichever party (trustor or trustee) actually called revokeTrustee — onlyActiveMember, so
    // always a genuine caller hash, never a bytes32(0) admin stand-in.
    revokedBy: string;
    timestamp: bigint | number;
  };
}

export interface DecodedTrusteeRevokedEvent {
  eventName: 'TrusteeRevoked';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    trustorIdHash: string;
    trusteeIdHash: string;
    revokedBy: string;
  };
}

export function decodeTrusteeRevokedEventLog(
  log: RawTrusteeRevokedEventLog
): DecodedTrusteeRevokedEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      trustorIdHash: log.args.trustorIdHash,
      trusteeIdHash: log.args.trusteeIdHash,
      revokedBy: log.args.revokedBy,
    },
  };
}

// ============================================================================
// TrusteeLevelUpdated (Slice 5)
// ============================================================================

export interface RawTrusteeLevelUpdatedEventLog {
  eventName: 'TrusteeLevelUpdated';
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    trustorIdHash: string;
    trusteeIdHash: string;
    oldLevel: bigint | number;
    newLevel: bigint | number;
    timestamp: bigint | number;
  };
}

export interface DecodedTrusteeLevelUpdatedEvent {
  eventName: 'TrusteeLevelUpdated';
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    trustorIdHash: string;
    trusteeIdHash: string;
    oldLevel: number;
    newLevel: number;
  };
}

export function decodeTrusteeLevelUpdatedEventLog(
  log: RawTrusteeLevelUpdatedEventLog
): DecodedTrusteeLevelUpdatedEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      trustorIdHash: log.args.trustorIdHash,
      trusteeIdHash: log.args.trusteeIdHash,
      oldLevel: Number(log.args.oldLevel),
      newLevel: Number(log.args.newLevel),
    },
  };
}

// ============================================================================
// VouchGiven / VouchRetracted (Slice 6)
// ============================================================================

export type VouchEventName = 'VouchGiven' | 'VouchRetracted';

export interface RawVouchEventLog {
  eventName: VouchEventName;
  transactionHash: string;
  blockNumber: number;
  index: number;
  contractAddress: string;
  chainId: number;
  args: {
    voucherIdHash: string;
    voucheeIdHash: string;
    timestamp: bigint | number;
  };
}

export interface DecodedVouchEvent {
  eventName: VouchEventName;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  contractAddress: string;
  chainId: number;
  blockTimestampSeconds: number;
  args: {
    voucherIdHash: string;
    voucheeIdHash: string;
  };
}

export function decodeVouchEventLog(log: RawVouchEventLog): DecodedVouchEvent {
  return {
    eventName: log.eventName,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    contractAddress: log.contractAddress,
    chainId: log.chainId,
    blockTimestampSeconds: Number(log.args.timestamp),
    args: {
      voucherIdHash: log.args.voucherIdHash,
      voucheeIdHash: log.args.voucheeIdHash,
    },
  };
}
