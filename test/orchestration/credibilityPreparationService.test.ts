// test/orchestration/credibilityPreparationService.test.ts
//
// Layer 3 (orchestration) — CredibilityPreparationService.prepare(), the step that runs ahead
// of every verification/dispute submission. Real Firestore emulator (checkCallerRecordRole
// reads the record doc directly, and the recordHashHistory + blockchainSyncQueue writes this
// suite exists to verify go to the real emulator too) — only the blockchain-facing edges are
// mocked: BlockchainPreparationService (smart account readiness), BlockchainRoleManagerService
// (on-chain role stats), PermissionPreparationService (role initialization), and
// blockchainHealthRecordService (the actual chain calls).
//
// Added alongside subjectService.test.ts's recordHashHistory assertions — this file didn't
// exist before, so the BlockchainSyncQueueService wrapping and recordHashHistory write added to
// addRecordHash's call site (previously untracked entirely — no sync queue, no history doc, tx
// hash silently discarded) had zero automated coverage until now.

import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { doc, getDoc, getDocs, collection, setDoc } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { connectTestFirestore, clearTestFirestore, seedRecord } from './helpers/testFirestore';

const { mockCurrentUser, blockchainPrepMocks, roleManagerMocks, permissionPrepMocks, healthRecordMocks } =
  vi.hoisted(() => ({
    mockCurrentUser: { uid: null as string | null },
    blockchainPrepMocks: {
      ensureReady: vi.fn(),
    },
    roleManagerMocks: {
      getRecordRoleStats: vi.fn(),
    },
    permissionPrepMocks: {
      initializeRecordRole: vi.fn(),
    },
    healthRecordMocks: {
      doesHashExist: vi.fn(),
      addRecordHash: vi.fn(),
    },
  }));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockCurrentUser.uid ? { uid: mockCurrentUser.uid } : null }),
}));

vi.mock('@/features/BlockchainWallet/services/blockchainPreparationService', () => ({
  BlockchainPreparationService: blockchainPrepMocks,
}));

vi.mock('@/features/Permissions/services/blockchainRoleManagerService', () => ({
  BlockchainRoleManagerService: roleManagerMocks,
}));

vi.mock('@/features/Permissions/services/permissionPreparationService', () => ({
  PermissionPreparationService: permissionPrepMocks,
}));

vi.mock('@/features/CredibilityRecord/services/blockchainHealthRecordService', () => ({
  blockchainHealthRecordService: healthRecordMocks,
}));

import { CredibilityPreparationService } from '../../src/features/CredibilityRecord/services/credibilityPreparationService';

const RECORD_ID = 'credibility-prep-record';
const OWNER = 'credibility-prep-owner';
const STRANGER = 'credibility-prep-stranger';
const HASH = '0xhash';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

const NOT_INITIALIZED = { ownerCount: 0, adminCount: 0, sharerCount: 0, viewerCount: 0 };
const INITIALIZED = { ownerCount: 1, adminCount: 0, sharerCount: 0, viewerCount: 0 };

const db = connectTestFirestore('belrose-orchestration-credibility-prep');

