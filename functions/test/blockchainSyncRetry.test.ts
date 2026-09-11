// functions/test/blockchainSyncRetry.test.ts
//
// Functions layer — adminRetryBlockchainSync: admin-gated retry for the 5 blockchainSyncQueue
// actions signed by the admin wallet. Mirrors memberRegistry.test.ts/unacceptedFlags.test.ts's
// mocking pattern — both contract bindings (MemberRoleManager__factory, HealthRecordCore__factory)
// are mocked, Firestore is real (emulator, via test/setup.ts).
//
// Coverage strategy: the "simulate first, classify the revert, then send-or-fail" mechanism and
// the guard rails (auth, doc state, unsupported action) are shared across all 5 actions, so
// they're tested once generically. Each action's own wiring (contract method + args + Firestore
// mirror shape) gets its own hard-success test; the already-done soft-success path is exercised
// for two representative actions with different mirror shapes (an idempotency-guarded array
// append, and a plain object overwrite) rather than repeated identically five times.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { AbiCoder } from 'ethers';
import { clearFirestore } from './helpers/testAdmin';

const {
  mockMemberRoleManager,
  mockHealthRecordCore,
  mrmConnectMock,
  hrcConnectMock,
} = vi.hoisted(() => {
  function mockMethod() {
    return Object.assign(vi.fn(), { staticCall: vi.fn() });
  }
  const mockMemberRoleManager = {
    addMember: mockMethod(),
    setUserStatus: mockMethod(),
    initializeRecordRole: mockMethod(),
  };
  const mockHealthRecordCore = {
    flagUnacceptedUpdate: mockMethod(),
    revokeUnacceptedFlag: mockMethod(),
  };
  return {
    mockMemberRoleManager,
    mockHealthRecordCore,
    mrmConnectMock: vi.fn(() => mockMemberRoleManager),
    hrcConnectMock: vi.fn(() => mockHealthRecordCore),
  };
});

vi.mock('../src/_shared/typechain', () => ({
  MemberRoleManager__factory: { connect: mrmConnectMock },
  HealthRecordCore__factory: { connect: hrcConnectMock },
}));

import { adminRetryBlockchainSync } from '../src/handlers/blockchainSyncRetry';

function fakeTx(blockNumber = 100, hash = '0xtxhash') {
  return { hash, wait: vi.fn(async () => ({ blockNumber })) };
}

// Builds a realistic `Error(string)` ABI revert payload (selector 0x08c379a0 + ABI-encoded
// string) embedded in an error message, matching what decodeRevertReason expects to find in a
// real ethers/viem error dump.
function revertError(reason: string): Error {
  const encoded = AbiCoder.defaultAbiCoder().encode(['string'], [reason]);
  const hex = '0x08c379a0' + encoded.slice(2);
  return new Error(`execution reverted (reason="${reason}", data="${hex}")`);
}

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

async function seedQueueEntry(docId: string, overrides: Record<string, unknown>) {
  await admin
    .firestore()
    .collection('blockchainSyncQueue')
    .doc(docId)
    .set({
      status: 'failed',
      retryCount: 0,
      createdAt: new Date(),
      lastAttemptAt: new Date(),
      ...overrides,
    });
}

beforeEach(async () => {
  await clearFirestore();
  vi.clearAllMocks();
});

describe('adminRetryBlockchainSync — auth gate', () => {
  it('throws permission-denied when there is no authenticated caller', async () => {
    await expect(
      adminRetryBlockchainSync.run(buildRequestAs({ docId: 'sync-1' }, null))
    ).rejects.toThrow('Not authorized');
  });

  it('throws permission-denied for an authenticated non-admin caller', async () => {
    await expect(
      adminRetryBlockchainSync.run(buildRequestAs({ docId: 'sync-1' }, 'regular-user'))
    ).rejects.toThrow('Not authorized');
  });
});

