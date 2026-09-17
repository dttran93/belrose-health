// functions/test/healthRecordCoreEventDecoders.test.ts
//
// Pure unit tests for HealthRecordCore's event decoders — mirrors
// memberRoleManagerEventDecoders.test.ts's exact shape. No Firestore/emulator/network involved.

import { describe, it, expect } from 'vitest';
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
  type RawHealthRecordCoreAdminTransferredEventLog,
  type RawRecordAnchoredEventLog,
  type RawRecordUnanchoredEventLog,
  type RawRecordHashAddedEventLog,
  type RawRecordHashRetractedEventLog,
  type RawRecordVerifiedEventLog,
  type RawVerificationRetractedEventLog,
  type RawRecordDisputedEventLog,
  type RawDisputeRetractedEventLog,
  type RawDisputeModificationEventLog,
  type RawVerificationLevelModifiedEventLog,
  type RawUnacceptedUpdateFlaggedEventLog,
  type RawUnacceptedUpdateFlagRevokedEventLog,
  type RawMemberRoleManagerUpdatedEventLog,
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

function fakeRecordAnchoredLog(overrides: Partial<RawRecordAnchoredEventLog> = {}): RawRecordAnchoredEventLog {
  return {
    eventName: 'RecordAnchored',
    transactionHash: '0xanchortx1',
    blockNumber: 3000,
    index: 0,
    contractAddress: '0xHealthRecordCoreProxy',
    chainId: 84532,
    args: {
      recordIdHash: '0xRecordIdHash1',
      recordHash: '0xRecordHash1',
      subjectIdHash: '0xSubjectIdHash1',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeRecordAnchoredEventLog', () => {
  it('decodes a RecordAnchored log, including recordHash', () => {
    const decoded = decodeRecordAnchoredEventLog(fakeRecordAnchoredLog());

    expect(decoded).toEqual({
      eventName: 'RecordAnchored',
      txHash: '0xanchortx1',
      blockNumber: 3000,
      logIndex: 0,
      contractAddress: '0xHealthRecordCoreProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        recordIdHash: '0xRecordIdHash1',
        recordHash: '0xRecordHash1',
        subjectIdHash: '0xSubjectIdHash1',
      },
    });
  });
});

function fakeRecordUnanchoredLog(
  overrides: Partial<RawRecordUnanchoredEventLog> = {}
): RawRecordUnanchoredEventLog {
  return {
    eventName: 'RecordUnanchored',
    transactionHash: '0xunanchortx1',
    blockNumber: 3100,
    index: 0,
    contractAddress: '0xHealthRecordCoreProxy',
    chainId: 84532,
    args: {
      recordIdHash: '0xRecordIdHash1',
      subjectIdHash: '0xSubjectIdHash1',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeRecordUnanchoredEventLog', () => {
  it('decodes a RecordUnanchored log', () => {
    const decoded = decodeRecordUnanchoredEventLog(fakeRecordUnanchoredLog());

    expect(decoded).toEqual({
      eventName: 'RecordUnanchored',
      txHash: '0xunanchortx1',
      blockNumber: 3100,
      logIndex: 0,
      contractAddress: '0xHealthRecordCoreProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        recordIdHash: '0xRecordIdHash1',
        subjectIdHash: '0xSubjectIdHash1',
      },
    });
  });
});

function fakeRecordHashAddedLog(overrides: Partial<RawRecordHashAddedEventLog> = {}): RawRecordHashAddedEventLog {
  return {
    eventName: 'RecordHashAdded',
    transactionHash: '0xhashaddedtx1',
    blockNumber: 3200,
    index: 0,
    contractAddress: '0xHealthRecordCoreProxy',
    chainId: 84532,
    args: {
      recordIdHash: '0xRecordIdHash1',
      newHash: '0xNewHash1',
      addedBy: '0xAddedByHash1',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeRecordHashAddedEventLog', () => {
  it('decodes a RecordHashAdded log, including addedBy', () => {
    const decoded = decodeRecordHashAddedEventLog(fakeRecordHashAddedLog());

    expect(decoded).toEqual({
      eventName: 'RecordHashAdded',
      txHash: '0xhashaddedtx1',
      blockNumber: 3200,
      logIndex: 0,
      contractAddress: '0xHealthRecordCoreProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        recordIdHash: '0xRecordIdHash1',
        newHash: '0xNewHash1',
        addedBy: '0xAddedByHash1',
      },
    });
  });
});

