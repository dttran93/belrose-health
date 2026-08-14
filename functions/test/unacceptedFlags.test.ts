// functions/test/unacceptedFlags.test.ts
//
// Functions layer — flagUnacceptedUpdate / revokeUnacceptedFlag: admin-gated Cloud Functions that
// call HealthRecordCore.sol's onlyAdmin flag functions using the admin wallet, then mirror the
// result into Firestore. Mirrors memberRegistry.test.ts's mocking pattern exactly — the contract
// binding (HealthRecordCore__factory) is mocked, Firestore is real (emulator, via test/setup.ts).
// getAdminWallet() still constructs a real ethers.Wallet/JsonRpcProvider from the fake
// ADMIN_WALLET_PRIVATE_KEY set in test/setup.ts, but since the contract itself is mocked here,
// that wallet is never actually used to sign or send anything.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { clearFirestore } from './helpers/testAdmin';

const { mockContract, connectMock } = vi.hoisted(() => {
  const mockContract = {
    flagUnacceptedUpdate: vi.fn(),
    revokeUnacceptedFlag: vi.fn(),
  };
  return { mockContract, connectMock: vi.fn(() => mockContract) };
});

vi.mock('../src/_shared/typechain', () => ({
  HealthRecordCore__factory: { connect: connectMock },
}));

import { flagUnacceptedUpdate, revokeUnacceptedFlag } from '../src/handlers/unacceptedFlags';

function fakeTx(blockNumber = 100, hash = '0xtxhash') {
  return { hash, wait: vi.fn(async () => ({ blockNumber })) };
}

// platformAdmin-gated request builder — buildRequest (callableRequest.ts) doesn't carry custom
// claims, so this handler needs its own, same as recomputeUserCredibility.test.ts's.
function buildAdminRequest(data: unknown = {}): any {
  return {
    data,
    auth: { uid: 'admin-1', token: { uid: 'admin-1', platformAdmin: true } },
    rawRequest: {},
  };
}

function buildRequestAs(data: unknown, uid: string | null): any {
  return {
    data,
    auth: uid ? { uid, token: { uid } } : undefined,
    rawRequest: {},
  };
}

beforeEach(async () => {
  await clearFirestore();
  vi.clearAllMocks();
  mockContract.flagUnacceptedUpdate.mockResolvedValue(fakeTx());
  mockContract.revokeUnacceptedFlag.mockResolvedValue(fakeTx());
});

describe('flagUnacceptedUpdate — auth gate', () => {
  it('throws permission-denied when there is no authenticated caller', async () => {
    await expect(
      flagUnacceptedUpdate.run(buildRequestAs({ subjectId: 's1', recordId: 'r1', reporterId: 'p1' }, null))
    ).rejects.toThrow('Not authorized');
  });

  it('throws permission-denied for an authenticated non-admin caller', async () => {
    await expect(
      flagUnacceptedUpdate.run(
        buildRequestAs({ subjectId: 's1', recordId: 'r1', reporterId: 'p1' }, 'regular-user')
      )
    ).rejects.toThrow('Not authorized');
  });
});

describe('flagUnacceptedUpdate — validation', () => {
  it('throws invalid-argument when subjectId is missing', async () => {
    await expect(
      flagUnacceptedUpdate.run(buildAdminRequest({ recordId: 'r1', reporterId: 'p1' }))
    ).rejects.toThrow('subjectId');
  });

  it('throws invalid-argument when recordId is missing', async () => {
    await expect(
      flagUnacceptedUpdate.run(buildAdminRequest({ subjectId: 's1', reporterId: 'p1' }))
    ).rejects.toThrow('recordId');
  });

  it('throws invalid-argument when reporterId is missing', async () => {
    await expect(
      flagUnacceptedUpdate.run(buildAdminRequest({ subjectId: 's1', recordId: 'r1' }))
    ).rejects.toThrow('reporterId');
  });

  it('throws not-found when the record does not exist', async () => {
    await expect(
      flagUnacceptedUpdate.run(
        buildAdminRequest({ subjectId: 's1', recordId: 'missing-record', reporterId: 'p1' })
      )
    ).rejects.toThrow('Record not found');
  });
});

