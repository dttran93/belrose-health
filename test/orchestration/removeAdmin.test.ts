// test/orchestration/removeAdmin.test.ts
//
// Layer 3 (orchestration) — PermissionsService.removeAdmin. Covers full revoke and both
// demoteTo variants ('sharer' | 'viewer'). Real Firestore emulator (permissive rules),
// BlockchainRoleManagerService/SharingService/firebase-auth mocked.
//
// Includes a regression test for the same Rule 6 bug the removeOwner Rule 5 fix addressed
// earlier this session: demoting a subject to 'viewer' must be blocked, not just a full
// revoke — a subject-administrator can demote to sharer, but never below it.

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
    prepareEncryptionAccessRevoke: vi.fn(),
  },
}));

import { PermissionsService } from '../../src/features/Permissions/services/permissionsService';
import { BlockchainRoleManagerService } from '../../src/features/Permissions/services/blockchainRoleManagerService';
import { SharingService } from '@/features/Sharing/services/sharingService';

const OWNER = 'remove-admin-owner';
const ADMIN = 'remove-admin-target-admin';
const OTHER_ADMIN = 'remove-admin-other-admin';
const STRANGER = 'remove-admin-stranger';
const RECORD_ID = 'remove-admin-record';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

const db = connectTestFirestore('belrose-orchestration-remove-admin');

