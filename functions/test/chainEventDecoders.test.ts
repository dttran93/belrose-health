// functions/test/chainEventDecoders.test.ts
//
// Pure unit tests for the event decoders — no Firestore/emulator/network involved. Feeds
// fabricated raw-log fixtures (matching the minimal duck-typed shape decodeMemberRoleManagerLog
// expects, not a full ethers EventLog) and asserts the decoded shape.

import { describe, it, expect } from 'vitest';
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
  type RawMemberRoleManagerLog,
  type RawRoleEventLog,
  type RawRoleChangedEventLog,
  type RawMemberStatusChangedEventLog,
  type RawOwnershipVoluntarilyLeftEventLog,
  type RawTrusteeProposedAcceptedEventLog,
  type RawTrusteeDeclinedEventLog,
  type RawTrusteeRevokedEventLog,
  type RawTrusteeLevelUpdatedEventLog,
} from '../src/chainIndexer/eventDecoders';

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

function fakeRoleLog(overrides: Partial<RawRoleEventLog> = {}): RawRoleEventLog {
  return {
    eventName: 'RoleGranted',
    transactionHash: '0xrole123',
    blockNumber: 200,
    index: 1,
    contractAddress: '0xMemberRoleManagerProxy',
    chainId: 84532,
    args: {
      recordIdHash: '0xRecordIdHash',
      targetIdHash: '0xTargetIdHash',
      role: 'administrator',
      userIdHash: '0xCallerIdHash',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeRoleEventLog', () => {
  it('decodes a RoleGranted log', () => {
    const decoded = decodeRoleEventLog(fakeRoleLog());

    expect(decoded).toEqual({
      eventName: 'RoleGranted',
      txHash: '0xrole123',
      blockNumber: 200,
      logIndex: 1,
      contractAddress: '0xMemberRoleManagerProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        recordIdHash: '0xRecordIdHash',
        targetIdHash: '0xTargetIdHash',
        role: 'administrator',
        userIdHash: '0xCallerIdHash',
      },
    });
  });

  it('decodes a RoleRevoked log identically shaped, just a different eventName', () => {
    const decoded = decodeRoleEventLog(fakeRoleLog({ eventName: 'RoleRevoked', transactionHash: '0xrevoke1' }));
    expect(decoded.eventName).toBe('RoleRevoked');
    expect(decoded.txHash).toBe('0xrevoke1');
  });

  it('passes the non-indexed `role` string through unchanged — no hash/topic decoding involved', () => {
    const decoded = decodeRoleEventLog(fakeRoleLog({ args: { ...fakeRoleLog().args, role: 'viewer' } }));
    expect(decoded.args.role).toBe('viewer');
  });

  it('decodes the bytes32(0) userIdHash case (initializeRecordRole) as an ordinary hex string, no special-casing', () => {
    const zeroHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
    const decoded = decodeRoleEventLog(fakeRoleLog({ args: { ...fakeRoleLog().args, userIdHash: zeroHash } }));
    expect(decoded.args.userIdHash).toBe(zeroHash);
  });
});

function fakeRoleChangedLog(overrides: Partial<RawRoleChangedEventLog> = {}): RawRoleChangedEventLog {
  return {
    eventName: 'RoleChanged',
    transactionHash: '0xchange123',
    blockNumber: 300,
    index: 2,
    contractAddress: '0xMemberRoleManagerProxy',
    chainId: 84532,
    args: {
      recordIdHash: '0xRecordIdHash',
      targetIdHash: '0xTargetIdHash',
      oldRole: 'viewer',
      newRole: 'sharer',
      userIdHash: '0xCallerIdHash',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeRoleChangedEventLog', () => {
  it('decodes a RoleChanged log, including both oldRole and newRole', () => {
    const decoded = decodeRoleChangedEventLog(fakeRoleChangedLog());

    expect(decoded).toEqual({
      eventName: 'RoleChanged',
      txHash: '0xchange123',
      blockNumber: 300,
      logIndex: 2,
      contractAddress: '0xMemberRoleManagerProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        recordIdHash: '0xRecordIdHash',
        targetIdHash: '0xTargetIdHash',
        oldRole: 'viewer',
        newRole: 'sharer',
        userIdHash: '0xCallerIdHash',
      },
    });
  });

  it('passes both non-indexed role strings through unchanged', () => {
    const decoded = decodeRoleChangedEventLog(
      fakeRoleChangedLog({ args: { ...fakeRoleChangedLog().args, oldRole: 'administrator', newRole: 'owner' } })
    );
    expect(decoded.args.oldRole).toBe('administrator');
    expect(decoded.args.newRole).toBe('owner');
  });
});

