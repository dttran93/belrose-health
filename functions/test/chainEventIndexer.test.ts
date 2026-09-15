// functions/test/chainEventIndexer.test.ts
//
// Functions layer — the chain event indexer's core cycle. Mirrors
// functions/test/blockchainSyncRetry.test.ts's mocking pattern: MemberRoleManager__factory is
// mocked (no real chain calls), Firestore is real (emulator, via test/setup.ts). The RPC
// `provider` is also a lightweight mock (getBlockNumber/getTransaction only) passed explicitly —
// runChainEventIndexerCycle accepts db/provider as parameters specifically so tests never touch
// a real network.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { ethers } from 'ethers';
import { clearFirestore } from './helpers/testAdmin';

const { mockContract, connectMock } = vi.hoisted(() => {
  const mockContract = {
    target: '0xMockMemberRoleManagerProxy',
    filters: {
      MemberRegistered: vi.fn(() => 'MemberRegistered-filter'),
      WalletLinked: vi.fn(() => 'WalletLinked-filter'),
      RoleGranted: vi.fn(() => 'RoleGranted-filter'),
      RoleRevoked: vi.fn(() => 'RoleRevoked-filter'),
      RoleChanged: vi.fn(() => 'RoleChanged-filter'),
      MemberStatusChanged: vi.fn(() => 'MemberStatusChanged-filter'),
      OwnershipVoluntarilyLeft: vi.fn(() => 'OwnershipVoluntarilyLeft-filter'),
      TrusteeProposed: vi.fn(() => 'TrusteeProposed-filter'),
      TrusteeAccepted: vi.fn(() => 'TrusteeAccepted-filter'),
      TrusteeDeclined: vi.fn(() => 'TrusteeDeclined-filter'),
      TrusteeRevoked: vi.fn(() => 'TrusteeRevoked-filter'),
      TrusteeLevelUpdated: vi.fn(() => 'TrusteeLevelUpdated-filter'),
      VouchGiven: vi.fn(() => 'VouchGiven-filter'),
      VouchRetracted: vi.fn(() => 'VouchRetracted-filter'),
    },
    queryFilter: vi.fn(),
    userStatus: vi.fn(),
  };
  return { mockContract, connectMock: vi.fn(() => mockContract) };
});

vi.mock('../src/_shared/typechain', () => ({
  MemberRoleManager__factory: { connect: connectMock },
}));

import { runChainEventIndexerCycle } from '../src/chainIndexer/chainEventIndexerService';
import { buildChainIndexerCheckpointDocId } from '../src/_shared';

// Matches mockContract.target + the mock provider's chainId — the real doc ID the code under
// test will actually compute and use.
const CHECKPOINT_DOC_ID = buildChainIndexerCheckpointDocId(
  'MemberRoleManager',
  84532,
  '0xMockMemberRoleManagerProxy'
);

// Matches test/setup.ts's fake-but-valid ADMIN_WALLET_PRIVATE_KEY — computed once so
// admin-signed-tx tests can assert against the real derived address.
const ADMIN_ADDRESS = new ethers.Wallet('0x' + '11'.repeat(32)).address;