function fakeRecordHashRetractedLog(
  overrides: Partial<RawRecordHashRetractedEventLog> = {}
): RawRecordHashRetractedEventLog {
  return {
    eventName: 'RecordHashRetracted',
    transactionHash: '0xhashretractedtx1',
    blockNumber: 3300,
    index: 0,
    contractAddress: '0xHealthRecordCoreProxy',
    chainId: 84532,
    args: {
      recordIdHash: '0xRecordIdHash1',
      recordHash: '0xRecordHash1',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeRecordHashRetractedEventLog', () => {
  it('decodes a RecordHashRetracted log', () => {
    const decoded = decodeRecordHashRetractedEventLog(fakeRecordHashRetractedLog());

    expect(decoded).toEqual({
      eventName: 'RecordHashRetracted',
      txHash: '0xhashretractedtx1',
      blockNumber: 3300,
      logIndex: 0,
      contractAddress: '0xHealthRecordCoreProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        recordIdHash: '0xRecordIdHash1',
        recordHash: '0xRecordHash1',
      },
    });
  });
});

function fakeRecordVerifiedLog(overrides: Partial<RawRecordVerifiedEventLog> = {}): RawRecordVerifiedEventLog {
  return {
    eventName: 'RecordVerified',
    transactionHash: '0xverifiedtx1',
    blockNumber: 3400,
    index: 0,
    contractAddress: '0xHealthRecordCoreProxy',
    chainId: 84532,
    args: {
      recordHash: '0xRecordHash1',
      recordIdHash: '0xRecordIdHash1',
      verifierIdHash: '0xVerifierIdHash1',
      level: 1n, // arbitrary VerificationLevel
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeRecordVerifiedEventLog', () => {
  it('decodes a RecordVerified log, converting level to a number and keeping recordIdHash for completeness', () => {
    const decoded = decodeRecordVerifiedEventLog(fakeRecordVerifiedLog());

    expect(decoded).toEqual({
      eventName: 'RecordVerified',
      txHash: '0xverifiedtx1',
      blockNumber: 3400,
      logIndex: 0,
      contractAddress: '0xHealthRecordCoreProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        recordHash: '0xRecordHash1',
        recordIdHash: '0xRecordIdHash1',
        verifierIdHash: '0xVerifierIdHash1',
        level: 1,
      },
    });
  });
});

function fakeVerificationRetractedLog(
  overrides: Partial<RawVerificationRetractedEventLog> = {}
): RawVerificationRetractedEventLog {
  return {
    eventName: 'VerificationRetracted',
    transactionHash: '0xverifretracttx1',
    blockNumber: 3500,
    index: 0,
    contractAddress: '0xHealthRecordCoreProxy',
    chainId: 84532,
    args: {
      recordHash: '0xRecordHash1',
      verifierIdHash: '0xVerifierIdHash1',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeVerificationRetractedEventLog', () => {
  it('decodes a VerificationRetracted log', () => {
    const decoded = decodeVerificationRetractedEventLog(fakeVerificationRetractedLog());

    expect(decoded).toEqual({
      eventName: 'VerificationRetracted',
      txHash: '0xverifretracttx1',
      blockNumber: 3500,
      logIndex: 0,
      contractAddress: '0xHealthRecordCoreProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        recordHash: '0xRecordHash1',
        verifierIdHash: '0xVerifierIdHash1',
      },
    });
  });
});

