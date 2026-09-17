// functions/test/healthRecordCoreEventIndexer.test.ts
//
// Functions layer — the chain event indexer's core cycle, run against HealthRecordCore's own
// config. Mirrors memberRoleManagerEventIndexer.test.ts's exact mocking pattern:
// HealthRecordCore__factory is mocked (no real chain calls), Firestore is real (emulator, via
// test/setup.ts). Vitest mocks are file-scoped, so this coexists safely with
// memberRoleManagerEventIndexer.test.ts's own mock of the same '../src/_shared/typechain' module.
//
// HRC Slice 1 covers AdminTransferred only — see healthRecordCoreEventDecoders.ts's header for
// why it's the canary slice. HRC Slice 2 adds the subject-anchoring family
// (RecordAnchored/RecordUnanchored/RecordReanchored). HRC Slice 3 adds the hash-versioning family
// (RecordHashAdded/RecordHashRetracted). HRC Slice 4 adds the verification family
// (RecordVerified/VerificationRetracted/VerificationLevelModified). HRC Slice 5 adds the dispute
// family (RecordDisputed/DisputeRetracted/DisputeModification). HRC Slice 6 (final slice) adds the
// unaccepted flags family (UnacceptedUpdateFlagged/UnacceptedUpdateFlagRevoked).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { ethers } from 'ethers';
import { clearFirestore } from './helpers/testAdmin';

const { mockContract, connectMock } = vi.hoisted(() => {
  const mockContract = {
    target: '0xMockHealthRecordCoreProxy',
    filters: {
      AdminTransferred: vi.fn(() => 'AdminTransferred-filter'),
      RecordAnchored: vi.fn(() => 'RecordAnchored-filter'),
      RecordUnanchored: vi.fn(() => 'RecordUnanchored-filter'),
      RecordReanchored: vi.fn(() => 'RecordReanchored-filter'),
      RecordHashAdded: vi.fn(() => 'RecordHashAdded-filter'),
      RecordHashRetracted: vi.fn(() => 'RecordHashRetracted-filter'),
      RecordVerified: vi.fn(() => 'RecordVerified-filter'),
      VerificationRetracted: vi.fn(() => 'VerificationRetracted-filter'),
      VerificationLevelModified: vi.fn(() => 'VerificationLevelModified-filter'),
      RecordDisputed: vi.fn(() => 'RecordDisputed-filter'),
      DisputeRetracted: vi.fn(() => 'DisputeRetracted-filter'),
      DisputeModification: vi.fn(() => 'DisputeModification-filter'),
      UnacceptedUpdateFlagged: vi.fn(() => 'UnacceptedUpdateFlagged-filter'),
      UnacceptedUpdateFlagRevoked: vi.fn(() => 'UnacceptedUpdateFlagRevoked-filter'),
      MemberRoleManagerUpdated: vi.fn(() => 'MemberRoleManagerUpdated-filter'),
    },
    queryFilter: vi.fn(),
  };
  return { mockContract, connectMock: vi.fn(() => mockContract) };
});

// chainEventIndexerService.ts also transitively imports MemberRoleManager__factory (via
// memberRoleManagerEventRegistry.ts's MEMBER_ROLE_MANAGER_INDEXER_CONFIG, constructed at module
// load time) — stubbed out unused-but-present so that construction doesn't crash. This file only
// exercises HealthRecordCore.
vi.mock('../src/_shared/typechain', () => ({
  HealthRecordCore__factory: { connect: connectMock },
  MemberRoleManager__factory: { connect: vi.fn() },
}));

import { runChainEventIndexerCycle } from '../src/chainIndexer/chainEventIndexerService';
import { HEALTH_RECORD_CORE_INDEXER_CONFIG } from '../src/chainIndexer/healthRecordCoreEventRegistry';
import { buildChainIndexerCheckpointDocId } from '../src/_shared';

const CHECKPOINT_DOC_ID = buildChainIndexerCheckpointDocId(
  'HealthRecordCore',
  84532,
  '0xMockHealthRecordCoreProxy'
);

// Matches test/setup.ts's fake-but-valid ADMIN_WALLET_PRIVATE_KEY — computed once so
// admin-signed-tx tests can assert against the real derived address.
const ADMIN_ADDRESS = new ethers.Wallet('0x' + '11'.repeat(32)).address;

function fakeAdminTransferredEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  oldAdmin?: string;
  newAdmin?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      oldAdmin: overrides.oldAdmin ?? '0xOldAdminAddress',
      newAdmin: overrides.newAdmin ?? '0xNewAdminAddress',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeMemberRoleManagerUpdatedEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  newAddress?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      newAddress: overrides.newAddress ?? '0xNewMemberRoleManagerAddress',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeRecordAnchoredEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  recordIdHash?: string;
  recordHash?: string;
  subjectIdHash?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      recordIdHash: overrides.recordIdHash ?? '0xRecordIdHash1',
      recordHash: overrides.recordHash ?? '0xRecordHash1',
      subjectIdHash: overrides.subjectIdHash ?? '0xSubjectIdHash1',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

