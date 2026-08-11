// functions/test/memberRegistry.test.ts
//
// Functions layer — registerMemberOnChainComplete / updateMemberStatus /
// deactivateWalletOnChain / reactivateWalletOnChain: the Cloud Functions that do all wallet
// generation and on-chain registration server-side using the admin wallet (the client-side
// AccountEncryptionService.registerWalletOnChain just calls registerMemberOnChainComplete).
// The contract binding (MemberRoleManager__factory) and the network-dependent smart-account-
// address computation are mocked; Firestore is real (emulator, via test/setup.ts).
// getAdminWallet() still constructs a real ethers.Wallet/JsonRpcProvider from the fake
// ADMIN_WALLET_PRIVATE_KEY set in test/setup.ts, but since the contract itself is mocked here,
// that wallet is never actually used to sign or send anything.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { buildRequest } from './helpers/callableRequest';
import { clearFirestore } from './helpers/testAdmin';

const {
  mockContract,
  connectMock,
  generateWalletMock,
  encryptPrivateKeyMock,
  computeSmartAccountAddressMock,
} = vi.hoisted(() => {
  const mockContract = {
    addMember: vi.fn(),
    addMemberBatch: vi.fn(),
    deactivateWallet: vi.fn(),
    reactivateWallet: vi.fn(),
    setUserStatus: vi.fn(),
  };
  return {
    mockContract,
    connectMock: vi.fn(() => mockContract),
    generateWalletMock: vi.fn(),
    encryptPrivateKeyMock: vi.fn(),
    computeSmartAccountAddressMock: vi.fn(),
  };
});

vi.mock('../src/_shared/typechain', () => ({
  MemberRoleManager__factory: { connect: connectMock },
}));

vi.mock('../src/services/backendWalletService', () => ({
  generateWallet: generateWalletMock,
  encryptPrivateKey: encryptPrivateKeyMock,
}));

vi.mock('../src/handlers/wallet', () => ({
  computeSmartAccountAddress: computeSmartAccountAddressMock,
}));

import {
  registerMemberOnChainComplete,
  registerMemberOnChain,
  updateMemberStatus,
  deactivateWalletOnChain,
  reactivateWalletOnChain,
} from '../src/handlers/memberRegistry';

const VALID_ADDRESS = '0x' + '11'.repeat(20);

function fakeTx(blockNumber = 100, hash = '0xtxhash') {
  return { hash, wait: vi.fn(async () => ({ blockNumber })) };
}

beforeEach(async () => {
  await clearFirestore();
  vi.clearAllMocks();

  generateWalletMock.mockReturnValue({
    address: '0xEOAADDRESS',
    privateKey: '0xprivatekey',
    mnemonic: 'test mnemonic phrase',
  });
  computeSmartAccountAddressMock.mockResolvedValue('0xSMARTACCOUNTADDRESS');
  encryptPrivateKeyMock.mockImplementation(() => ({
    encryptedKey: 'encrypted',
    iv: 'iv',
    authTag: 'authtag',
    salt: 'salt',
  }));
  mockContract.addMember.mockResolvedValue(fakeTx());
  mockContract.addMemberBatch.mockResolvedValue(fakeTx());
  mockContract.deactivateWallet.mockResolvedValue(fakeTx());
  mockContract.reactivateWallet.mockResolvedValue(fakeTx());
  mockContract.setUserStatus.mockResolvedValue(fakeTx());
});