function fakeVerificationLevelModifiedLog(
  overrides: Partial<RawVerificationLevelModifiedEventLog> = {}
): RawVerificationLevelModifiedEventLog {
  return {
    eventName: 'VerificationLevelModified',
    transactionHash: '0xverifmodtx1',
    blockNumber: 3600,
    index: 0,
    contractAddress: '0xHealthRecordCoreProxy',
    chainId: 84532,
    args: {
      recordHash: '0xRecordHash1',
      verifierIdHash: '0xVerifierIdHash1',
      oldLevel: 0n,
      newLevel: 2n,
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeVerificationLevelModifiedEventLog', () => {
  it('decodes a VerificationLevelModified log, converting both bigint levels to numbers', () => {
    const decoded = decodeVerificationLevelModifiedEventLog(fakeVerificationLevelModifiedLog());

    expect(decoded).toEqual({
      eventName: 'VerificationLevelModified',
      txHash: '0xverifmodtx1',
      blockNumber: 3600,
      logIndex: 0,
      contractAddress: '0xHealthRecordCoreProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        recordHash: '0xRecordHash1',
        verifierIdHash: '0xVerifierIdHash1',
        oldLevel: 0,
        newLevel: 2,
      },
    });
  });
});

function fakeRecordDisputedLog(overrides: Partial<RawRecordDisputedEventLog> = {}): RawRecordDisputedEventLog {
  return {
    eventName: 'RecordDisputed',
    transactionHash: '0xdisputedtx1',
    blockNumber: 3700,
    index: 0,
    contractAddress: '0xHealthRecordCoreProxy',
    chainId: 84532,
    args: {
      recordHash: '0xRecordHash1',
      recordIdHash: '0xRecordIdHash1',
      disputerIdHash: '0xDisputerIdHash1',
      severity: 1n,
      culpability: 2n,
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeRecordDisputedEventLog', () => {
  it('decodes a RecordDisputed log, converting severity/culpability to numbers and keeping recordIdHash for completeness', () => {
    const decoded = decodeRecordDisputedEventLog(fakeRecordDisputedLog());

    expect(decoded).toEqual({
      eventName: 'RecordDisputed',
      txHash: '0xdisputedtx1',
      blockNumber: 3700,
      logIndex: 0,
      contractAddress: '0xHealthRecordCoreProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        recordHash: '0xRecordHash1',
        recordIdHash: '0xRecordIdHash1',
        disputerIdHash: '0xDisputerIdHash1',
        severity: 1,
        culpability: 2,
      },
    });
  });
});

function fakeDisputeRetractedLog(overrides: Partial<RawDisputeRetractedEventLog> = {}): RawDisputeRetractedEventLog {
  return {
    eventName: 'DisputeRetracted',
    transactionHash: '0xdisputeretracttx1',
    blockNumber: 3800,
    index: 0,
    contractAddress: '0xHealthRecordCoreProxy',
    chainId: 84532,
    args: {
      recordHash: '0xRecordHash1',
      disputerIdHash: '0xDisputerIdHash1',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeDisputeRetractedEventLog', () => {
  it('decodes a DisputeRetracted log', () => {
    const decoded = decodeDisputeRetractedEventLog(fakeDisputeRetractedLog());

    expect(decoded).toEqual({
      eventName: 'DisputeRetracted',
      txHash: '0xdisputeretracttx1',
      blockNumber: 3800,
      logIndex: 0,
      contractAddress: '0xHealthRecordCoreProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        recordHash: '0xRecordHash1',
        disputerIdHash: '0xDisputerIdHash1',
      },
    });
  });
});

function fakeDisputeModificationLog(
  overrides: Partial<RawDisputeModificationEventLog> = {}
): RawDisputeModificationEventLog {
  return {
    eventName: 'DisputeModification',
    transactionHash: '0xdisputemodtx1',
    blockNumber: 3900,
    index: 0,
    contractAddress: '0xHealthRecordCoreProxy',
    chainId: 84532,
    args: {
      recordHash: '0xRecordHash1',
      disputerIdHash: '0xDisputerIdHash1',
      oldSeverity: 0n,
      newSeverity: 2n,
      oldCulpability: 1n,
      newCulpability: 0n,
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeDisputeModificationEventLog', () => {
  it('decodes a DisputeModification log, converting all four bigint severity/culpability values to numbers', () => {
    const decoded = decodeDisputeModificationEventLog(fakeDisputeModificationLog());

    expect(decoded).toEqual({
      eventName: 'DisputeModification',
      txHash: '0xdisputemodtx1',
      blockNumber: 3900,
      logIndex: 0,
      contractAddress: '0xHealthRecordCoreProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        recordHash: '0xRecordHash1',
        disputerIdHash: '0xDisputerIdHash1',
        oldSeverity: 0,
        newSeverity: 2,
        oldCulpability: 1,
        newCulpability: 0,
      },
    });
  });
});

