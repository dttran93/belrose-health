// functions/test/healthRecordCoreEventDecoders.test.ts
//
// Pure unit tests for HealthRecordCore's event decoders — mirrors
// memberRoleManagerEventDecoders.test.ts's exact shape. No Firestore/emulator/network involved.

import { describe, it, expect } from 'vitest';
import {
  decodeHealthRecordCoreAdminTransferredEventLog,
  type RawHealthRecordCoreAdminTransferredEventLog,
} from '../src/chainIndexer/healthRecordCoreEventDecoders';

function fakeAdminTransferredLog(
  overrides: Partial<RawHealthRecordCoreAdminTransferredEventLog> = {}
): RawHealthRecordCoreAdminTransferredEventLog {
  return {
    eventName: 'AdminTransferred',
    transactionHash: '0xhrcadmintx1',
    blockNumber: 2000,
    index: 0,
    contractAddress: '0xHealthRecordCoreProxy',
    chainId: 84532,
    args: {
      oldAdmin: '0xOldAdminAddress',
      newAdmin: '0xNewAdminAddress',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeHealthRecordCoreAdminTransferredEventLog', () => {
  it('decodes an AdminTransferred log, keeping oldAdmin and newAdmin distinct', () => {
    const decoded = decodeHealthRecordCoreAdminTransferredEventLog(fakeAdminTransferredLog());

    expect(decoded).toEqual({
      eventName: 'AdminTransferred',
      txHash: '0xhrcadmintx1',
      blockNumber: 2000,
      logIndex: 0,
      contractAddress: '0xHealthRecordCoreProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        oldAdmin: '0xOldAdminAddress',
        newAdmin: '0xNewAdminAddress',
      },
    });
  });
});
