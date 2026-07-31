// test/orchestration/removeViewer.test.ts
//
// Layer 3 (orchestration) — PermissionsService.removeViewer. Viewer is the floor role, so
// there's no demotion variant here — it's always a full revoke. Real Firestore emulator
// (permissive rules), BlockchainRoleManagerService/SharingService/firebase-auth mocked.

import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { doc, getDoc, getDocs, collection, setDoc } from 'firebase/firestore';
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
    prepareEncryptionAccessRevoke: vi.fn(),
  },
}));

import { PermissionsService } from '../../src/features/Permissions/services/permissionsService';
import { BlockchainRoleManagerService } from '../../src/features/Permissions/services/blockchainRoleManagerService';
import { SharingService } from '@/features/Sharing/services/sharingService';

const OWNER = 'remove-viewer-owner';
const VIEWER = 'remove-viewer-target-viewer';
const STRANGER = 'remove-viewer-stranger';
const SUBJECT_VIEWER = 'remove-viewer-subject-viewer';
const RECORD_ID = 'remove-viewer-record';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

const db = connectTestFirestore('belrose-orchestration-remove-viewer');

describe('PermissionsService.removeViewer (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.clearAllMocks();
    await seedUser(db, OWNER, '0xOwnerWallet');
    await seedUser(db, VIEWER, '0xViewerWallet');
    await seedUser(db, STRANGER, '0xStrangerWallet');
    await seedUser(db, SUBJECT_VIEWER, '0xSubjectViewerWallet');
    // Encryption revokes are tested in sharingService's own suite — default to "no-op" (as if
    // there's no wrappedKey to deactivate) so these tests can focus on role/history/chain
    // behavior without needing real key material.
    vi.mocked(SharingService.prepareEncryptionAccessRevoke).mockResolvedValue(null);
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  it('owner removes a viewer', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], viewers: [VIEWER] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.revokeRole).mockResolvedValue({
      txHash: '0xrevoke',
      blockNumber: 1,
    });

    await PermissionsService.removeViewer(RECORD_ID, VIEWER);

    expect(BlockchainRoleManagerService.revokeRole).toHaveBeenCalledWith(RECORD_ID, '0xViewerWallet');
    expect(SharingService.prepareEncryptionAccessRevoke).toHaveBeenCalledWith(
      RECORD_ID,
      VIEWER,
      OWNER
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.viewers).toEqual([]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: VIEWER, action: 'revoked', previousRole: 'viewer', newRole: null },
    ]);
  });

  it('a viewer can remove themselves even with no other role', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], viewers: [VIEWER] });
    setCaller(VIEWER);

    vi.mocked(BlockchainRoleManagerService.revokeRole).mockResolvedValue({
      txHash: '0xself-revoke',
      blockNumber: 2,
    });

    await PermissionsService.removeViewer(RECORD_ID, VIEWER);

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.viewers).toEqual([]);
  });

  it('denies a stranger with no role and not removing themselves', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], viewers: [VIEWER] });
    setCaller(STRANGER);

    await expect(PermissionsService.removeViewer(RECORD_ID, VIEWER)).rejects.toThrow(
      'You do not have permission to remove viewers'
    );
    expect(BlockchainRoleManagerService.revokeRole).not.toHaveBeenCalled();
  });

  it('refuses to remove a target who is not actually a viewer', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(OWNER);

    await expect(PermissionsService.removeViewer(RECORD_ID, VIEWER)).rejects.toThrow(
      'User is not a viewer of this record'
    );
    expect(BlockchainRoleManagerService.revokeRole).not.toHaveBeenCalled();
  });

  it('lets a subject-viewer remove access they personally granted', async () => {
    // The subject caller also needs an active role (viewer) to reach this branch at all.
    await seedRecord(db, RECORD_ID, {
      owners: [OWNER],
      viewers: [VIEWER, SUBJECT_VIEWER],
      subjects: [SUBJECT_VIEWER],
    });
    await setDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${VIEWER}`), { grantedBy: SUBJECT_VIEWER });
    setCaller(SUBJECT_VIEWER);

    vi.mocked(BlockchainRoleManagerService.revokeRole).mockResolvedValue({
      txHash: '0xsubject-revoke',
      blockNumber: 3,
    });

    await PermissionsService.removeViewer(RECORD_ID, VIEWER);

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.viewers).toEqual([SUBJECT_VIEWER]);
  });

  it('denies a subject-viewer removing access they did not personally grant', async () => {
    await seedRecord(db, RECORD_ID, {
      owners: [OWNER],
      viewers: [VIEWER, SUBJECT_VIEWER],
      subjects: [SUBJECT_VIEWER],
    });
    await setDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${VIEWER}`), { grantedBy: OWNER });
    setCaller(SUBJECT_VIEWER);

    await expect(PermissionsService.removeViewer(RECORD_ID, VIEWER)).rejects.toThrow(
      'Subjects with viewer permissions can only remove permissions they granted'
    );
    expect(BlockchainRoleManagerService.revokeRole).not.toHaveBeenCalled();
  });

  it('blocks removing an active subject\'s viewer access outright — no demotion option exists below viewer', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], viewers: [VIEWER], subjects: [VIEWER] });
    setCaller(OWNER);

    await expect(PermissionsService.removeViewer(RECORD_ID, VIEWER)).rejects.toThrow(
      "Cannot remove a subject's access. Please remove them as subject first."
    );
    expect(BlockchainRoleManagerService.revokeRole).not.toHaveBeenCalled();
  });

  it('keeps the Firestore removal when the blockchain call rejects, and logs it for reconciliation', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], viewers: [VIEWER] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.revokeRole).mockRejectedValue(
      new Error('transaction reverted')
    );

    // Firestore-first: the chain call is best-effort and does not revert the removal that
    // already succeeded, so this resolves rather than throwing.
    await expect(PermissionsService.removeViewer(RECORD_ID, VIEWER)).resolves.toBeUndefined();

    expect(SharingService.prepareEncryptionAccessRevoke).toHaveBeenCalledWith(
      RECORD_ID,
      VIEWER,
      OWNER
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.viewers).toEqual([]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: VIEWER, action: 'revoked', previousRole: 'viewer', newRole: null },
    ]);
    // No confirmed tx to cite — the audit event still exists, just without a chain reference yet.
    expect(events.docs[0]!.data().blockchainRef).toBeNull();

    const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'failed',
      action: 'revokeRole',
      error: 'transaction reverted',
      permissionHistoryPath: `records/${RECORD_ID}/permissionHistory/${events.docs[0]!.id}`,
    });
  });
});
