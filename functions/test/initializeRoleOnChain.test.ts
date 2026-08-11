// functions/test/initializeRoleOnChain.test.ts
//
// Functions layer — initializeRoleOnChain: the registered-user counterpart to
// initializeRoleOnChainForRequester. The caller initializes the record's first role using their
// own already-linked wallet (as opposed to the guest-fulfillment sibling, which does it on a
// requester's behalf via the uploader). Fires as a silent prerequisite inside
// usePermissionFlow's grant handler — never something the user directly triggers — which is why
// its blockchain writes are tracked server-side (blockchainSyncQueue) rather than client-side;
// see blockchainSyncQueueService.ts's header comment for the full rule. The contract binding
// (MemberRoleManager__factory) is mocked, same as memberRegistry.test.ts; Firestore is real
// (emulator, via test/setup.ts).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { buildRequest } from './helpers/callableRequest';
import { clearFirestore } from './helpers/testAdmin';

const { mockContract, connectMock } = vi.hoisted(() => {
  const mockContract = {
    getAllRecordParticipants: vi.fn(),
    initializeRecordRole: vi.fn(),
  };
  return { mockContract, connectMock: vi.fn(() => mockContract) };
});

vi.mock('../src/_shared/typechain', () => ({
  MemberRoleManager__factory: { connect: connectMock },
}));

import { initializeRoleOnChain } from '../src/handlers/memberRegistry';

const CALLER = 'caller-1';
const RECORD_ID = 'record-1';
const WALLET_ADDRESS = '0x' + '22'.repeat(20);

function fakeTx(blockNumber = 100, hash = '0xtxhash') {
  return { hash, wait: vi.fn(async () => ({ blockNumber })) };
}

async function seedRecord(overrides: Record<string, unknown> = {}) {
  await admin
    .firestore()
    .collection('records')
    .doc(RECORD_ID)
    .set({ uploadedBy: CALLER, ...overrides });
}

async function seedCallerWithWallet(overrides: Record<string, unknown> = {}) {
  await admin
    .firestore()
    .collection('users')
    .doc(CALLER)
    .set({
      onChainIdentity: {
        linkedWallets: [{ address: WALLET_ADDRESS, isWalletActive: true }],
      },
      ...overrides,
    });
}

beforeEach(async () => {
  await clearFirestore();
  vi.clearAllMocks();

  mockContract.getAllRecordParticipants.mockResolvedValue({
    owners: [],
    admins: [],
    sharers: [],
    viewers: [],
  });
  mockContract.initializeRecordRole.mockResolvedValue(fakeTx());
});