describe('adminRetryBlockchainSync — guard rails', () => {
  it('throws invalid-argument when docId is missing', async () => {
    await expect(adminRetryBlockchainSync.run(buildAdminRequest({}))).rejects.toThrow('docId');
  });

  it('throws not-found for a nonexistent entry', async () => {
    await expect(
      adminRetryBlockchainSync.run(buildAdminRequest({ docId: 'missing' }))
    ).rejects.toThrow('not found');
  });

  it('throws failed-precondition and leaves the doc untouched for an already-confirmed entry', async () => {
    await seedQueueEntry('sync-1', {
      contract: 'MemberRoleManager',
      action: 'addMember',
      userId: 'user-1',
      status: 'confirmed',
      context: { type: 'memberRegistry' },
    });

    await expect(
      adminRetryBlockchainSync.run(buildAdminRequest({ docId: 'sync-1' }))
    ).rejects.toThrow('already confirmed');

    const snap = await admin.firestore().collection('blockchainSyncQueue').doc('sync-1').get();
    expect(snap.data()!.retryCount).toBe(0);
    expect(mockMemberRoleManager.addMember).not.toHaveBeenCalled();
  });

  it('throws invalid-argument and leaves the doc untouched for an unsupported action (e.g. addMemberBatch)', async () => {
    await seedQueueEntry('sync-1', {
      contract: 'MemberRoleManager',
      action: 'addMemberBatch',
      userId: 'user-1',
      status: 'failed',
      context: { type: 'memberRegistry' },
    });

    await expect(
      adminRetryBlockchainSync.run(buildAdminRequest({ docId: 'sync-1' }))
    ).rejects.toThrow('not a supported retry operation');

    const snap = await admin.firestore().collection('blockchainSyncQueue').doc('sync-1').get();
    expect(snap.data()!.retryCount).toBe(0);
    expect(snap.data()!.status).toBe('failed');
  });
});

describe('adminRetryBlockchainSync — addMember', () => {
  const seed = () =>
    seedQueueEntry('sync-1', {
      contract: 'MemberRoleManager',
      action: 'addMember',
      userId: 'user-1',
      userWalletAddress: '0xWallet1',
      context: { type: 'memberRegistry', newStatus: 'Active' },
    });

  it('hard success: sends the tx, marks confirmed, increments retryCount, and mirrors into linkedWallets', async () => {
    await seed();
    await admin
      .firestore()
      .collection('users')
      .doc('user-1')
      .set({ wallet: { smartAccountAddress: '0xSomeOtherAddress' } });
    mockMemberRoleManager.addMember.mockResolvedValueOnce(fakeTx());

    const result: any = await adminRetryBlockchainSync.run(buildAdminRequest({ docId: 'sync-1' }));

    expect(result.outcome).toBe('tx-confirmed');
    expect(mockMemberRoleManager.addMember.staticCall).toHaveBeenCalledWith(
      '0xWallet1',
      expect.any(String)
    );
    expect(mockMemberRoleManager.addMember).toHaveBeenCalledWith('0xWallet1', expect.any(String));

    const syncSnap = await admin.firestore().collection('blockchainSyncQueue').doc('sync-1').get();
    expect(syncSnap.data()).toMatchObject({
      status: 'confirmed',
      resolutionType: 'tx-confirmed',
      confirmedTxHash: '0xtxhash',
      retryCount: 1,
      retriedBy: 'admin-1',
    });

    const userSnap = await admin.firestore().collection('users').doc('user-1').get();
    const linkedWallets = userSnap.data()!.onChainIdentity.linkedWallets;
    expect(linkedWallets).toHaveLength(1);
    expect(linkedWallets[0]).toMatchObject({ address: '0xWallet1', type: 'eoa' });
  });

  it('already-done: does not send a real tx, marks confirmed via reconciliation, and skips a duplicate mirror entry', async () => {
    await seed();
    await admin
      .firestore()
      .collection('users')
      .doc('user-1')
      .set({
        wallet: { smartAccountAddress: '0xSomeOtherAddress' },
        onChainIdentity: {
          linkedWallets: [{ address: '0xWallet1', type: 'eoa', isWalletActive: true }],
        },
      });
    mockMemberRoleManager.addMember.staticCall.mockRejectedValueOnce(
      revertError('Wallet already registered')
    );

    const result: any = await adminRetryBlockchainSync.run(buildAdminRequest({ docId: 'sync-1' }));

    expect(result.outcome).toBe('already-done');
    expect(mockMemberRoleManager.addMember).not.toHaveBeenCalled(); // no real tx sent

    const syncSnap = await admin.firestore().collection('blockchainSyncQueue').doc('sync-1').get();
    expect(syncSnap.data()).toMatchObject({
      status: 'confirmed',
      resolutionType: 'already-done',
      retryCount: 1,
    });

    const userSnap = await admin.firestore().collection('users').doc('user-1').get();
    expect(userSnap.data()!.onChainIdentity.linkedWallets).toHaveLength(1); // not duplicated
  });

  it('genuine failure: marks failed, increments retryCount, and rethrows the decoded reason', async () => {
    await seed();
    mockMemberRoleManager.addMember.staticCall.mockRejectedValueOnce(
      revertError('Something genuinely wrong')
    );

    await expect(
      adminRetryBlockchainSync.run(buildAdminRequest({ docId: 'sync-1' }))
    ).rejects.toThrow('Something genuinely wrong');

    const syncSnap = await admin.firestore().collection('blockchainSyncQueue').doc('sync-1').get();
    expect(syncSnap.data()).toMatchObject({
      status: 'failed',
      retryCount: 1,
      lastRetryError: 'Something genuinely wrong',
    });
  });

  it('an undecodable revert is classified as a genuine failure, never soft-success', async () => {
    await seed();
    mockMemberRoleManager.addMember.staticCall.mockRejectedValueOnce(new Error('network timeout'));

    await expect(
      adminRetryBlockchainSync.run(buildAdminRequest({ docId: 'sync-1' }))
    ).rejects.toThrow('network timeout');

    const syncSnap = await admin.firestore().collection('blockchainSyncQueue').doc('sync-1').get();
    expect(syncSnap.data()!.status).toBe('failed');
  });

  it('retryCount increments across repeated retries rather than being hard-set', async () => {
    await seed();
    mockMemberRoleManager.addMember.staticCall.mockRejectedValue(
      revertError('Something genuinely wrong')
    );

    await expect(
      adminRetryBlockchainSync.run(buildAdminRequest({ docId: 'sync-1' }))
    ).rejects.toThrow();
    let snap = await admin.firestore().collection('blockchainSyncQueue').doc('sync-1').get();
    expect(snap.data()!.retryCount).toBe(1);

    // The doc is left 'failed' (not 'confirmed') after a genuine failure, so it's still eligible.
    await expect(
      adminRetryBlockchainSync.run(buildAdminRequest({ docId: 'sync-1' }))
    ).rejects.toThrow();
    snap = await admin.firestore().collection('blockchainSyncQueue').doc('sync-1').get();
    expect(snap.data()!.retryCount).toBe(2);
  });
});