// Shared by RecordUnanchored/RecordReanchored — same {recordIdHash, subjectIdHash} shape.
function fakeRecordUnanchoredReanchoredEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  recordIdHash?: string;
  subjectIdHash?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      recordIdHash: overrides.recordIdHash ?? '0xRecordIdHash1',
      subjectIdHash: overrides.subjectIdHash ?? '0xSubjectIdHash1',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeRecordHashAddedEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  recordIdHash?: string;
  newHash?: string;
  addedBy?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      recordIdHash: overrides.recordIdHash ?? '0xRecordIdHash1',
      newHash: overrides.newHash ?? '0xNewHash1',
      addedBy: overrides.addedBy ?? '0xAddedByHash1',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeRecordHashRetractedEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  recordIdHash?: string;
  recordHash?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      recordIdHash: overrides.recordIdHash ?? '0xRecordIdHash1',
      recordHash: overrides.recordHash ?? '0xRecordHash1',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeRecordVerifiedEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  recordHash?: string;
  recordIdHash?: string;
  verifierIdHash?: string;
  level?: number;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      recordHash: overrides.recordHash ?? '0xRecordHash1',
      recordIdHash: overrides.recordIdHash ?? '0xRecordIdHash1',
      verifierIdHash: overrides.verifierIdHash ?? '0xVerifierIdHash1',
      level: overrides.level ?? 1,
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

// Shared by VerificationRetracted/VerificationLevelModified — same {recordHash, verifierIdHash}
// base shape (level fields only apply to VerificationLevelModified, added separately below).
function fakeVerificationRetractedEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  recordHash?: string;
  verifierIdHash?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      recordHash: overrides.recordHash ?? '0xRecordHash1',
      verifierIdHash: overrides.verifierIdHash ?? '0xVerifierIdHash1',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeVerificationLevelModifiedEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  recordHash?: string;
  verifierIdHash?: string;
  oldLevel?: number;
  newLevel?: number;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      recordHash: overrides.recordHash ?? '0xRecordHash1',
      verifierIdHash: overrides.verifierIdHash ?? '0xVerifierIdHash1',
      oldLevel: overrides.oldLevel ?? 0,
      newLevel: overrides.newLevel ?? 1,
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeRecordDisputedEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  recordHash?: string;
  recordIdHash?: string;
  disputerIdHash?: string;
  severity?: number;
  culpability?: number;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      recordHash: overrides.recordHash ?? '0xRecordHash1',
      recordIdHash: overrides.recordIdHash ?? '0xRecordIdHash1',
      disputerIdHash: overrides.disputerIdHash ?? '0xDisputerIdHash1',
      severity: overrides.severity ?? 1,
      culpability: overrides.culpability ?? 2,
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeDisputeRetractedEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  recordHash?: string;
  disputerIdHash?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      recordHash: overrides.recordHash ?? '0xRecordHash1',
      disputerIdHash: overrides.disputerIdHash ?? '0xDisputerIdHash1',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeDisputeModificationEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  recordHash?: string;
  disputerIdHash?: string;
  oldSeverity?: number;
  newSeverity?: number;
  oldCulpability?: number;
  newCulpability?: number;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      recordHash: overrides.recordHash ?? '0xRecordHash1',
      disputerIdHash: overrides.disputerIdHash ?? '0xDisputerIdHash1',
      oldSeverity: overrides.oldSeverity ?? 0,
      newSeverity: overrides.newSeverity ?? 1,
      oldCulpability: overrides.oldCulpability ?? 0,
      newCulpability: overrides.newCulpability ?? 1,
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeUnacceptedUpdateFlaggedEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  subjectIdHash?: string;
  recordIdHash?: string;
  reporterIdHash?: string;
  recordHash?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      subjectIdHash: overrides.subjectIdHash ?? '0xSubjectIdHash1',
      recordIdHash: overrides.recordIdHash ?? '0xRecordIdHash1',
      reporterIdHash: overrides.reporterIdHash ?? '0xReporterIdHash1',
      recordHash: overrides.recordHash ?? '0xRecordHash1',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeUnacceptedUpdateFlagRevokedEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  subjectIdHash?: string;
  recordIdHash?: string;
  reporterIdHash?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      subjectIdHash: overrides.subjectIdHash ?? '0xSubjectIdHash1',
      recordIdHash: overrides.recordIdHash ?? '0xRecordIdHash1',
      reporterIdHash: overrides.reporterIdHash ?? '0xReporterIdHash1',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function configureQueryFilter(handlers: {
  adminTransferred?: (from: number, to: number) => unknown[];
  recordAnchored?: (from: number, to: number) => unknown[];
  recordUnanchored?: (from: number, to: number) => unknown[];
  recordReanchored?: (from: number, to: number) => unknown[];
  recordHashAdded?: (from: number, to: number) => unknown[];
  recordHashRetracted?: (from: number, to: number) => unknown[];
  recordVerified?: (from: number, to: number) => unknown[];
  verificationRetracted?: (from: number, to: number) => unknown[];
  verificationLevelModified?: (from: number, to: number) => unknown[];
  recordDisputed?: (from: number, to: number) => unknown[];
  disputeRetracted?: (from: number, to: number) => unknown[];
  disputeModification?: (from: number, to: number) => unknown[];
  unacceptedUpdateFlagged?: (from: number, to: number) => unknown[];
  unacceptedUpdateFlagRevoked?: (from: number, to: number) => unknown[];
  memberRoleManagerUpdated?: (from: number, to: number) => unknown[];
}) {
  mockContract.queryFilter.mockImplementation(async (filter: unknown, from: number, to: number) => {
    switch (filter) {
      case 'AdminTransferred-filter':
        return (handlers.adminTransferred ?? (() => []))(from, to);
      case 'RecordAnchored-filter':
        return (handlers.recordAnchored ?? (() => []))(from, to);
      case 'RecordUnanchored-filter':
        return (handlers.recordUnanchored ?? (() => []))(from, to);
      case 'RecordReanchored-filter':
        return (handlers.recordReanchored ?? (() => []))(from, to);
      case 'RecordHashAdded-filter':
        return (handlers.recordHashAdded ?? (() => []))(from, to);
      case 'RecordHashRetracted-filter':
        return (handlers.recordHashRetracted ?? (() => []))(from, to);
      case 'RecordVerified-filter':
        return (handlers.recordVerified ?? (() => []))(from, to);
      case 'VerificationRetracted-filter':
        return (handlers.verificationRetracted ?? (() => []))(from, to);
      case 'VerificationLevelModified-filter':
        return (handlers.verificationLevelModified ?? (() => []))(from, to);
      case 'RecordDisputed-filter':
        return (handlers.recordDisputed ?? (() => []))(from, to);
      case 'DisputeRetracted-filter':
        return (handlers.disputeRetracted ?? (() => []))(from, to);
      case 'DisputeModification-filter':
        return (handlers.disputeModification ?? (() => []))(from, to);
      case 'UnacceptedUpdateFlagged-filter':
        return (handlers.unacceptedUpdateFlagged ?? (() => []))(from, to);
      case 'UnacceptedUpdateFlagRevoked-filter':
        return (handlers.unacceptedUpdateFlagRevoked ?? (() => []))(from, to);
      case 'MemberRoleManagerUpdated-filter':
        return (handlers.memberRoleManagerUpdated ?? (() => []))(from, to);
      default:
        throw new Error(`Unexpected filter in test: ${String(filter)}`);
    }
  });
}