function fakeUnacceptedUpdateFlaggedLog(
  overrides: Partial<RawUnacceptedUpdateFlaggedEventLog> = {}
): RawUnacceptedUpdateFlaggedEventLog {
  return {
    eventName: 'UnacceptedUpdateFlagged',
    transactionHash: '0xflaggedtx1',
    blockNumber: 4000,
    index: 0,
    contractAddress: '0xHealthRecordCoreProxy',
    chainId: 84532,
    args: {
      subjectIdHash: '0xSubjectIdHash1',
      recordIdHash: '0xRecordIdHash1',
      reporterIdHash: '0xReporterIdHash1',
      recordHash: '0xRecordHash1',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeUnacceptedUpdateFlaggedEventLog', () => {
  it('decodes an UnacceptedUpdateFlagged log', () => {
    const decoded = decodeUnacceptedUpdateFlaggedEventLog(fakeUnacceptedUpdateFlaggedLog());

    expect(decoded).toEqual({
      eventName: 'UnacceptedUpdateFlagged',
      txHash: '0xflaggedtx1',
      blockNumber: 4000,
      logIndex: 0,
      contractAddress: '0xHealthRecordCoreProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        subjectIdHash: '0xSubjectIdHash1',
        recordIdHash: '0xRecordIdHash1',
        reporterIdHash: '0xReporterIdHash1',
        recordHash: '0xRecordHash1',
      },
    });
  });
});

function fakeUnacceptedUpdateFlagRevokedLog(
  overrides: Partial<RawUnacceptedUpdateFlagRevokedEventLog> = {}
): RawUnacceptedUpdateFlagRevokedEventLog {
  return {
    eventName: 'UnacceptedUpdateFlagRevoked',
    transactionHash: '0xflagrevokedtx1',
    blockNumber: 4100,
    index: 0,
    contractAddress: '0xHealthRecordCoreProxy',
    chainId: 84532,
    args: {
      subjectIdHash: '0xSubjectIdHash1',
      recordIdHash: '0xRecordIdHash1',
      reporterIdHash: '0xReporterIdHash1',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeUnacceptedUpdateFlagRevokedEventLog', () => {
  it('decodes an UnacceptedUpdateFlagRevoked log', () => {
    const decoded = decodeUnacceptedUpdateFlagRevokedEventLog(fakeUnacceptedUpdateFlagRevokedLog());

    expect(decoded).toEqual({
      eventName: 'UnacceptedUpdateFlagRevoked',
      txHash: '0xflagrevokedtx1',
      blockNumber: 4100,
      logIndex: 0,
      contractAddress: '0xHealthRecordCoreProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        subjectIdHash: '0xSubjectIdHash1',
        recordIdHash: '0xRecordIdHash1',
        reporterIdHash: '0xReporterIdHash1',
      },
    });
  });
});

function fakeMemberRoleManagerUpdatedLog(
  overrides: Partial<RawMemberRoleManagerUpdatedEventLog> = {}
): RawMemberRoleManagerUpdatedEventLog {
  return {
    eventName: 'MemberRoleManagerUpdated',
    transactionHash: '0xmrmupdatedtx1',
    blockNumber: 4200,
    index: 0,
    contractAddress: '0xHealthRecordCoreProxy',
    chainId: 84532,
    args: {
      newAddress: '0xNewMemberRoleManagerAddress',
      timestamp: 1_700_000_000n,
    },
    ...overrides,
  };
}

describe('decodeMemberRoleManagerUpdatedEventLog', () => {
  it('decodes a MemberRoleManagerUpdated log', () => {
    const decoded = decodeMemberRoleManagerUpdatedEventLog(fakeMemberRoleManagerUpdatedLog());

    expect(decoded).toEqual({
      eventName: 'MemberRoleManagerUpdated',
      txHash: '0xmrmupdatedtx1',
      blockNumber: 4200,
      logIndex: 0,
      contractAddress: '0xHealthRecordCoreProxy',
      chainId: 84532,
      blockTimestampSeconds: 1_700_000_000,
      args: {
        newAddress: '0xNewMemberRoleManagerAddress',
      },
    });
  });
});
