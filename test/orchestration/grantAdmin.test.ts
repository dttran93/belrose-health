// test/orchestration/grantAdmin.test.ts
//
// Layer 3 (orchestration) — PermissionsService.grantAdmin.
// Same setup as grantViewer/grantSharer: real Firestore emulator (permissive rules),
// BlockchainRoleManagerService/SharingService/firebase-auth mocked.
//
// Includes regression coverage for the dead "subject caller" branch removed this session:
// Check 2/3 used to require a subject to already hold administrator/owner role to pass —
// impossible, since the outer condition already excluded admins/owners. A subject-only
// caller now gets denied cleanly at Check 2 instead of falling through unreachable logic.

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
    prepareEncryptionAccessGrant: vi.fn(),
  },
}));

import { PermissionsService } from '../../src/features/Permissions/services/permissionsService';
import { BlockchainRoleManagerService } from '../../src/features/Permissions/services/blockchainRoleManagerService';
import { SharingService } from '@/features/Sharing/services/sharingService';

const OWNER = 'grant-admin-owner';
const ADMIN = 'grant-admin-admin-caller';
const SHARER = 'grant-admin-sharer';
const SUBJECT_ONLY = 'grant-admin-subject-only';
const STRANGER = 'grant-admin-stranger';
const TARGET = 'grant-admin-target';
const RECORD_ID = 'grant-admin-record';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

const db = connectTestFirestore('belrose-orchestration-grant-admin');

describe('PermissionsService.grantAdmin (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.clearAllMocks();
    await seedUser(db, OWNER, '0xOwnerWallet');
    await seedUser(db, ADMIN, '0xAdminWallet');
    await seedUser(db, SHARER, '0xSharerWallet');
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

  it('owner grants admin to a user with no existing role', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.grantRole).mockResolvedValue({
      txHash: '0xgrant',
      blockNumber: 1,
    });

    await PermissionsService.grantAdmin(RECORD_ID, TARGET);

    expect(BlockchainRoleManagerService.grantRole).toHaveBeenCalledWith(
      RECORD_ID,
      '0xTargetWallet',
      'administrator'
    );
    expect(SharingService.prepareEncryptionAccessGrant).toHaveBeenCalledWith(
      RECORD_ID,
      TARGET,
      OWNER
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.administrators).toEqual([TARGET]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'granted', previousRole: null, newRole: 'administrator' },
    ]);
    // blockchainRef starts null in the atomic Firestore write and is filled in once the
    // (mocked, successful) chain call resolves.
    expect(events.docs[0]!.data().blockchainRef).toMatchObject({
      txHash: '0xgrant',
      blockNumber: 1,
    });

    // blockchainSyncQueue now records every attempt, not just failures — confirmed here.
    const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'confirmed',
      action: 'grantRole',
      txHash: '0xgrant',
      blockNumber: 1,
      permissionHistoryPath: `records/${RECORD_ID}/permissionHistory/${events.docs[0]!.id}`,
    });
  });

  it('admin upgrades an existing sharer to administrator via changeRole, not grantRole', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN], sharers: [TARGET] });
    setCaller(ADMIN);

    vi.mocked(BlockchainRoleManagerService.changeRole).mockResolvedValue({
      txHash: '0xupgrade',
      blockNumber: 2,
    });

    await PermissionsService.grantAdmin(RECORD_ID, TARGET);

    expect(BlockchainRoleManagerService.changeRole).toHaveBeenCalledWith(
      RECORD_ID,
      '0xTargetWallet',
      'administrator'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.administrators).toEqual([ADMIN, TARGET]);
    expect(recordSnap.data()?.sharers).toEqual([]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'upgraded', previousRole: 'sharer', newRole: 'administrator' },
    ]);
  });

  it('owner upgrades an existing viewer to administrator via changeRole, not grantRole', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], viewers: [TARGET] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.changeRole).mockResolvedValue({
      txHash: '0xupgrade-viewer',
      blockNumber: 3,
    });

    await PermissionsService.grantAdmin(RECORD_ID, TARGET);

    expect(BlockchainRoleManagerService.changeRole).toHaveBeenCalledWith(
      RECORD_ID,
      '0xTargetWallet',
      'administrator'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.administrators).toEqual([TARGET]);
    expect(recordSnap.data()?.viewers).toEqual([]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'upgraded', previousRole: 'viewer', newRole: 'administrator' },
    ]);
  });

  it('denies a caller with no role on the record', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(STRANGER);

    await expect(PermissionsService.grantAdmin(RECORD_ID, TARGET)).rejects.toThrow(
      'Only administrators or owners can add administrators'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
  });

  it('denies granting to a target with no user profile', async () => {
    const nonexistentTarget = 'grant-admin-nonexistent-target';
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(OWNER);

    await expect(PermissionsService.grantAdmin(RECORD_ID, nonexistentTarget)).rejects.toThrow(
      'Target user does not exist or has no profile'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
    expect(SharingService.prepareEncryptionAccessGrant).not.toHaveBeenCalled();
  });

  it('denies a plain sharer', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], sharers: [SHARER] });
    setCaller(SHARER);

    await expect(PermissionsService.grantAdmin(RECORD_ID, TARGET)).rejects.toThrow(
      'Only administrators or owners can add administrators'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
  });

  it('regression: denies a caller who is only a subject, with no other role', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], subjects: [SUBJECT_ONLY] });
    setCaller(SUBJECT_ONLY);

    await expect(PermissionsService.grantAdmin(RECORD_ID, TARGET)).rejects.toThrow(
      'Only administrators or owners can add administrators'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
  });

  it('refuses to grant admin to an existing owner', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER, TARGET] });
    setCaller(OWNER);

    await expect(PermissionsService.grantAdmin(RECORD_ID, TARGET)).rejects.toThrow(
      'User is already an owner (higher role than administrator)'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
  });

  it('refuses to grant admin to an existing administrator', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [TARGET] });
    setCaller(OWNER);

    await expect(PermissionsService.grantAdmin(RECORD_ID, TARGET)).rejects.toThrow(
      'User is already an administrator'
    );
    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
  });

  // Regression: PermissionsService.getUserWalletAddress gives a Permissions-specific message
  // ("has no distributed network account") for a target whose profile exists but has no wallet
  // linked — distinct from "Target user does not exist or has no profile" (Check 3, which
  // already guarantees the profile itself exists by the time this fires). The underlying
  // Firestore read is shared with WalletService.getUserWalletStatus, but this message is
  // Permissions' own and must survive that consolidation.
  it('gives a Permissions-specific message when the target has a profile but no linked wallet', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    await setDoc(doc(db, 'users', TARGET), {}); // profile exists, no wallet field
    setCaller(OWNER);

    await expect(PermissionsService.grantAdmin(RECORD_ID, TARGET)).rejects.toThrow(
      `${TARGET} has no distributed network account`
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
    await expect(PermissionsService.grantAdmin(RECORD_ID, TARGET)).resolves.toBeUndefined();

    expect(SharingService.prepareEncryptionAccessGrant).toHaveBeenCalledWith(
      RECORD_ID,
      TARGET,
      OWNER
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.administrators).toEqual([TARGET]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'granted', previousRole: null, newRole: 'administrator' },
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
    // chainId/contractAddress are known upfront (static config, not outcome data), so a failed
    // attempt still carries them — unlike txHash/blockNumber, which only exist once confirmed.
    expect(syncDocs.docs[0]!.data().chainId).toEqual(expect.any(Number));
    expect(syncDocs.docs[0]!.data().contractAddress).toEqual(expect.any(String));
    expect(syncDocs.docs[0]!.data().txHash).toBeUndefined();
  });
});
