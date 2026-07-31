// test/orchestration/grantViewer.test.ts
//
// Layer 3 (orchestration) — PermissionsService.grantViewer.
// Real Firestore (emulator, permissive rules — see test/orchestration/permissive.rules);
// BlockchainRoleManagerService, SharingService, and firebase/auth are mocked, so this suite
// checks PermissionsService's own wiring (does it call the right sub-service with the right
// args, in the right order, and land the right Firestore state) — not blockchain/crypto/rules
// correctness, which are already owned by contracts/test and test/rules respectively.

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

const OWNER = 'grant-viewer-owner';
const TARGET = 'grant-viewer-target';
const STRANGER = 'grant-viewer-stranger';
const VIEWER = 'grant-viewer-viewer-caller';
const SHARER = 'grant-viewer-sharer-caller';
const RECORD_ID = 'grant-viewer-record';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

const db = connectTestFirestore('belrose-orchestration-grant-viewer');

describe('PermissionsService.grantViewer (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.clearAllMocks();
    await seedUser(db, OWNER, '0xOwnerWallet');
    await seedUser(db, TARGET, '0xTargetWallet');
    await seedUser(db, STRANGER, '0xStrangerWallet');
    await seedUser(db, VIEWER, '0xViewerWallet');
    await seedUser(db, SHARER, '0xSharerWallet');
    // Encryption grants are tested in sharingService's own suite — default to "no-op" (as if
    // the receiver already has active access) so these tests can focus on role/history/chain
    // behavior without needing real key material.
    vi.mocked(SharingService.prepareEncryptionAccessGrant).mockResolvedValue(null);
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  it('grants viewer access: calls blockchain + encryption, writes an audit event, updates Firestore', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.grantRole).mockResolvedValue({
      txHash: '0xabc',
      blockNumber: 42,
    });

    await PermissionsService.grantViewer(RECORD_ID, TARGET);

    expect(BlockchainRoleManagerService.grantRole).toHaveBeenCalledWith(
      RECORD_ID,
      '0xTargetWallet',
      'viewer'
    );
    expect(SharingService.prepareEncryptionAccessGrant).toHaveBeenCalledWith(
      RECORD_ID,
      TARGET,
      OWNER
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.viewers).toEqual([TARGET]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.size).toBe(1);
    const event = events.docs[0]!.data();
    expect(event.changedBy).toBe(OWNER);
    expect(event.changes).toEqual([
      { userId: TARGET, action: 'granted', previousRole: null, newRole: 'viewer' },
    ]);
  });

  it('denies a caller with no role on the record — never touches blockchain or Firestore', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(STRANGER);

    await expect(PermissionsService.grantViewer(RECORD_ID, TARGET)).rejects.toThrow(
      'You do not have permission to share this record'
    );

    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
    expect(SharingService.prepareEncryptionAccessGrant).not.toHaveBeenCalled();

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.viewers).toEqual([]);
  });

  it('denies granting to a target with no user profile', async () => {
    const nonexistentTarget = 'grant-viewer-nonexistent-target';
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(OWNER);

    await expect(PermissionsService.grantViewer(RECORD_ID, nonexistentTarget)).rejects.toThrow(
      'Target user does not exist or has no profile'
    );

    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
    expect(SharingService.prepareEncryptionAccessGrant).not.toHaveBeenCalled();
  });

  it('denies a viewer on the record — never touches blockchain or Firestore', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER], viewers: [VIEWER] });
    setCaller(VIEWER);

    await expect(PermissionsService.grantViewer(RECORD_ID, TARGET)).rejects.toThrow(
      'You do not have permission to share this record'
    );

    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
    expect(SharingService.prepareEncryptionAccessGrant).not.toHaveBeenCalled();
  });

  it('lets a sharer on the record grant viewer access', async () => {
    // grantViewer predates the sharer role — grantSharer already allows a sharer caller
    // (isCurrentUserSharer), grantViewer never got the same update.
    await seedRecord(db, RECORD_ID, { owners: [OWNER], sharers: [SHARER] });
    setCaller(SHARER);

    vi.mocked(BlockchainRoleManagerService.grantRole).mockResolvedValue({
      txHash: '0xsharer',
      blockNumber: 43,
    });

    await PermissionsService.grantViewer(RECORD_ID, TARGET);

    expect(BlockchainRoleManagerService.grantRole).toHaveBeenCalledWith(
      RECORD_ID,
      '0xTargetWallet',
      'viewer'
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.viewers).toEqual([TARGET]);
  });

  it('refuses to demote an existing owner down to viewer', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER, TARGET] });
    setCaller(OWNER);

    await expect(PermissionsService.grantViewer(RECORD_ID, TARGET)).rejects.toThrow(
      'User is already an owner (higher role than viewer)'
    );

    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
  });

  it('refuses to grant viewer access to an active subject — subjects require at least sharer access', async () => {
    // TARGET has no existing role yet, but is a subject of the record (e.g. the patient
    // themselves) — mirrors the same floor getEligibleRoleTargets already enforces for
    // demoting a subject, just on the grant side instead.
    await seedRecord(db, RECORD_ID, { owners: [OWNER], subjects: [TARGET] });
    setCaller(OWNER);

    await expect(PermissionsService.grantViewer(RECORD_ID, TARGET)).rejects.toThrow(/subject/i);

    expect(BlockchainRoleManagerService.grantRole).not.toHaveBeenCalled();
    expect(SharingService.prepareEncryptionAccessGrant).not.toHaveBeenCalled();

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.viewers).toEqual([]);
  });

  it('keeps the Firestore grant when the blockchain call rejects, and logs it for reconciliation', async () => {
    await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.grantRole).mockRejectedValue(
      new Error('transaction reverted')
    );

    // Firestore-first: the chain call is best-effort and does not revert the grant that
    // already succeeded, so this resolves rather than throwing.
    await expect(PermissionsService.grantViewer(RECORD_ID, TARGET)).resolves.toBeUndefined();

    expect(SharingService.prepareEncryptionAccessGrant).toHaveBeenCalledWith(
      RECORD_ID,
      TARGET,
      OWNER
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()?.viewers).toEqual([TARGET]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'granted', previousRole: null, newRole: 'viewer' },
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
