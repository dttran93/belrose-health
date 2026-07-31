// test/orchestration/removeOwner.test.ts
//
// Layer 3 (orchestration) — PermissionsService.removeOwner. This is the method behind the
// first real bug found this session: the old two-step "leave then grant" blockchain call
// reverted on self-demotion because after leaving, the caller had zero role and couldn't
// grant themselves a new one. The fix made voluntarilyLeaveOwnership atomic (recordId +
// optional newRole in one call) — the first test below is the regression test for exactly
// that scenario at the orchestration layer (contracts/test/ownerSelfDemotion.test.cjs
// already covers it at the contract layer).

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

const OWNER = 'remove-owner-owner';
const OTHER_OWNER = 'remove-owner-other-owner';
const ADMIN = 'remove-owner-admin';
const RECORD_ID = 'remove-owner-record';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

const db = connectTestFirestore('belrose-orchestration-remove-owner');

describe('PermissionsService.removeOwner (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.clearAllMocks();
    await seedUser(db, OWNER, '0xOwnerWallet');
    await seedUser(db, OTHER_OWNER, '0xOtherOwnerWallet');
    await seedUser(db, ADMIN, '0xAdminWallet');
    // Encryption revokes are tested in sharingService's own suite — default to "no-op" (as if
    // there's no wrappedKey to deactivate) so these tests can focus on role/history/chain
    // behavior without needing real key material.
    vi.mocked(SharingService.prepareEncryptionAccessRevoke).mockResolvedValue(null);
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  it('regression: self-demotes an owner to administrator in one atomic blockchain call', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER, OTHER_OWNER] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.voluntarilyLeaveOwnership).mockResolvedValue({
      txHash: '0xdemote',
      blockNumber: 10,
    });

    await PermissionsService.removeOwner(RECORD_ID, OWNER, undefined, { demoteTo: 'administrator' });

    // The whole point of the fix: one call, recordId + newRole together — never a separate
    // leave-then-grant pair that could revert between the two steps.
    expect(BlockchainRoleManagerService.voluntarilyLeaveOwnership).toHaveBeenCalledWith(
      RECORD_ID,
      'administrator'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.owners).toEqual([OTHER_OWNER]);
    expect(recordSnap.data()?.administrators).toEqual([OWNER]);

    // Demoting (not fully leaving) still needs the encryption key — must not be revoked.
    expect(SharingService.prepareEncryptionAccessRevoke).not.toHaveBeenCalled();

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: OWNER, action: 'downgraded', previousRole: 'owner', newRole: 'administrator' },
    ]);
  });

  it('self-demotes an owner to sharer', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.voluntarilyLeaveOwnership).mockResolvedValue({
      txHash: '0xdemote-sharer',
      blockNumber: 12,
    });

    await PermissionsService.removeOwner(RECORD_ID, OWNER, undefined, { demoteTo: 'sharer' });

    expect(BlockchainRoleManagerService.voluntarilyLeaveOwnership).toHaveBeenCalledWith(
      RECORD_ID,
      'sharer'
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.owners).toEqual([]);
    expect(recordSnap.data()?.sharers).toEqual([OWNER]);

    // Demoting (not fully leaving) still needs the encryption key — must not be revoked.
    expect(SharingService.prepareEncryptionAccessRevoke).not.toHaveBeenCalled();

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: OWNER, action: 'downgraded', previousRole: 'owner', newRole: 'sharer' },
    ]);
  });

  it('self-demotes an owner to viewer', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.voluntarilyLeaveOwnership).mockResolvedValue({
      txHash: '0xdemote-viewer',
      blockNumber: 13,
    });

    await PermissionsService.removeOwner(RECORD_ID, OWNER, undefined, { demoteTo: 'viewer' });

    expect(BlockchainRoleManagerService.voluntarilyLeaveOwnership).toHaveBeenCalledWith(
      RECORD_ID,
      'viewer'
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.owners).toEqual([]);
    expect(recordSnap.data()?.viewers).toEqual([OWNER]);

    expect(SharingService.prepareEncryptionAccessRevoke).not.toHaveBeenCalled();

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: OWNER, action: 'downgraded', previousRole: 'owner', newRole: 'viewer' },
    ]);
  });

  it('fully revokes the sole owner once an administrator exists to take over', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.voluntarilyLeaveOwnership).mockResolvedValue({
      txHash: '0xleave',
      blockNumber: 11,
    });

    await PermissionsService.removeOwner(RECORD_ID, OWNER);

    expect(BlockchainRoleManagerService.voluntarilyLeaveOwnership).toHaveBeenCalledWith(
      RECORD_ID,
      undefined
    );
    expect(SharingService.prepareEncryptionAccessRevoke).toHaveBeenCalledWith(
      RECORD_ID,
      OWNER,
      OWNER
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.owners).toEqual([]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: OWNER, action: 'revoked', previousRole: 'owner', newRole: null },
    ]);
  });

  it('blocks removing a different owner — owners may only remove themselves', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER, OTHER_OWNER] });
    setCaller(OWNER);

    await expect(PermissionsService.removeOwner(RECORD_ID, OTHER_OWNER)).rejects.toThrow(
      'Owners can only be removed by themselves. You cannot remove other owners.'
    );

    expect(BlockchainRoleManagerService.voluntarilyLeaveOwnership).not.toHaveBeenCalled();
  });

  it('blocks removing the last owner when no administrators exist', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(OWNER);

    await expect(PermissionsService.removeOwner(RECORD_ID, OWNER)).rejects.toThrow(
      'Cannot remove the last owner when no administrators exist'
    );

    expect(BlockchainRoleManagerService.voluntarilyLeaveOwnership).not.toHaveBeenCalled();
  });

  it('regression: refuses to demote a subject-owner straight to viewer (subjects require at least sharer access)', async () => {
    // Admin seeded so Rule 4 (last-owner-without-admin) doesn't fire first.
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN], subjects: [OWNER] });
    setCaller(OWNER);

    await expect(
      PermissionsService.removeOwner(RECORD_ID, OWNER, undefined, { demoteTo: 'viewer' })
    ).rejects.toThrow(/subject/i);

    expect(BlockchainRoleManagerService.voluntarilyLeaveOwnership).not.toHaveBeenCalled();
    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.owners).toEqual([OWNER]);
  });

  it('keeps the Firestore removal when the blockchain call rejects, and logs it for reconciliation', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER, OTHER_OWNER] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.voluntarilyLeaveOwnership).mockRejectedValue(
      new Error('transaction reverted')
    );

    // Firestore-first: the chain call is best-effort and does not revert the removal that
    // already succeeded, so this resolves rather than throwing.
    await expect(PermissionsService.removeOwner(RECORD_ID, OWNER)).resolves.toBeUndefined();

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.owners).toEqual([OTHER_OWNER]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: OWNER, action: 'revoked', previousRole: 'owner', newRole: null },
    ]);
    // No confirmed tx to cite — the audit event still exists, just without a chain reference yet.
    expect(events.docs[0]!.data().blockchainRef).toBeNull();

    const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'failed',
      action: 'voluntarilyLeaveOwnership',
      error: 'transaction reverted',
      permissionHistoryPath: `records/${RECORD_ID}/permissionHistory/${events.docs[0]!.id}`,
    });
  });
});
