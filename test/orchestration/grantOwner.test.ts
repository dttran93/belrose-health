// test/orchestration/grantOwner.test.ts
//
// Layer 3 (orchestration) — PermissionsService.grantOwner.
// Same setup as grantViewer/grantSharer/grantAdmin: real Firestore emulator (permissive
// rules), BlockchainRoleManagerService/SharingService/firebase-auth mocked.
//
// Includes regression coverage for the dead "subject caller" branch removed this session
// (same shape as grantAdmin's — a subject-only caller now gets denied cleanly at Check 2
// instead of falling through logic that could never actually pass).

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

const OWNER = 'grant-owner-owner';
const ADMIN = 'grant-owner-admin';
const SUBJECT_ONLY = 'grant-owner-subject-only';
const STRANGER = 'grant-owner-stranger';
const TARGET = 'grant-owner-target';
const RECORD_ID = 'grant-owner-record';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

const db = connectTestFirestore('belrose-orchestration-grant-owner');

describe('PermissionsService.grantOwner (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.clearAllMocks();
    await seedUser(db, OWNER, '0xOwnerWallet');
    await seedUser(db, ADMIN, '0xAdminWallet');
    await seedUser(db, SUBJECT_ONLY, '0xSubjectOnlyWallet');
    await seedUser(db, STRANGER, '0xStrangerWallet');
    await seedUser(db, TARGET, '0xTargetWallet');
    // Encryption grants are tested in sharingService's own suite — default to "no-op" (as if
    // the receiver already has active access) so these tests can focus on role/history/chain
    // behavior without needing real key material.
    vi.mocked(SharingService.prepareEncryptionAccessGrant).mockResolvedValue(null);
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  it('owner grants owner to a user with no existing role', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.grantRole).mockResolvedValue({
      txHash: '0xgrant',
      blockNumber: 1,
    });

    await PermissionsService.grantOwner(RECORD_ID, TARGET);

    expect(BlockchainRoleManagerService.grantRole).toHaveBeenCalledWith(
      RECORD_ID,
      '0xTargetWallet',
      'owner'
    );
    expect(SharingService.prepareEncryptionAccessGrant).toHaveBeenCalledWith(
      RECORD_ID,
      TARGET,
      OWNER
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.owners).toEqual([OWNER, TARGET]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'granted', previousRole: null, newRole: 'owner' },
    ]);
  });

  it('admin can bootstrap an owner when no owner exists yet', async () => {
    await seedRecord(db, RECORD_ID, { administrators: [ADMIN] });
    setCaller(ADMIN);

    vi.mocked(BlockchainRoleManagerService.grantRole).mockResolvedValue({
      txHash: '0xbootstrap',
      blockNumber: 2,
    });

    await PermissionsService.grantOwner(RECORD_ID, TARGET);

    expect(BlockchainRoleManagerService.grantRole).toHaveBeenCalledWith(
      RECORD_ID,
      '0xTargetWallet',
      'owner'
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.owners).toEqual([TARGET]);
  });

  it('denies an admin from adding an owner once an owner already exists', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN] });
    setCaller(ADMIN);

    await expect(PermissionsService.grantOwner(RECORD_ID, TARGET)).rejects.toThrow(
      'You do not have permission to add owners'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
  });

  it('denies a caller with no role on the record', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(STRANGER);

    await expect(PermissionsService.grantOwner(RECORD_ID, TARGET)).rejects.toThrow(
      'You do not have permission to add owners'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
  });

  it('denies granting to a target with no user profile', async () => {
    const nonexistentTarget = 'grant-owner-nonexistent-target';
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(OWNER);

    await expect(PermissionsService.grantOwner(RECORD_ID, nonexistentTarget)).rejects.toThrow(
      'Target user does not exist or has no profile'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
    expect(SharingService.prepareEncryptionAccessGrant).not.toHaveBeenCalled();
  });

  it('regression: denies a caller who is only a subject, with no other role, even when no owner exists', async () => {
    await seedRecord(db, RECORD_ID, { subjects: [SUBJECT_ONLY] });
    setCaller(SUBJECT_ONLY);

    await expect(PermissionsService.grantOwner(RECORD_ID, TARGET)).rejects.toThrow(
      'You do not have permission to add owners'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
  });

  it('refuses to grant owner to an existing owner', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER, TARGET] });
    setCaller(OWNER);

    await expect(PermissionsService.grantOwner(RECORD_ID, TARGET)).rejects.toThrow(
      'User is already an owner'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
  });

  it('upgrades an existing administrator to owner via changeRole, not grantRole', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [TARGET] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.changeRole).mockResolvedValue({
      txHash: '0xupgrade',
      blockNumber: 3,
    });

    await PermissionsService.grantOwner(RECORD_ID, TARGET);

    expect(BlockchainRoleManagerService.changeRole).toHaveBeenCalledWith(
      RECORD_ID,
      '0xTargetWallet',
      'owner'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.owners).toEqual([OWNER, TARGET]);
    expect(recordSnap.data()?.administrators).toEqual([]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'upgraded', previousRole: 'administrator', newRole: 'owner' },
    ]);
  });

  it('upgrades an existing sharer to owner via changeRole, not grantRole', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], sharers: [TARGET] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.changeRole).mockResolvedValue({
      txHash: '0xupgrade-sharer',
      blockNumber: 4,
    });

    await PermissionsService.grantOwner(RECORD_ID, TARGET);

    expect(BlockchainRoleManagerService.changeRole).toHaveBeenCalledWith(
      RECORD_ID,
      '0xTargetWallet',
      'owner'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.owners).toEqual([OWNER, TARGET]);
    expect(recordSnap.data()?.sharers).toEqual([]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'upgraded', previousRole: 'sharer', newRole: 'owner' },
    ]);
  });

  it('upgrades an existing viewer to owner via changeRole, not grantRole', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], viewers: [TARGET] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.changeRole).mockResolvedValue({
      txHash: '0xupgrade-viewer',
      blockNumber: 5,
    });

    await PermissionsService.grantOwner(RECORD_ID, TARGET);

    expect(BlockchainRoleManagerService.changeRole).toHaveBeenCalledWith(
      RECORD_ID,
      '0xTargetWallet',
      'owner'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.owners).toEqual([OWNER, TARGET]);
    expect(recordSnap.data()?.viewers).toEqual([]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'upgraded', previousRole: 'viewer', newRole: 'owner' },
    ]);
  });

  it('keeps the Firestore grant when the blockchain call rejects, and logs it for reconciliation', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.grantRole).mockRejectedValue(
      new Error('transaction reverted')
    );

    // Firestore-first: the chain call is best-effort and does not revert the grant that
    // already succeeded, so this resolves rather than throwing.
    await expect(PermissionsService.grantOwner(RECORD_ID, TARGET)).resolves.toBeUndefined();

    expect(SharingService.prepareEncryptionAccessGrant).toHaveBeenCalledWith(
      RECORD_ID,
      TARGET,
      OWNER
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.owners).toEqual([OWNER, TARGET]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'granted', previousRole: null, newRole: 'owner' },
    ]);
    // No confirmed tx to cite — the audit event still exists, just without a chain reference yet.
    expect(events.docs[0]!.data().blockchainRef).toBeNull();

    const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'failed',
      action: 'grantRole',
      error: 'transaction reverted',
      permissionHistoryPath: `records/${RECORD_ID}/permissionHistory/${events.docs[0]!.id}`,
    });
  });
});