function fakeStatusChangedLog(
  overrides: Partial<RawMemberStatusChangedEventLog> = {}
): RawMemberStatusChangedEventLog {
  return {
    eventName: 'MemberStatusChanged',
    transactionHash: '0xstatus123',
    blockNumber: 400,
    index: 0,
    contractAddress: '0xMemberRoleManagerProxy',
    chainId: 84532,
    args: {
      userIdHash: '0xUserIdHash',
      oldStatus: 2n,
      newStatus: 1n,
      changedBy: '0xAdminAddress',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeMemberStatusChangedEventLog', () => {
  it('decodes a MemberStatusChanged log, converting the bigint status enum values to numbers', () => {
    const decoded = decodeMemberStatusChangedEventLog(fakeStatusChangedLog());

    expect(decoded).toEqual({
      eventName: 'MemberStatusChanged',
      txHash: '0xstatus123',
      blockNumber: 400,
      logIndex: 0,
      contractAddress: '0xMemberRoleManagerProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        userIdHash: '0xUserIdHash',
        oldStatus: 2,
        newStatus: 1,
        changedBy: '0xAdminAddress',
      },
    });
  });

  it('accepts plain numbers as well as bigints for the status fields', () => {
    const decoded = decodeMemberStatusChangedEventLog(
      fakeStatusChangedLog({ args: { ...fakeStatusChangedLog().args, oldStatus: 3, newStatus: 4 } })
    );
    expect(decoded.args.oldStatus).toBe(3);
    expect(decoded.args.newStatus).toBe(4);
  });
});

function fakeOwnershipLeftLog(
  overrides: Partial<RawOwnershipVoluntarilyLeftEventLog> = {}
): RawOwnershipVoluntarilyLeftEventLog {
  return {
    eventName: 'OwnershipVoluntarilyLeft',
    transactionHash: '0xleft123',
    blockNumber: 500,
    index: 1,
    contractAddress: '0xMemberRoleManagerProxy',
    chainId: 84532,
    args: {
      recordIdHash: '0xRecordIdHash',
      userIdHash: '0xUserIdHash',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeOwnershipVoluntarilyLeftEventLog', () => {
  it('decodes an OwnershipVoluntarilyLeft log', () => {
    const decoded = decodeOwnershipVoluntarilyLeftEventLog(fakeOwnershipLeftLog());

    expect(decoded).toEqual({
      eventName: 'OwnershipVoluntarilyLeft',
      txHash: '0xleft123',
      blockNumber: 500,
      logIndex: 1,
      contractAddress: '0xMemberRoleManagerProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        recordIdHash: '0xRecordIdHash',
        userIdHash: '0xUserIdHash',
      },
    });
  });
});

function fakeTrusteeProposedAcceptedLog(
  overrides: Partial<RawTrusteeProposedAcceptedEventLog> = {}
): RawTrusteeProposedAcceptedEventLog {
  return {
    eventName: 'TrusteeProposed',
    transactionHash: '0xtrustee123',
    blockNumber: 600,
    index: 0,
    contractAddress: '0xMemberRoleManagerProxy',
    chainId: 84532,
    args: {
      trustorIdHash: '0xTrustorIdHash',
      trusteeIdHash: '0xTrusteeIdHash',
      level: 1n, // Custodian
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeTrusteeProposedAcceptedEventLog', () => {
  it('decodes a TrusteeProposed log, converting the bigint level to a number', () => {
    const decoded = decodeTrusteeProposedAcceptedEventLog(fakeTrusteeProposedAcceptedLog());

    expect(decoded).toEqual({
      eventName: 'TrusteeProposed',
      txHash: '0xtrustee123',
      blockNumber: 600,
      logIndex: 0,
      contractAddress: '0xMemberRoleManagerProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        trustorIdHash: '0xTrustorIdHash',
        trusteeIdHash: '0xTrusteeIdHash',
        level: 1,
      },
    });
  });

  it('decodes a TrusteeAccepted log identically shaped, just a different eventName', () => {
    const decoded = decodeTrusteeProposedAcceptedEventLog(
      fakeTrusteeProposedAcceptedLog({ eventName: 'TrusteeAccepted', transactionHash: '0xaccept1' })
    );
    expect(decoded.eventName).toBe('TrusteeAccepted');
    expect(decoded.txHash).toBe('0xaccept1');
  });
});