function fakeEventLog(overrides: {
  eventName: 'MemberRegistered' | 'WalletLinked';
  transactionHash: string;
  blockNumber: number;
  index: number;
  wallet?: string;
  userIdHash?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      wallet: overrides.wallet ?? '0xWallet1',
      userIdHash: overrides.userIdHash ?? '0xHash1',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeRoleEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  recordIdHash?: string;
  targetIdHash?: string;
  role?: string;
  userIdHash?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      recordIdHash: overrides.recordIdHash ?? '0xRecordHash1',
      targetIdHash: overrides.targetIdHash ?? '0xTargetHash1',
      role: overrides.role ?? 'administrator',
      userIdHash: overrides.userIdHash ?? '0xCallerHash1',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeRoleChangedEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  recordIdHash?: string;
  targetIdHash?: string;
  oldRole?: string;
  newRole?: string;
  userIdHash?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      recordIdHash: overrides.recordIdHash ?? '0xRecordHash1',
      targetIdHash: overrides.targetIdHash ?? '0xTargetHash1',
      oldRole: overrides.oldRole ?? 'viewer',
      newRole: overrides.newRole ?? 'sharer',
      userIdHash: overrides.userIdHash ?? '0xCallerHash1',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeStatusChangedEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  userIdHash?: string;
  oldStatus?: number;
  newStatus?: number;
  changedBy?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      userIdHash: overrides.userIdHash ?? '0xHash1',
      oldStatus: overrides.oldStatus ?? 2, // Active
      newStatus: overrides.newStatus ?? 1, // Inactive
      changedBy: overrides.changedBy ?? ADMIN_ADDRESS,
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeOwnershipLeftEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  recordIdHash?: string;
  userIdHash?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      recordIdHash: overrides.recordIdHash ?? '0xRecordHash1',
      userIdHash: overrides.userIdHash ?? '0xCallerHash1',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

// Shared by TrusteeProposed/TrusteeAccepted — same {trustorIdHash, trusteeIdHash, level} shape.
function fakeTrusteeProposedAcceptedEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  trustorIdHash?: string;
  trusteeIdHash?: string;
  level?: number;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      trustorIdHash: overrides.trustorIdHash ?? '0xTrustorHash1',
      trusteeIdHash: overrides.trusteeIdHash ?? '0xTrusteeHash1',
      level: overrides.level ?? 1, // custodian
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeTrusteeDeclinedEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  trustorIdHash?: string;
  trusteeIdHash?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      trustorIdHash: overrides.trustorIdHash ?? '0xTrustorHash1',
      trusteeIdHash: overrides.trusteeIdHash ?? '0xTrusteeHash1',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeTrusteeRevokedEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  trustorIdHash?: string;
  trusteeIdHash?: string;
  revokedBy?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      trustorIdHash: overrides.trustorIdHash ?? '0xTrustorHash1',
      trusteeIdHash: overrides.trusteeIdHash ?? '0xTrusteeHash1',
      revokedBy: overrides.revokedBy ?? '0xTrustorHash1',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeTrusteeLevelUpdatedEventLog(overrides: {
  transactionHash: string;
  blockNumber: number;
  index: number;
  trustorIdHash?: string;
  trusteeIdHash?: string;
  oldLevel?: number;
  newLevel?: number;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      trustorIdHash: overrides.trustorIdHash ?? '0xTrustorHash1',
      trusteeIdHash: overrides.trusteeIdHash ?? '0xTrusteeHash1',
      oldLevel: overrides.oldLevel ?? 0, // observer
      newLevel: overrides.newLevel ?? 1, // custodian
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

function fakeVouchEventLog(overrides: {
  eventName: 'VouchGiven' | 'VouchRetracted';
  transactionHash: string;
  blockNumber: number;
  index: number;
  voucherIdHash?: string;
  voucheeIdHash?: string;
  timestamp?: bigint;
}) {
  return {
    transactionHash: overrides.transactionHash,
    blockNumber: overrides.blockNumber,
    index: overrides.index,
    args: {
      voucherIdHash: overrides.voucherIdHash ?? '0xVoucherHash1',
      voucheeIdHash: overrides.voucheeIdHash ?? '0xVoucheeHash1',
      timestamp: overrides.timestamp ?? 1_700_000_000n,
    },
  };
}

// Every existing test only cares about MemberRegistered/WalletLinked and expects role-event
// filters to just come back empty — roleGranted/roleRevoked/etc. are optional so those tests
// don't need updating for a slice they predate.
function configureQueryFilter(handlers: {
  memberRegistered: (from: number, to: number) => unknown[];
  walletLinked: (from: number, to: number) => unknown[];
  roleGranted?: (from: number, to: number) => unknown[];
  roleRevoked?: (from: number, to: number) => unknown[];
  roleChanged?: (from: number, to: number) => unknown[];
  memberStatusChanged?: (from: number, to: number) => unknown[];
  ownershipVoluntarilyLeft?: (from: number, to: number) => unknown[];
  trusteeProposed?: (from: number, to: number) => unknown[];
  trusteeAccepted?: (from: number, to: number) => unknown[];
  trusteeDeclined?: (from: number, to: number) => unknown[];
  trusteeRevoked?: (from: number, to: number) => unknown[];
  trusteeLevelUpdated?: (from: number, to: number) => unknown[];
  vouchGiven?: (from: number, to: number) => unknown[];
  vouchRetracted?: (from: number, to: number) => unknown[];
}) {
  mockContract.queryFilter.mockImplementation(async (filter: unknown, from: number, to: number) => {
    switch (filter) {
      case 'MemberRegistered-filter':
        return handlers.memberRegistered(from, to);
      case 'WalletLinked-filter':
        return handlers.walletLinked(from, to);
      case 'RoleGranted-filter':
        return (handlers.roleGranted ?? (() => []))(from, to);
      case 'RoleRevoked-filter':
        return (handlers.roleRevoked ?? (() => []))(from, to);
      case 'RoleChanged-filter':
        return (handlers.roleChanged ?? (() => []))(from, to);
      case 'MemberStatusChanged-filter':
        return (handlers.memberStatusChanged ?? (() => []))(from, to);
      case 'OwnershipVoluntarilyLeft-filter':
        return (handlers.ownershipVoluntarilyLeft ?? (() => []))(from, to);
      case 'TrusteeProposed-filter':
        return (handlers.trusteeProposed ?? (() => []))(from, to);
      case 'TrusteeAccepted-filter':
        return (handlers.trusteeAccepted ?? (() => []))(from, to);
      case 'TrusteeDeclined-filter':
        return (handlers.trusteeDeclined ?? (() => []))(from, to);
      case 'TrusteeRevoked-filter':
        return (handlers.trusteeRevoked ?? (() => []))(from, to);
      case 'TrusteeLevelUpdated-filter':
        return (handlers.trusteeLevelUpdated ?? (() => []))(from, to);
      case 'VouchGiven-filter':
        return (handlers.vouchGiven ?? (() => []))(from, to);
      case 'VouchRetracted-filter':
        return (handlers.vouchRetracted ?? (() => []))(from, to);
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
    contract: 'MemberRoleManager',
    chainId: 84532,
    contractAddress: '0xMockMemberRoleManagerProxy',
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

// Mirrors MemberRoleManager.sol's MemberStatus enum — see memberRegistry.ts's own statusMap.
const MEMBER_STATUS_ACTIVE = 2;
const MEMBER_STATUS_INACTIVE = 1;

beforeEach(async () => {
  await clearFirestore();
  vi.clearAllMocks();
  connectMock.mockReturnValue(mockContract);
  // Active by default — every existing Member-event test predates the deactivation check
  // (isDeactivatedOnChain) and expects to reach its own branch of the pipeline; tests that
  // specifically want the deactivated_tracked path override this explicitly.
  mockContract.userStatus.mockResolvedValue(MEMBER_STATUS_ACTIVE);
});

describe('runChainEventIndexerCycle — basic scan + checkpoint', () => {
  it('caches a found event and advances the checkpoint to the scanned target block', async () => {
    await seedCheckpoint(999); // startBlock = 1000
    configureQueryFilter({
      memberRegistered: () => [
        fakeEventLog({ eventName: 'MemberRegistered', transactionHash: '0xtx1', blockNumber: 1005, index: 0 }),
      ],
      walletLinked: () => [],
    });
    const provider = makeMockProvider({ currentBlock: 1030 }); // targetBlock = 1010

    const result = await runChainEventIndexerCycle(admin.firestore(), provider);

    expect(result).toMatchObject({ scannedFromBlock: 1000, scannedToBlock: 1010, eventsFound: 1, newlyCached: 1 });
    expect(await getCheckpointBlock()).toBe(1010);

    const cached = await getCachedEvent('0xtx1', 0);
    expect(cached).toMatchObject({
      contract: 'MemberRoleManager',
      eventName: 'MemberRegistered',
      logIndex: 0,
      args: { wallet: '0xWallet1', userIdHash: '0xHash1' },
      reconciliationStatus: expect.any(String),
    });
    expect(cached!.blockchainRef).toMatchObject({ txHash: '0xtx1', blockNumber: 1005 });
  });

  it('resumes from the persisted checkpoint on a subsequent run rather than rescanning', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({ memberRegistered: () => [], walletLinked: () => [] });
    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));
    expect(await getCheckpointBlock()).toBe(1010);

    const secondCallRanges: Array<[number, number]> = [];
    configureQueryFilter({
      memberRegistered: (from, to) => {
        secondCallRanges.push([from, to]);
        return [];
      },
      walletLinked: () => [],
    });
    const result = await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1050 }));

    expect(result.scannedFromBlock).toBe(1011); // resumed right after the prior checkpoint
    expect(secondCallRanges[0][0]).toBe(1011);
    expect(await getCheckpointBlock()).toBe(1030); // 1050 - 20 buffer
  });

  it('is a no-op when the checkpoint is already caught up to the confirmation buffer', async () => {
    await seedCheckpoint(1010);
    configureQueryFilter({ memberRegistered: () => [], walletLinked: () => [] });

    const result = await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1025 })); // target = 1005, already behind checkpoint

    expect(result.eventsFound).toBe(0);
    expect(mockContract.queryFilter).not.toHaveBeenCalled();
    expect(await getCheckpointBlock()).toBe(1010); // untouched
  });

  it('re-scanning an overlapping block range never duplicates a cached event (idempotent via composite doc ID)', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [
        fakeEventLog({ eventName: 'MemberRegistered', transactionHash: '0xtx1', blockNumber: 1005, index: 0 }),
      ],
      walletLinked: () => [],
    });
    const first = await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));
    expect(first.newlyCached).toBe(1);

    // Simulate an overlapping rescan: reset the checkpoint back and feed the identical event again.
    await seedCheckpoint(999);
    const second = await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    expect(second.eventsFound).toBe(1); // the log is "found" again by the scan
    expect(second.newlyCached).toBe(0); // but not newly cached — already exists

    const allCached = await admin.firestore().collection('chainEventCache').get();
    expect(allCached.size).toBe(1); // never duplicated
  });
});