function makeMockProvider(opts: { currentBlock: number; txFromByHash?: Record<string, string> }) {
  return {
    getBlockNumber: vi.fn(async () => opts.currentBlock),
    getNetwork: vi.fn(async () => ({ chainId: 84532n })),
    getTransaction: vi.fn(async (txHash: string) => {
      const from = opts.txFromByHash?.[txHash];
      return from ? { from } : null;
    }),
  } as unknown as ethers.JsonRpcProvider;
}

async function seedCheckpoint(lastScannedBlock: number) {
  await admin.firestore().collection('chainIndexerCheckpoints').doc(CHECKPOINT_DOC_ID).set({
    contract: 'HealthRecordCore',
    chainId: 84532,
    contractAddress: '0xMockHealthRecordCoreProxy',
    lastScannedBlock,
    lastRunAt: new Date(),
    lastRunStatus: 'ok',
  });
}

async function getCheckpointBlock(): Promise<number> {
  const snap = await admin.firestore().collection('chainIndexerCheckpoints').doc(CHECKPOINT_DOC_ID).get();
  return snap.data()!.lastScannedBlock;
}

async function getCachedEvent(txHash: string, logIndex: number) {
  const snap = await admin
    .firestore()
    .collection('chainEventCache')
    .doc(`${txHash}_${logIndex}`)
    .get();
  return snap.exists ? snap.data() : null;
}

beforeEach(async () => {
  await clearFirestore();
  vi.clearAllMocks();
  connectMock.mockReturnValue(mockContract);
});

describe('runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG) — basic scan + checkpoint', () => {
  it('caches a found event and advances the checkpoint to the scanned target block', async () => {
    await seedCheckpoint(1999); // startBlock = 2000
    configureQueryFilter({
      adminTransferred: () => [
        fakeAdminTransferredEventLog({ transactionHash: '0xhrctx1', blockNumber: 2005, index: 0, oldAdmin: ADMIN_ADDRESS }),
      ],
    });
    const provider = makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xhrctx1': ADMIN_ADDRESS } }); // targetBlock = 2010

    const result = await runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG, admin.firestore(), provider);

    expect(result).toMatchObject({ scannedFromBlock: 2000, scannedToBlock: 2010, eventsFound: 1, newlyCached: 1 });
    expect(await getCheckpointBlock()).toBe(2010);

    const cached = await getCachedEvent('0xhrctx1', 0);
    expect(cached).toMatchObject({
      contract: 'HealthRecordCore',
      eventName: 'AdminTransferred',
      logIndex: 0,
      args: { oldAdmin: ADMIN_ADDRESS, newAdmin: '0xNewAdminAddress' },
      reconciliationStatus: 'infrastructure',
    });
    expect(cached!.blockchainRef).toMatchObject({ txHash: '0xhrctx1', blockNumber: 2005 });
  });

  it('is a no-op when the checkpoint is already caught up to the confirmation buffer', async () => {
    await seedCheckpoint(2010);
    configureQueryFilter({ adminTransferred: () => [] });

    const result = await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2025 }) // target = 2005, already behind checkpoint
    );

    expect(result.eventsFound).toBe(0);
    expect(mockContract.queryFilter).not.toHaveBeenCalled();
    expect(await getCheckpointBlock()).toBe(2010); // untouched
  });
});