function fakeTrusteeDeclinedLog(overrides: Partial<RawTrusteeDeclinedEventLog> = {}): RawTrusteeDeclinedEventLog {
  return {
    eventName: 'TrusteeDeclined',
    transactionHash: '0xdecline1',
    blockNumber: 700,
    index: 0,
    contractAddress: '0xMemberRoleManagerProxy',
    chainId: 84532,
    args: {
      trustorIdHash: '0xTrustorIdHash',
      trusteeIdHash: '0xTrusteeIdHash',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeTrusteeDeclinedEventLog', () => {
  it('decodes a TrusteeDeclined log', () => {
    const decoded = decodeTrusteeDeclinedEventLog(fakeTrusteeDeclinedLog());

    expect(decoded).toEqual({
      eventName: 'TrusteeDeclined',
      txHash: '0xdecline1',
      blockNumber: 700,
      logIndex: 0,
      contractAddress: '0xMemberRoleManagerProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        trustorIdHash: '0xTrustorIdHash',
        trusteeIdHash: '0xTrusteeIdHash',
      },
    });
  });
});

function fakeTrusteeRevokedLog(overrides: Partial<RawTrusteeRevokedEventLog> = {}): RawTrusteeRevokedEventLog {
  return {
    eventName: 'TrusteeRevoked',
    transactionHash: '0xrevoke1',
    blockNumber: 800,
    index: 0,
    contractAddress: '0xMemberRoleManagerProxy',
    chainId: 84532,
    args: {
      trustorIdHash: '0xTrustorIdHash',
      trusteeIdHash: '0xTrusteeIdHash',
      revokedBy: '0xRevokerIdHash',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeTrusteeRevokedEventLog', () => {
  it('decodes a TrusteeRevoked log, including revokedBy', () => {
    const decoded = decodeTrusteeRevokedEventLog(fakeTrusteeRevokedLog());

    expect(decoded).toEqual({
      eventName: 'TrusteeRevoked',
      txHash: '0xrevoke1',
      blockNumber: 800,
      logIndex: 0,
      contractAddress: '0xMemberRoleManagerProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        trustorIdHash: '0xTrustorIdHash',
        trusteeIdHash: '0xTrusteeIdHash',
        revokedBy: '0xRevokerIdHash',
      },
    });
  });
});

function fakeTrusteeLevelUpdatedLog(
  overrides: Partial<RawTrusteeLevelUpdatedEventLog> = {}
): RawTrusteeLevelUpdatedEventLog {
  return {
    eventName: 'TrusteeLevelUpdated',
    transactionHash: '0xlevel1',
    blockNumber: 900,
    index: 0,
    contractAddress: '0xMemberRoleManagerProxy',
    chainId: 84532,
    args: {
      trustorIdHash: '0xTrustorIdHash',
      trusteeIdHash: '0xTrusteeIdHash',
      oldLevel: 0n, // Observer
      newLevel: 2n, // Controller
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeTrusteeLevelUpdatedEventLog', () => {
  it('decodes a TrusteeLevelUpdated log, converting both bigint levels to numbers', () => {
    const decoded = decodeTrusteeLevelUpdatedEventLog(fakeTrusteeLevelUpdatedLog());

    expect(decoded).toEqual({
      eventName: 'TrusteeLevelUpdated',
      txHash: '0xlevel1',
      blockNumber: 900,
      logIndex: 0,
      contractAddress: '0xMemberRoleManagerProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        trustorIdHash: '0xTrustorIdHash',
        trusteeIdHash: '0xTrusteeIdHash',
        oldLevel: 0,
        newLevel: 2,
      },
    });
  });
});
