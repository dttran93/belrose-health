// functions/test/chainEventDecoders.test.ts
//
// Pure unit tests for the event decoders — no Firestore/emulator/network involved. Feeds
// fabricated raw-log fixtures (matching the minimal duck-typed shape decodeMemberRoleManagerLog
// expects, not a full ethers EventLog) and asserts the decoded shape.

import { describe, it, expect } from 'vitest';
import { decodeMemberRoleManagerLog, type RawMemberRoleManagerLog } from '../src/chainIndexer/eventDecoders';

function fakeLog(overrides: Partial<RawMemberRoleManagerLog> = {}): RawMemberRoleManagerLog {
  return {
    eventName: 'MemberRegistered',
    transactionHash: '0xabc123',
    blockNumber: 100,
    index: 2,
    contractAddress: '0xMemberRoleManagerProxy',
    chainId: 84532,
    args: {
      wallet: '0xWalletAddress',
      userIdHash: '0xUserIdHash',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeMemberRoleManagerLog', () => {
  it('decodes a MemberRegistered log', () => {
    const decoded = decodeMemberRoleManagerLog(fakeLog());

    expect(decoded).toEqual({
      eventName: 'MemberRegistered',
      txHash: '0xabc123',
      blockNumber: 100,
      logIndex: 2,
      contractAddress: '0xMemberRoleManagerProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: { wallet: '0xWalletAddress', userIdHash: '0xUserIdHash' },
    });
  });

  it('decodes a WalletLinked log identically shaped, just a different eventName', () => {
    const decoded = decodeMemberRoleManagerLog(
      fakeLog({ eventName: 'WalletLinked', transactionHash: '0xdef456', index: 0 })
    );

    expect(decoded.eventName).toBe('WalletLinked');
    expect(decoded.txHash).toBe('0xdef456');
    expect(decoded.logIndex).toBe(0);
  });

  it('accepts a plain number timestamp as well as a bigint', () => {
    const decoded = decodeMemberRoleManagerLog(fakeLog({ args: { wallet: '0xW', userIdHash: '0xU', timestamp: 42 } }));
    expect(decoded.blockTimestampSeconds).toBe(42);
  });

  it('does not mutate or leak the raw timestamp field into the decoded args', () => {
    const decoded = decodeMemberRoleManagerLog(fakeLog());
    expect(decoded.args).not.toHaveProperty('timestamp');
  });
});