describe('initializeRoleOnChain — guard clauses', () => {
  it('throws unauthenticated when there is no caller', async () => {
    await expect(
      initializeRoleOnChain.run(
        buildRequest({ recordId: RECORD_ID, walletAddress: WALLET_ADDRESS, role: 'owner' })
      )
    ).rejects.toThrow('authenticated');
  });

  it('throws invalid-argument when recordId is missing', async () => {
    await expect(
      initializeRoleOnChain.run(
        buildRequest({ walletAddress: WALLET_ADDRESS, role: 'owner' }, CALLER)
      )
    ).rejects.toThrow('Missing recordId or walletAddress');
  });

  it('throws invalid-argument when walletAddress is not a valid address', async () => {
    await expect(
      initializeRoleOnChain.run(
        buildRequest({ recordId: RECORD_ID, walletAddress: 'not-an-address', role: 'owner' }, CALLER)
      )
    ).rejects.toThrow('Missing recordId or walletAddress');
  });

  it('throws invalid-argument when role is neither administrator nor owner', async () => {
    await expect(
      initializeRoleOnChain.run(
        buildRequest(
          { recordId: RECORD_ID, walletAddress: WALLET_ADDRESS, role: 'viewer' },
          CALLER
        )
      )
    ).rejects.toThrow('Role must be "administrator" or "owner"');
  });

  it('throws not-found when the caller has no Firestore profile', async () => {
    await seedRecord();

    await expect(
      initializeRoleOnChain.run(
        buildRequest({ recordId: RECORD_ID, walletAddress: WALLET_ADDRESS, role: 'owner' }, CALLER)
      )
    ).rejects.toThrow('Data not found');
  });

  it('throws not-found when the record does not exist', async () => {
    await seedCallerWithWallet();

    await expect(
      initializeRoleOnChain.run(
        buildRequest({ recordId: RECORD_ID, walletAddress: WALLET_ADDRESS, role: 'owner' }, CALLER)
      )
    ).rejects.toThrow('Data not found');
  });

  it('throws permission-denied when the wallet is not linked to the caller', async () => {
    await seedRecord();
    await seedCallerWithWallet({ onChainIdentity: { linkedWallets: [] } });

    await expect(
      initializeRoleOnChain.run(
        buildRequest({ recordId: RECORD_ID, walletAddress: WALLET_ADDRESS, role: 'owner' }, CALLER)
      )
    ).rejects.toThrow('Wallet not linked or inactive');
  });

  it('throws permission-denied when the wallet is inactive', async () => {
    await seedRecord();
    await seedCallerWithWallet({
      onChainIdentity: { linkedWallets: [{ address: WALLET_ADDRESS, isWalletActive: false }] },
    });

    await expect(
      initializeRoleOnChain.run(
        buildRequest({ recordId: RECORD_ID, walletAddress: WALLET_ADDRESS, role: 'owner' }, CALLER)
      )
    ).rejects.toThrow('Wallet not linked or inactive');
  });

  it('throws permission-denied when the caller is not the record uploader', async () => {
    await seedRecord({ uploadedBy: 'someone-else' });
    await seedCallerWithWallet();

    await expect(
      initializeRoleOnChain.run(
        buildRequest({ recordId: RECORD_ID, walletAddress: WALLET_ADDRESS, role: 'owner' }, CALLER)
      )
    ).rejects.toThrow('Only the creator can initialize roles');
  });

  it('throws already-exists when the record is already initialized on chain', async () => {
    await seedRecord();
    await seedCallerWithWallet();
    mockContract.getAllRecordParticipants.mockResolvedValue({
      owners: ['0xexistingowner'],
      admins: [],
      sharers: [],
      viewers: [],
    });

    await expect(
      initializeRoleOnChain.run(
        buildRequest({ recordId: RECORD_ID, walletAddress: WALLET_ADDRESS, role: 'owner' }, CALLER)
      )
    ).rejects.toThrow('already initialized');
    expect(mockContract.initializeRecordRole).not.toHaveBeenCalled();
  });

  it('self-heals the Firestore flag when the record is already initialized on chain but not yet marked', async () => {
    await seedRecord();
    await seedCallerWithWallet();
    mockContract.getAllRecordParticipants.mockResolvedValue({
      owners: ['0xexistingowner'],
      admins: [],
      sharers: [],
      viewers: [],
    });

    await expect(
      initializeRoleOnChain.run(
        buildRequest({ recordId: RECORD_ID, walletAddress: WALLET_ADDRESS, role: 'owner' }, CALLER)
      )
    ).rejects.toThrow('already initialized');

    const snap = await admin.firestore().collection('records').doc(RECORD_ID).get();
    expect(snap.data()!.blockchainRoleInitialization.blockchainInitialized).toBe(true);
    expect(snap.data()!.blockchainRoleInitialization.syncedFromChain).toBe(true);
  });

  it('does not overwrite an already-reconciled Firestore flag', async () => {
    await seedRecord({
      blockchainRoleInitialization: { blockchainInitialized: true, syncedFromChain: false },
    });
    await seedCallerWithWallet();
    mockContract.getAllRecordParticipants.mockResolvedValue({
      owners: ['0xexistingowner'],
      admins: [],
      sharers: [],
      viewers: [],
    });

    await expect(
      initializeRoleOnChain.run(
        buildRequest({ recordId: RECORD_ID, walletAddress: WALLET_ADDRESS, role: 'owner' }, CALLER)
      )
    ).rejects.toThrow('already initialized');

    const snap = await admin.firestore().collection('records').doc(RECORD_ID).get();
    expect(snap.data()!.blockchainRoleInitialization.syncedFromChain).toBe(false);
  });
});

