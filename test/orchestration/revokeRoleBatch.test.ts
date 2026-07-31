// test/orchestration/revokeRoleBatch.test.ts
//
// Layer 3 (orchestration) — PermissionsService.revokeRoleBatch. Always a full revoke (no
// demotion variant), only owner/admin may call it — note there's no self-removal bypass
// here at all, unlike every single-record remove* method (isSelfRemoval always lets a user
// leave their own access regardless of role). That looks like an intentional simplification
// for what's effectively an admin bulk-action tool rather than a self-service one, so it's
// captured below as a documented observation, not treated as a bug to fix.

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

const OWNER = 'batch-revoke-owner';
const VIEWER = 'batch-revoke-viewer-caller';
const TARGET = 'batch-revoke-target';
const RECORD_A = 'batch-revoke-record-a';
const RECORD_B = 'batch-revoke-record-b';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

const db = connectTestFirestore('belrose-orchestration-revoke-role-batch');

describe('PermissionsService.revokeRoleBatch (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.resetAllMocks();
    vi.mocked(BlockchainRoleManagerService.revokeRoleBatch).mockResolvedValue({
      txHash: '0xdefault',
      blockNumber: 0,
    });
    // Encryption revokes are tested in sharingService's own suite — default to "no-op" (as if
    // there's no wrappedKey to deactivate) so these tests can focus on role/history/chain
    // behavior without needing real key material.
    vi.mocked(SharingService.prepareEncryptionAccessRevoke).mockResolvedValue(null);
    await seedUser(db, OWNER, '0xOwnerWallet');
    await seedUser(db, VIEWER, '0xViewerCallerWallet');
    await seedUser(db, TARGET, '0xTargetWallet');
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  it('revokes across two records in one blockchain call', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER], viewers: [TARGET] });
    await seedRecord(db, RECORD_B, { owners: [OWNER], sharers: [TARGET] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.revokeRoleBatch).mockResolvedValue({
      txHash: '0xbatch',
      blockNumber: 1,
    });

    await PermissionsService.revokeRoleBatch([RECORD_A, RECORD_B], TARGET);

    expect(BlockchainRoleManagerService.revokeRoleBatch).toHaveBeenCalledWith(
      expect.arrayContaining([RECORD_A, RECORD_B]),
      '0xTargetWallet'
    );
    expect(SharingService.prepareEncryptionAccessRevoke).toHaveBeenCalledWith(
      RECORD_A,
      TARGET,
      OWNER
    );
    expect(SharingService.prepareEncryptionAccessRevoke).toHaveBeenCalledWith(
      RECORD_B,
      TARGET,
      OWNER
    );

    const recordA = await getDoc(doc(db, 'records', RECORD_A));
    expect(recordA.data()?.viewers).toEqual([]);
    const recordB = await getDoc(doc(db, 'records', RECORD_B));
    expect(recordB.data()?.sharers).toEqual([]);

    const eventsA = await getDocs(collection(db, 'records', RECORD_A, 'permissionHistory'));
    expect(eventsA.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'revoked', previousRole: 'viewer', newRole: null },
    ]);
  });

  it('skips a record the caller has no permission on', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER], viewers: [TARGET] });
    await seedRecord(db, RECORD_B, { owners: ['someone-else'], viewers: [TARGET] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.revokeRoleBatch).mockResolvedValue({
      txHash: '0xpartial',
      blockNumber: 2,
    });

    await PermissionsService.revokeRoleBatch([RECORD_A, RECORD_B], TARGET);

    expect(BlockchainRoleManagerService.revokeRoleBatch).toHaveBeenCalledWith(
      [RECORD_A],
      '0xTargetWallet'
    );
    const recordB = await getDoc(doc(db, 'records', RECORD_B));
    expect(recordB.data()?.viewers).toEqual([TARGET]);
  });

  it('observation: unlike the single-record remove* methods, a non-admin/owner cannot self-revoke via batch', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER], viewers: [VIEWER] });
    setCaller(VIEWER);

    await PermissionsService.revokeRoleBatch([RECORD_A], VIEWER);

    // Silently skipped, not thrown — this is a bulk-admin tool, not a self-service one.
    expect(BlockchainRoleManagerService.revokeRoleBatch).not.toHaveBeenCalled();
    const recordA = await getDoc(doc(db, 'records', RECORD_A));
    expect(recordA.data()?.viewers).toEqual([VIEWER]);
  });

  it('skips a record where the target has no role at all', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER] });
    setCaller(OWNER);

    await PermissionsService.revokeRoleBatch([RECORD_A], TARGET);

    expect(BlockchainRoleManagerService.revokeRoleBatch).not.toHaveBeenCalled();
  });

  it('skips a record where the target is an owner', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER, TARGET] });
    setCaller(OWNER);

    await PermissionsService.revokeRoleBatch([RECORD_A], TARGET);

    expect(BlockchainRoleManagerService.revokeRoleBatch).not.toHaveBeenCalled();
    const recordA = await getDoc(doc(db, 'records', RECORD_A));
    expect(recordA.data()?.owners).toEqual([OWNER, TARGET]);
  });

  it('skips a record where the target is an active subject', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER], sharers: [TARGET], subjects: [TARGET] });
    setCaller(OWNER);

    await PermissionsService.revokeRoleBatch([RECORD_A], TARGET);

    expect(BlockchainRoleManagerService.revokeRoleBatch).not.toHaveBeenCalled();
    const recordA = await getDoc(doc(db, 'records', RECORD_A));
    expect(recordA.data()?.sharers).toEqual([TARGET]);
  });

  it('skips a record that does not exist', async () => {
    setCaller(OWNER);

    await PermissionsService.revokeRoleBatch(['nonexistent-record'], TARGET);

    expect(BlockchainRoleManagerService.revokeRoleBatch).not.toHaveBeenCalled();
  });

  it('keeps the Firestore removals when the blockchain batch call rejects, and logs it for reconciliation', async () => {
    await seedRecord(db, RECORD_A, { owners: [OWNER], viewers: [TARGET] });
    setCaller(OWNER);

    vi.mocked(BlockchainRoleManagerService.revokeRoleBatch).mockRejectedValue(
      new Error('transaction reverted')
    );

    // Firestore-first: the chain call is best-effort and does not revert the removal that
    // already succeeded.
    await expect(
      PermissionsService.revokeRoleBatch([RECORD_A], TARGET)
    ).resolves.toBeUndefined();

    const recordA = await getDoc(doc(db, 'records', RECORD_A));
    expect(recordA.data()?.viewers).toEqual([]);

    const events = await getDocs(collection(db, 'records', RECORD_A, 'permissionHistory'));
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: TARGET, action: 'revoked', previousRole: 'viewer', newRole: null },
    ]);
    // No confirmed tx to cite — the audit event still exists, just without a chain reference yet.
    expect(events.docs[0]!.data().blockchainRef).toBeNull();

    const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'failed',
      action: 'revokeRoleBatch',
      error: 'transaction reverted',
      permissionHistoryPath: [`records/${RECORD_A}/permissionHistory/${events.docs[0]!.id}`],
    });
  });
});
