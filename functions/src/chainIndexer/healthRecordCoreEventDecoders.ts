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
// versioning, verification, dispute, unaccepted flags) are added in later slices.
//
// Not in scope for this indexer at all: setMemberRoleManager(address) (onlyAdmin) updates a
// cross-contract pointer but emits no event whatsoever — a contract-level blind spot this indexer
// cannot detect or work around. UUPS's inherited `Upgraded` proxy event also isn't a custom
// `event` declared in HealthRecordCore.sol — same out-of-scope status as MemberRoleManager's own
// proxy machinery.

export type HealthRecordCoreEventName = 'AdminTransferred';

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