describe('CredibilityPreparationService.prepare (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.resetAllMocks();
    blockchainPrepMocks.ensureReady.mockResolvedValue('0xSmartAccount');
    permissionPrepMocks.initializeRecordRole.mockResolvedValue({
      success: true,
      role: 'owner',
    });
    healthRecordMocks.addRecordHash.mockResolvedValue({ txHash: '0xaddhash', blockNumber: 5 });
    setCaller(null);
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  it('throws when not authenticated', async () => {
    await expect(CredibilityPreparationService.prepare(RECORD_ID, HASH)).rejects.toThrow(
      'User not authenticated'
    );
  });

  describe('record role initialization', () => {
    it('initializes the caller as owner when uninitialized and the caller owns the record', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      roleManagerMocks.getRecordRoleStats.mockResolvedValue(NOT_INITIALIZED);
      healthRecordMocks.doesHashExist.mockResolvedValue(true);
      setCaller(OWNER);

      await CredibilityPreparationService.prepare(RECORD_ID, HASH);

      expect(permissionPrepMocks.initializeRecordRole).toHaveBeenCalledWith(
        RECORD_ID,
        '0xSmartAccount',
        'owner'
      );
    });

    it('throws when uninitialized and the caller has no role on the record', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      roleManagerMocks.getRecordRoleStats.mockResolvedValue(NOT_INITIALIZED);
      setCaller(STRANGER);

      await expect(CredibilityPreparationService.prepare(RECORD_ID, HASH)).rejects.toThrow(
        'You do not have access to this record'
      );
      expect(permissionPrepMocks.initializeRecordRole).not.toHaveBeenCalled();
    });

    it('skips initialization entirely when the record already has a role on-chain', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      roleManagerMocks.getRecordRoleStats.mockResolvedValue(INITIALIZED);
      healthRecordMocks.doesHashExist.mockResolvedValue(true);
      setCaller(OWNER);

      await CredibilityPreparationService.prepare(RECORD_ID, HASH);

      expect(permissionPrepMocks.initializeRecordRole).not.toHaveBeenCalled();
    });
  });

  describe('hash anchoring', () => {
    beforeEach(async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      roleManagerMocks.getRecordRoleStats.mockResolvedValue(INITIALIZED);
      setCaller(OWNER);
    });

    it('does nothing chain-side when the hash is already on-chain', async () => {
      healthRecordMocks.doesHashExist.mockResolvedValue(true);

      const address = await CredibilityPreparationService.prepare(RECORD_ID, HASH);

      expect(address).toBe('0xSmartAccount');
      expect(healthRecordMocks.addRecordHash).not.toHaveBeenCalled();

      const hashEvents = await getDocs(collection(db, 'records', RECORD_ID, 'recordHashHistory'));
      expect(hashEvents.size).toBe(0);
      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(0);
    });

    it('anchors the hash, writes recordHashHistory, and logs a confirmed sync-queue entry when not yet on-chain', async () => {
      healthRecordMocks.doesHashExist.mockResolvedValue(false);

      const address = await CredibilityPreparationService.prepare(RECORD_ID, HASH);

      expect(address).toBe('0xSmartAccount');
      expect(healthRecordMocks.addRecordHash).toHaveBeenCalledWith(RECORD_ID, HASH);

      const hashEvents = await getDocs(collection(db, 'records', RECORD_ID, 'recordHashHistory'));
      expect(hashEvents.size).toBe(1);
      expect(hashEvents.docs[0]!.data()).toMatchObject({
        hash: HASH,
        anchoredVia: 'credibility',
        changedBy: OWNER,
      });
      expect(hashEvents.docs[0]!.data().blockchainRef).toMatchObject({
        txHash: '0xaddhash',
        blockNumber: 5,
      });

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(1);
      expect(syncDocs.docs[0]!.data()).toMatchObject({
        status: 'confirmed',
        action: 'addRecordHash',
        contract: 'HealthRecordCore',
        permissionHistoryPath: `records/${RECORD_ID}/recordHashHistory/${hashEvents.docs[0]!.id}`,
      });
    });

    it('leaves recordHashHistory unresolved and logs a failed sync-queue entry when the chain call rejects, then throws', async () => {
      healthRecordMocks.doesHashExist.mockResolvedValue(false);
      healthRecordMocks.addRecordHash.mockRejectedValue(new Error('transaction reverted'));

      await expect(CredibilityPreparationService.prepare(RECORD_ID, HASH)).rejects.toThrow(
        'Failed to prepare network: transaction reverted'
      );

      const hashEvents = await getDocs(collection(db, 'records', RECORD_ID, 'recordHashHistory'));
      expect(hashEvents.size).toBe(1);
      // No confirmed tx to cite — the audit event still exists, just without a chain reference yet.
      expect(hashEvents.docs[0]!.data().blockchainRef).toBeNull();

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(1);
      expect(syncDocs.docs[0]!.data()).toMatchObject({
        status: 'failed',
        action: 'addRecordHash',
        error: 'transaction reverted',
      });
    });
  });
});
