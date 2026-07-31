// test/orchestration/grantRoleBatch.test.ts
//
// Layer 3 (orchestration) — PermissionsService.grantRoleBatch. This method re-implements
// its own copy of the grant permission rules in a pre-flight loop (rather than calling
// grantViewer/grantSharer/etc per record) — a second, independent copy of business logic
// that can drift from the single-record methods, which is exactly what several tests below
// found: the pre-flight was never updated to match this session's fixes to grantSharer
// (sharer/subject can no longer mint a sharer) and grantViewer (subject requires sharer+).

import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { doc, getDoc, getDocs, collection } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { connectTestFirestore, clearTestFirestore, seedUser, seedRecord } from './helpers/testFirestore';

const { mockCurrentUser } = vi.hoisted(() => ({
  mockCurrentUser: { uid: null as string | null },
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockCurrentUser.uid ? { uid: mockCurrentUser.uid } : null }),
}));

vi.mock('../../src/features/Permissions/services/blockchainRoleManagerService', () => ({
  BlockchainRoleManagerService: {
    grantRole: vi.fn(),
    changeRole: vi.fn(),
    revokeRole: vi.fn(),
    voluntarilyLeaveOwnership: vi.fn(),
    grantRoleBatch: vi.fn(),
    changeRoleBatch: vi.fn(),
    revokeRoleBatch: vi.fn(),
  },
}));

vi.mock('@/features/Sharing/services/sharingService', () => ({
  SharingService: {
    grantEncryptionAccess: vi.fn(),
    revokeEncryptionAccess: vi.fn(),
    prepareEncryptionAccessGrant: vi.fn(),
  },
}));

import { PermissionsService } from '../../src/features/Permissions/services/permissionsService';
import { BlockchainRoleManagerService } from '../../src/features/Permissions/services/blockchainRoleManagerService';
import { SharingService } from '@/features/Sharing/services/sharingService';

const OWNER = 'batch-grant-owner';
const SHARER = 'batch-grant-sharer-caller';
const SUBJECT_ONLY = 'batch-grant-subject-only';
const TARGET = 'batch-grant-target';
const RECORD_A = 'batch-grant-record-a';
const RECORD_B = 'batch-grant-record-b';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

const db = connectTestFirestore('belrose-orchestration-grant-role-batch');

