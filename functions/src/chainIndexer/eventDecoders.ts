// functions/src/chainIndexer/eventDecoders.ts
//
// Pure, no-I/O decoding: a raw on-chain log → the args shape chainEventIndexerService caches.
// Deliberately duck-typed against a minimal log shape (not ethers' full EventLog type) so these
// are trivial to unit-test with fabricated fixtures — see functions/test/chainEventDecoders.test.ts.
//
// Slice 1 covers MemberRoleManager's MemberRegistered/WalletLinked only — both admin-only-
// triggered (addMember/addMemberBatch), both carrying the identical
// (wallet, userIdHash, timestamp) shape. Later slices (RoleGranted/RoleRevoked, etc.) get their
// own decoder here, keyed by eventName, following the same pattern.

export type MemberRoleManagerEventName = 'MemberRegistered' | 'WalletLinked';

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
