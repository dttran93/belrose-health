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
// below rather than overloading the Member* ones. RoleChanged is deliberately NOT included yet
// (Slice 3 — see eventRegistry.ts's own comment): its match shape differs again (oldRole/newRole
// against a role CHANGE, not a grant/revoke), and it shares call sites with this slice's events
// closely enough to deserve its own focused review pass rather than being folded in here.

export type MemberRoleManagerEventName = 'MemberRegistered' | 'WalletLinked' | 'RoleGranted' | 'RoleRevoked';

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