describe('adminRetryBlockchainSync — setUserStatus', () => {
  it('hard success: reconstructs the numeric enum from the stored label and mirrors onChainStatus', async () => {
    await seedQueueEntry('sync-2', {
      contract: 'MemberRoleManager',
      action: 'setUserStatus',
      userId: 'user-2',
      context: { type: 'memberRegistry', newStatus: 'Verified' },
    });
    await admin.firestore().collection('users').doc('user-2').set({});
    mockMemberRoleManager.setUserStatus.mockResolvedValueOnce(fakeTx());

    const result: any = await adminRetryBlockchainSync.run(buildAdminRequest({ docId: 'sync-2' }));

    expect(result.outcome).toBe('tx-confirmed');
    expect(mockMemberRoleManager.setUserStatus).toHaveBeenCalledWith(expect.any(String), 3); // Verified = 3

    const userSnap = await admin.firestore().collection('users').doc('user-2').get();
    expect(userSnap.data()!.onChainIdentity.onChainStatus).toEqual([
      expect.objectContaining({ status: 'Verified' }),
    ]);
  });

  it('already-done: still appends a reconciliation entry to the status history (no idempotency guard, matches the original handler)', async () => {
    await seedQueueEntry('sync-2', {
      contract: 'MemberRoleManager',
      action: 'setUserStatus',
      userId: 'user-2',
      context: { type: 'memberRegistry', newStatus: 'Active' },
    });
    await admin.firestore().collection('users').doc('user-2').set({});
    mockMemberRoleManager.setUserStatus.staticCall.mockRejectedValueOnce(
      revertError('Already this status')
    );

    const result: any = await adminRetryBlockchainSync.run(buildAdminRequest({ docId: 'sync-2' }));

    expect(result.outcome).toBe('already-done');
    expect(mockMemberRoleManager.setUserStatus).not.toHaveBeenCalled();
  });

  it('throws a clear internal error for an unrecognized status label rather than passing undefined to ethers', async () => {
    await seedQueueEntry('sync-2', {
      contract: 'MemberRoleManager',
      action: 'setUserStatus',
      userId: 'user-2',
      context: { type: 'memberRegistry', newStatus: 'SomeFutureStatus' },
    });

    await expect(
      adminRetryBlockchainSync.run(buildAdminRequest({ docId: 'sync-2' }))
    ).rejects.toThrow('Unrecognized status label');
    expect(mockMemberRoleManager.setUserStatus).not.toHaveBeenCalled();
  });
});