describe('runChainEventIndexerCycle — chunked scanning with backoff', () => {
  it('halves the chunk size and retries on a block-range error, without ever throwing', async () => {
    await seedCheckpoint(99); // startBlock = 100, currentBlock 700 => targetBlock 680, span 581 > initial 500-block chunk
    const attempts: Array<[number, number]> = [];
    configureQueryFilter({
      memberRegistered: (from, to) => {
        attempts.push([from, to]);
        if (attempts.length === 1) throw new Error('query returned more than 10000 results');
        return [];
      },
      walletLinked: () => [],
    });

    const result = await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 700 }));

    expect(attempts.length).toBeGreaterThanOrEqual(2);
    const [firstFrom, firstTo] = attempts[0];
    const [secondFrom, secondTo] = attempts[1];
    expect(secondFrom).toBe(firstFrom); // retried from the same start block
    expect(secondTo - secondFrom).toBeLessThan(firstTo - firstFrom); // smaller range
    expect(result.scannedToBlock).toBe(680); // still completes the full scan despite the retry
  });

  it('rethrows a genuine (non-range) error without treating it as a backoff signal', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => {
        throw new Error('network timeout');
      },
      walletLinked: () => [],
    });

    await expect(
      runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }))
    ).rejects.toThrow('network timeout');

    // Checkpoint left at the last successfully-completed block (none here), marked as errored.
    const snap = await admin.firestore().collection('chainIndexerCheckpoints').doc(CHECKPOINT_DOC_ID).get();
    expect(snap.data()).toMatchObject({ lastRunStatus: 'error', lastError: 'network timeout' });
  });
});

describe('runChainEventIndexerCycle — reconciliation classification', () => {
  it('classifies as matched when Firestore already knows about this wallet/identity link', async () => {
    await admin
      .firestore()
      .collection('users')
      .doc('user-1')
      .set({ onChainIdentity: { userIdHash: '0xHash1' }, wallet: { address: '0xWallet1' } });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [
        fakeEventLog({ eventName: 'MemberRegistered', transactionHash: '0xtx1', blockNumber: 1005, index: 0 }),
      ],
      walletLinked: () => [],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'matched', matchedFirestoreRef: 'users/user-1' });
  });

  it('classifies as sync_queue_confirmed_missing_write when a confirmed sync-queue entry exists but Firestore has no matching user', async () => {
    await admin
      .firestore()
      .collection('blockchainSyncQueue')
      .doc('sync-1')
      .set({ txHash: '0xtx1', status: 'confirmed', action: 'addMember', userId: 'user-1', contract: 'MemberRoleManager' });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [
        fakeEventLog({ eventName: 'MemberRegistered', transactionHash: '0xtx1', blockNumber: 1005, index: 0 }),
      ],
      walletLinked: () => [],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'sync_queue_confirmed_missing_write', matchedSyncQueueId: 'sync-1' });
  });

  it('classifies as admin_untracked when no sync-queue entry exists and the tx was signed by the admin wallet', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [
        fakeEventLog({ eventName: 'MemberRegistered', transactionHash: '0xtx1', blockNumber: 1005, index: 0 }),
      ],
      walletLinked: () => [],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xtx1': ADMIN_ADDRESS } })
    );

    const cached = await getCachedEvent('0xtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'admin_untracked' });
  });

  it('classifies as legitimate_chain_only when no sync-queue entry exists and the tx was signed by some other wallet', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [
        fakeEventLog({ eventName: 'MemberRegistered', transactionHash: '0xtx1', blockNumber: 1005, index: 0 }),
      ],
      walletLinked: () => [],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xtx1': '0xSomeUnrelatedSigner' } })
    );

    const cached = await getCachedEvent('0xtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });

  // Reproduces e2e test cleanup (e2e/helpers/backend/staging.ts's deactivateOnChain): the
  // identity is genuinely deactivated on-chain, but its Firestore user doc is gone — checked
  // before both the sync-queue and admin-wallet checks, so this fires regardless of whether a
  // sync-queue entry happens to exist for this txHash.
  it('classifies as deactivated_tracked when unmatched and the identity is Inactive on-chain — even with a confirmed sync-queue entry', async () => {
    await admin
      .firestore()
      .collection('blockchainSyncQueue')
      .doc('sync-1')
      .set({ txHash: '0xtx1', status: 'confirmed', action: 'addMember', userId: 'user-1', contract: 'MemberRoleManager' });
    mockContract.userStatus.mockResolvedValue(MEMBER_STATUS_INACTIVE);
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [
        fakeEventLog({ eventName: 'MemberRegistered', transactionHash: '0xtx1', blockNumber: 1005, index: 0 }),
      ],
      walletLinked: () => [],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xtx1', 0);
    expect(cached).toMatchObject({
      reconciliationStatus: 'deactivated_tracked',
      matchedSyncQueueId: null,
      matchedFirestoreRef: null,
    });
  });

  it('classifies as deactivated_tracked when unmatched, Inactive on-chain, and no sync-queue entry either — not admin_untracked', async () => {
    mockContract.userStatus.mockResolvedValue(MEMBER_STATUS_INACTIVE);
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [
        fakeEventLog({ eventName: 'MemberRegistered', transactionHash: '0xtx1', blockNumber: 1005, index: 0 }),
      ],
      walletLinked: () => [],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xtx1': ADMIN_ADDRESS } })
    );

    const cached = await getCachedEvent('0xtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'deactivated_tracked' });
  });

  it('does not apply deactivated_tracked to an already-matched event — the on-chain status check only runs for unmatched events', async () => {
    await admin
      .firestore()
      .collection('users')
      .doc('user-1')
      .set({ onChainIdentity: { userIdHash: '0xHash1' }, wallet: { address: '0xWallet1' } });
    mockContract.userStatus.mockResolvedValue(MEMBER_STATUS_INACTIVE); // even a deactivated real user should still report 'matched'
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [
        fakeEventLog({ eventName: 'MemberRegistered', transactionHash: '0xtx1', blockNumber: 1005, index: 0 }),
      ],
      walletLinked: () => [],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'matched' });
  });
});