describe('registerMemberOnChainComplete', () => {
  it('throws unauthenticated when there is no caller', async () => {
    await expect(
      registerMemberOnChainComplete.run(buildRequest({ masterKeyHex: 'hex' }))
    ).rejects.toThrow('authenticated');
  });

  it('throws invalid-argument when masterKeyHex is missing', async () => {
    await expect(registerMemberOnChainComplete.run(buildRequest({}, 'uid-1'))).rejects.toThrow(
      'masterKeyHex'
    );
  });

  it('throws not-found when the user has no Firestore doc', async () => {
    await expect(
      registerMemberOnChainComplete.run(buildRequest({ masterKeyHex: 'hex' }, 'uid-1'))
    ).rejects.toThrow('User not found');
  });

  it('throws already-exists when the user already has a wallet and is not a guest', async () => {
    await admin
      .firestore()
      .collection('users')
      .doc('uid-1')
      .set({ wallet: { address: '0xexisting' }, isGuest: false });

    await expect(
      registerMemberOnChainComplete.run(buildRequest({ masterKeyHex: 'hex' }, 'uid-1'))
    ).rejects.toThrow('already has a wallet');
  });

  it('allows a guest to register a real wallet even if a wallet-shaped field already exists', async () => {
    // Guests never actually have a `wallet` field pre-claim (see guestAccountUtils.ts) — this
    // pins the `!userData?.isGuest` clause specifically, which is what permits re-registration.
    await admin
      .firestore()
      .collection('users')
      .doc('uid-1')
      .set({ wallet: { address: '0xplaceholder' }, isGuest: true });

    const result: any = await registerMemberOnChainComplete.run(
      buildRequest({ masterKeyHex: 'hex' }, 'uid-1')
    );
    expect(result.walletAddress).toBe('0xEOAADDRESS');
  });

  it('generates a wallet, registers on-chain, and writes wallet + onChainIdentity to Firestore', async () => {
    await admin.firestore().collection('users').doc('uid-1').set({});

    const result: any = await registerMemberOnChainComplete.run(
      buildRequest({ masterKeyHex: 'hex-master-key' }, 'uid-1')
    );

    expect(mockContract.addMemberBatch).toHaveBeenCalledWith(
      ['0xEOAADDRESS', '0xSMARTACCOUNTADDRESS'],
      expect.any(String)
    );
    expect(encryptPrivateKeyMock).toHaveBeenCalledWith('0xprivatekey', 'hex-master-key');
    expect(result).toMatchObject({
      success: true,
      walletAddress: '0xEOAADDRESS',
      smartAccountAddress: '0xSMARTACCOUNTADDRESS',
    });

    const snap = await admin.firestore().collection('users').doc('uid-1').get();
    const data = snap.data()!;
    expect(data.wallet.address).toBe('0xeoaaddress');
    expect(data.wallet.smartAccountAddress).toBe('0xsmartaccountaddress');
    expect(data.onChainIdentity.linkedWallets).toHaveLength(2);
    expect(data.onChainIdentity.linkedWallets[0]).toMatchObject({
      address: '0xeoaaddress',
      type: 'eoa',
      isWalletActive: true,
    });
  });

  it('throws internal when the on-chain transaction is dropped (no receipt)', async () => {
    await admin.firestore().collection('users').doc('uid-1').set({});
    mockContract.addMemberBatch.mockResolvedValueOnce({
      hash: '0xtxhash',
      wait: vi.fn(async () => null),
    });

    await expect(
      registerMemberOnChainComplete.run(buildRequest({ masterKeyHex: 'hex' }, 'uid-1'))
    ).rejects.toThrow('dropped or replaced');
  });
});

