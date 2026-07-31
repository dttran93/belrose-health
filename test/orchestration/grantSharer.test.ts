// test/orchestration/grantSharer.test.ts
//
// Layer 3 (orchestration) — PermissionsService.grantSharer.
// Same setup as grantViewer.test.ts: real Firestore emulator (permissive rules),
// BlockchainRoleManagerService/SharingService/firebase-auth mocked.
//
// A plain sharer may only grant VIEWER access (via grantViewer), never SHARER access to a
// peer — minting a new sharer stays an owner/admin decision (see the "regression" test below).

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

const OWNER = 'grant-sharer-owner';
const ADMIN = 'grant-sharer-admin';
const SHARER = 'grant-sharer-sharer-caller';
const VIEWER = 'grant-sharer-viewer-caller';
const STRANGER = 'grant-sharer-stranger';
const TARGET = 'grant-sharer-target';
const RECORD_ID = 'grant-sharer-record';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

const db = connectTestFirestore('belrose-orchestration-grant-sharer');

describe('PermissionsService.grantSharer (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.clearAllMocks();
    await seedUser(db, OWNER, '0xOwnerWallet');
    await seedUser(db, ADMIN, '0xAdminWallet');
    await seedUser(db, SHARER, '0xSharerWallet');
    await seedUser(db, VIEWER, '0xViewerWallet');
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

  it('owner grants sharer access to a user with no existing role', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.grantRole).mockResolvedValue({
      txHash: '0xgrant',
      blockNumber: 1,
    });

    await PermissionsService.grantSharer(RECORD_ID, TARGET);

    expect(BlockchainRoleManagerService.grantRole).toHaveBeenCalledWith(
      RECORD_ID,
      '0xTargetWallet',
      'sharer'
    );
    expect(SharingService.prepareEncryptionAccessGrant).toHaveBeenCalledWith(
      RECORD_ID,
      TARGET,
      OWNER
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.sharers).toEqual([TARGET]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'granted', previousRole: null, newRole: 'sharer' },
    ]);
  });

  it('admin upgrades an existing viewer to sharer, removing them from viewers', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN], viewers: [TARGET] });
    setCaller(ADMIN);

    vi.mocked(BlockchainRoleManagerService.grantRole).mockResolvedValue({
      txHash: '0xupgrade',
      blockNumber: 2,
    });

    await PermissionsService.grantSharer(RECORD_ID, TARGET);

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.sharers).toEqual([TARGET]);
    expect(recordSnap.data()?.viewers).toEqual([]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'upgraded', previousRole: 'viewer', newRole: 'sharer' },
    ]);
  });

  it('denies a caller with no role on the record', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(STRANGER);

    await expect(PermissionsService.grantSharer(RECORD_ID, TARGET)).rejects.toThrow(
      'You do not have permission to share this record'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
  });

  it('denies a plain viewer', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], viewers: [VIEWER] });
    setCaller(VIEWER);

    await expect(PermissionsService.grantSharer(RECORD_ID, TARGET)).rejects.toThrow(
      'You do not have permission to share this record'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
  });

  it('denies granting to a target with no user profile', async () => {
    const nonexistentTarget = 'grant-sharer-nonexistent-target';
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(OWNER);

    await expect(PermissionsService.grantSharer(RECORD_ID, nonexistentTarget)).rejects.toThrow(
      'Target user does not exist or has no profile'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
    expect(SharingService.prepareEncryptionAccessGrant).not.toHaveBeenCalled();
  });

  it('regression: a plain sharer cannot grant sharer access to someone else', async () => {
    // Sharers may only grant viewer access (grantViewer) — minting a new peer-level
    // sharer stays an owner/admin (or subject) decision.
    await seedRecord(db, RECORD_ID, { owners: [OWNER], sharers: [SHARER] });
    setCaller(SHARER);

    await expect(PermissionsService.grantSharer(RECORD_ID, TARGET)).rejects.toThrow(
      'You do not have permission to share this record'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
  });

  it('refuses to demote an existing owner down to sharer', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER, TARGET] });
    setCaller(OWNER);

    await expect(PermissionsService.grantSharer(RECORD_ID, TARGET)).rejects.toThrow(
      'User is already an owner (higher role than sharer)'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
  });

  it('keeps the Firestore grant when the blockchain call rejects, and logs it for reconciliation', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.grantRole).mockRejectedValue(
      new Error('transaction reverted')
    );

    // Firestore-first: the chain call is best-effort and does not revert the grant that
    // already succeeded, so this resolves rather than throwing.
    await expect(PermissionsService.grantSharer(RECORD_ID, TARGET)).resolves.toBeUndefined();

    expect(SharingService.prepareEncryptionAccessGrant).toHaveBeenCalledWith(
      RECORD_ID,
      TARGET,
      OWNER
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.sharers).toEqual([TARGET]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'granted', previousRole: null, newRole: 'sharer' },
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