describe('runChainEventIndexerCycle — sweeping lingering unclassified events', () => {
  // Reproduces the real incident this sweep exists to fix: a prior run got killed (timeout,
  // crash) after caching an event but before finishing its reconciliation, leaving it stuck at
  // 'unclassified' forever — the checkpoint has already moved past that block, so the forward
  // scan alone would never revisit it.
  it('retroactively reconciles a stuck "unclassified" doc without needing to re-scan its block', async () => {
    await admin
      .firestore()
      .collection('chainEventCache')
      .doc('0xstuck_0')
      .set({
        contract: 'MemberRoleManager',
        eventName: 'MemberRegistered',
        logIndex: 0,
        blockchainRef: {
          txHash: '0xstuck',
          blockNumber: 500,
          contractAddress: '0xMockMemberRoleManagerProxy',
          chainId: 84532,
        },
        blockTimestamp: new Date(),
        args: { wallet: '0xWalletX', userIdHash: '0xHashX' },
        reconciliationStatus: 'unclassified',
        matchedSyncQueueId: null,
        matchedFirestoreRef: null,
        reconciledAt: null,
        indexedAt: new Date(),
      });

    await seedCheckpoint(999);
    configureQueryFilter({ memberRegistered: () => [], walletLinked: () => [] });

    const result = await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xstuck': ADMIN_ADDRESS } })
    );

    expect(result.reconciledUnclassified).toBe(1);
    const snap = await admin.firestore().collection('chainEventCache').doc('0xstuck_0').get();
    expect(snap.data()).toMatchObject({ reconciliationStatus: 'admin_untracked' });
  });

  it('leaves an already-classified doc untouched (only sweeps unclassified ones)', async () => {
    await admin.firestore().collection('chainEventCache').doc('0xdone_0').set({
      contract: 'MemberRoleManager',
      eventName: 'MemberRegistered',
      logIndex: 0,
      blockchainRef: { txHash: '0xdone', blockNumber: 500, contractAddress: '0xMockMemberRoleManagerProxy', chainId: 84532 },
      blockTimestamp: new Date(),
      args: { wallet: '0xWalletX', userIdHash: '0xHashX' },
      reconciliationStatus: 'matched',
      matchedSyncQueueId: null,
      matchedFirestoreRef: 'users/user-1',
      reconciledAt: new Date(),
      indexedAt: new Date(),
    });

    await seedCheckpoint(999);
    configureQueryFilter({ memberRegistered: () => [], walletLinked: () => [] });

    const result = await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    expect(result.reconciledUnclassified).toBe(0);
    const snap = await admin.firestore().collection('chainEventCache').doc('0xdone_0').get();
    expect(snap.data()).toMatchObject({ reconciliationStatus: 'matched', matchedFirestoreRef: 'users/user-1' });
  });
});

