// test/orchestration/trusteePermissionService.test.ts
//
// Layer 3 (orchestration) — TrusteePermissionService: the fan-out of record permissions when a
// trustee relationship is created, activated, rolled back, revoked, or edited. Real Firestore
// emulator for records/wrappedKeys/permissionHistory/blockchainSyncQueue (all read/written
// directly by this service, Firestore-first — role array + permissionHistory event now commit
// atomically per record, and blockchainRef starts null since the chain call is a separate,
// best-effort step the CALLER owns, not these methods); cross-feature/blockchain edges are
// mocked: SharingService.prepareEncryptionAccessGrant (needs a real unlocked encryption
// session — defaults to null/no-op so these tests can focus on role/history/chain behavior;
// prepareEncryptionAccessRevoke has no such dependency and is NOT mocked, tested for real),
// WalletService.getUserWalletAddress, BlockchainRoleManagerService (on-chain role read/write),
// and firebase/auth.

import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { doc, getDoc, getDocs, collection, setDoc } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { connectTestFirestore, clearTestFirestore, seedRecord } from './helpers/testFirestore';

const { mockCurrentUser, sharingMocks, walletMocks, roleManagerMocks } = vi.hoisted(() => ({
  mockCurrentUser: { uid: null as string | null },
  sharingMocks: {
    prepareEncryptionAccessGrant: vi.fn(),
    prepareEncryptionAccessRevoke: vi.fn(),
  },
  walletMocks: { getUserWalletAddress: vi.fn() },
  roleManagerMocks: {
    getRoleDetails: vi.fn(),
    grantRole: vi.fn(),
    changeRole: vi.fn(),
    revokeRole: vi.fn(),
  },
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockCurrentUser.uid ? { uid: mockCurrentUser.uid } : null }),
}));

vi.mock('@/features/Sharing/services/sharingService', () => ({
  SharingService: sharingMocks,
}));

vi.mock('@/features/BlockchainWallet/services/walletService', () => ({
  WalletService: walletMocks,
}));

vi.mock('@/features/Permissions/services/blockchainRoleManagerService', () => ({
  BlockchainRoleManagerService: roleManagerMocks,
}));

import { TrusteePermissionService } from '../../src/features/Trustee/services/trusteePermissionService';

const TRUSTOR = 'trustee-perm-trustor';
const TRUSTEE = 'trustee-perm-trustee';
const RECORD_A = 'trustee-perm-record-a';
const RECORD_B = 'trustee-perm-record-b';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

const db = connectTestFirestore('belrose-orchestration-trustee-permission');

async function tagTrustee(recordId: string, trusteeId: string) {
  await setDoc(doc(db, 'records', recordId), { trustees: [trusteeId] }, { merge: true });
}

async function seedWrappedKey(
  recordId: string,
  userId: string,
  overrides: Record<string, unknown> = {}
) {
  await setDoc(doc(db, 'wrappedKeys', `${recordId}_${userId}`), {
    recordId,
    userId,
    grantedBy: TRUSTOR,
    isActive: false,
    ...overrides,
  });
}

async function seedTrusteeRelationship(
  trustorId: string,
  trusteeId: string,
  overrides: Record<string, unknown> = {}
) {
  await setDoc(doc(db, 'trusteeRelationships', `${trustorId}_${trusteeId}`), {
    trustorId,
    trusteeId,
    trustLevel: 'observer',
    isActive: true,
    status: 'active',
    ...overrides,
  });
}

async function getPermissionHistory(recordId: string) {
  const snap = await getDocs(collection(db, 'records', recordId, 'permissionHistory'));
  return snap.docs.map(d => d.data());
}