describe('adminRetryBlockchainSync — initializeRoleOnChain', () => {
  it('hard success: calls initializeRecordRole with the stored context and overwrites blockchainRoleInitialization', async () => {
    await seedQueueEntry('sync-3', {
      contract: 'MemberRoleManager',
      action: 'initializeRoleOnChain',
      userId: 'user-3',
      userWalletAddress: '0xWallet3',
      context: {
        type: 'permission',
        targetUserId: 'user-3',
        targetWalletAddress: '0xWallet3',
        role: 'owner',
        recordId: 'record-1',
        recordIdHash: '0xRecordIdHash',
      },
    });
    await admin.firestore().collection('records').doc('record-1').set({});
    mockMemberRoleManager.initializeRecordRole.mockResolvedValueOnce(fakeTx());

    const result: any = await adminRetryBlockchainSync.run(buildAdminRequest({ docId: 'sync-3' }));

    expect(result.outcome).toBe('tx-confirmed');
    expect(mockMemberRoleManager.initializeRecordRole).toHaveBeenCalledWith(
      '0xRecordIdHash',
      '0xWallet3',
      'owner'
    );

    const recordSnap = await admin.firestore().collection('records').doc('record-1').get();
    expect(recordSnap.data()!.blockchainRoleInitialization.blockchainInitialized).toBe(true);
  });
});

describe('adminRetryBlockchainSync — flagUnacceptedUpdate', () => {
  it('hard success: calls flagUnacceptedUpdate and creates the unacceptedFlags mirror doc', async () => {
    await seedQueueEntry('sync-4', {
      contract: 'HealthRecordCore',
      action: 'flagUnacceptedUpdate',
      userId: 'subject-1',
      context: {
        type: 'flagUnacceptedUpdate',
        recordId: 'record-1',
        recordHash: '0xcontenthash',
        subjectId: 'subject-1',
        reporterId: 'reporter-1',
      },
    });
    mockHealthRecordCore.flagUnacceptedUpdate.mockResolvedValueOnce(fakeTx());

    const result: any = await adminRetryBlockchainSync.run(buildAdminRequest({ docId: 'sync-4' }));

    expect(result.outcome).toBe('tx-confirmed');
    expect(mockHealthRecordCore.flagUnacceptedUpdate).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      '0xcontenthash'
    );

    const flagSnap = await admin
      .firestore()
      .collection('unacceptedFlags')
      .doc('subject-1_record-1')
      .get();
    expect(flagSnap.exists).toBe(true);
    expect(flagSnap.data()).toMatchObject({ isActive: true, chainStatus: 'confirmed' });
  });
});

describe('adminRetryBlockchainSync — revokeUnacceptedFlag', () => {
  it('hard success: calls revokeUnacceptedFlag and flips the mirror doc to inactive', async () => {
    await seedQueueEntry('sync-5', {
      contract: 'HealthRecordCore',
      action: 'revokeUnacceptedFlag',
      userId: 'subject-1',
      context: { type: 'revokeUnacceptedFlag', recordId: 'record-1', subjectId: 'subject-1' },
    });
    await admin
      .firestore()
      .collection('unacceptedFlags')
      .doc('subject-1_record-1')
      .set({ isActive: true, onChainHistory: [{ action: 'flagged', at: new Date() }] });
    mockHealthRecordCore.revokeUnacceptedFlag.mockResolvedValueOnce(fakeTx());

    const result: any = await adminRetryBlockchainSync.run(buildAdminRequest({ docId: 'sync-5' }));

    expect(result.outcome).toBe('tx-confirmed');
    expect(mockHealthRecordCore.revokeUnacceptedFlag).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String)
    );

    const flagSnap = await admin
      .firestore()
      .collection('unacceptedFlags')
      .doc('subject-1_record-1')
      .get();
    expect(flagSnap.data()!.isActive).toBe(false);
    expect(flagSnap.data()!.onChainHistory).toHaveLength(2);
  });
});