describe('registerMemberOnChain', () => {
  it('throws unauthenticated when there is no caller', async () => {
    await expect(
      registerMemberOnChain.run(buildRequest({ walletAddress: VALID_ADDRESS }))
    ).rejects.toThrow('authenticated');
  });

  it('throws invalid-argument for a malformed wallet address', async () => {
    await expect(
      registerMemberOnChain.run(buildRequest({ walletAddress: 'not-an-address' }, 'uid-1'))
    ).rejects.toThrow('Invalid wallet address');
  });

  it('throws not-found when the caller has no Firestore doc', async () => {
    await expect(
      registerMemberOnChain.run(buildRequest({ walletAddress: VALID_ADDRESS }, 'uid-1'))
    ).rejects.toThrow('User profile not found');
  });

  it('is idempotent: returns success without a contract call when already linked in Firestore', async () => {
    await admin
      .firestore()
      .collection('users')
      .doc('uid-1')
      .set({ onChainIdentity: { linkedWallets: [{ address: VALID_ADDRESS }] } });

    const result: any = await registerMemberOnChain.run(
      buildRequest({ walletAddress: VALID_ADDRESS }, 'uid-1')
    );

    expect(result).toEqual({ success: true, message: 'Wallet already registered in Firestore' });
    expect(mockContract.addMember).not.toHaveBeenCalled();
  });

  it('registers the wallet on-chain and links it in Firestore', async () => {
    await admin.firestore().collection('users').doc('uid-1').set({});

    const result: any = await registerMemberOnChain.run(
      buildRequest({ walletAddress: VALID_ADDRESS }, 'uid-1')
    );

    expect(result.success).toBe(true);
    expect(mockContract.addMember).toHaveBeenCalledWith(VALID_ADDRESS, expect.any(String));

    const snap = await admin.firestore().collection('users').doc('uid-1').get();
    const data = snap.data()!;
    expect(data.onChainIdentity.userIdHash).toEqual(expect.any(String));
    expect(data.onChainIdentity.linkedWallets).toHaveLength(1);
    expect(data.onChainIdentity.linkedWallets[0]).toMatchObject({
      address: VALID_ADDRESS,
      type: 'eoa',
      isWalletActive: true,
    });

    const syncDocs = await admin.firestore().collection('blockchainSyncQueue').get();
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'confirmed',
      contract: 'MemberRoleManager',
      action: 'addMember',
      userId: 'uid-1',
      userWalletAddress: VALID_ADDRESS,
      txHash: '0xtxhash',
      blockNumber: 100,
    });
  });

  it('treats a wallet already registered on-chain as a graceful success, and still tracks the failed attempt', async () => {
    await admin.firestore().collection('users').doc('uid-1').set({});
    mockContract.addMember.mockRejectedValueOnce(new Error('Wallet already registered'));

    const result: any = await registerMemberOnChain.run(
      buildRequest({ walletAddress: VALID_ADDRESS }, 'uid-1')
    );

    expect(result).toEqual({ success: true, message: 'Wallet already registered on chain' });

    const syncDocs = await admin.firestore().collection('blockchainSyncQueue').get();
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'failed',
      action: 'addMember',
      error: 'Wallet already registered',
    });
  });

  it('records a failed sync-queue entry and rethrows on a genuine chain failure', async () => {
    await admin.firestore().collection('users').doc('uid-1').set({});
    mockContract.addMember.mockRejectedValueOnce(new Error('RPC timeout'));

    await expect(
      registerMemberOnChain.run(buildRequest({ walletAddress: VALID_ADDRESS }, 'uid-1'))
    ).rejects.toThrow('RPC timeout');

    const syncDocs = await admin.firestore().collection('blockchainSyncQueue').get();
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({ status: 'failed', error: 'RPC timeout' });
  });
});

describe('deactivateWalletOnChain', () => {
  it('throws unauthenticated when there is no caller', async () => {
    await expect(
      deactivateWalletOnChain.run(buildRequest({ walletAddress: VALID_ADDRESS }))
    ).rejects.toThrow('authenticated');
  });

  it('throws invalid-argument for a malformed wallet address', async () => {
    await expect(
      deactivateWalletOnChain.run(buildRequest({ walletAddress: 'not-an-address' }, 'uid-1'))
    ).rejects.toThrow('Invalid wallet address');
  });

  it('throws not-found when the caller has no Firestore doc', async () => {
    await expect(
      deactivateWalletOnChain.run(buildRequest({ walletAddress: VALID_ADDRESS }, 'uid-1'))
    ).rejects.toThrow('User profile not found');
  });

  it('throws permission-denied when the wallet is not linked to the caller', async () => {
    await admin.firestore().collection('users').doc('uid-1').set({ onChainIdentity: { linkedWallets: [] } });

    await expect(
      deactivateWalletOnChain.run(buildRequest({ walletAddress: VALID_ADDRESS }, 'uid-1'))
    ).rejects.toThrow('not linked');
  });

  it('is idempotent: returns success without a contract call when already inactive', async () => {
    await admin
      .firestore()
      .collection('users')
      .doc('uid-1')
      .set({
        onChainIdentity: {
          linkedWallets: [{ address: VALID_ADDRESS, isWalletActive: false }],
        },
      });

    const result: any = await deactivateWalletOnChain.run(
      buildRequest({ walletAddress: VALID_ADDRESS }, 'uid-1')
    );

    expect(result).toEqual({ success: true, message: 'Wallet already inactive' });
    expect(mockContract.deactivateWallet).not.toHaveBeenCalled();
  });

  it('deactivates an active wallet on-chain and marks it inactive in Firestore', async () => {
    await admin
      .firestore()
      .collection('users')
      .doc('uid-1')
      .set({
        onChainIdentity: {
          linkedWallets: [{ address: VALID_ADDRESS, isWalletActive: true }],
        },
      });

    const result: any = await deactivateWalletOnChain.run(
      buildRequest({ walletAddress: VALID_ADDRESS }, 'uid-1')
    );

    expect(result.success).toBe(true);
    expect(mockContract.deactivateWallet).toHaveBeenCalledWith(VALID_ADDRESS);

    const snap = await admin.firestore().collection('users').doc('uid-1').get();
    expect(snap.data()!.onChainIdentity.linkedWallets[0].isWalletActive).toBe(false);
  });
});