describe('PermissionsService.removeAdmin (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.clearAllMocks();
    await seedUser(db, OWNER, '0xOwnerWallet');
    await seedUser(db, ADMIN, '0xAdminWallet');
    await seedUser(db, OTHER_ADMIN, '0xOtherAdminWallet');
    await seedUser(db, STRANGER, '0xStrangerWallet');
    // Encryption revokes are tested in sharingService's own suite — default to "no-op" (as if
    // there's no wrappedKey to deactivate) so these tests can focus on role/history/chain
    // behavior without needing real key material.
    vi.mocked(SharingService.prepareEncryptionAccessRevoke).mockResolvedValue(null);
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  it('owner fully revokes an administrator', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.revokeRole).mockResolvedValue({
      txHash: '0xrevoke',
      blockNumber: 1,
    });

    await PermissionsService.removeAdmin(RECORD_ID, ADMIN);

    expect(BlockchainRoleManagerService.revokeRole).toHaveBeenCalledWith(RECORD_ID, '0xAdminWallet');
    expect(SharingService.prepareEncryptionAccessRevoke).toHaveBeenCalledWith(
      RECORD_ID,
      ADMIN,
      OWNER
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.administrators).toEqual([]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: ADMIN, action: 'revoked', previousRole: 'administrator', newRole: null },
    ]);
  });

  it('owner demotes an administrator to sharer', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.changeRole).mockResolvedValue({
      txHash: '0xdemote-sharer',
      blockNumber: 2,
    });

    await PermissionsService.removeAdmin(RECORD_ID, ADMIN, undefined, { demoteTo: 'sharer' });

    expect(BlockchainRoleManagerService.changeRole).toHaveBeenCalledWith(
      RECORD_ID,
      '0xAdminWallet',
      'sharer'
    );
    expect(SharingService.prepareEncryptionAccessRevoke).not.toHaveBeenCalled();

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.administrators).toEqual([]);
    expect(recordSnap.data()?.sharers).toEqual([ADMIN]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: ADMIN, action: 'downgraded', previousRole: 'administrator', newRole: 'sharer' },
    ]);
  });

  it('owner demotes an administrator to viewer', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.changeRole).mockResolvedValue({
      txHash: '0xdemote-viewer',
      blockNumber: 3,
    });

    await PermissionsService.removeAdmin(RECORD_ID, ADMIN, undefined, { demoteTo: 'viewer' });

    expect(BlockchainRoleManagerService.changeRole).toHaveBeenCalledWith(
      RECORD_ID,
      '0xAdminWallet',
      'viewer'
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.administrators).toEqual([]);
    expect(recordSnap.data()?.viewers).toEqual([ADMIN]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: ADMIN, action: 'downgraded', previousRole: 'administrator', newRole: 'viewer' },
    ]);
  });

  it('an administrator can remove themselves even when an owner exists', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN] });
    setCaller(ADMIN);

    vi.mocked(BlockchainRoleManagerService.revokeRole).mockResolvedValue({
      txHash: '0xself-revoke',
      blockNumber: 4,
    });

    await PermissionsService.removeAdmin(RECORD_ID, ADMIN);

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.administrators).toEqual([]);
  });

  it('denies a non-owner administrator removing a different administrator while an owner exists', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN, OTHER_ADMIN] });
    setCaller(ADMIN);

    await expect(PermissionsService.removeAdmin(RECORD_ID, OTHER_ADMIN)).rejects.toThrow(
      'Only the record owner can remove other administrators'
    );
    expect(BlockchainRoleManagerService.revokeRole).not.toHaveBeenCalled();
  });

  it('allows an administrator to remove a different administrator once no owner exists', async () => {
    await seedRecord(db, RECORD_ID, { administrators: [ADMIN, OTHER_ADMIN] });
    setCaller(ADMIN);

    vi.mocked(BlockchainRoleManagerService.revokeRole).mockResolvedValue({
      txHash: '0xno-owner-revoke',
      blockNumber: 5,
    });

    await PermissionsService.removeAdmin(RECORD_ID, OTHER_ADMIN);

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.administrators).toEqual([ADMIN]);
  });

  it('blocks removing the last administrator when no owner exists', async () => {
    await seedRecord(db, RECORD_ID, { administrators: [ADMIN] });
    setCaller(ADMIN);

    await expect(PermissionsService.removeAdmin(RECORD_ID, ADMIN)).rejects.toThrow(
      'Cannot remove the last administrator from a record'
    );
    expect(BlockchainRoleManagerService.revokeRole).not.toHaveBeenCalled();
  });

  it('denies a stranger with no role', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN] });
    setCaller(STRANGER);

    await expect(PermissionsService.removeAdmin(RECORD_ID, ADMIN)).rejects.toThrow(
      'You are not an owner or administrator of this record'
    );
    expect(BlockchainRoleManagerService.revokeRole).not.toHaveBeenCalled();
  });

  it('refuses to act on a target who is not actually an administrator', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(OWNER);

    await expect(PermissionsService.removeAdmin(RECORD_ID, ADMIN)).rejects.toThrow(
      'User is not an administrator of this record'
    );
    expect(BlockchainRoleManagerService.revokeRole).not.toHaveBeenCalled();
  });

  it('defensively refuses to remove a target who is (inconsistently) also in owners', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER, ADMIN], administrators: [ADMIN] });
    setCaller(OWNER);

    await expect(PermissionsService.removeAdmin(RECORD_ID, ADMIN)).rejects.toThrow(
      'Cannot remove the record owner as administrator'
    );
    expect(BlockchainRoleManagerService.revokeRole).not.toHaveBeenCalled();
  });

  it('blocks fully revoking a subject-administrator without a demoteTo', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN], subjects: [ADMIN] });
    setCaller(OWNER);

    await expect(PermissionsService.removeAdmin(RECORD_ID, ADMIN)).rejects.toThrow(
      "Cannot remove a subject's access. Please remove them as subject first or demote to a different role."
    );
    expect(BlockchainRoleManagerService.revokeRole).not.toHaveBeenCalled();
  });

  it('allows demoting a subject-administrator to sharer (satisfies the sharer floor)', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN], subjects: [ADMIN] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.changeRole).mockResolvedValue({
      txHash: '0xsubject-to-sharer',
      blockNumber: 6,
    });

    await PermissionsService.removeAdmin(RECORD_ID, ADMIN, undefined, { demoteTo: 'sharer' });

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.sharers).toEqual([ADMIN]);
  });

  it('regression: refuses to demote a subject-administrator straight to viewer (subjects require at least sharer access)', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN], subjects: [ADMIN] });
    setCaller(OWNER);

    await expect(
      PermissionsService.removeAdmin(RECORD_ID, ADMIN, undefined, { demoteTo: 'viewer' })
    ).rejects.toThrow(/subject/i);

    expect(BlockchainRoleManagerService.changeRole).not.toHaveBeenCalled();
    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.administrators).toEqual([ADMIN]);
  });

  it('keeps the Firestore removal when the blockchain call rejects, and logs it for reconciliation', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.revokeRole).mockRejectedValue(
      new Error('transaction reverted')
    );

    // Firestore-first: the chain call is best-effort and does not revert the removal that
    // already succeeded, so this resolves rather than throwing.
    await expect(PermissionsService.removeAdmin(RECORD_ID, ADMIN)).resolves.toBeUndefined();

    expect(SharingService.prepareEncryptionAccessRevoke).toHaveBeenCalledWith(
      RECORD_ID,
      ADMIN,
      OWNER
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.administrators).toEqual([]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: ADMIN, action: 'revoked', previousRole: 'administrator', newRole: null },
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