describe('runChainEventIndexerCycle — RoleGranted/RoleRevoked (Slice 2)', () => {
  const targetUserId = 'user-target';
  const targetIdHash = ethers.id(targetUserId);

  it('classifies as matched against a direct-write (permissionsService.ts-style) permissionHistory doc', async () => {
    await admin
      .firestore()
      .collection('records')
      .doc('rec-1')
      .collection('permissionHistory')
      .doc('event-1')
      .set({
        recordIdHash: '0xRecordHash1',
        changedBy: 'user-admin',
        changedByIdHash: ethers.id('user-admin'),
        changes: [{ userId: targetUserId, newRole: 'administrator' }],
        context: 'direct',
      });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      roleGranted: () => [
        fakeRoleEventLog({ transactionHash: '0xroletx1', blockNumber: 1005, index: 0, recordIdHash: '0xRecordHash1', targetIdHash, role: 'administrator' }),
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xroletx1', 0);
    expect(cached).toMatchObject({
      eventName: 'RoleGranted',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: 'records/rec-1/permissionHistory/event-1',
    });
  });

  it('classifies as matched against a trustee-authored permissionHistory doc identically — producer-agnostic', async () => {
    await admin
      .firestore()
      .collection('records')
      .doc('rec-1')
      .collection('permissionHistory')
      .doc('event-1')
      .set({
        recordIdHash: '0xRecordHash1',
        changedBy: 'trustee-uid',
        changedByIdHash: ethers.id('trustee-uid'),
        changes: [{ userId: targetUserId, newRole: 'administrator' }],
        context: 'trustee_grant',
      });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      roleGranted: () => [
        fakeRoleEventLog({ transactionHash: '0xroletx1', blockNumber: 1005, index: 0, recordIdHash: '0xRecordHash1', targetIdHash, role: 'administrator' }),
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xroletx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'matched' });
  });

  it('matches the initializeRecordRole case even though the on-chain userIdHash is bytes32(0) and Firestore\'s changedByIdHash is a real hash', async () => {
    const zeroHash = ethers.ZeroHash;
    await admin
      .firestore()
      .collection('records')
      .doc('rec-1')
      .collection('permissionHistory')
      .doc('event-1')
      .set({
        recordIdHash: '0xRecordHash1',
        changedBy: 'real-admin-uid',
        changedByIdHash: ethers.id('real-admin-uid'), // real hash — deliberately NOT bytes32(0)
        changes: [{ userId: targetUserId, newRole: 'owner' }],
      });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      roleGranted: () => [
        fakeRoleEventLog({
          transactionHash: '0xroletx1',
          blockNumber: 1005,
          index: 0,
          recordIdHash: '0xRecordHash1',
          targetIdHash,
          role: 'owner',
          userIdHash: zeroHash, // the real on-chain value for this call site
        }),
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xroletx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'matched' });
  });

  it('classifies as sync_queue_confirmed_missing_write for an unmatched RoleRevoked with a confirmed sync-queue entry', async () => {
    await admin
      .firestore()
      .collection('blockchainSyncQueue')
      .doc('sync-1')
      .set({ txHash: '0xroletx1', status: 'confirmed', action: 'revokeRole', userId: 'user-1', contract: 'MemberRoleManager' });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      roleRevoked: () => [
        fakeRoleEventLog({ transactionHash: '0xroletx1', blockNumber: 1005, index: 0, recordIdHash: '0xRecordHash1', targetIdHash }),
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xroletx1', 0);
    expect(cached).toMatchObject({ eventName: 'RoleRevoked', reconciliationStatus: 'sync_queue_confirmed_missing_write', matchedSyncQueueId: 'sync-1' });
  });

  it('classifies as admin_untracked when unmatched, no sync-queue entry, and signed by the admin wallet', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      roleGranted: () => [
        fakeRoleEventLog({ transactionHash: '0xroletx1', blockNumber: 1005, index: 0, recordIdHash: '0xRecordHash1', targetIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xroletx1': ADMIN_ADDRESS } })
    );

    const cached = await getCachedEvent('0xroletx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'admin_untracked' });
  });

  // Unlike Slice 1's MemberRegistered/WalletLinked (which can only ever be admin-signed, since
  // addMember/addMemberBatch are onlyAdmin), grantRole/revokeRole are onlyActiveMember — callable
  // directly by any real user's own wallet. This is the first test that can actually reach this
  // branch structurally, not just exercise it generically.
  it('classifies as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some other real wallet', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      roleGranted: () => [
        fakeRoleEventLog({ transactionHash: '0xroletx1', blockNumber: 1005, index: 0, recordIdHash: '0xRecordHash1', targetIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xroletx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xroletx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });

  it('handles all fourteen event types found in the same chunk, advancing the checkpoint to the min toBlock across all fourteen filters', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [fakeEventLog({ eventName: 'MemberRegistered', transactionHash: '0xa', blockNumber: 1002, index: 0 })],
      walletLinked: () => [fakeEventLog({ eventName: 'WalletLinked', transactionHash: '0xb', blockNumber: 1003, index: 0 })],
      roleGranted: () => [fakeRoleEventLog({ transactionHash: '0xc', blockNumber: 1004, index: 0, recordIdHash: '0xRecordHash1', targetIdHash })],
      roleRevoked: () => [fakeRoleEventLog({ transactionHash: '0xd', blockNumber: 1006, index: 0, recordIdHash: '0xRecordHash1', targetIdHash })],
      roleChanged: () => [fakeRoleChangedEventLog({ transactionHash: '0xe', blockNumber: 1007, index: 0, recordIdHash: '0xRecordHash1', targetIdHash })],
      memberStatusChanged: () => [fakeStatusChangedEventLog({ transactionHash: '0xf', blockNumber: 1008, index: 0 })],
      ownershipVoluntarilyLeft: () => [fakeOwnershipLeftEventLog({ transactionHash: '0xg', blockNumber: 1009, index: 0 })],
      trusteeProposed: () => [fakeTrusteeProposedAcceptedEventLog({ transactionHash: '0xh', blockNumber: 1002, index: 0 })],
      trusteeAccepted: () => [fakeTrusteeProposedAcceptedEventLog({ transactionHash: '0xi', blockNumber: 1003, index: 0 })],
      trusteeDeclined: () => [fakeTrusteeDeclinedEventLog({ transactionHash: '0xj', blockNumber: 1004, index: 0 })],
      trusteeRevoked: () => [fakeTrusteeRevokedEventLog({ transactionHash: '0xk', blockNumber: 1005, index: 0 })],
      trusteeLevelUpdated: () => [fakeTrusteeLevelUpdatedEventLog({ transactionHash: '0xl', blockNumber: 1006, index: 0 })],
      vouchGiven: () => [fakeVouchEventLog({ eventName: 'VouchGiven', transactionHash: '0xm', blockNumber: 1007, index: 0 })],
      vouchRetracted: () => [fakeVouchEventLog({ eventName: 'VouchRetracted', transactionHash: '0xn', blockNumber: 1008, index: 0 })],
    });

    const result = await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 })); // targetBlock 1010

    expect(result.eventsFound).toBe(14);
    expect(result.newlyCached).toBe(14);
    expect(await getCheckpointBlock()).toBe(1010); // all fourteen filters shared the same [1000,1010] range
    expect((await getCachedEvent('0xa', 0))?.eventName).toBe('MemberRegistered');
    expect((await getCachedEvent('0xb', 0))?.eventName).toBe('WalletLinked');
    expect((await getCachedEvent('0xc', 0))?.eventName).toBe('RoleGranted');
    expect((await getCachedEvent('0xd', 0))?.eventName).toBe('RoleRevoked');
    expect((await getCachedEvent('0xe', 0))?.eventName).toBe('RoleChanged');
    expect((await getCachedEvent('0xf', 0))?.eventName).toBe('MemberStatusChanged');
    expect((await getCachedEvent('0xg', 0))?.eventName).toBe('OwnershipVoluntarilyLeft');
    expect((await getCachedEvent('0xh', 0))?.eventName).toBe('TrusteeProposed');
    expect((await getCachedEvent('0xi', 0))?.eventName).toBe('TrusteeAccepted');
    expect((await getCachedEvent('0xj', 0))?.eventName).toBe('TrusteeDeclined');
    expect((await getCachedEvent('0xk', 0))?.eventName).toBe('TrusteeRevoked');
    expect((await getCachedEvent('0xl', 0))?.eventName).toBe('TrusteeLevelUpdated');
    expect((await getCachedEvent('0xm', 0))?.eventName).toBe('VouchGiven');
    expect((await getCachedEvent('0xn', 0))?.eventName).toBe('VouchRetracted');
  });
});

