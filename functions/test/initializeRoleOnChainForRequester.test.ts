// functions/test/initializeRoleOnChainForRequester.test.ts
//
// Functions layer — initializeRoleOnChainForRequester: the guest-fulfillment counterpart to
// initializeRoleOnChain. The guest provider has no wallet of their own, so the admin wallet calls
// initializeRecordRole directly on the requester's already-linked wallet instead. The contract
// binding (MemberRoleManager__factory) is mocked, same as memberRegistry.test.ts; Firestore is
// real (emulator, via test/setup.ts).

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

import { initializeRoleOnChainForRequester } from '../src/handlers/memberRegistry';

const UPLOADER = 'uploader-1';
const REQUESTER = 'requester-1';
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
    .set({ uploadedBy: UPLOADER, ...overrides });
}

async function seedRequesterWithWallet(overrides: Record<string, unknown> = {}) {
  await admin
    .firestore()
    .collection('users')
    .doc(REQUESTER)
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

describe('initializeRoleOnChainForRequester — guard clauses', () => {
  it('throws unauthenticated when there is no caller', async () => {
    await expect(
      initializeRoleOnChainForRequester.run(
        buildRequest({ recordId: RECORD_ID, requesterUserId: REQUESTER, role: 'owner' })
      )
    ).rejects.toThrow('authenticated');
  });

  it('throws invalid-argument when recordId is missing', async () => {
    await expect(
      initializeRoleOnChainForRequester.run(
        buildRequest({ requesterUserId: REQUESTER, role: 'owner' }, UPLOADER)
      )
    ).rejects.toThrow('Missing recordId or requesterUserId');
  });

  it('throws invalid-argument when requesterUserId is missing', async () => {
    await expect(
      initializeRoleOnChainForRequester.run(
        buildRequest({ recordId: RECORD_ID, role: 'owner' }, UPLOADER)
      )
    ).rejects.toThrow('Missing recordId or requesterUserId');
  });

  it('throws invalid-argument when role is neither administrator nor owner', async () => {
    await expect(
      initializeRoleOnChainForRequester.run(
        buildRequest({ recordId: RECORD_ID, requesterUserId: REQUESTER, role: 'viewer' }, UPLOADER)
      )
    ).rejects.toThrow('Role must be administrator or owner');
  });

  it('throws not-found when the record does not exist', async () => {
    await expect(
      initializeRoleOnChainForRequester.run(
        buildRequest({ recordId: RECORD_ID, requesterUserId: REQUESTER, role: 'owner' }, UPLOADER)
      )
    ).rejects.toThrow('Record not found');
  });

  it('throws permission-denied when the caller is not the uploader', async () => {
    await seedRecord();

    await expect(
      initializeRoleOnChainForRequester.run(
        buildRequest(
          { recordId: RECORD_ID, requesterUserId: REQUESTER, role: 'owner' },
          'someone-else'
        )
      )
    ).rejects.toThrow('Only the uploader can initialize roles');
  });

  it('throws not-found when the requester has no Firestore profile', async () => {
    await seedRecord();

    await expect(
      initializeRoleOnChainForRequester.run(
        buildRequest({ recordId: RECORD_ID, requesterUserId: REQUESTER, role: 'owner' }, UPLOADER)
      )
    ).rejects.toThrow('Requester not found');
  });

  it('throws failed-precondition when the requester has no active linked wallet', async () => {
    await seedRecord();
    await seedRequesterWithWallet({
      onChainIdentity: { linkedWallets: [{ address: WALLET_ADDRESS, isWalletActive: false }] },
    });

    await expect(
      initializeRoleOnChainForRequester.run(
        buildRequest({ recordId: RECORD_ID, requesterUserId: REQUESTER, role: 'owner' }, UPLOADER)
      )
    ).rejects.toThrow('Requester has no active wallet');
  });

  it('throws already-exists when the record is already initialized on chain', async () => {
    await seedRecord();
    await seedRequesterWithWallet();
    mockContract.getAllRecordParticipants.mockResolvedValue({
      owners: ['0xexistingowner'],
      admins: [],
      sharers: [],
      viewers: [],
    });

    await expect(
      initializeRoleOnChainForRequester.run(
        buildRequest({ recordId: RECORD_ID, requesterUserId: REQUESTER, role: 'owner' }, UPLOADER)
      )
    ).rejects.toThrow('already initialized');
    expect(mockContract.initializeRecordRole).not.toHaveBeenCalled();
  });
});

describe('initializeRoleOnChainForRequester — happy path', () => {
  it('initializes the role on-chain using the requester\'s active wallet and updates Firestore', async () => {
    await seedRecord();
    await seedRequesterWithWallet();

    const result: any = await initializeRoleOnChainForRequester.run(
      buildRequest({ recordId: RECORD_ID, requesterUserId: REQUESTER, role: 'administrator' }, UPLOADER)
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
    await seedRequesterWithWallet();

    await initializeRoleOnChainForRequester.run(
      buildRequest({ recordId: RECORD_ID, requesterUserId: REQUESTER, role: 'owner' }, UPLOADER)
    );

    expect(mockContract.getAllRecordParticipants).toHaveBeenCalledWith('0xstoredhash');
    expect(mockContract.initializeRecordRole).toHaveBeenCalledWith(
      '0xstoredhash',
      WALLET_ADDRESS,
      'owner'
    );
  });

  it('picks the active wallet even when an inactive one is listed first', async () => {
    await seedRecord();
    await seedRequesterWithWallet({
      onChainIdentity: {
        linkedWallets: [
          { address: '0x' + '99'.repeat(20), isWalletActive: false },
          { address: WALLET_ADDRESS, isWalletActive: true },
        ],
      },
    });

    await initializeRoleOnChainForRequester.run(
      buildRequest({ recordId: RECORD_ID, requesterUserId: REQUESTER, role: 'owner' }, UPLOADER)
    );

    expect(mockContract.initializeRecordRole).toHaveBeenCalledWith(
      expect.any(String),
      WALLET_ADDRESS,
      'owner'
    );
  });

  it('throws internal when the on-chain transaction is dropped (no receipt)', async () => {
    await seedRecord();
    await seedRequesterWithWallet();
    mockContract.initializeRecordRole.mockResolvedValueOnce({
      hash: '0xtxhash',
      wait: vi.fn(async () => null),
    });

    await expect(
      initializeRoleOnChainForRequester.run(
        buildRequest({ recordId: RECORD_ID, requesterUserId: REQUESTER, role: 'owner' }, UPLOADER)
      )
    ).rejects.toThrow('dropped or replaced');
  });
});
