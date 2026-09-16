// functions/test/healthRecordCoreEventIndexer.test.ts
//
// Functions layer — the chain event indexer's core cycle, run against HealthRecordCore's own
// config. Mirrors memberRoleManagerEventIndexer.test.ts's exact mocking pattern:
// HealthRecordCore__factory is mocked (no real chain calls), Firestore is real (emulator, via
// test/setup.ts). Vitest mocks are file-scoped, so this coexists safely with
// memberRoleManagerEventIndexer.test.ts's own mock of the same '../src/_shared/typechain' module.
//
// HRC Slice 1 covers AdminTransferred only — see healthRecordCoreEventDecoders.ts's header for
// why it's the canary slice.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { ethers } from 'ethers';
import { clearFirestore } from './helpers/testAdmin';

const { mockContract, connectMock } = vi.hoisted(() => {
  const mockContract = {
    target: '0xMockHealthRecordCoreProxy',
    filters: {
      AdminTransferred: vi.fn(() => 'AdminTransferred-filter'),
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

function configureQueryFilter(handlers: { adminTransferred?: (from: number, to: number) => unknown[] }) {
  mockContract.queryFilter.mockImplementation(async (filter: unknown, from: number, to: number) => {
    switch (filter) {
      case 'AdminTransferred-filter':
        return (handlers.adminTransferred ?? (() => []))(from, to);
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