describe('runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG) — AdminTransferred reconciliation (HRC Slice 1)', () => {
  it('classifies as infrastructure when oldAdmin matches our configured admin wallet — no getTransaction call needed', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      adminTransferred: () => [
        fakeAdminTransferredEventLog({ transactionHash: '0xhrctx1', blockNumber: 2005, index: 0, oldAdmin: ADMIN_ADDRESS }),
      ],
    });

    // Deliberately no txFromByHash entry — the reconciler never calls provider.getTransaction for
    // this event, since oldAdmin (emitted before reassignment) IS the signer already.
    await runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG, admin.firestore(), makeMockProvider({ currentBlock: 2030 }));

    const cached = await getCachedEvent('0xhrctx1', 0);
    expect(cached).toMatchObject({ eventName: 'AdminTransferred', reconciliationStatus: 'infrastructure' });
  });

  it('classifies as infrastructure_admin_mismatch when oldAdmin differs from our configured admin wallet', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      adminTransferred: () => [
        fakeAdminTransferredEventLog({ transactionHash: '0xhrctx1', blockNumber: 2005, index: 0, oldAdmin: '0xSomeOtherWallet' }),
      ],
    });

    await runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG, admin.firestore(), makeMockProvider({ currentBlock: 2030 }));

    const cached = await getCachedEvent('0xhrctx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'infrastructure_admin_mismatch' });
  });
});