describe('initializeRoleOnChain — happy path', () => {
  it('initializes the role on-chain using the caller\'s active wallet and updates Firestore', async () => {
    await seedRecord();
    await seedCallerWithWallet();

    const result: any = await initializeRoleOnChain.run(
      buildRequest(
        { recordId: RECORD_ID, walletAddress: WALLET_ADDRESS, role: 'administrator' },
        CALLER
      )
    );

    expect(result.success).toBe(true);
    expect(mockContract.initializeRecordRole).toHaveBeenCalledWith(
      expect.any(String),
      WALLET_ADDRESS,
      'administrator'
    );

    const snap = await admin.firestore().collection('records').doc(RECORD_ID).get();
    const data = snap.data()!;
    expect(data.blockchainRoleInitialization.blockchainInitialized).toBe(true);
    expect(data.blockchainRoleInitialization.blockchainRef.txHash).toBe('0xtxhash');
  });

  it('prefers the stored recordIdHash over recomputing it', async () => {
    await seedRecord({ recordIdHash: '0xstoredhash' });
    await seedCallerWithWallet();

    await initializeRoleOnChain.run(
      buildRequest({ recordId: RECORD_ID, walletAddress: WALLET_ADDRESS, role: 'owner' }, CALLER)
    );

    expect(mockContract.getAllRecordParticipants).toHaveBeenCalledWith('0xstoredhash');
    expect(mockContract.initializeRecordRole).toHaveBeenCalledWith(
      '0xstoredhash',
      WALLET_ADDRESS,
      'owner'
    );
  });

  it('throws internal when the on-chain transaction is dropped (no receipt)', async () => {
    await seedRecord();
    await seedCallerWithWallet();
    mockContract.initializeRecordRole.mockResolvedValueOnce({
      hash: '0xtxhash',
      wait: vi.fn(async () => null),
    });

    await expect(
      initializeRoleOnChain.run(
        buildRequest({ recordId: RECORD_ID, walletAddress: WALLET_ADDRESS, role: 'owner' }, CALLER)
      )
    ).rejects.toThrow('dropped or replaced');
  });
});

describe('initializeRoleOnChain — blockchainSyncQueue tracking', () => {
  it('records a confirmed entry on success', async () => {
    await seedRecord();
    await seedCallerWithWallet();

    await initializeRoleOnChain.run(
      buildRequest({ recordId: RECORD_ID, walletAddress: WALLET_ADDRESS, role: 'owner' }, CALLER)
    );

    const syncDocs = await admin.firestore().collection('blockchainSyncQueue').get();
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'confirmed',
      contract: 'MemberRoleManager',
      action: 'initializeRoleOnChain',
      userId: CALLER,
      userWalletAddress: WALLET_ADDRESS,
      txHash: '0xtxhash',
      blockNumber: 100,
    });
  });

  it('records a failed entry (and still throws) when the chain call itself fails', async () => {
    await seedRecord();
    await seedCallerWithWallet();
    mockContract.initializeRecordRole.mockRejectedValueOnce(new Error('RPC timeout'));

    await expect(
      initializeRoleOnChain.run(
        buildRequest({ recordId: RECORD_ID, walletAddress: WALLET_ADDRESS, role: 'owner' }, CALLER)
      )
    ).rejects.toThrow('RPC timeout');

    const syncDocs = await admin.firestore().collection('blockchainSyncQueue').get();
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'failed',
      action: 'initializeRoleOnChain',
      userId: CALLER,
      error: 'RPC timeout',
    });
  });

  it('does not write a sync-queue entry for the already-exists self-heal case (not a write attempt)', async () => {
    await seedRecord();
    await seedCallerWithWallet();
    mockContract.getAllRecordParticipants.mockResolvedValue({
      owners: ['0xexistingowner'],
      admins: [],
      sharers: [],
      viewers: [],
    });

    await expect(
      initializeRoleOnChain.run(
        buildRequest({ recordId: RECORD_ID, walletAddress: WALLET_ADDRESS, role: 'owner' }, CALLER)
      )
    ).rejects.toThrow('already initialized');

    const syncDocs = await admin.firestore().collection('blockchainSyncQueue').get();
    expect(syncDocs.size).toBe(0);
  });
});
