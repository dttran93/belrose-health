// test/orchestration/removeSharer.test.ts
//
// Layer 3 (orchestration) — PermissionsService.removeSharer. Covers both the full-revoke
// path and the demoteToViewer path. Real Firestore emulator (permissive rules),
// BlockchainRoleManagerService/SharingService/firebase-auth mocked.

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

const OWNER = 'remove-sharer-owner';
const SHARER = 'remove-sharer-target-sharer';
const GRANTING_SHARER = 'remove-sharer-granting-sharer';
const STRANGER = 'remove-sharer-stranger';
const RECORD_ID = 'remove-sharer-record';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

const db = connectTestFirestore('belrose-orchestration-remove-sharer');

describe('PermissionsService.removeSharer (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.clearAllMocks();
    await seedUser(db, OWNER, '0xOwnerWallet');
    await seedUser(db, SHARER, '0xSharerWallet');
    await seedUser(db, GRANTING_SHARER, '0xGrantingSharerWallet');
    await seedUser(db, STRANGER, '0xStrangerWallet');
    // Encryption revokes are tested in sharingService's own suite — default to "no-op" (as if
    // there's no wrappedKey to deactivate) so these tests can focus on role/history/chain
    // behavior without needing real key material.
    vi.mocked(SharingService.prepareEncryptionAccessRevoke).mockResolvedValue(null);
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  it('owner fully revokes a sharer', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], sharers: [SHARER] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.revokeRole).mockResolvedValue({
      txHash: '0xrevoke',
      blockNumber: 1,
    });

    await PermissionsService.removeSharer(RECORD_ID, SHARER);

    expect(BlockchainRoleManagerService.revokeRole).toHaveBeenCalledWith(RECORD_ID, '0xSharerWallet');
    expect(BlockchainRoleManagerService.changeRole).not.toHaveBeenCalled();
    expect(SharingService.prepareEncryptionAccessRevoke).toHaveBeenCalledWith(
      RECORD_ID,
      SHARER,
      OWNER
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.sharers).toEqual([]);
    expect(recordSnap.data()?.viewers).toEqual([]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: SHARER, action: 'revoked', previousRole: 'sharer', newRole: null },
    ]);
  });

  it('owner demotes a sharer to viewer, keeping the encryption key intact', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], sharers: [SHARER] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.changeRole).mockResolvedValue({
      txHash: '0xdemote',
      blockNumber: 2,
    });

    await PermissionsService.removeSharer(RECORD_ID, SHARER, undefined, { demoteToViewer: true });

    expect(BlockchainRoleManagerService.changeRole).toHaveBeenCalledWith(
      RECORD_ID,
      '0xSharerWallet',
      'viewer'
    );
    expect(BlockchainRoleManagerService.revokeRole).not.toHaveBeenCalled();
    // Demoting (not fully leaving) still needs the encryption key — must not be revoked.
    expect(SharingService.prepareEncryptionAccessRevoke).not.toHaveBeenCalled();

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.sharers).toEqual([]);
    expect(recordSnap.data()?.viewers).toEqual([SHARER]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: SHARER, action: 'downgraded', previousRole: 'sharer', newRole: 'viewer' },
    ]);
  });

  it('a sharer can remove themselves even with no other role', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], sharers: [SHARER] });
    setCaller(SHARER);

    vi.mocked(BlockchainRoleManagerService.revokeRole).mockResolvedValue({
      txHash: '0xself-revoke',
      blockNumber: 3,
    });

    await PermissionsService.removeSharer(RECORD_ID, SHARER);

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.sharers).toEqual([]);
  });

  it('lets a sharer remove access they personally granted', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], sharers: [SHARER, GRANTING_SHARER] });
    await setDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${SHARER}`), { grantedBy: GRANTING_SHARER });
    setCaller(GRANTING_SHARER);

    vi.mocked(BlockchainRoleManagerService.revokeRole).mockResolvedValue({
      txHash: '0xgranted-revoke',
      blockNumber: 4,
    });

    await PermissionsService.removeSharer(RECORD_ID, SHARER);

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.sharers).toEqual([GRANTING_SHARER]);
  });

  it('denies a sharer removing access they did not personally grant', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], sharers: [SHARER, GRANTING_SHARER] });
    await setDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${SHARER}`), { grantedBy: OWNER });
    setCaller(GRANTING_SHARER);

    await expect(PermissionsService.removeSharer(RECORD_ID, SHARER)).rejects.toThrow(
      'Sharers can only remove permissions they personally granted'
    );
    expect(BlockchainRoleManagerService.revokeRole).not.toHaveBeenCalled();
  });

  it('denies a stranger with no role and not removing themselves', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], sharers: [SHARER] });
    setCaller(STRANGER);

    await expect(PermissionsService.removeSharer(RECORD_ID, SHARER)).rejects.toThrow(
      'You do not have permission to remove sharers'
    );
    expect(BlockchainRoleManagerService.revokeRole).not.toHaveBeenCalled();
  });

  it('refuses to act on a target who is not actually a sharer', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(OWNER);

    await expect(PermissionsService.removeSharer(RECORD_ID, SHARER)).rejects.toThrow(
      'User is not a sharer of this record'
    );
    expect(BlockchainRoleManagerService.revokeRole).not.toHaveBeenCalled();
  });

  it('blocks demoting an active subject-sharer to viewer — sharer is already their floor', async () => {
    // Confirms this check is unconditional (unlike the removeOwner/removeAdmin bug found
    // this session) — sharer is the floor, so there's no valid demotion target at all here.
    await seedRecord(db, RECORD_ID, { owners: [OWNER], sharers: [SHARER], subjects: [SHARER] });
    setCaller(OWNER);

    await expect(
      PermissionsService.removeSharer(RECORD_ID, SHARER, undefined, { demoteToViewer: true })
    ).rejects.toThrow("Cannot remove a subject's access. Please remove them as subject first.");
    expect(BlockchainRoleManagerService.changeRole).not.toHaveBeenCalled();
  });

  it('keeps the Firestore removal when the blockchain call rejects, and logs it for reconciliation', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], sharers: [SHARER] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.revokeRole).mockRejectedValue(
      new Error('transaction reverted')
    );

    // Firestore-first: the chain call is best-effort and does not revert the removal that
    // already succeeded, so this resolves rather than throwing.
    await expect(PermissionsService.removeSharer(RECORD_ID, SHARER)).resolves.toBeUndefined();

    expect(SharingService.prepareEncryptionAccessRevoke).toHaveBeenCalledWith(
      RECORD_ID,
      SHARER,
      OWNER
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.sharers).toEqual([]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: SHARER, action: 'revoked', previousRole: 'sharer', newRole: null },
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