describe('flagUnacceptedUpdate — happy path', () => {
  it('calls the contract with the server-fetched recordHash and creates the Firestore mirror', async () => {
    await admin.firestore().collection('records').doc('record-1').set({ recordHash: '0xcontenthash' });

    const result: any = await flagUnacceptedUpdate.run(
      buildAdminRequest({ subjectId: 'subject-1', recordId: 'record-1', reporterId: 'provider-1' })
    );

    expect(mockContract.flagUnacceptedUpdate).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      '0xcontenthash'
    );
    expect(result.success).toBe(true);

    const flagDoc = await admin
      .firestore()
      .collection('unacceptedFlags')
      .doc('subject-1_record-1')
      .get();
    expect(flagDoc.exists).toBe(true);
    expect(flagDoc.data()).toMatchObject({
      subjectId: 'subject-1',
      recordId: 'record-1',
      recordHash: '0xcontenthash',
      reporterId: 'provider-1',
      isActive: true,
      chainStatus: 'confirmed',
    });
    expect(flagDoc.data()!.onChainHistory).toHaveLength(1);
    expect(flagDoc.data()!.onChainHistory[0].action).toBe('flagged');

    const syncDocs = await admin.firestore().collection('blockchainSyncQueue').get();
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'confirmed',
      contract: 'HealthRecordCore',
      action: 'flagUnacceptedUpdate',
      userId: 'subject-1',
      txHash: '0xtxhash',
      blockNumber: 100,
    });
  });

  it('records a failed sync-queue entry, rethrows, and creates NO Firestore doc when the chain call fails', async () => {
    await admin.firestore().collection('records').doc('record-1').set({ recordHash: '0xcontenthash' });
    mockContract.flagUnacceptedUpdate.mockRejectedValueOnce(new Error('Already flagged'));

    await expect(
      flagUnacceptedUpdate.run(
        buildAdminRequest({ subjectId: 'subject-1', recordId: 'record-1', reporterId: 'provider-1' })
      )
    ).rejects.toThrow('Already flagged');

    const flagDoc = await admin
      .firestore()
      .collection('unacceptedFlags')
      .doc('subject-1_record-1')
      .get();
    expect(flagDoc.exists).toBe(false); // mirror write only happens after chain success

    const syncDocs = await admin.firestore().collection('blockchainSyncQueue').get();
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data().status).toBe('failed');
  });
});

describe('revokeUnacceptedFlag — auth gate and validation', () => {
  it('throws permission-denied for a non-admin caller', async () => {
    await expect(
      revokeUnacceptedFlag.run(
        buildRequestAs({ subjectId: 's1', recordId: 'r1' }, 'regular-user')
      )
    ).rejects.toThrow('Not authorized');
  });

  it('throws invalid-argument when recordId is missing', async () => {
    await expect(
      revokeUnacceptedFlag.run(buildAdminRequest({ subjectId: 's1' }))
    ).rejects.toThrow('recordId');
  });
});

describe('revokeUnacceptedFlag — happy path', () => {
  it('flips isActive to false and appends a revoked onChainHistory entry', async () => {
    await admin
      .firestore()
      .collection('unacceptedFlags')
      .doc('subject-1_record-1')
      .set({
        id: 'subject-1_record-1',
        subjectId: 'subject-1',
        recordId: 'record-1',
        recordHash: '0xcontenthash',
        reporterId: 'provider-1',
        isActive: true,
        createdAt: new Date(),
        chainStatus: 'confirmed',
        onChainHistory: [{ action: 'flagged', at: new Date(), blockchainRef: {} }],
      });

    const result: any = await revokeUnacceptedFlag.run(
      buildAdminRequest({ subjectId: 'subject-1', recordId: 'record-1' })
    );

    expect(mockContract.revokeUnacceptedFlag).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String)
    );
    expect(result.success).toBe(true);

    const flagDoc = await admin
      .firestore()
      .collection('unacceptedFlags')
      .doc('subject-1_record-1')
      .get();
    expect(flagDoc.data()!.isActive).toBe(false);
    expect(flagDoc.data()!.onChainHistory).toHaveLength(2);
    expect(flagDoc.data()!.onChainHistory[1].action).toBe('revoked');
  });
});