describe('runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG) — RecordAnchored/RecordUnanchored/RecordReanchored (HRC Slice 2)', () => {
  const recordIdHash = '0xRecordIdHash1';
  const subjectIdHash = '0xSubjectIdHash1';

  it('classifies RecordAnchored as matched against a subjectHistory doc recording a direct "anchored" self-anchor', async () => {
    await admin
      .firestore()
      .collection('records')
      .doc('rec-1')
      .collection('subjectHistory')
      .doc('event-1')
      .set({ recordIdHash, subjectIdHash, action: 'anchored', changedByIdHash: subjectIdHash });
    await seedCheckpoint(1999);
    configureQueryFilter({
      recordAnchored: () => [
        fakeRecordAnchoredEventLog({ transactionHash: '0xanchortx1', blockNumber: 2005, index: 0, recordIdHash, subjectIdHash }),
      ],
    });

    await runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG, admin.firestore(), makeMockProvider({ currentBlock: 2030 }));

    const cached = await getCachedEvent('0xanchortx1', 0);
    expect(cached).toMatchObject({
      eventName: 'RecordAnchored',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: 'records/rec-1/subjectHistory/event-1',
    });
  });

  it('classifies RecordAnchored as matched against an "anchored_as_controller" entry too — the on-chain event never distinguishes the two', async () => {
    await admin
      .firestore()
      .collection('records')
      .doc('rec-1')
      .collection('subjectHistory')
      .doc('event-1')
      .set({ recordIdHash, subjectIdHash, action: 'anchored_as_controller', changedByIdHash: '0xControllerIdHash' });
    await seedCheckpoint(1999);
    configureQueryFilter({
      recordAnchored: () => [
        fakeRecordAnchoredEventLog({ transactionHash: '0xanchortx1', blockNumber: 2005, index: 0, recordIdHash, subjectIdHash }),
      ],
    });

    await runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG, admin.firestore(), makeMockProvider({ currentBlock: 2030 }));

    const cached = await getCachedEvent('0xanchortx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'matched' });
  });

  it('classifies RecordAnchored as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some real wallet', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      recordAnchored: () => [
        fakeRecordAnchoredEventLog({ transactionHash: '0xanchortx1', blockNumber: 2005, index: 0, recordIdHash, subjectIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xanchortx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xanchortx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });

  it('classifies RecordUnanchored as matched against an "unanchored" subjectHistory entry', async () => {
    await admin
      .firestore()
      .collection('records')
      .doc('rec-1')
      .collection('subjectHistory')
      .doc('event-1')
      .set({ recordIdHash, subjectIdHash, action: 'unanchored', changedByIdHash: subjectIdHash });
    await seedCheckpoint(1999);
    configureQueryFilter({
      recordUnanchored: () => [
        fakeRecordUnanchoredReanchoredEventLog({ transactionHash: '0xunanchortx1', blockNumber: 2005, index: 0, recordIdHash, subjectIdHash }),
      ],
    });

    await runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG, admin.firestore(), makeMockProvider({ currentBlock: 2030 }));

    const cached = await getCachedEvent('0xunanchortx1', 0);
    expect(cached).toMatchObject({
      eventName: 'RecordUnanchored',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: 'records/rec-1/subjectHistory/event-1',
    });
  });

  it('classifies RecordUnanchored as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some real wallet', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      recordUnanchored: () => [
        fakeRecordUnanchoredReanchoredEventLog({ transactionHash: '0xunanchortx1', blockNumber: 2005, index: 0, recordIdHash, subjectIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xunanchortx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xunanchortx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });

  // RecordReanchored's match rule can never return matched: true today — no 'reanchored' value
  // exists in Firestore's SubjectHistoryAction — so every occurrence falls through to
  // classifyUnmatchedEvent. This documents that known gap at the full-cycle level, not just the
  // pure match-rule level (see healthRecordCoreReconciliationRules.test.ts's own coverage).
  it('classifies RecordReanchored as legitimate_chain_only — the match rule can never succeed today (known gap)', async () => {
    await admin
      .firestore()
      .collection('records')
      .doc('rec-1')
      .collection('subjectHistory')
      .doc('event-1')
      .set({ recordIdHash, subjectIdHash, action: 'anchored', changedByIdHash: subjectIdHash });
    await seedCheckpoint(1999);
    configureQueryFilter({
      recordReanchored: () => [
        fakeRecordUnanchoredReanchoredEventLog({ transactionHash: '0xreanchortx1', blockNumber: 2005, index: 0, recordIdHash, subjectIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xreanchortx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xreanchortx1', 0);
    expect(cached).toMatchObject({ eventName: 'RecordReanchored', reconciliationStatus: 'legitimate_chain_only' });
  });

  it('handles all fifteen HealthRecordCore event types found in the same chunk, advancing the checkpoint to the min toBlock across all fifteen filters', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      adminTransferred: () => [fakeAdminTransferredEventLog({ transactionHash: '0xa', blockNumber: 2002, index: 0, oldAdmin: ADMIN_ADDRESS })],
      recordAnchored: () => [fakeRecordAnchoredEventLog({ transactionHash: '0xb', blockNumber: 2003, index: 0 })],
      recordUnanchored: () => [fakeRecordUnanchoredReanchoredEventLog({ transactionHash: '0xc', blockNumber: 2004, index: 0 })],
      recordReanchored: () => [fakeRecordUnanchoredReanchoredEventLog({ transactionHash: '0xd', blockNumber: 2005, index: 0 })],
      recordHashAdded: () => [fakeRecordHashAddedEventLog({ transactionHash: '0xe', blockNumber: 2006, index: 0 })],
      recordHashRetracted: () => [fakeRecordHashRetractedEventLog({ transactionHash: '0xf', blockNumber: 2007, index: 0 })],
      recordVerified: () => [fakeRecordVerifiedEventLog({ transactionHash: '0xg', blockNumber: 2008, index: 0 })],
      verificationRetracted: () => [fakeVerificationRetractedEventLog({ transactionHash: '0xh', blockNumber: 2009, index: 0 })],
      verificationLevelModified: () => [fakeVerificationLevelModifiedEventLog({ transactionHash: '0xi', blockNumber: 2010, index: 0 })],
      recordDisputed: () => [fakeRecordDisputedEventLog({ transactionHash: '0xj', blockNumber: 2010, index: 1 })],
      disputeRetracted: () => [fakeDisputeRetractedEventLog({ transactionHash: '0xk', blockNumber: 2010, index: 2 })],
      disputeModification: () => [fakeDisputeModificationEventLog({ transactionHash: '0xl', blockNumber: 2010, index: 3 })],
      unacceptedUpdateFlagged: () => [fakeUnacceptedUpdateFlaggedEventLog({ transactionHash: '0xm', blockNumber: 2010, index: 4 })],
      unacceptedUpdateFlagRevoked: () => [fakeUnacceptedUpdateFlagRevokedEventLog({ transactionHash: '0xn', blockNumber: 2010, index: 5 })],
      memberRoleManagerUpdated: () => [fakeMemberRoleManagerUpdatedEventLog({ transactionHash: '0xo', blockNumber: 2010, index: 6 })],
    });

    const result = await runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG, admin.firestore(), makeMockProvider({ currentBlock: 2030 })); // targetBlock 2010

    expect(result.eventsFound).toBe(15);
    expect(result.newlyCached).toBe(15);
    expect(await getCheckpointBlock()).toBe(2010);
    expect((await getCachedEvent('0xa', 0))?.eventName).toBe('AdminTransferred');
    expect((await getCachedEvent('0xb', 0))?.eventName).toBe('RecordAnchored');
    expect((await getCachedEvent('0xc', 0))?.eventName).toBe('RecordUnanchored');
    expect((await getCachedEvent('0xd', 0))?.eventName).toBe('RecordReanchored');
    expect((await getCachedEvent('0xe', 0))?.eventName).toBe('RecordHashAdded');
    expect((await getCachedEvent('0xf', 0))?.eventName).toBe('RecordHashRetracted');
    expect((await getCachedEvent('0xg', 0))?.eventName).toBe('RecordVerified');
    expect((await getCachedEvent('0xh', 0))?.eventName).toBe('VerificationRetracted');
    expect((await getCachedEvent('0xi', 0))?.eventName).toBe('VerificationLevelModified');
    expect((await getCachedEvent('0xj', 1))?.eventName).toBe('RecordDisputed');
    expect((await getCachedEvent('0xk', 2))?.eventName).toBe('DisputeRetracted');
    expect((await getCachedEvent('0xl', 3))?.eventName).toBe('DisputeModification');
    expect((await getCachedEvent('0xm', 4))?.eventName).toBe('UnacceptedUpdateFlagged');
    expect((await getCachedEvent('0xn', 5))?.eventName).toBe('UnacceptedUpdateFlagRevoked');
    expect((await getCachedEvent('0xo', 6))?.eventName).toBe('MemberRoleManagerUpdated');
  });
});

describe('runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG) — RecordHashAdded/RecordHashRetracted (HRC Slice 3)', () => {
  const recordIdHash = '0xRecordIdHash1';

  it('classifies RecordHashAdded as matched against a recordHashHistory doc with the same hash and changedByIdHash === addedBy', async () => {
    const addedBy = '0xAddedByHash1';
    await admin
      .firestore()
      .collection('records')
      .doc('rec-1')
      .collection('recordHashHistory')
      .doc('event-1')
      .set({ recordIdHash, hash: '0xNewHash1', action: 'anchored', changedByIdHash: addedBy });
    await seedCheckpoint(1999);
    configureQueryFilter({
      recordHashAdded: () => [
        fakeRecordHashAddedEventLog({ transactionHash: '0xhashaddedtx1', blockNumber: 2005, index: 0, recordIdHash, newHash: '0xNewHash1', addedBy }),
      ],
    });

    await runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG, admin.firestore(), makeMockProvider({ currentBlock: 2030 }));

    const cached = await getCachedEvent('0xhashaddedtx1', 0);
    expect(cached).toMatchObject({
      eventName: 'RecordHashAdded',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: 'records/rec-1/recordHashHistory/event-1',
    });
  });

  it('does not match RecordHashAdded against a doc whose changedByIdHash differs from addedBy', async () => {
    await admin
      .firestore()
      .collection('records')
      .doc('rec-1')
      .collection('recordHashHistory')
      .doc('event-1')
      .set({ recordIdHash, hash: '0xNewHash1', action: 'anchored', changedByIdHash: '0xSomeoneElseHash' });
    await seedCheckpoint(1999);
    configureQueryFilter({
      recordHashAdded: () => [
        fakeRecordHashAddedEventLog({ transactionHash: '0xhashaddedtx1', blockNumber: 2005, index: 0, recordIdHash, newHash: '0xNewHash1', addedBy: '0xAddedByHash1' }),
      ],
    });

    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xhashaddedtx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xhashaddedtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });

  it('classifies RecordHashAdded as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some real wallet', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      recordHashAdded: () => [fakeRecordHashAddedEventLog({ transactionHash: '0xhashaddedtx1', blockNumber: 2005, index: 0, recordIdHash })],
    });

    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xhashaddedtx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xhashaddedtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });

  // RecordHashRetracted's match rule can never return matched: true today — no 'retracted' value
  // exists in Firestore's RecordHashHistoryAction — so every occurrence falls through to
  // classifyUnmatchedEvent. This documents that known gap at the full-cycle level, not just the
  // pure match-rule level (see healthRecordCoreReconciliationRules.test.ts's own coverage).
  it('classifies RecordHashRetracted as legitimate_chain_only — the match rule can never succeed today (known gap)', async () => {
    await admin
      .firestore()
      .collection('records')
      .doc('rec-1')
      .collection('recordHashHistory')
      .doc('event-1')
      .set({ recordIdHash, hash: '0xRecordHash1', action: 'anchored', changedByIdHash: '0xAddedByHash1' });
    await seedCheckpoint(1999);
    configureQueryFilter({
      recordHashRetracted: () => [
        fakeRecordHashRetractedEventLog({ transactionHash: '0xhashretractedtx1', blockNumber: 2005, index: 0, recordIdHash, recordHash: '0xRecordHash1' }),
      ],
    });

    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xhashretractedtx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xhashretractedtx1', 0);
    expect(cached).toMatchObject({ eventName: 'RecordHashRetracted', reconciliationStatus: 'legitimate_chain_only' });
  });
});

