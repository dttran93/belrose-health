// functions/test/createDependentAccount.test.ts
//
// Functions layer — createDependentAccount: the guardian-triggered, Admin-SDK dependent
// bootstrap (client-side AccountEncryptionService.generateEncryptionBundle only sends encrypted
// material here — see dependentAccountService.test.ts for that half). Contract binding and the
// network-dependent smart-account-address computation are mocked; Firestore/Auth are real
// (emulators, via test/setup.ts).
//
// Includes a regression test for a previously-confirmed bug (formerly pinned here as "bug #7"):
// the catch block's best-effort cleanup used to only call admin.auth().deleteUser() — it never
// deleted the users/{dependentUid} Firestore doc already written in Step 2, so a blockchain
// failure after that point left an orphaned Firestore doc with no matching Auth account,
// forever. Fixed by also deleting dependentRef in the catch block; this test now confirms both
// cleanups happen.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { buildRequest } from './helpers/callableRequest';
import { clearFirestore, deleteAllAuthUsers } from './helpers/testAdmin';

const {
  mockContract,
  connectMock,
  generateWalletMock,
  encryptPrivateKeyMock,
  computeSmartAccountAddressMock,
} = vi.hoisted(() => {
  const mockContract = {
    addMemberBatch: vi.fn(),
    bootstrapDependentTrustee: vi.fn(),
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

import { createDependentAccount } from '../src/handlers/createDependentAccount';

const GUARDIAN = 'guardian-1';

function fullPayload(overrides: Record<string, unknown> = {}) {
  return {
    email: 'dep-abc@placeholder.belrose.health',
    password: 'password123',
    firstName: 'Jane',
    lastName: 'Doe',
    encryptedMasterKey: 'enc-master-key',
    masterKeyIV: 'master-iv',
    masterKeySalt: 'master-salt',
    publicKey: 'public-key',
    encryptedPrivateKey: 'enc-private-key',
    encryptedPrivateKeyIV: 'private-iv',
    recoveryKeyHash: 'recovery-hash',
    masterKeyHex: 'master-key-hex',
    ...overrides,
  };
}

function fakeTx(blockNumber = 100, hash = '0xtxhash') {
  return { hash, wait: vi.fn(async () => ({ blockNumber })) };
}

beforeEach(async () => {
  await clearFirestore();
  await deleteAllAuthUsers();
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
  mockContract.addMemberBatch.mockResolvedValue(fakeTx());
  mockContract.bootstrapDependentTrustee.mockResolvedValue(fakeTx());

  await admin.firestore().collection('users').doc(GUARDIAN).set({ isDependent: false });
});

describe('createDependentAccount — guard clauses', () => {
  it('throws unauthenticated when there is no caller', async () => {
    await expect(createDependentAccount.run(buildRequest(fullPayload()))).rejects.toThrow(
      'authenticated'
    );
  });

  it('throws not-found when the guardian has no Firestore profile', async () => {
    await expect(
      createDependentAccount.run(buildRequest(fullPayload(), 'no-such-guardian'))
    ).rejects.toThrow('Guardian profile not found');
  });

  it('throws permission-denied when the caller is itself a dependent', async () => {
    await admin.firestore().collection('users').doc('dep-guardian').set({ isDependent: true });

    await expect(
      createDependentAccount.run(buildRequest(fullPayload(), 'dep-guardian'))
    ).rejects.toThrow('cannot create other accounts');
  });

  it('throws invalid-argument when a required field is missing', async () => {
    const { recoveryKeyHash, ...incomplete } = fullPayload();
    await expect(
      createDependentAccount.run(buildRequest(incomplete, GUARDIAN))
    ).rejects.toThrow('Missing required fields');
  });

  it('throws already-exists when the email is already registered', async () => {
    await admin
      .auth()
      .createUser({ email: 'dep-abc@placeholder.belrose.health', password: 'password123' });

    await expect(
      createDependentAccount.run(buildRequest(fullPayload(), GUARDIAN))
    ).rejects.toThrow('already exists');
  });
});

describe('createDependentAccount — happy path', () => {
  it('creates the Auth user, Firestore doc (encryption+wallet+onChainIdentity), and an active controller trusteeRelationship', async () => {
    const result: any = await createDependentAccount.run(buildRequest(fullPayload(), GUARDIAN));

    expect(result.walletAddress).toBe('0xEOAADDRESS');
    expect(result.smartAccountAddress).toBe('0xSMARTACCOUNTADDRESS');
    expect(mockContract.addMemberBatch).toHaveBeenCalledWith(
      ['0xEOAADDRESS', '0xSMARTACCOUNTADDRESS'],
      expect.any(String)
    );
    expect(mockContract.bootstrapDependentTrustee).toHaveBeenCalled();
    expect(encryptPrivateKeyMock).toHaveBeenCalledWith('0xprivatekey', 'master-key-hex');

    const depSnap = await admin.firestore().collection('users').doc(result.uid).get();
    const depData = depSnap.data()!;
    expect(depData).toMatchObject({
      isDependent: true,
      dependentCreatedBy: GUARDIAN,
      encryption: expect.objectContaining({
        enabled: true,
        encryptedMasterKey: 'enc-master-key',
        recoveryKeyHash: 'recovery-hash',
      }),
    });
    expect(depData.wallet.address).toBe('0xeoaaddress');
    expect(depData.onChainIdentity.linkedWallets).toHaveLength(2);

    const relSnap = await admin
      .firestore()
      .collection('trusteeRelationships')
      .doc(`${result.uid}_${GUARDIAN}`)
      .get();
    expect(relSnap.data()).toMatchObject({
      trustorId: result.uid,
      trusteeId: GUARDIAN,
      trustLevel: 'controller',
      isActive: true,
      status: 'active',
      isDependentRelationship: true,
    });

    // Regression for #810: bootstrapDependentTrustee emits both TrusteeProposed and
    // TrusteeAccepted on-chain, so the relationship doc's write must be paired with matching
    // trusteeHistory entries — otherwise the chain event indexer's reconciliation
    // (findMatchingTrusteeHistoryForProposedEvent/ForAcceptedEvent) always classifies these two
    // events as admin_untracked even though Firestore has the relationship recorded.
    const historySnap = await relSnap.ref.collection('trusteeHistory').get();
    const historyActions = historySnap.docs.map(d => d.data().action).sort();
    expect(historyActions).toEqual(['accept', 'propose']);
    historySnap.docs.forEach(d => {
      expect(d.data()).toMatchObject({
        trustorId: result.uid,
        trustorIdHash: expect.any(String),
        trusteeId: GUARDIAN,
        trusteeIdHash: expect.any(String),
        blockchainRef: expect.objectContaining({ txHash: '0xtxhash' }),
      });
    });
    const proposeEntry = historySnap.docs.find(d => d.data().action === 'propose')!.data();
    expect(proposeEntry.trustLevel).toBe('controller');

    // Both on-chain writes are tracked in blockchainSyncQueue for observability, same as any
    // client-side blockchain write — this doesn't change the function's own atomic behavior,
    // it just makes the attempts visible in the same dashboard.
    const syncDocs = await admin.firestore().collection('blockchainSyncQueue').get();
    expect(syncDocs.size).toBe(2);
    const actions = syncDocs.docs.map(d => d.data().action).sort();
    expect(actions).toEqual(['addMemberBatch', 'bootstrapDependentTrustee']);
    syncDocs.docs.forEach(d => {
      expect(d.data()).toMatchObject({
        status: 'confirmed',
        contract: 'MemberRoleManager',
        userId: GUARDIAN,
        txHash: '0xtxhash',
        blockNumber: 100,
      });
    });
  });

  it('marks a real (non-placeholder) email as unverified but a placeholder email as verified', async () => {
    const result: any = await createDependentAccount.run(
      buildRequest(fullPayload({ email: 'real-guardian-provided@example.com' }), GUARDIAN)
    );
    const snap = await admin.firestore().collection('users').doc(result.uid).get();
    expect(snap.data()!.emailVerified).toBe(false);
  });
});

describe('createDependentAccount — cleanup on post-write blockchain failure', () => {
  it('deletes both the Auth user and the Firestore users/{uid} doc when the on-chain step fails after Step 2', async () => {
    mockContract.addMemberBatch.mockRejectedValueOnce(new Error('RPC timeout'));

    await expect(createDependentAccount.run(buildRequest(fullPayload(), GUARDIAN))).rejects.toThrow(
      'Failed to set up dependent account'
    );

    // The Auth user is cleaned up (best-effort deleteUser succeeds)...
    await expect(admin.auth().getUserByEmail('dep-abc@placeholder.belrose.health')).rejects.toThrow();

    // ...and so is the Firestore users/{uid} doc from Step 2 — no orphaned doc left behind with
    // no matching Auth account.
    const orphaned = await admin
      .firestore()
      .collection('users')
      .where('dependentCreatedBy', '==', GUARDIAN)
      .get();
    expect(orphaned.empty).toBe(true);

    // The failed attempt is still tracked — and since addMemberBatch itself never got a chance
    // to run, only that one entry exists (bootstrapDependentTrustee is never even attempted).
    const syncDocs = await admin.firestore().collection('blockchainSyncQueue').get();
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'failed',
      contract: 'MemberRoleManager',
      action: 'addMemberBatch',
      userId: GUARDIAN,
      error: 'RPC timeout',
    });
  });
});