describe('runChainEventIndexerCycle — RoleChanged (Slice 3)', () => {
  const targetUserId = 'user-target';
  const targetIdHash = ethers.id(targetUserId);

  it('classifies as matched against a permissionHistory doc recording an "upgraded" change with the same oldRole/newRole', async () => {
    await admin
      .firestore()
      .collection('records')
      .doc('rec-1')
      .collection('permissionHistory')
      .doc('event-1')
      .set({
        recordIdHash: '0xRecordHash1',
        changedBy: 'user-admin',
        changedByIdHash: ethers.id('user-admin'),
        changes: [{ action: 'upgraded', userId: targetUserId, previousRole: 'viewer', newRole: 'sharer' }],
      });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      roleChanged: () => [
        fakeRoleChangedEventLog({
          transactionHash: '0xchangetx1',
          blockNumber: 1005,
          index: 0,
          recordIdHash: '0xRecordHash1',
          targetIdHash,
          oldRole: 'viewer',
          newRole: 'sharer',
        }),
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xchangetx1', 0);
    expect(cached).toMatchObject({
      eventName: 'RoleChanged',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: 'records/rec-1/permissionHistory/event-1',
    });
  });

  it('classifies as matched against a trustee level-sync "downgraded" change identically — producer-agnostic', async () => {
    await admin
      .firestore()
      .collection('records')
      .doc('rec-1')
      .collection('permissionHistory')
      .doc('event-1')
      .set({
        recordIdHash: '0xRecordHash1',
        changedBy: 'trustee-uid',
        changedByIdHash: ethers.id('trustee-uid'),
        changes: [{ action: 'downgraded', userId: targetUserId, previousRole: 'administrator', newRole: 'viewer' }],
        context: 'trustee_grant',
      });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      roleChanged: () => [
        fakeRoleChangedEventLog({
          transactionHash: '0xchangetx1',
          blockNumber: 1005,
          index: 0,
          recordIdHash: '0xRecordHash1',
          targetIdHash,
          oldRole: 'administrator',
          newRole: 'viewer',
        }),
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xchangetx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'matched' });
  });

  it('does not match a "granted"/"revoked" changes[] entry even if the role values happen to line up — those belong to RoleGranted/RoleRevoked, not RoleChanged', async () => {
    await admin
      .firestore()
      .collection('records')
      .doc('rec-1')
      .collection('permissionHistory')
      .doc('event-1')
      .set({
        recordIdHash: '0xRecordHash1',
        changes: [{ action: 'granted', userId: targetUserId, previousRole: null, newRole: 'sharer' }],
      });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      roleChanged: () => [
        fakeRoleChangedEventLog({
          transactionHash: '0xchangetx1',
          blockNumber: 1005,
          index: 0,
          recordIdHash: '0xRecordHash1',
          targetIdHash,
          oldRole: 'viewer',
          newRole: 'sharer',
        }),
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xchangetx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: expect.not.stringMatching('matched') });
  });

  it('classifies as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some other real wallet', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      roleChanged: () => [
        fakeRoleChangedEventLog({ transactionHash: '0xchangetx1', blockNumber: 1005, index: 0, recordIdHash: '0xRecordHash1', targetIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xchangetx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xchangetx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });
});

describe('runChainEventIndexerCycle — MemberStatusChanged (Slice 4)', () => {
  it('classifies as matched when the target user\'s onChainStatus history already has this status', async () => {
    await admin
      .firestore()
      .collection('users')
      .doc('user-1')
      .set({
        onChainIdentity: {
          userIdHash: '0xHash1',
          onChainStatus: [{ status: 'Verified', statusUpdatedAt: new Date() }],
        },
      });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      memberStatusChanged: () => [
        fakeStatusChangedEventLog({ transactionHash: '0xstatustx1', blockNumber: 1005, index: 0, newStatus: 3 }), // Verified
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xstatustx1', 0);
    expect(cached).toMatchObject({
      eventName: 'MemberStatusChanged',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: 'users/user-1',
    });
  });

  it('does not match when the user exists but their history never recorded this status', async () => {
    await admin
      .firestore()
      .collection('users')
      .doc('user-1')
      .set({ onChainIdentity: { userIdHash: '0xHash1', onChainStatus: [{ status: 'Active' }] } });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      memberStatusChanged: () => [
        fakeStatusChangedEventLog({ transactionHash: '0xstatustx1', blockNumber: 1005, index: 0, newStatus: 4 }), // VerifiedProvider — never recorded
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xstatustx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xstatustx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });

  // Reproduces e2e cleanup directly: staging.ts's deactivateOnChain calls setUserStatus(...,
  // Inactive), which emits exactly this event — and then deletes the Firestore user doc.
  it('classifies as deactivated_tracked when unmatched and the identity is Inactive on-chain', async () => {
    mockContract.userStatus.mockResolvedValue(MEMBER_STATUS_INACTIVE);
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      memberStatusChanged: () => [
        fakeStatusChangedEventLog({ transactionHash: '0xstatustx1', blockNumber: 1005, index: 0, newStatus: 1 }), // Inactive
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xstatustx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'deactivated_tracked' });
  });

  it('classifies as admin_untracked when unmatched, Active on-chain (not deactivated), and signed by the admin wallet', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      memberStatusChanged: () => [
        fakeStatusChangedEventLog({ transactionHash: '0xstatustx1', blockNumber: 1005, index: 0, newStatus: 2 }), // Active — matches beforeEach's default mock, not Inactive
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xstatustx1': ADMIN_ADDRESS } })
    );

    const cached = await getCachedEvent('0xstatustx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'admin_untracked' });
  });
});

describe('runChainEventIndexerCycle — OwnershipVoluntarilyLeft (Slice 4)', () => {
  const leavingUserId = 'user-owner';
  const userIdHash = ethers.id(leavingUserId);

  it('classifies as matched against a permissionHistory doc recording a self-authored full owner removal', async () => {
    await admin
      .firestore()
      .collection('records')
      .doc('rec-1')
      .collection('permissionHistory')
      .doc('event-1')
      .set({
        recordIdHash: '0xRecordHash1',
        changedBy: leavingUserId,
        changedByIdHash: userIdHash,
        changes: [{ action: 'revoked', userId: leavingUserId, previousRole: 'owner', newRole: null }],
      });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      ownershipVoluntarilyLeft: () => [
        fakeOwnershipLeftEventLog({ transactionHash: '0xownertx1', blockNumber: 1005, index: 0, recordIdHash: '0xRecordHash1', userIdHash }),
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xownertx1', 0);
    expect(cached).toMatchObject({
      eventName: 'OwnershipVoluntarilyLeft',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: 'records/rec-1/permissionHistory/event-1',
    });
  });

  it('does not match a same-shaped revoked/owner/null entry authored by someone else — only a self-authored removal counts', async () => {
    await admin
      .firestore()
      .collection('records')
      .doc('rec-1')
      .collection('permissionHistory')
      .doc('event-1')
      .set({
        recordIdHash: '0xRecordHash1',
        changedBy: 'some-other-admin',
        changedByIdHash: ethers.id('some-other-admin'),
        changes: [{ action: 'revoked', userId: leavingUserId, previousRole: 'owner', newRole: null }],
      });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      ownershipVoluntarilyLeft: () => [
        fakeOwnershipLeftEventLog({ transactionHash: '0xownertx1', blockNumber: 1005, index: 0, recordIdHash: '0xRecordHash1', userIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xownertx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xownertx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });

  it('classifies as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some other real wallet', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      ownershipVoluntarilyLeft: () => [
        fakeOwnershipLeftEventLog({ transactionHash: '0xownertx1', blockNumber: 1005, index: 0, recordIdHash: '0xRecordHash1', userIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xownertx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xownertx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });
});

describe('runChainEventIndexerCycle — TrusteeProposed/TrusteeAccepted (Slice 5)', () => {
  const trustorId = 'user-trustor';
  const trusteeId = 'user-trustee';
  const trustorIdHash = ethers.id(trustorId);
  const trusteeIdHash = ethers.id(trusteeId);

  it('classifies TrusteeProposed as matched against a trusteeHistory "propose" entry with the same level', async () => {
    await admin
      .firestore()
      .collection('trusteeRelationships')
      .doc('rel-1')
      .collection('trusteeHistory')
      .doc('event-1')
      .set({ trustorIdHash, trusteeIdHash, action: 'propose', trustLevel: 'custodian' });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      trusteeProposed: () => [
        fakeTrusteeProposedAcceptedEventLog({ transactionHash: '0xtptx1', blockNumber: 1005, index: 0, trustorIdHash, trusteeIdHash, level: 1 }),
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xtptx1', 0);
    expect(cached).toMatchObject({
      eventName: 'TrusteeProposed',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: 'trusteeRelationships/rel-1/trusteeHistory/event-1',
    });
  });

  it('classifies TrusteeAccepted as matched against a trusteeHistory "accept" entry — level not required to be present', async () => {
    await admin
      .firestore()
      .collection('trusteeRelationships')
      .doc('rel-1')
      .collection('trusteeHistory')
      .doc('event-1')
      .set({ trustorIdHash, trusteeIdHash, action: 'accept' });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      trusteeAccepted: () => [
        fakeTrusteeProposedAcceptedEventLog({ transactionHash: '0xtatx1', blockNumber: 1005, index: 0, trustorIdHash, trusteeIdHash }),
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xtatx1', 0);
    expect(cached).toMatchObject({ eventName: 'TrusteeAccepted', reconciliationStatus: 'matched' });
  });

  // bootstrapDependentTrustee (onlyAdmin) emits both TrusteeProposed and TrusteeAccepted, so
  // unlike TrusteeDeclined/Revoked/LevelUpdated, admin_untracked is genuinely reachable here.
  it('classifies TrusteeProposed as admin_untracked when unmatched, no sync-queue entry, and signed by the admin wallet', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      trusteeProposed: () => [
        fakeTrusteeProposedAcceptedEventLog({ transactionHash: '0xtptx1', blockNumber: 1005, index: 0, trustorIdHash, trusteeIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xtptx1': ADMIN_ADDRESS } })
    );

    const cached = await getCachedEvent('0xtptx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'admin_untracked' });
  });

  it('classifies TrusteeAccepted as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some other real wallet', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      trusteeAccepted: () => [
        fakeTrusteeProposedAcceptedEventLog({ transactionHash: '0xtatx1', blockNumber: 1005, index: 0, trustorIdHash, trusteeIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xtatx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xtatx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });
});

describe('runChainEventIndexerCycle — TrusteeDeclined (Slice 5)', () => {
  const trustorId = 'user-trustor';
  const trusteeId = 'user-trustee';
  const trustorIdHash = ethers.id(trustorId);
  const trusteeIdHash = ethers.id(trusteeId);

  it('classifies as matched against a trusteeHistory "decline" entry', async () => {
    await admin
      .firestore()
      .collection('trusteeRelationships')
      .doc('rel-1')
      .collection('trusteeHistory')
      .doc('event-1')
      .set({ trustorIdHash, trusteeIdHash, action: 'decline' });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      trusteeDeclined: () => [
        fakeTrusteeDeclinedEventLog({ transactionHash: '0xtdtx1', blockNumber: 1005, index: 0, trustorIdHash, trusteeIdHash }),
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xtdtx1', 0);
    expect(cached).toMatchObject({
      eventName: 'TrusteeDeclined',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: 'trusteeRelationships/rel-1/trusteeHistory/event-1',
    });
  });

  it('classifies as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some other real wallet', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      trusteeDeclined: () => [
        fakeTrusteeDeclinedEventLog({ transactionHash: '0xtdtx1', blockNumber: 1005, index: 0, trustorIdHash, trusteeIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xtdtx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xtdtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });
});

describe('runChainEventIndexerCycle — TrusteeRevoked (Slice 5)', () => {
  const trustorId = 'user-trustor';
  const trusteeId = 'user-trustee';
  const trustorIdHash = ethers.id(trustorId);
  const trusteeIdHash = ethers.id(trusteeId);

  it('classifies as matched against a trusteeHistory "revoke" entry authored by the same revokedBy identity', async () => {
    await admin
      .firestore()
      .collection('trusteeRelationships')
      .doc('rel-1')
      .collection('trusteeHistory')
      .doc('event-1')
      .set({ trustorIdHash, trusteeIdHash, action: 'revoke', changedByIdHash: trustorIdHash });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      trusteeRevoked: () => [
        fakeTrusteeRevokedEventLog({ transactionHash: '0xtrtx1', blockNumber: 1005, index: 0, trustorIdHash, trusteeIdHash, revokedBy: trustorIdHash }),
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xtrtx1', 0);
    expect(cached).toMatchObject({
      eventName: 'TrusteeRevoked',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: 'trusteeRelationships/rel-1/trusteeHistory/event-1',
    });
  });

  it('does not match a "revoke" entry authored by a different identity than the event\'s revokedBy', async () => {
    await admin
      .firestore()
      .collection('trusteeRelationships')
      .doc('rel-1')
      .collection('trusteeHistory')
      .doc('event-1')
      .set({ trustorIdHash, trusteeIdHash, action: 'revoke', changedByIdHash: trusteeIdHash }); // revoked by trustee, not trustor
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      trusteeRevoked: () => [
        fakeTrusteeRevokedEventLog({ transactionHash: '0xtrtx1', blockNumber: 1005, index: 0, trustorIdHash, trusteeIdHash, revokedBy: trustorIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xtrtx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xtrtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });

  it('classifies as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some other real wallet', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      trusteeRevoked: () => [
        fakeTrusteeRevokedEventLog({ transactionHash: '0xtrtx1', blockNumber: 1005, index: 0, trustorIdHash, trusteeIdHash, revokedBy: trustorIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xtrtx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xtrtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });
});

describe('runChainEventIndexerCycle — TrusteeLevelUpdated (Slice 5)', () => {
  const trustorId = 'user-trustor';
  const trusteeId = 'user-trustee';
  const trustorIdHash = ethers.id(trustorId);
  const trusteeIdHash = ethers.id(trusteeId);

  it('classifies as matched against a trusteeHistory "level-update" entry with the same new level', async () => {
    await admin
      .firestore()
      .collection('trusteeRelationships')
      .doc('rel-1')
      .collection('trusteeHistory')
      .doc('event-1')
      .set({ trustorIdHash, trusteeIdHash, action: 'level-update', trustLevel: 'controller' });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      trusteeLevelUpdated: () => [
        fakeTrusteeLevelUpdatedEventLog({ transactionHash: '0xtltx1', blockNumber: 1005, index: 0, trustorIdHash, trusteeIdHash, oldLevel: 1, newLevel: 2 }),
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xtltx1', 0);
    expect(cached).toMatchObject({
      eventName: 'TrusteeLevelUpdated',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: 'trusteeRelationships/rel-1/trusteeHistory/event-1',
    });
  });

  it('does not match a "level-update" entry recording a different new level', async () => {
    await admin
      .firestore()
      .collection('trusteeRelationships')
      .doc('rel-1')
      .collection('trusteeHistory')
      .doc('event-1')
      .set({ trustorIdHash, trusteeIdHash, action: 'level-update', trustLevel: 'observer' });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      trusteeLevelUpdated: () => [
        fakeTrusteeLevelUpdatedEventLog({ transactionHash: '0xtltx1', blockNumber: 1005, index: 0, trustorIdHash, trusteeIdHash, oldLevel: 1, newLevel: 2 }),
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xtltx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xtltx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });

  it('classifies as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some other real wallet', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      trusteeLevelUpdated: () => [
        fakeTrusteeLevelUpdatedEventLog({ transactionHash: '0xtltx1', blockNumber: 1005, index: 0, trustorIdHash, trusteeIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xtltx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xtltx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });
});

describe('runChainEventIndexerCycle — VouchGiven/VouchRetracted (Slice 6)', () => {
  const voucherId = 'user-voucher';
  const voucheeId = 'user-vouchee';
  const voucherIdHash = ethers.id(voucherId);
  const voucheeIdHash = ethers.id(voucheeId);

  it('classifies VouchGiven as matched against a vouches doc with a "vouched" onChainHistory entry', async () => {
    await admin
      .firestore()
      .collection('vouches')
      .doc(`${voucherId}_${voucheeId}`)
      .set({ voucherIdHash, voucheeIdHash, chainStatus: 'Active', onChainHistory: [{ action: 'vouched' }] });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      vouchGiven: () => [
        fakeVouchEventLog({ eventName: 'VouchGiven', transactionHash: '0xvgtx1', blockNumber: 1005, index: 0, voucherIdHash, voucheeIdHash }),
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xvgtx1', 0);
    expect(cached).toMatchObject({
      eventName: 'VouchGiven',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: `vouches/${voucherId}_${voucheeId}`,
    });
  });

  it('classifies VouchGiven as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some other real wallet', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      vouchGiven: () => [
        fakeVouchEventLog({ eventName: 'VouchGiven', transactionHash: '0xvgtx1', blockNumber: 1005, index: 0, voucherIdHash, voucheeIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xvgtx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xvgtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });

  it('classifies VouchRetracted as matched against a vouches doc with a "retracted" onChainHistory entry', async () => {
    await admin
      .firestore()
      .collection('vouches')
      .doc(`${voucherId}_${voucheeId}`)
      .set({
        voucherIdHash,
        voucheeIdHash,
        chainStatus: 'Retracted',
        onChainHistory: [{ action: 'vouched' }, { action: 'retracted' }],
      });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      vouchRetracted: () => [
        fakeVouchEventLog({ eventName: 'VouchRetracted', transactionHash: '0xvrtx1', blockNumber: 1005, index: 0, voucherIdHash, voucheeIdHash }),
      ],
    });

    await runChainEventIndexerCycle(admin.firestore(), makeMockProvider({ currentBlock: 1030 }));

    const cached = await getCachedEvent('0xvrtx1', 0);
    expect(cached).toMatchObject({
      eventName: 'VouchRetracted',
      reconciliationStatus: 'matched',
      matchedFirestoreRef: `vouches/${voucherId}_${voucheeId}`,
    });
  });

  it('does not match VouchRetracted against a doc that was only ever vouched, never retracted', async () => {
    await admin
      .firestore()
      .collection('vouches')
      .doc(`${voucherId}_${voucheeId}`)
      .set({ voucherIdHash, voucheeIdHash, chainStatus: 'Active', onChainHistory: [{ action: 'vouched' }] });
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      vouchRetracted: () => [
        fakeVouchEventLog({ eventName: 'VouchRetracted', transactionHash: '0xvrtx1', blockNumber: 1005, index: 0, voucherIdHash, voucheeIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xvrtx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xvrtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });

  it('classifies VouchRetracted as legitimate_chain_only when unmatched, no sync-queue entry, and signed by some other real wallet', async () => {
    await seedCheckpoint(999);
    configureQueryFilter({
      memberRegistered: () => [],
      walletLinked: () => [],
      vouchRetracted: () => [
        fakeVouchEventLog({ eventName: 'VouchRetracted', transactionHash: '0xvrtx1', blockNumber: 1005, index: 0, voucherIdHash, voucheeIdHash }),
      ],
    });

    await runChainEventIndexerCycle(
      admin.firestore(),
      makeMockProvider({ currentBlock: 1030, txFromByHash: { '0xvrtx1': '0xSomeRealUserWallet' } })
    );

    const cached = await getCachedEvent('0xvrtx1', 0);
    expect(cached).toMatchObject({ reconciliationStatus: 'legitimate_chain_only' });
  });
});