describe('runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG) — RecordVerified/VerificationRetracted/VerificationLevelModified (HRC Slice 4)', () => {
  const recordHash = '0xRecordHash1';
  const verifierIdHash = '0xVerifierIdHash1';
  const verificationDocId = `${recordHash}_verifier-uid`;

  it('classifies RecordVerified as matched against a verifications doc with a "verified" onChainHistory entry', async () => {
    await admin
      .firestore()
      .collection('verifications')
      .doc(verificationDocId)
      .set({ recordHash, verifierIdHash, chainStatus: 'confirmed', onChainHistory: [{ action: 'verified' }] });
    await seedCheckpoint(1999);
    configureQueryFilter({
      recordVerified: () => [
        fakeRecordVerifiedEventLog({ transactionHash: '0xverifiedtx1', blockNumber: 2005, index: 0, recordHash, verifierIdHash }),
      ],
    });

    await runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG, admin.firestore(), makeMockProvider({ currentBlock: 2030 }));

    const cached = await getCachedEvent('0xverifiedtx1', 0);
    expect(cached).toMatchObject({
      eventName: 'RecordVerified',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: `verifications/${verificationDocId}`,
    });
  });

  it('classifies RecordVerified as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some real wallet', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      recordVerified: () => [
        fakeRecordVerifiedEventLog({ transactionHash: '0xverifiedtx1', blockNumber: 2005, index: 0, recordHash, verifierIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xverifiedtx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xverifiedtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });

  it('classifies VerificationRetracted as matched against a "retracted" onChainHistory entry', async () => {
    await admin
      .firestore()
      .collection('verifications')
      .doc(verificationDocId)
      .set({ recordHash, verifierIdHash, chainStatus: 'confirmed', onChainHistory: [{ action: 'verified' }, { action: 'retracted' }] });
    await seedCheckpoint(1999);
    configureQueryFilter({
      verificationRetracted: () => [
        fakeVerificationRetractedEventLog({ transactionHash: '0xverifretracttx1', blockNumber: 2005, index: 0, recordHash, verifierIdHash }),
      ],
    });

    await runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG, admin.firestore(), makeMockProvider({ currentBlock: 2030 }));

    const cached = await getCachedEvent('0xverifretracttx1', 0);
    expect(cached).toMatchObject({
      eventName: 'VerificationRetracted',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: `verifications/${verificationDocId}`,
    });
  });

  it('classifies VerificationRetracted as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some real wallet — no role modifier on this event at all', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      verificationRetracted: () => [
        fakeVerificationRetractedEventLog({ transactionHash: '0xverifretracttx1', blockNumber: 2005, index: 0, recordHash, verifierIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xverifretracttx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xverifretracttx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });

  it('classifies VerificationLevelModified as matched against a "modified" onChainHistory entry', async () => {
    await admin
      .firestore()
      .collection('verifications')
      .doc(verificationDocId)
      .set({ recordHash, verifierIdHash, chainStatus: 'confirmed', onChainHistory: [{ action: 'verified' }, { action: 'modified' }] });
    await seedCheckpoint(1999);
    configureQueryFilter({
      verificationLevelModified: () => [
        fakeVerificationLevelModifiedEventLog({ transactionHash: '0xverifmodtx1', blockNumber: 2005, index: 0, recordHash, verifierIdHash }),
      ],
    });

    await runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG, admin.firestore(), makeMockProvider({ currentBlock: 2030 }));

    const cached = await getCachedEvent('0xverifmodtx1', 0);
    expect(cached).toMatchObject({
      eventName: 'VerificationLevelModified',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: `verifications/${verificationDocId}`,
    });
  });

  it('classifies VerificationLevelModified as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some real wallet', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      verificationLevelModified: () => [
        fakeVerificationLevelModifiedEventLog({ transactionHash: '0xverifmodtx1', blockNumber: 2005, index: 0, recordHash, verifierIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xverifmodtx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xverifmodtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });
});

describe('runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG) — RecordDisputed/DisputeRetracted/DisputeModification (HRC Slice 5)', () => {
  const recordHash = '0xRecordHash1';
  const disputerIdHash = '0xDisputerIdHash1';
  const disputeDocId = `${recordHash}_disputer-uid`;

  it('classifies RecordDisputed as matched against a disputes doc with a "disputed" onChainHistory entry', async () => {
    await admin
      .firestore()
      .collection('disputes')
      .doc(disputeDocId)
      .set({ recordHash, disputerIdHash, chainStatus: 'confirmed', onChainHistory: [{ action: 'disputed' }] });
    await seedCheckpoint(1999);
    configureQueryFilter({
      recordDisputed: () => [
        fakeRecordDisputedEventLog({ transactionHash: '0xdisputedtx1', blockNumber: 2005, index: 0, recordHash, disputerIdHash }),
      ],
    });

    await runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG, admin.firestore(), makeMockProvider({ currentBlock: 2030 }));

    const cached = await getCachedEvent('0xdisputedtx1', 0);
    expect(cached).toMatchObject({
      eventName: 'RecordDisputed',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: `disputes/${disputeDocId}`,
    });
  });

  it('classifies RecordDisputed as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some real wallet', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      recordDisputed: () => [
        fakeRecordDisputedEventLog({ transactionHash: '0xdisputedtx1', blockNumber: 2005, index: 0, recordHash, disputerIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xdisputedtx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xdisputedtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });

  it('classifies DisputeRetracted as matched against a "retracted" onChainHistory entry', async () => {
    await admin
      .firestore()
      .collection('disputes')
      .doc(disputeDocId)
      .set({ recordHash, disputerIdHash, chainStatus: 'confirmed', onChainHistory: [{ action: 'disputed' }, { action: 'retracted' }] });
    await seedCheckpoint(1999);
    configureQueryFilter({
      disputeRetracted: () => [
        fakeDisputeRetractedEventLog({ transactionHash: '0xdisputeretracttx1', blockNumber: 2005, index: 0, recordHash, disputerIdHash }),
      ],
    });

    await runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG, admin.firestore(), makeMockProvider({ currentBlock: 2030 }));

    const cached = await getCachedEvent('0xdisputeretracttx1', 0);
    expect(cached).toMatchObject({
      eventName: 'DisputeRetracted',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: `disputes/${disputeDocId}`,
    });
  });

  it('classifies DisputeRetracted as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some real wallet — no role modifier on this event at all', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      disputeRetracted: () => [
        fakeDisputeRetractedEventLog({ transactionHash: '0xdisputeretracttx1', blockNumber: 2005, index: 0, recordHash, disputerIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xdisputeretracttx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xdisputeretracttx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });

  it('classifies DisputeModification as matched against a "modified" onChainHistory entry', async () => {
    await admin
      .firestore()
      .collection('disputes')
      .doc(disputeDocId)
      .set({ recordHash, disputerIdHash, chainStatus: 'confirmed', onChainHistory: [{ action: 'disputed' }, { action: 'modified' }] });
    await seedCheckpoint(1999);
    configureQueryFilter({
      disputeModification: () => [
        fakeDisputeModificationEventLog({ transactionHash: '0xdisputemodtx1', blockNumber: 2005, index: 0, recordHash, disputerIdHash }),
      ],
    });

    await runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG, admin.firestore(), makeMockProvider({ currentBlock: 2030 }));

    const cached = await getCachedEvent('0xdisputemodtx1', 0);
    expect(cached).toMatchObject({
      eventName: 'DisputeModification',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: `disputes/${disputeDocId}`,
    });
  });

  it('classifies DisputeModification as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some real wallet', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      disputeModification: () => [
        fakeDisputeModificationEventLog({ transactionHash: '0xdisputemodtx1', blockNumber: 2005, index: 0, recordHash, disputerIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xdisputemodtx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xdisputemodtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });
});

describe('runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG) — UnacceptedUpdateFlagged/UnacceptedUpdateFlagRevoked (HRC Slice 6, final slice)', () => {
  const subjectIdHash = '0xSubjectIdHash1';
  const recordIdHash = '0xRecordIdHash1';
  const reporterIdHash = '0xReporterIdHash1';
  const flagDocId = 'subject-uid_record-uid';

  it('classifies UnacceptedUpdateFlagged as matched against an unacceptedFlags doc with a "flagged" onChainHistory entry', async () => {
    await admin
      .firestore()
      .collection('unacceptedFlags')
      .doc(flagDocId)
      .set({ subjectIdHash, recordIdHash, reporterIdHash, chainStatus: 'confirmed', onChainHistory: [{ action: 'flagged' }] });
    await seedCheckpoint(1999);
    configureQueryFilter({
      unacceptedUpdateFlagged: () => [
        fakeUnacceptedUpdateFlaggedEventLog({ transactionHash: '0xflaggedtx1', blockNumber: 2005, index: 0, subjectIdHash, recordIdHash, reporterIdHash }),
      ],
    });

    await runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG, admin.firestore(), makeMockProvider({ currentBlock: 2030 }));

    const cached = await getCachedEvent('0xflaggedtx1', 0);
    expect(cached).toMatchObject({
      eventName: 'UnacceptedUpdateFlagged',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: `unacceptedFlags/${flagDocId}`,
    });
  });

  // Both events are onlyAdmin (no user-callable path at all), same structural shape as
  // MemberRoleManager's admin-only events (MemberRegistered/WalletLinked/MemberStatusChanged) —
  // legitimate_chain_only is not reachable, so admin_untracked is the meaningful unmatched case to
  // cover here, not legitimate_chain_only.
  it('classifies UnacceptedUpdateFlagged as admin_untracked when unmatched, no sync-queue entry, and signed by the admin wallet', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      unacceptedUpdateFlagged: () => [
        fakeUnacceptedUpdateFlaggedEventLog({ transactionHash: '0xflaggedtx1', blockNumber: 2005, index: 0, subjectIdHash, recordIdHash, reporterIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xflaggedtx1': ADMIN_ADDRESS } })
    );

    const cached = await getCachedEvent('0xflaggedtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'admin_untracked' });
  });

  it('classifies UnacceptedUpdateFlagRevoked as matched against a "revoked" onChainHistory entry', async () => {
    await admin
      .firestore()
      .collection('unacceptedFlags')
      .doc(flagDocId)
      .set({ subjectIdHash, recordIdHash, reporterIdHash, chainStatus: 'confirmed', onChainHistory: [{ action: 'flagged' }, { action: 'revoked' }] });
    await seedCheckpoint(1999);
    configureQueryFilter({
      unacceptedUpdateFlagRevoked: () => [
        fakeUnacceptedUpdateFlagRevokedEventLog({ transactionHash: '0xflagrevokedtx1', blockNumber: 2005, index: 0, subjectIdHash, recordIdHash, reporterIdHash }),
      ],
    });

    await runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG, admin.firestore(), makeMockProvider({ currentBlock: 2030 }));

    const cached = await getCachedEvent('0xflagrevokedtx1', 0);
    expect(cached).toMatchObject({
      eventName: 'UnacceptedUpdateFlagRevoked',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: `unacceptedFlags/${flagDocId}`,
    });
  });

  it('classifies UnacceptedUpdateFlagRevoked as admin_untracked when unmatched, no sync-queue entry, and signed by the admin wallet', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      unacceptedUpdateFlagRevoked: () => [
        fakeUnacceptedUpdateFlagRevokedEventLog({ transactionHash: '0xflagrevokedtx1', blockNumber: 2005, index: 0, subjectIdHash, recordIdHash, reporterIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xflagrevokedtx1': ADMIN_ADDRESS } })
    );

    const cached = await getCachedEvent('0xflagrevokedtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'admin_untracked' });
  });
});

describe('runChainEventIndexerCycle(HEALTH_RECORD_CORE_INDEXER_CONFIG) — MemberRoleManagerUpdated (HRC Slice 7, final slice)', () => {
  it('classifies as infrastructure when signed by our configured admin wallet', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      memberRoleManagerUpdated: () => [
        fakeMemberRoleManagerUpdatedEventLog({ transactionHash: '0xmrmtx1', blockNumber: 2005, index: 0 }),
      ],
    });

    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xmrmtx1': ADMIN_ADDRESS } })
    );

    const cached = await getCachedEvent('0xmrmtx1', 0);
    expect(cached).toMatchObject({ eventName: 'MemberRoleManagerUpdated', reconciliationStatus: 'infrastructure' });
  });

  it('classifies as infrastructure_admin_mismatch when signed by some other address', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      memberRoleManagerUpdated: () => [
        fakeMemberRoleManagerUpdatedEventLog({ transactionHash: '0xmrmtx1', blockNumber: 2005, index: 0 }),
      ],
    });

    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030, txFromByHash: { '0xmrmtx1': '0xSomeOtherWallet' } })
    );

    const cached = await getCachedEvent('0xmrmtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'infrastructure_admin_mismatch' });
  });

  it('classifies as infrastructure_admin_mismatch when the signer cannot be resolved at all', async () => {
    await seedCheckpoint(1999);
    configureQueryFilter({
      memberRoleManagerUpdated: () => [
        fakeMemberRoleManagerUpdatedEventLog({ transactionHash: '0xmrmtx1', blockNumber: 2005, index: 0 }),
      ],
    });

    // Deliberately no txFromByHash entry — getTransaction resolves to null, same fail-safe
    // direction as MemberRoleManager's own reconcileHealthRecordCoreUpdatedEvent.
    await runChainEventIndexerCycle(
      HEALTH_RECORD_CORE_INDEXER_CONFIG,
      admin.firestore(),
      makeMockProvider({ currentBlock: 2030 })
    );

    const cached = await getCachedEvent('0xmrmtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'infrastructure_admin_mismatch' });
  });
});
