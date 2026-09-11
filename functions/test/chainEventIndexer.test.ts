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
    },
    queryFilter: vi.fn(),
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

function configureQueryFilter(handlers: {
  memberRegistered: (from: number, to: number) => unknown[];
  walletLinked: (from: number, to: number) => unknown[];
}) {
  mockContract.queryFilter.mockImplementation(async (filter: unknown, from: number, to: number) => {
    if (filter === 'MemberRegistered-filter') return handlers.memberRegistered(from, to);
    return handlers.walletLinked(from, to);
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

beforeEach(async () => {
  await clearFirestore();
  vi.clearAllMocks();
  connectMock.mockReturnValue(mockContract);
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