describe('TrusteePermissionService (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.resetAllMocks();
    setCaller(TRUSTOR);
    sharingMocks.prepareEncryptionAccessGrant.mockResolvedValue(null);
    sharingMocks.prepareEncryptionAccessRevoke.mockResolvedValue(null);
    walletMocks.getUserWalletAddress.mockResolvedValue('0xTrusteeWallet');
    roleManagerMocks.getRoleDetails.mockResolvedValue({ role: '', isActive: false });
    roleManagerMocks.grantRole.mockResolvedValue({ txHash: '0xgrant', blockNumber: 10 });
    roleManagerMocks.changeRole.mockResolvedValue({ txHash: '0xchange', blockNumber: 11 });
    roleManagerMocks.revokeRole.mockResolvedValue({ txHash: '0xrevokerole', blockNumber: 12 });
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  describe('getRecordsForTrustor', () => {
    it('returns an empty array when the trustor has no records', async () => {
      await expect(TrusteePermissionService.getRecordsForTrustor(TRUSTOR)).resolves.toEqual([]);
    });

    it('returns records where the trustor is a subject, with their resolved role', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], subjects: [TRUSTOR] });
      const result = await TrusteePermissionService.getRecordsForTrustor(TRUSTOR);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({ recordId: RECORD_A, trustorRole: 'owner', recordTrustees: [] })
      );
      expect(result[0]).not.toHaveProperty('currentTrusteeRole');
    });

    it('includes currentTrusteeRole when a trusteeId is passed', async () => {
      await seedRecord(db, RECORD_A, {
        owners: [TRUSTOR],
        viewers: [TRUSTEE],
        subjects: [TRUSTOR],
      });

      const result = await TrusteePermissionService.getRecordsForTrustor(TRUSTOR, TRUSTEE);

      expect(result[0]!.currentTrusteeRole).toBe('viewer');
    });

    it('reflects the trustees[] array on each record', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], subjects: [TRUSTOR] });
      await tagTrustee(RECORD_A, 'some-other-trustee');

      const result = await TrusteePermissionService.getRecordsForTrustor(TRUSTOR);
      expect(result[0]!.recordTrustees).toEqual(['some-other-trustee']);
    });
  });

  describe('grantPendingTrusteeAccess', () => {
    // grantPendingTrusteeAccess now appends {recordId, previousRole} onto the relationship doc's
    // recordIdsGranted atomically with each record's own grant — the relationship doc must
    // already exist (created by TrusteeRelationshipService.inviteTrustee's Step 1 in production;
    // seeded directly here since these tests call this method in isolation).
    beforeEach(async () => {
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, {
        status: 'pending',
        isActive: false,
        recordIdsGranted: [],
      });
    });

    it('throws when not authenticated', async () => {
      setCaller(null);
      await expect(
        TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'observer')
      ).rejects.toThrow('User not authenticated');
    });

    it('is a no-op when the trustor has no records', async () => {
      await expect(
        TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'observer')
      ).resolves.toEqual([]);
      expect(sharingMocks.prepareEncryptionAccessGrant).not.toHaveBeenCalled();
    });

    it('is a no-op when the trustee already has an equal-or-higher role on every record', async () => {
      // observer always resolves to 'viewer' — a trustee already an owner outranks that, so
      // resolveTrusteeRole's rank check should skip the grant entirely.
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR, TRUSTEE], subjects: [TRUSTOR] });

      await expect(
        TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'observer')
      ).resolves.toEqual([]);
      expect(sharingMocks.prepareEncryptionAccessGrant).not.toHaveBeenCalled();
    });

    it('grants viewer access for an observer-level trustee, tags trustees[], and writes a deferred-blockchainRef audit event', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], subjects: [TRUSTOR] });

      const succeeded = await TrusteePermissionService.grantPendingTrusteeAccess(
        TRUSTEE,
        'observer'
      );

      expect(sharingMocks.prepareEncryptionAccessGrant).toHaveBeenCalledWith(
        RECORD_A,
        TRUSTEE,
        TRUSTOR,
        { isActive: false }
      );

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      const data = snap.data()!;
      expect(data.viewers).toContain(TRUSTEE);
      expect(data.trustees).toContain(TRUSTEE);

      const events = await getPermissionHistory(RECORD_A);
      expect(events).toHaveLength(1);
      expect(events[0]!.changes).toEqual([
        { userId: TRUSTEE, action: 'granted', previousRole: null, newRole: 'viewer' },
      ]);
      expect(events[0]!.blockchainRef).toBeNull();
      expect(events[0]!.context).toBe('trustee_grant');

      expect(succeeded).toEqual([
        { recordId: RECORD_A, role: 'viewer', historyRef: expect.anything() },
      ]);

      const relSnap = await getDoc(doc(db, 'trusteeRelationships', `${TRUSTOR}_${TRUSTEE}`));
      expect(relSnap.data()?.recordIdsGranted).toEqual([
        { recordId: RECORD_A, previousRole: null },
      ]);
    });

    it('mirrors the trustor role for a custodian-level trustee (capped at administrator for an owner)', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], subjects: [TRUSTOR] });

      await TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'custodian');

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.administrators).toContain(TRUSTEE);
    });

    it('mirrors the trustor role exactly (including owner) for a controller-level trustee', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], subjects: [TRUSTOR] });

      await TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'controller');

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.owners).toContain(TRUSTEE);
    });

    it('caps a sharer/viewer trustor down to viewer even at controller level', async () => {
      await seedRecord(db, RECORD_A, { owners: ['other-owner'], sharers: [TRUSTOR], subjects: [TRUSTOR] });

      await TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'controller');

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.viewers).toContain(TRUSTEE);
      expect(snap.data()?.owners).not.toContain(TRUSTEE);
    });

    // Regression: trustees[] is now tagged unconditionally (even for upgrades from independent
    // access) — previousRole (persisted below) is what disambiguates strip-vs-downgrade on
    // revoke, not trustees[] membership. See TrusteePermissionService.revokeTrusteeAccess.
    it('tags trustees[] and records the independent baseline role when the trustee already had independent access, and logs an upgrade', async () => {
      await seedRecord(db, RECORD_A, {
        owners: [TRUSTOR],
        viewers: [TRUSTEE],
        subjects: [TRUSTOR],
      });

      await TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'controller');

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      const data = snap.data()!;
      expect(data.owners).toContain(TRUSTEE);
      expect(data.trustees).toContain(TRUSTEE);

      const events = await getPermissionHistory(RECORD_A);
      expect(events[0]!.changes).toEqual([
        { userId: TRUSTEE, action: 'upgraded', previousRole: 'viewer', newRole: 'owner' },
      ]);

      const relSnap = await getDoc(doc(db, 'trusteeRelationships', `${TRUSTOR}_${TRUSTEE}`));
      expect(relSnap.data()?.recordIdsGranted).toEqual([
        { recordId: RECORD_A, previousRole: 'viewer' },
      ]);
    });

    it('removes the trustee from other role arrays when granting a new role, for an owner/admin trustor', async () => {
      await seedRecord(db, RECORD_A, {
        owners: [TRUSTOR],
        viewers: [TRUSTEE],
        subjects: [TRUSTOR],
      });

      await TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'custodian');

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      const data = snap.data()!;
      expect(data.administrators).toContain(TRUSTEE);
      expect(data.viewers).not.toContain(TRUSTEE);
    });

    it('continues fanning out to other records when one record fails, and only returns the succeeded one', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], subjects: [TRUSTOR] });
      await seedRecord(db, RECORD_B, { owners: [TRUSTOR], subjects: [TRUSTOR] });
      sharingMocks.prepareEncryptionAccessGrant.mockRejectedValueOnce(new Error('down for record A'));

      const succeeded = await TrusteePermissionService.grantPendingTrusteeAccess(
        TRUSTEE,
        'observer'
      );

      const snapB = await getDoc(doc(db, 'records', RECORD_B));
      expect(snapB.data()?.viewers).toContain(TRUSTEE);
      expect(succeeded).toEqual([
        { recordId: RECORD_B, role: 'viewer', historyRef: expect.anything() },
      ]);

      const snapA = await getDoc(doc(db, 'records', RECORD_A));
      expect(snapA.data()?.viewers ?? []).not.toContain(TRUSTEE);

      const relSnap = await getDoc(doc(db, 'trusteeRelationships', `${TRUSTOR}_${TRUSTEE}`));
      expect(relSnap.data()?.recordIdsGranted).toEqual([
        { recordId: RECORD_B, previousRole: null },
      ]);
    });
  });

  describe('activateTrusteeAccess', () => {
    it('throws when not authenticated', async () => {
      setCaller(null);
      await expect(TrusteePermissionService.activateTrusteeAccess(TRUSTOR)).rejects.toThrow(
        'User not authenticated'
      );
    });

    it('is a no-op when there is no relationship doc (recordIdsGranted defaults to empty)', async () => {
      setCaller(TRUSTEE);
      await expect(
        TrusteePermissionService.activateTrusteeAccess(TRUSTOR)
      ).resolves.toBeUndefined();
    });

    it('activates every inactive wrappedKey in recordIdsGranted', async () => {
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, {
        status: 'pending',
        isActive: false,
        recordIdsGranted: [
          { recordId: RECORD_A, previousRole: null },
          { recordId: RECORD_B, previousRole: null },
        ],
      });
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: false, grantedBy: TRUSTOR });
      await seedWrappedKey(RECORD_B, TRUSTEE, { isActive: false, grantedBy: TRUSTOR });
      setCaller(TRUSTEE);

      await TrusteePermissionService.activateTrusteeAccess(TRUSTOR);

      const snapA = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      const snapB = await getDoc(doc(db, 'wrappedKeys', `${RECORD_B}_${TRUSTEE}`));
      expect(snapA.data()?.isActive).toBe(true);
      expect(snapA.data()?.activatedAt).toBeDefined();
      expect(snapA.data()?.history).toEqual([{ action: 'reactivated', by: TRUSTEE, at: expect.anything() }]);
      expect(snapB.data()?.isActive).toBe(true);
    });

    it('does not touch a wrappedKey granted by a different trustor', async () => {
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, {
        status: 'pending',
        isActive: false,
        recordIdsGranted: [{ recordId: RECORD_A, previousRole: null }],
      });
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: false, grantedBy: 'someone-else' });
      setCaller(TRUSTEE);

      await TrusteePermissionService.activateTrusteeAccess(TRUSTOR);

      const snap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      expect(snap.data()?.isActive).toBe(false);
    });

    it('scopes activation to recordIdsGranted, leaving a stale inactive wrappedKey from an earlier revoke-then-reinvite cycle untouched', async () => {
      // Regression test: RECORD_C was granted in a past invite cycle, then the relationship was
      // revoked (deactivating, not deleting, its wrappedKey). This new invite cycle only covers
      // A and B — C must NOT come back to life just because it happens to match
      // (userId, grantedBy, isActive) like A and B do.
      const RECORD_C = 'trustee-perm-record-c';
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, {
        status: 'pending',
        isActive: false,
        recordIdsGranted: [
          { recordId: RECORD_A, previousRole: null },
          { recordId: RECORD_B, previousRole: null },
        ],
      });
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: false, grantedBy: TRUSTOR });
      await seedWrappedKey(RECORD_B, TRUSTEE, { isActive: false, grantedBy: TRUSTOR });
      await seedWrappedKey(RECORD_C, TRUSTEE, { isActive: false, grantedBy: TRUSTOR });
      setCaller(TRUSTEE);

      await TrusteePermissionService.activateTrusteeAccess(TRUSTOR);

      const snapA = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      const snapB = await getDoc(doc(db, 'wrappedKeys', `${RECORD_B}_${TRUSTEE}`));
      const snapC = await getDoc(doc(db, 'wrappedKeys', `${RECORD_C}_${TRUSTEE}`));
      expect(snapA.data()?.isActive).toBe(true);
      expect(snapB.data()?.isActive).toBe(true);
      expect(snapC.data()?.isActive).toBe(false);
    });

    it('tolerates a recordId in recordIdsGranted whose wrappedKey was never created (non-fatal per-record fan-out failure)', async () => {
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, {
        status: 'pending',
        isActive: false,
        recordIdsGranted: [
          { recordId: RECORD_A, previousRole: null },
          { recordId: RECORD_B, previousRole: null },
        ],
      });
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: false, grantedBy: TRUSTOR });
      // RECORD_B's wrappedKey was never created — simulates a fan-out failure for that record.
      setCaller(TRUSTEE);

      await expect(
        TrusteePermissionService.activateTrusteeAccess(TRUSTOR)
      ).resolves.toBeUndefined();

      const snapA = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      expect(snapA.data()?.isActive).toBe(true);
    });

    it('is a no-op when recordIdsGranted is empty', async () => {
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, {
        status: 'pending',
        isActive: false,
        recordIdsGranted: [],
      });
      setCaller(TRUSTEE);

      await expect(
        TrusteePermissionService.activateTrusteeAccess(TRUSTOR)
      ).resolves.toBeUndefined();
    });
  });

  describe('rollbackPendingTrusteeAccess', () => {
    it('throws when not authenticated', async () => {
      setCaller(null);
      await expect(
        TrusteePermissionService.rollbackPendingTrusteeAccess(TRUSTOR, TRUSTEE, [])
      ).rejects.toThrow('User not authenticated');
    });

    it('throws when the caller is neither the trustor nor the trustee', async () => {
      setCaller('some-stranger');
      await expect(
        TrusteePermissionService.rollbackPendingTrusteeAccess(TRUSTOR, TRUSTEE, [])
      ).rejects.toThrow('Unauthorized: you are not a party to this trustee relationship');
    });

    it('allows the trustor to roll back', async () => {
      setCaller(TRUSTOR);
      await expect(
        TrusteePermissionService.rollbackPendingTrusteeAccess(TRUSTOR, TRUSTEE, [])
      ).resolves.toEqual([]);
    });

    it('allows the trustee to roll back (declining their own invite)', async () => {
      setCaller(TRUSTEE);
      await expect(
        TrusteePermissionService.rollbackPendingTrusteeAccess(TRUSTOR, TRUSTEE, [])
      ).resolves.toEqual([]);
    });

    it('strips role-array access entirely when previousRole is null, deletes the wrappedKey, and logs the revocation with a deferred blockchainRef', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: false, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      const succeeded = await TrusteePermissionService.rollbackPendingTrusteeAccess(
        TRUSTOR,
        TRUSTEE,
        [{ recordId: RECORD_A, previousRole: null }]
      );

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      const data = recordSnap.data()!;
      expect(data.viewers).not.toContain(TRUSTEE);
      expect(data.trustees).not.toContain(TRUSTEE);

      const keySnap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      expect(keySnap.exists()).toBe(false);

      const events = await getPermissionHistory(RECORD_A);
      expect(events[0]!.changes).toEqual([
        { userId: TRUSTEE, action: 'revoked', previousRole: 'viewer', newRole: null },
      ]);
      expect(events[0]!.blockchainRef).toBeNull();
      expect(succeeded).toEqual([{ recordId: RECORD_A, historyRef: expect.anything() }]);
    });

    // Regression: the trustee already had independent viewer access before being upgraded via
    // this pending invite (previousRole: 'viewer'). Declining must downgrade them back to
    // viewer — not strip them to nothing — and the wrappedKey stays untouched either way.
    it('downgrades back to the independent baseline role when previousRole is set, without touching the wrappedKey', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], administrators: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      const succeeded = await TrusteePermissionService.rollbackPendingTrusteeAccess(
        TRUSTOR,
        TRUSTEE,
        [{ recordId: RECORD_A, previousRole: 'viewer' }]
      );

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.administrators).not.toContain(TRUSTEE);
      expect(recordSnap.data()?.viewers).toContain(TRUSTEE);
      expect(recordSnap.data()?.trustees).not.toContain(TRUSTEE);

      const events = await getPermissionHistory(RECORD_A);
      expect(events[0]!.changes).toEqual([
        { userId: TRUSTEE, action: 'downgraded', previousRole: 'administrator', newRole: 'viewer' },
      ]);
      expect(succeeded).toEqual([{ recordId: RECORD_A, historyRef: expect.anything() }]);

      const keySnap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      expect(keySnap.data()?.isActive).toBe(true);
    });

    it('does not log a permission change when the trustee had no role on the record', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR] });
      setCaller(TRUSTOR);

      const succeeded = await TrusteePermissionService.rollbackPendingTrusteeAccess(
        TRUSTOR,
        TRUSTEE,
        [{ recordId: RECORD_A, previousRole: null }]
      );

      expect(await getPermissionHistory(RECORD_A)).toEqual([]);
      expect(succeeded).toEqual([]);
    });

    it('does not touch a record outside recordIdsGranted', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: false, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      await TrusteePermissionService.rollbackPendingTrusteeAccess(TRUSTOR, TRUSTEE, []);

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.viewers).toContain(TRUSTEE);

      const keySnap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      expect(keySnap.exists()).toBe(true);

      expect(await getPermissionHistory(RECORD_A)).toEqual([]);
    });
  });

  describe('revokeTrusteeAccess', () => {
    it('falls back to the trustor as changedBy when there is no authenticated caller', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], administrators: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      setCaller(null);

      await TrusteePermissionService.revokeTrusteeAccess(TRUSTOR, TRUSTEE, [
        { recordId: RECORD_A, previousRole: null },
      ]);

      const events = await getPermissionHistory(RECORD_A);
      expect(events[0]!.changedBy).toBe(TRUSTOR);
      expect(events[0]!.changes).toEqual([
        { userId: TRUSTEE, action: 'revoked', previousRole: 'administrator', newRole: null },
      ]);
    });

    it('strips role-array access entirely when previousRole is null (fresh grant), calls prepareEncryptionAccessRevoke, and defers blockchainRef', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], administrators: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      const succeeded = await TrusteePermissionService.revokeTrusteeAccess(TRUSTOR, TRUSTEE, [
        { recordId: RECORD_A, previousRole: null },
      ]);

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.administrators).not.toContain(TRUSTEE);
      expect(recordSnap.data()?.trustees).not.toContain(TRUSTEE);

      expect(sharingMocks.prepareEncryptionAccessRevoke).toHaveBeenCalledWith(
        RECORD_A,
        TRUSTEE,
        TRUSTOR
      );

      const events = await getPermissionHistory(RECORD_A);
      expect(events[0]!.blockchainRef).toBeNull();
      expect(events[0]!.changes).toEqual([
        { userId: TRUSTEE, action: 'revoked', previousRole: 'administrator', newRole: null },
      ]);
      expect(succeeded).toEqual([{ recordId: RECORD_A, historyRef: expect.anything() }]);
    });

    // Regression: the trustee already had independent viewer access before being upgraded to
    // administrator via this relationship (previousRole: 'viewer'). Revoking the relationship
    // must downgrade them back to viewer — not strip them to nothing, and not leave them
    // permanently stuck at administrator (the bug this previousRole tracking exists to fix).
    it('downgrades back to the independent baseline role when previousRole is set, without touching the wrappedKey', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], administrators: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      const succeeded = await TrusteePermissionService.revokeTrusteeAccess(TRUSTOR, TRUSTEE, [
        { recordId: RECORD_A, previousRole: 'viewer' },
      ]);

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.administrators).not.toContain(TRUSTEE);
      expect(recordSnap.data()?.viewers).toContain(TRUSTEE);
      expect(recordSnap.data()?.trustees).not.toContain(TRUSTEE);

      expect(sharingMocks.prepareEncryptionAccessRevoke).not.toHaveBeenCalled();

      const events = await getPermissionHistory(RECORD_A);
      expect(events[0]!.changes).toEqual([
        { userId: TRUSTEE, action: 'downgraded', previousRole: 'administrator', newRole: 'viewer' },
      ]);
      expect(succeeded).toEqual([{ recordId: RECORD_A, historyRef: expect.anything() }]);

      const keySnap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      expect(keySnap.data()?.isActive).toBe(true);
    });

    it('is a no-op when recordIdsGranted is empty', async () => {
      setCaller(TRUSTOR);

      const succeeded = await TrusteePermissionService.revokeTrusteeAccess(TRUSTOR, TRUSTEE, []);

      expect(sharingMocks.prepareEncryptionAccessRevoke).not.toHaveBeenCalled();
      expect(succeeded).toEqual([]);
    });

    it('does not touch a record outside recordIdsGranted', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], administrators: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      // RECORD_B is fully set up as if it were trustee-derived (tagged, active wrappedKey), but
      // it's not in the list passed in — it must be left alone.
      await seedRecord(db, RECORD_B, { owners: [TRUSTOR], administrators: [TRUSTEE] });
      await tagTrustee(RECORD_B, TRUSTEE);
      await seedWrappedKey(RECORD_B, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      const succeeded = await TrusteePermissionService.revokeTrusteeAccess(TRUSTOR, TRUSTEE, [
        { recordId: RECORD_A, previousRole: null },
      ]);

      expect(succeeded).toEqual([{ recordId: RECORD_A, historyRef: expect.anything() }]);
      const recordBSnap = await getDoc(doc(db, 'records', RECORD_B));
      expect(recordBSnap.data()?.administrators).toContain(TRUSTEE);
      expect(await getPermissionHistory(RECORD_B)).toEqual([]);
    });

    it('skips a record where the trustee no longer has any role', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR] });
      setCaller(TRUSTOR);

      const succeeded = await TrusteePermissionService.revokeTrusteeAccess(TRUSTOR, TRUSTEE, [
        { recordId: RECORD_A, previousRole: null },
      ]);

      expect(succeeded).toEqual([]);
      expect(sharingMocks.prepareEncryptionAccessRevoke).not.toHaveBeenCalled();
    });

    it('skips a record that no longer exists', async () => {
      setCaller(TRUSTOR);

      const succeeded = await TrusteePermissionService.revokeTrusteeAccess(TRUSTOR, TRUSTEE, [
        { recordId: 'nonexistent-record', previousRole: null },
      ]);

      expect(succeeded).toEqual([]);
    });
  });

  describe('grantAccessForNewRecord', () => {
    it('is a no-op when the subject has no active trustees', async () => {
      await expect(
        TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, RECORD_A)
      ).resolves.toBeUndefined();
      expect(sharingMocks.prepareEncryptionAccessGrant).not.toHaveBeenCalled();
    });

    it('throws when the record does not exist', async () => {
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE);
      await expect(
        TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, 'nonexistent-record')
      ).rejects.toThrow('Record not found');
    });

    it('skips a trustee with no linked wallet', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR] });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE);
      walletMocks.getUserWalletAddress.mockResolvedValue(null);

      await TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, RECORD_A);

      expect(sharingMocks.prepareEncryptionAccessGrant).not.toHaveBeenCalled();
    });

    it('grants a fresh on-chain role via grantRole when the trustee has none yet, deferring blockchainRef until it resolves', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR] });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, { trustLevel: 'observer' });
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: '', isActive: false });

      await TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, RECORD_A);

      expect(roleManagerMocks.grantRole).toHaveBeenCalledWith(RECORD_A, '0xTrusteeWallet', 'viewer');
      expect(roleManagerMocks.changeRole).not.toHaveBeenCalled();
      expect(sharingMocks.prepareEncryptionAccessGrant).toHaveBeenCalledWith(RECORD_A, TRUSTEE, TRUSTOR);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      const data = snap.data()!;
      expect(data.viewers).toContain(TRUSTEE);
      expect(data.trustees).toContain(TRUSTEE);

      const events = await getPermissionHistory(RECORD_A);
      expect(events[0]!.changes).toEqual([
        { userId: TRUSTEE, action: 'granted', previousRole: null, newRole: 'viewer' },
      ]);
      // Filled in once the (mocked, successful) chain call resolves.
      expect(events[0]!.blockchainRef).toMatchObject({ txHash: '0xgrant', blockNumber: 10 });

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(1);
      expect(syncDocs.docs[0]!.data()).toMatchObject({ status: 'confirmed', action: 'grantRole' });
    });

    it('calls changeRole instead of grantRole when the trustee already has a lower on-chain role', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, { trustLevel: 'controller' });
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: 'viewer', isActive: true });

      await TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, RECORD_A);

      expect(roleManagerMocks.changeRole).toHaveBeenCalledWith(RECORD_A, '0xTrusteeWallet', 'owner');
      expect(roleManagerMocks.grantRole).not.toHaveBeenCalled();
    });

    // Regression: trustees[] is now tagged unconditionally (even for upgrades from independent
    // access), and recordIdsGranted records the pre-fan-out baseline role so a later revoke can
    // downgrade back to it instead of stripping outright.
    it('tags trustees[] and records the independent baseline role when the trustee already had independent access', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, { trustLevel: 'controller' });
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: 'viewer', isActive: true });

      await TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, RECORD_A);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.trustees).toContain(TRUSTEE);

      const relSnap = await getDoc(doc(db, 'trusteeRelationships', `${TRUSTOR}_${TRUSTEE}`));
      expect(relSnap.data()?.recordIdsGranted).toEqual([
        { recordId: RECORD_A, previousRole: 'viewer' },
      ]);
    });

    it('does not overwrite an already-tracked recordIdsGranted entry on a re-run', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, {
        trustLevel: 'controller',
        recordIdsGranted: [{ recordId: RECORD_A, previousRole: 'viewer' }],
      });
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: 'viewer', isActive: true });

      await TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, RECORD_A);

      const relSnap = await getDoc(doc(db, 'trusteeRelationships', `${TRUSTOR}_${TRUSTEE}`));
      expect(relSnap.data()?.recordIdsGranted).toEqual([
        { recordId: RECORD_A, previousRole: 'viewer' },
      ]);
    });

    it('keeps the Firestore grant when the on-chain call rejects, and logs it for reconciliation', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR] });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, { trustLevel: 'observer' });
      roleManagerMocks.grantRole.mockRejectedValue(new Error('transaction reverted'));

      // Firestore-first: the chain call is best-effort and does not revert the grant that
      // already succeeded.
      await expect(
        TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, RECORD_A)
      ).resolves.toBeUndefined();

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.viewers).toContain(TRUSTEE);

      const events = await getPermissionHistory(RECORD_A);
      expect(events[0]!.blockchainRef).toBeNull();

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(1);
      expect(syncDocs.docs[0]!.data()).toMatchObject({
        status: 'failed',
        action: 'grantRole',
        error: 'transaction reverted',
      });
    });

    it('mirrors an already-auto-granted on-chain role, citing the anchor tx directly instead of making its own chain call', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR] });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, { trustLevel: 'observer' });
      // extendTrusteeGrantsOnAnchor already granted 'viewer' inside the anchor tx — the trustee
      // already has an equal-or-higher on-chain role, so resolveTrusteeRole yields desiredRole=null.
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: 'viewer', isActive: true });

      await TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, RECORD_A, {
        txHash: '0xanchor',
        blockNumber: 99,
      });

      expect(roleManagerMocks.grantRole).not.toHaveBeenCalled();
      expect(roleManagerMocks.changeRole).not.toHaveBeenCalled();
      expect(sharingMocks.prepareEncryptionAccessGrant).toHaveBeenCalledWith(RECORD_A, TRUSTEE, TRUSTOR);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.viewers).toContain(TRUSTEE);

      const events = await getPermissionHistory(RECORD_A);
      expect(events[0]!.changes).toEqual([
        { userId: TRUSTEE, action: 'granted', previousRole: null, newRole: 'viewer' },
      ]);
      expect(events[0]!.blockchainRef).toMatchObject({ txHash: '0xanchor', blockNumber: 99 });

      // No chain call was made — nothing to track in the sync queue.
      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(0);
    });

    it('still mirrors Firestore/encryption for an already-correct on-chain role, but skips the audit log when there is neither a chain call nor an anchor tx to cite', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR] });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, { trustLevel: 'observer' });
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: 'viewer', isActive: true });

      await TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, RECORD_A);

      expect(roleManagerMocks.grantRole).not.toHaveBeenCalled();
      expect(roleManagerMocks.changeRole).not.toHaveBeenCalled();
      expect(sharingMocks.prepareEncryptionAccessGrant).toHaveBeenCalledWith(RECORD_A, TRUSTEE, TRUSTOR);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.viewers).toContain(TRUSTEE);
      expect(await getPermissionHistory(RECORD_A)).toEqual([]);
    });

    it('skips entirely (no Firestore/encryption mirroring) when no role is resolved on either side', async () => {
      // custodian/controller need a real trustorRole to resolve anything — with the trustor
      // holding no role at all on this record, resolveTrusteeRole yields null, and with no
      // on-chain role either (isActive:false), finalRole ends up null too.
      await seedRecord(db, RECORD_A, { owners: ['someone-else'] });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, { trustLevel: 'custodian' });
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: '', isActive: false });

      await TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, RECORD_A);

      expect(sharingMocks.prepareEncryptionAccessGrant).not.toHaveBeenCalled();
      expect(await getPermissionHistory(RECORD_A)).toEqual([]);
    });
  });

  describe('revokeAccessForRemovedRecord', () => {
    it('is a no-op when the subject has no active trustees', async () => {
      await expect(
        TrusteePermissionService.revokeAccessForRemovedRecord(TRUSTOR, RECORD_A)
      ).resolves.toBeUndefined();
    });

    it('is a no-op (does not throw) when the record no longer exists', async () => {
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE);
      await expect(
        TrusteePermissionService.revokeAccessForRemovedRecord(TRUSTOR, 'nonexistent-record')
      ).resolves.toBeUndefined();
    });

    it('leaves a trustee with independent (non-trustee-derived) access untouched', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      // Not in recordIdsGranted — independent access predating the trustee relationship.
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE);

      await TrusteePermissionService.revokeAccessForRemovedRecord(TRUSTOR, RECORD_A);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.viewers).toContain(TRUSTEE);
      expect(roleManagerMocks.revokeRole).not.toHaveBeenCalled();
    });

    it('self-heals by explicitly revoking on-chain when previousRole is null and the role is still active despite drift, deferring blockchainRef', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, {
        recordIdsGranted: [{ recordId: RECORD_A, previousRole: null }],
      });
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: 'viewer', isActive: true });

      await TrusteePermissionService.revokeAccessForRemovedRecord(TRUSTOR, RECORD_A);

      expect(roleManagerMocks.revokeRole).toHaveBeenCalledWith(RECORD_A, '0xTrusteeWallet');

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.viewers).not.toContain(TRUSTEE);

      const events = await getPermissionHistory(RECORD_A);
      expect(events[0]!.changes).toEqual([
        { userId: TRUSTEE, action: 'revoked', previousRole: 'viewer', newRole: null },
      ]);
      expect(events[0]!.blockchainRef).toMatchObject({ txHash: '0xrevokerole', blockNumber: 12 });

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(1);
      expect(syncDocs.docs[0]!.data()).toMatchObject({ status: 'confirmed', action: 'revokeRole' });

      const relSnap = await getDoc(doc(db, 'trusteeRelationships', `${TRUSTOR}_${TRUSTEE}`));
      expect(relSnap.data()?.recordIdsGranted).toEqual([]);
    });

    it('keeps the Firestore revoke when the self-heal chain call rejects, and logs it for reconciliation', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, {
        recordIdsGranted: [{ recordId: RECORD_A, previousRole: null }],
      });
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: 'viewer', isActive: true });
      roleManagerMocks.revokeRole.mockRejectedValue(new Error('transaction reverted'));

      await expect(
        TrusteePermissionService.revokeAccessForRemovedRecord(TRUSTOR, RECORD_A)
      ).resolves.toBeUndefined();

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.viewers).not.toContain(TRUSTEE);

      const events = await getPermissionHistory(RECORD_A);
      expect(events[0]!.blockchainRef).toBeNull();

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(1);
      expect(syncDocs.docs[0]!.data()).toMatchObject({ status: 'failed', action: 'revokeRole' });
    });

    it('cites the unanchor tx directly (without an explicit chain call) when previousRole is null and the role was already auto-revoked', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, {
        recordIdsGranted: [{ recordId: RECORD_A, previousRole: null }],
      });
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: '', isActive: false });

      await TrusteePermissionService.revokeAccessForRemovedRecord(TRUSTOR, RECORD_A, {
        txHash: '0xunanchor',
        blockNumber: 55,
      });

      expect(roleManagerMocks.revokeRole).not.toHaveBeenCalled();

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.viewers).not.toContain(TRUSTEE);

      const events = await getPermissionHistory(RECORD_A);
      expect(events[0]!.changes).toEqual([
        { userId: TRUSTEE, action: 'revoked', previousRole: 'viewer', newRole: null },
      ]);
      expect(events[0]!.blockchainRef).toMatchObject({ txHash: '0xunanchor', blockNumber: 55 });

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(0);
    });

    it('still mirrors Firestore/wrappedKeys but skips the audit log when there is no unanchor tx to cite', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, {
        recordIdsGranted: [{ recordId: RECORD_A, previousRole: null }],
      });
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: '', isActive: false });

      await TrusteePermissionService.revokeAccessForRemovedRecord(TRUSTOR, RECORD_A);

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.viewers).not.toContain(TRUSTEE);
      expect(await getPermissionHistory(RECORD_A)).toEqual([]);
    });

    // Regression: the trustee already had independent viewer access before being upgraded to
    // administrator via this relationship (previousRole: 'viewer'). retractTrusteeGrantsOnUnanchor
    // downgrades them on-chain instead of fully revoking — this must recognize that as "already
    // handled" too, not just full inactivity, and never touch the wrappedKey.
    it('recognizes an on-chain downgrade to the baseline role as already handled, without touching the wrappedKey', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], administrators: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, {
        recordIdsGranted: [{ recordId: RECORD_A, previousRole: 'viewer' }],
      });
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: 'viewer', isActive: true });

      await TrusteePermissionService.revokeAccessForRemovedRecord(TRUSTOR, RECORD_A, {
        txHash: '0xunanchor',
        blockNumber: 55,
      });

      expect(roleManagerMocks.revokeRole).not.toHaveBeenCalled();
      expect(roleManagerMocks.changeRole).not.toHaveBeenCalled();

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.administrators).not.toContain(TRUSTEE);
      expect(recordSnap.data()?.viewers).toContain(TRUSTEE);

      const events = await getPermissionHistory(RECORD_A);
      expect(events[0]!.changes).toEqual([
        { userId: TRUSTEE, action: 'downgraded', previousRole: 'administrator', newRole: 'viewer' },
      ]);
      expect(events[0]!.blockchainRef).toMatchObject({ txHash: '0xunanchor', blockNumber: 55 });

      const keySnap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      expect(keySnap.data()?.isActive).toBe(true);

      const relSnap = await getDoc(doc(db, 'trusteeRelationships', `${TRUSTOR}_${TRUSTEE}`));
      expect(relSnap.data()?.recordIdsGranted).toEqual([]);
    });

    it('calls changeRole to the baseline role as a drift correction when the on-chain state does not match it', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], administrators: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, {
        recordIdsGranted: [{ recordId: RECORD_A, previousRole: 'viewer' }],
      });
      // On-chain still shows the upgraded role — retractTrusteeGrantsOnUnanchor hasn't (yet)
      // corrected it, so this must self-heal via changeRole, not revokeRole.
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: 'administrator', isActive: true });

      await TrusteePermissionService.revokeAccessForRemovedRecord(TRUSTOR, RECORD_A);

      expect(roleManagerMocks.changeRole).toHaveBeenCalledWith(
        RECORD_A,
        '0xTrusteeWallet',
        'viewer'
      );
      expect(roleManagerMocks.revokeRole).not.toHaveBeenCalled();

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.viewers).toContain(TRUSTEE);

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(1);
      expect(syncDocs.docs[0]!.data()).toMatchObject({ status: 'confirmed', action: 'changeRole' });
    });
  });

  describe('updateTrusteeAccess', () => {
    it('is a no-op when recordIdsGranted is empty', async () => {
      await expect(
        TrusteePermissionService.updateTrusteeAccess(TRUSTOR, TRUSTEE, 'controller', [])
      ).resolves.toEqual([]);
    });

    it('does not touch a record outside recordIdsGranted', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });

      await TrusteePermissionService.updateTrusteeAccess(TRUSTOR, TRUSTEE, 'controller', []);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.owners).not.toContain(TRUSTEE);
    });

    it('updates the role across trustee-derived records and logs an upgrade with a deferred blockchainRef', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      const succeeded = await TrusteePermissionService.updateTrusteeAccess(
        TRUSTOR,
        TRUSTEE,
        'controller',
        [{ recordId: RECORD_A, previousRole: null }]
      );

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      const data = snap.data()!;
      expect(data.owners).toContain(TRUSTEE);
      expect(data.viewers).not.toContain(TRUSTEE);

      const events = await getPermissionHistory(RECORD_A);
      expect(events[0]!.changes).toEqual([
        { userId: TRUSTEE, action: 'upgraded', previousRole: 'viewer', newRole: 'owner' },
      ]);
      expect(events[0]!.blockchainRef).toBeNull();
      expect(succeeded).toEqual([{ recordId: RECORD_A, historyRef: expect.anything() }]);
    });

    it('logs a downgrade when the new role ranks lower than the previous one', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR, TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      await TrusteePermissionService.updateTrusteeAccess(TRUSTOR, TRUSTEE, 'observer', [
        { recordId: RECORD_A, previousRole: null },
      ]);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.viewers).toContain(TRUSTEE);

      const events = await getPermissionHistory(RECORD_A);
      expect(events[0]!.changes).toEqual([
        { userId: TRUSTEE, action: 'downgraded', previousRole: 'owner', newRole: 'viewer' },
      ]);
    });

    it('falls back to the trustor as changedBy when there is no authenticated caller', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      setCaller(null);

      await TrusteePermissionService.updateTrusteeAccess(TRUSTOR, TRUSTEE, 'controller', [
        { recordId: RECORD_A, previousRole: null },
      ]);

      const events = await getPermissionHistory(RECORD_A);
      expect(events[0]!.changedBy).toBe(TRUSTOR);
    });
  });
});