describe('PermissionsService.grantRoleBatch (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    // resetAllMocks (not clearAllMocks) — clearAllMocks only wipes call history, not a
    // configured mockResolvedValue/mockRejectedValue, which let one test's rejected-value
    // setup leak into a later test that never expected the blockchain call to be reached
    // at all. A benign default below means an unexpected call surfaces as "was called with
    // the wrong args" instead of an opaque leaked rejection.
    vi.resetAllMocks();
    vi.mocked(BlockchainRoleManagerService.grantRoleBatch).mockResolvedValue({
      txHash: '0xdefault',
      blockNumber: 0,
    });
    // Encryption grants are tested in sharingService's own suite — default to "no-op" (as if
    // the receiver already has active access) so these tests can focus on role/history/chain
    // behavior without needing real key material.
    vi.mocked(SharingService.prepareEncryptionAccessGrant).mockResolvedValue(null);
    await seedUser(db, OWNER, '0xOwnerWallet');
    await seedUser(db, SHARER, '0xSharerCallerWallet');
    await seedUser(db, SUBJECT_ONLY, '0xSubjectOnlyWallet');
    await seedUser(db, TARGET, '0xTargetWallet');
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  it('grants across two records in one blockchain call, mixing a fresh grant and an upgrade', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER] });
    await seedRecord(db, RECORD_B, { owners: [OWNER], viewers: [TARGET] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.grantRoleBatch).mockResolvedValue({
      txHash: '0xbatch',
      blockNumber: 1,
    });

    const result = await PermissionsService.grantRoleBatch(
      [RECORD_A, RECORD_B],
      TARGET,
      ['sharer', 'sharer']
    );

    expect(result.sort()).toEqual([RECORD_A, RECORD_B].sort());
    expect(BlockchainRoleManagerService.grantRoleBatch).toHaveBeenCalledWith(
      expect.arrayContaining([RECORD_A, RECORD_B]),
      '0xTargetWallet',
      ['sharer', 'sharer']
    );

    const recordA = await getDoc(doc(db, 'records', RECORD_A));
    expect(recordA.data()?.sharers).toEqual([TARGET]);
    const recordB = await getDoc(doc(db, 'records', RECORD_B));
    expect(recordB.data()?.sharers).toEqual([TARGET]);
    expect(recordB.data()?.viewers).toEqual([]);

    const eventsA = await getDocs(collection(db, 'records', RECORD_A, 'permissionHistory'));
    expect(eventsA.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'granted', previousRole: null, newRole: 'sharer' },
    ]);
    const eventsB = await getDocs(collection(db, 'records', RECORD_B, 'permissionHistory'));
    expect(eventsB.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'upgraded', previousRole: 'viewer', newRole: 'sharer' },
    ]);
  });

  it('skips a record the caller has no permission on, but still processes the eligible one', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER] });
    await seedRecord(db, RECORD_B, { owners: ['someone-else'] }); // caller has no role here
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.grantRoleBatch).mockResolvedValue({
      txHash: '0xpartial',
      blockNumber: 2,
    });

    const result = await PermissionsService.grantRoleBatch([RECORD_A, RECORD_B], TARGET, [
      'viewer',
      'viewer',
    ]);

    expect(result).toEqual([RECORD_A]);
    expect(BlockchainRoleManagerService.grantRoleBatch).toHaveBeenCalledWith(
      [RECORD_A],
      '0xTargetWallet',
      ['viewer']
    );

    const recordB = await getDoc(doc(db, 'records', RECORD_B));
    expect(recordB.data()?.viewers).toEqual([]);
  });

  it('skips a record where the target already has the requested role', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER], sharers: [TARGET] });
    setCaller(OWNER);

    const result = await PermissionsService.grantRoleBatch([RECORD_A], TARGET, ['sharer']);

    expect(result).toEqual([]);
    expect(BlockchainRoleManagerService.grantRoleBatch).not.toHaveBeenCalled();
  });

  it('skips a record where the target is already an owner', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER, TARGET] });
    setCaller(OWNER);

    const result = await PermissionsService.grantRoleBatch([RECORD_A], TARGET, ['sharer']);

    expect(result).toEqual([]);
    expect(BlockchainRoleManagerService.grantRoleBatch).not.toHaveBeenCalled();
  });

  it('skips demoting an administrator to sharer/viewer via batch', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER], administrators: [TARGET] });
    setCaller(OWNER);

    const result = await PermissionsService.grantRoleBatch([RECORD_A], TARGET, ['viewer']);

    expect(result).toEqual([]);
    expect(BlockchainRoleManagerService.grantRoleBatch).not.toHaveBeenCalled();
  });

  it('skips demoting a sharer to viewer via batch', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER], sharers: [TARGET] });
    setCaller(OWNER);

    const result = await PermissionsService.grantRoleBatch([RECORD_A], TARGET, ['viewer']);

    expect(result).toEqual([]);
    expect(BlockchainRoleManagerService.grantRoleBatch).not.toHaveBeenCalled();
  });

  it('skips a record that does not exist', async () => {
    setCaller(OWNER);

    const result = await PermissionsService.grantRoleBatch(['nonexistent-record'], TARGET, [
      'viewer',
    ]);

    expect(result).toEqual([]);
    expect(BlockchainRoleManagerService.grantRoleBatch).not.toHaveBeenCalled();
  });

  it('throws immediately on array length mismatch, before any Firestore reads', async () => {
    setCaller(OWNER);

    await expect(
      PermissionsService.grantRoleBatch([RECORD_A, RECORD_B], TARGET, ['viewer'])
    ).rejects.toThrow('Array length mismatch');
    expect(BlockchainRoleManagerService.grantRoleBatch).not.toHaveBeenCalled();
  });

  it('throws immediately when the target has no user profile', async () => {
    setCaller(OWNER);

    await expect(
      PermissionsService.grantRoleBatch([RECORD_A], 'batch-grant-nonexistent-target', ['viewer'])
    ).rejects.toThrow('Target user does not exist or has no profile');
    expect(BlockchainRoleManagerService.grantRoleBatch).not.toHaveBeenCalled();
  });

  it('returns an empty array and never calls the blockchain when every record is ineligible', async () => {
    await seedRecord(db, RECORD_A, { owners: ['someone-else'] });
    setCaller(OWNER);

    const result = await PermissionsService.grantRoleBatch([RECORD_A], TARGET, ['viewer']);

    expect(result).toEqual([]);
    expect(BlockchainRoleManagerService.grantRoleBatch).not.toHaveBeenCalled();
  });

  it('keeps the Firestore grants when the blockchain batch call rejects, and logs it for reconciliation', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.grantRoleBatch).mockRejectedValue(
      new Error('transaction reverted')
    );

    // Firestore-first: the chain call is best-effort and does not revert the grant that
    // already succeeded, so this resolves with the record still counted as processed.
    const result = await PermissionsService.grantRoleBatch([RECORD_A], TARGET, ['viewer']);
    expect(result).toEqual([RECORD_A]);

    const recordA = await getDoc(doc(db, 'records', RECORD_A));
    expect(recordA.data()?.viewers).toEqual([TARGET]);

    const events = await getDocs(collection(db, 'records', RECORD_A, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'granted', previousRole: null, newRole: 'viewer' },
    ]);
    // No confirmed tx to cite — the audit event still exists, just without a chain reference yet.
    expect(events.docs[0]!.data().blockchainRef).toBeNull();

    const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'failed',
      action: 'grantRoleBatch',
      error: 'transaction reverted',
      permissionHistoryPath: [`records/${RECORD_A}/permissionHistory/${events.docs[0]!.id}`],
    });
  });

  // ── Suspected bugs: the pre-flight's own copy of the permission rules has drifted from
  // the (fixed) single-record methods it's supposed to mirror. ──────────────────────────

  it('regression check: a plain sharer should NOT be able to batch-grant sharer access (mirrors grantSharer)', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER], sharers: [SHARER] });
    setCaller(SHARER);

    const result = await PermissionsService.grantRoleBatch([RECORD_A], TARGET, ['sharer']);

    expect(result).toEqual([]);
    expect(BlockchainRoleManagerService.grantRoleBatch).not.toHaveBeenCalled();
  });

  it('regression check: a subject-only caller should NOT be able to batch-grant viewer access (mirrors grantViewer)', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER], subjects: [SUBJECT_ONLY] });
    setCaller(SUBJECT_ONLY);

    const result = await PermissionsService.grantRoleBatch([RECORD_A], TARGET, ['viewer']);

    expect(result).toEqual([]);
    expect(BlockchainRoleManagerService.grantRoleBatch).not.toHaveBeenCalled();
  });

  it('regression check: batch-granting viewer to an active subject with no existing role should be blocked (mirrors grantViewer)', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER], subjects: [TARGET] });
    setCaller(OWNER);

    const result = await PermissionsService.grantRoleBatch([RECORD_A], TARGET, ['viewer']);

    expect(result).toEqual([]);
    expect(BlockchainRoleManagerService.grantRoleBatch).not.toHaveBeenCalled();
  });
});