describe('reactivateWalletOnChain', () => {
  it('throws permission-denied when the wallet is not linked to the caller', async () => {
    await admin.firestore().collection('users').doc('uid-1').set({ onChainIdentity: { linkedWallets: [] } });

    await expect(
      reactivateWalletOnChain.run(buildRequest({ walletAddress: VALID_ADDRESS }, 'uid-1'))
    ).rejects.toThrow('not linked');
  });

  it('is idempotent: returns success without a contract call when already active', async () => {
    await admin
      .firestore()
      .collection('users')
      .doc('uid-1')
      .set({
        onChainIdentity: {
          linkedWallets: [{ address: VALID_ADDRESS, isWalletActive: true }],
        },
      });

    const result: any = await reactivateWalletOnChain.run(
      buildRequest({ walletAddress: VALID_ADDRESS }, 'uid-1')
    );

    expect(result).toEqual({ success: true, message: 'Wallet already active' });
    expect(mockContract.reactivateWallet).not.toHaveBeenCalled();
  });

  it('reactivates an inactive wallet on-chain and marks it active in Firestore', async () => {
    await admin
      .firestore()
      .collection('users')
      .doc('uid-1')
      .set({
        onChainIdentity: {
          linkedWallets: [{ address: VALID_ADDRESS, isWalletActive: false }],
        },
      });

    const result: any = await reactivateWalletOnChain.run(
      buildRequest({ walletAddress: VALID_ADDRESS }, 'uid-1')
    );

    expect(result.success).toBe(true);
    expect(mockContract.reactivateWallet).toHaveBeenCalledWith(VALID_ADDRESS);

    const snap = await admin.firestore().collection('users').doc('uid-1').get();
    expect(snap.data()!.onChainIdentity.linkedWallets[0].isWalletActive).toBe(true);
  });
});

describe('updateMemberStatus', () => {
  it('throws invalid-argument when userId is missing', async () => {
    await expect(updateMemberStatus.run(buildRequest({ status: 2 }))).rejects.toThrow(
      'Invalid userId or status'
    );
  });

  it('throws invalid-argument when status is outside the 1-4 enum', async () => {
    await expect(
      updateMemberStatus.run(buildRequest({ userId: 'uid-1', status: 99 }))
    ).rejects.toThrow('Invalid userId or status');
  });

  it('throws invalid-argument for status 5 — there is no on-chain "Guest" status', async () => {
    await expect(
      updateMemberStatus.run(buildRequest({ userId: 'uid-1', status: 5 }))
    ).rejects.toThrow('Invalid userId or status');
  });

  it('throws invalid-argument for status 0 (NotRegistered) — not a settable status', async () => {
    await expect(
      updateMemberStatus.run(buildRequest({ userId: 'uid-1', status: 0 }))
    ).rejects.toThrow('Invalid userId or status');
  });

  it('calls the contract and syncs the new status to Firestore', async () => {
    await admin.firestore().collection('users').doc('uid-1').set({});

    const result: any = await updateMemberStatus.run(
      buildRequest({ userId: 'uid-1', status: 3 })
    );

    expect(mockContract.setUserStatus).toHaveBeenCalledWith(expect.any(String), 3);
    expect(result.success).toBe(true);

    const snap = await admin.firestore().collection('users').doc('uid-1').get();
    const statuses = snap.data()!.onChainIdentity.onChainStatus;
    expect(statuses[statuses.length - 1].status).toBe('Verified');

    const syncDocs = await admin.firestore().collection('blockchainSyncQueue').get();
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'confirmed',
      contract: 'MemberRoleManager',
      action: 'setUserStatus',
      userId: 'uid-1',
      context: expect.objectContaining({ type: 'memberRegistry', newStatus: 'Verified' }),
      txHash: '0xtxhash',
      blockNumber: 100,
    });
  });

  it('records a failed sync-queue entry and rethrows when the chain call fails', async () => {
    await admin.firestore().collection('users').doc('uid-1').set({});
    mockContract.setUserStatus.mockRejectedValueOnce(new Error('RPC timeout'));

    await expect(
      updateMemberStatus.run(buildRequest({ userId: 'uid-1', status: 3 }))
    ).rejects.toThrow('RPC timeout');

    const syncDocs = await admin.firestore().collection('blockchainSyncQueue').get();
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({ status: 'failed', error: 'RPC timeout' });
  });
});
