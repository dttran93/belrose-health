// test/orchestration/trusteePermissionService.test.ts
//
// Layer 3 (orchestration) — TrusteePermissionService: the fan-out of record permissions when a
// trustee relationship is created, activated, rolled back, revoked, or edited. Real Firestore
// emulator for records/wrappedKeys/trusteeRelationships (all read/written directly by this
// service); cross-feature/blockchain edges are mocked: SharingService (encryption fan-out,
// tested on its own in sharingService.test.ts), WalletService.getUserWalletAddress,
// BlockchainRoleManagerService (on-chain role read/write), writePermissionChangeEvent (audit
// log), and firebase/auth.

import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { connectTestFirestore, clearTestFirestore, seedRecord } from './helpers/testFirestore';
import { buildMemberRegistryRef } from '@belrose/shared';

const { mockCurrentUser, sharingMocks, walletMocks, roleManagerMocks, writeChangeMock } =
  vi.hoisted(() => ({
    mockCurrentUser: { uid: null as string | null },
    sharingMocks: { grantEncryptionAccess: vi.fn() },
    walletMocks: { getUserWalletAddress: vi.fn() },
    roleManagerMocks: {
      getRoleDetails: vi.fn(),
      grantRole: vi.fn(),
      changeRole: vi.fn(),
      revokeRole: vi.fn(),
    },
    writeChangeMock: vi.fn(),
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

vi.mock('@/features/Permissions/services/writePermissionChangeEvent', () => ({
  default: writeChangeMock,
}));

import { TrusteePermissionService } from '../../src/features/Trustee/services/trusteePermissionService';

const TRUSTOR = 'trustee-perm-trustor';
const TRUSTEE = 'trustee-perm-trustee';
const RECORD_A = 'trustee-perm-record-a';
const RECORD_B = 'trustee-perm-record-b';
const REF = buildMemberRegistryRef('0xref', 1);

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

describe('TrusteePermissionService (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.resetAllMocks();
    setCaller(TRUSTOR);
    sharingMocks.grantEncryptionAccess.mockResolvedValue(undefined);
    walletMocks.getUserWalletAddress.mockResolvedValue('0xTrusteeWallet');
    roleManagerMocks.getRoleDetails.mockResolvedValue({ role: '', isActive: false });
    roleManagerMocks.grantRole.mockResolvedValue({ txHash: '0xgrant', blockNumber: 10 });
    roleManagerMocks.changeRole.mockResolvedValue({ txHash: '0xchange', blockNumber: 11 });
    roleManagerMocks.revokeRole.mockResolvedValue({ txHash: '0xrevokerole', blockNumber: 12 });
    writeChangeMock.mockResolvedValue(undefined);
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
    it('throws when not authenticated', async () => {
      setCaller(null);
      await expect(
        TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'observer', REF)
      ).rejects.toThrow('User not authenticated');
    });

    it('is a no-op when the trustor has no records', async () => {
      await TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'observer', REF);
      expect(sharingMocks.grantEncryptionAccess).not.toHaveBeenCalled();
    });

    it('is a no-op when the trustee already has an equal-or-higher role on every record', async () => {
      // observer always resolves to 'viewer' — a trustee already an owner outranks that, so
      // resolveTrusteeRole's rank check should skip the grant entirely.
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR, TRUSTEE], subjects: [TRUSTOR] });

      await TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'observer', REF);

      expect(sharingMocks.grantEncryptionAccess).not.toHaveBeenCalled();
    });

    it('grants viewer access for an observer-level trustee and tags trustees[]', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], subjects: [TRUSTOR] });

      await TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'observer', REF);

      expect(sharingMocks.grantEncryptionAccess).toHaveBeenCalledWith(
        RECORD_A,
        TRUSTEE,
        TRUSTOR,
        { isActive: false }
      );

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      const data = snap.data()!;
      expect(data.viewers).toContain(TRUSTEE);
      expect(data.trustees).toContain(TRUSTEE);

      expect(writeChangeMock).toHaveBeenCalledWith(
        RECORD_A,
        TRUSTOR,
        [{ userId: TRUSTEE, action: 'granted', previousRole: null, newRole: 'viewer' }],
        REF,
        undefined,
        'trustee_grant'
      );
    });

    it('mirrors the trustor role for a custodian-level trustee (capped at administrator for an owner)', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], subjects: [TRUSTOR] });

      await TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'custodian', REF);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.administrators).toContain(TRUSTEE);
    });

    it('mirrors the trustor role exactly (including owner) for a controller-level trustee', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], subjects: [TRUSTOR] });

      await TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'controller', REF);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.owners).toContain(TRUSTEE);
    });

    it('caps a sharer/viewer trustor down to viewer even at controller level', async () => {
      await seedRecord(db, RECORD_A, { owners: ['other-owner'], sharers: [TRUSTOR], subjects: [TRUSTOR] });

      await TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'controller', REF);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.viewers).toContain(TRUSTEE);
      expect(snap.data()?.owners).not.toContain(TRUSTEE);
    });

    it('does not tag trustees[] when the trustee already had independent access, and logs an upgrade', async () => {
      await seedRecord(db, RECORD_A, {
        owners: [TRUSTOR],
        viewers: [TRUSTEE],
        subjects: [TRUSTOR],
      });

      await TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'controller', REF);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      const data = snap.data()!;
      expect(data.owners).toContain(TRUSTEE);
      expect(data.trustees ?? []).not.toContain(TRUSTEE);

      expect(writeChangeMock).toHaveBeenCalledWith(
        RECORD_A,
        TRUSTOR,
        [{ userId: TRUSTEE, action: 'upgraded', previousRole: 'viewer', newRole: 'owner' }],
        REF,
        undefined,
        'trustee_grant'
      );
    });

    it('removes the trustee from other role arrays when granting a new role, for an owner/admin trustor', async () => {
      await seedRecord(db, RECORD_A, {
        owners: [TRUSTOR],
        viewers: [TRUSTEE],
        subjects: [TRUSTOR],
      });

      await TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'custodian', REF);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      const data = snap.data()!;
      expect(data.administrators).toContain(TRUSTEE);
      expect(data.viewers).not.toContain(TRUSTEE);
    });

    it('continues fanning out to other records when one record fails', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], subjects: [TRUSTOR] });
      await seedRecord(db, RECORD_B, { owners: [TRUSTOR], subjects: [TRUSTOR] });
      sharingMocks.grantEncryptionAccess.mockRejectedValueOnce(new Error('down for record A'));

      await TrusteePermissionService.grantPendingTrusteeAccess(TRUSTEE, 'observer', REF);

      const snapB = await getDoc(doc(db, 'records', RECORD_B));
      expect(snapB.data()?.viewers).toContain(TRUSTEE);
    });
  });

  describe('activateTrusteeAccess', () => {
    it('throws when not authenticated', async () => {
      setCaller(null);
      await expect(TrusteePermissionService.activateTrusteeAccess(TRUSTOR)).rejects.toThrow(
        'User not authenticated'
      );
    });

    it('is a no-op when there are no matching inactive wrappedKeys', async () => {
      setCaller(TRUSTEE);
      await expect(
        TrusteePermissionService.activateTrusteeAccess(TRUSTOR)
      ).resolves.toBeUndefined();
    });

    it('activates every inactive wrappedKey granted by this trustor to this trustee', async () => {
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
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: false, grantedBy: 'someone-else' });
      setCaller(TRUSTEE);

      await TrusteePermissionService.activateTrusteeAccess(TRUSTOR);

      const snap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      expect(snap.data()?.isActive).toBe(false);
    });
  });

  describe('rollbackPendingTrusteeAccess', () => {
    it('throws when not authenticated', async () => {
      setCaller(null);
      await expect(
        TrusteePermissionService.rollbackPendingTrusteeAccess(TRUSTOR, TRUSTEE, REF)
      ).rejects.toThrow('User not authenticated');
    });

    it('throws when the caller is neither the trustor nor the trustee', async () => {
      setCaller('some-stranger');
      await expect(
        TrusteePermissionService.rollbackPendingTrusteeAccess(TRUSTOR, TRUSTEE, REF)
      ).rejects.toThrow('Unauthorized: you are not a party to this trustee relationship');
    });

    it('allows the trustor to roll back', async () => {
      setCaller(TRUSTOR);
      await expect(
        TrusteePermissionService.rollbackPendingTrusteeAccess(TRUSTOR, TRUSTEE, REF)
      ).resolves.toBeUndefined();
    });

    it('allows the trustee to roll back (declining their own invite)', async () => {
      setCaller(TRUSTEE);
      await expect(
        TrusteePermissionService.rollbackPendingTrusteeAccess(TRUSTOR, TRUSTEE, REF)
      ).resolves.toBeUndefined();
    });

    it('removes the trustee from all role arrays, deletes the wrappedKey, and logs the revocation', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: false, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      await TrusteePermissionService.rollbackPendingTrusteeAccess(TRUSTOR, TRUSTEE, REF);

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      const data = recordSnap.data()!;
      expect(data.viewers).not.toContain(TRUSTEE);
      expect(data.trustees).not.toContain(TRUSTEE);

      const keySnap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      expect(keySnap.exists()).toBe(false);

      expect(writeChangeMock).toHaveBeenCalledWith(
        RECORD_A,
        TRUSTOR,
        [{ userId: TRUSTEE, action: 'revoked', previousRole: 'viewer', newRole: null }],
        REF,
        undefined,
        'trustee_revoke'
      );
    });

    it('does not log a permission change when the trustee had no role on the record', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR] });
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: false, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      await TrusteePermissionService.rollbackPendingTrusteeAccess(TRUSTOR, TRUSTEE, REF);

      expect(writeChangeMock).not.toHaveBeenCalled();
    });

    // Regression: grantPendingTrusteeAccess only tags trustees[] when the trustee didn't already
    // have independent access (hadPriorAccess) — its absence means this role predates/is
    // independent of the trust relationship and must be left untouched when the invite is
    // declined/revoked before acceptance. Without this guard, the app would try to strip a role
    // the trustee has every right to keep, and firestore.rules' trustee-self-adjust branch
    // (which requires trustees[] membership) would correctly reject the attempt anyway.
    it('leaves a record alone entirely when the trustee has independent (non-trustee-derived) access', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] }); // no tagTrustee
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: false, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      await TrusteePermissionService.rollbackPendingTrusteeAccess(TRUSTOR, TRUSTEE, REF);

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.viewers).toContain(TRUSTEE);

      const keySnap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      expect(keySnap.exists()).toBe(true);

      expect(writeChangeMock).not.toHaveBeenCalled();
    });
  });

  describe('revokeTrusteeAccess', () => {
    it('falls back to the trustor as changedBy when there is no authenticated caller', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], administrators: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      setCaller(null);

      await TrusteePermissionService.revokeTrusteeAccess(TRUSTOR, TRUSTEE, REF);

      expect(writeChangeMock).toHaveBeenCalledWith(
        RECORD_A,
        TRUSTOR,
        [{ userId: TRUSTEE, action: 'revoked', previousRole: 'administrator', newRole: null }],
        REF,
        undefined,
        'trustee_revoke'
      );
    });

    it('deactivates the wrappedKey (rather than deleting it) and removes role-array access', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], administrators: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      await TrusteePermissionService.revokeTrusteeAccess(TRUSTOR, TRUSTEE, REF);

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.administrators).not.toContain(TRUSTEE);

      const keySnap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      expect(keySnap.exists()).toBe(true);
      expect(keySnap.data()?.isActive).toBe(false);
      expect(keySnap.data()?.revokedBy).toBe(TRUSTOR);
      expect(keySnap.data()?.history).toEqual([{ action: 'revoked', by: TRUSTOR, at: expect.anything() }]);
    });

    it('only touches active wrappedKeys granted by this trustor', async () => {
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: false, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      await TrusteePermissionService.revokeTrusteeAccess(TRUSTOR, TRUSTEE, REF);

      const snap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      expect(snap.data()?.isActive).toBe(false);
      expect(snap.data()?.revokedBy).toBeUndefined();
    });

    // Regression: same rationale as rollbackPendingTrusteeAccess above — a role that predates
    // (or is independent of) the trust relationship must survive the relationship ending.
    // Deactivating this wrappedKey would also be wrong even if the rule allowed it, since it's
    // the same physical doc backing their independent access (one wrappedKey per record+user,
    // not per-relationship).
    it('leaves a record alone entirely when the trustee has independent (non-trustee-derived) access', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] }); // no tagTrustee
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      await TrusteePermissionService.revokeTrusteeAccess(TRUSTOR, TRUSTEE, REF);

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.viewers).toContain(TRUSTEE);

      const keySnap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      expect(keySnap.data()?.isActive).toBe(true);

      expect(writeChangeMock).not.toHaveBeenCalled();
    });

    // Regression: a null blockchainRef (already-inactive-on-chain case, see
    // TrusteeBlockchainService.revokeTrustee) still deactivates the wrappedKey, strips role
    // arrays, AND still writes the audit event (with blockchainRef: null) — there's no fresh tx
    // to cite, but who/what/when is still worth recording.
    it('still deactivates the wrappedKey, strips role arrays, and logs the event (with a null blockchainRef)', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], administrators: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      await TrusteePermissionService.revokeTrusteeAccess(TRUSTOR, TRUSTEE, null);

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.administrators).not.toContain(TRUSTEE);

      const keySnap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      expect(keySnap.data()?.isActive).toBe(false);

      expect(writeChangeMock).toHaveBeenCalledWith(
        RECORD_A,
        TRUSTOR,
        [{ userId: TRUSTEE, action: 'revoked', previousRole: 'administrator', newRole: null }],
        null,
        undefined,
        'trustee_revoke'
      );
    });
  });

  describe('grantAccessForNewRecord', () => {
    it('is a no-op when the subject has no active trustees', async () => {
      await expect(
        TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, RECORD_A)
      ).resolves.toBeUndefined();
      expect(sharingMocks.grantEncryptionAccess).not.toHaveBeenCalled();
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

      expect(sharingMocks.grantEncryptionAccess).not.toHaveBeenCalled();
    });

    it('grants a fresh on-chain role via grantRole when the trustee has none yet', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR] });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, { trustLevel: 'observer' });
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: '', isActive: false });

      await TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, RECORD_A);

      expect(roleManagerMocks.grantRole).toHaveBeenCalledWith(RECORD_A, '0xTrusteeWallet', 'viewer');
      expect(roleManagerMocks.changeRole).not.toHaveBeenCalled();
      expect(sharingMocks.grantEncryptionAccess).toHaveBeenCalledWith(RECORD_A, TRUSTEE, TRUSTOR);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      const data = snap.data()!;
      expect(data.viewers).toContain(TRUSTEE);
      expect(data.trustees).toContain(TRUSTEE);

      expect(writeChangeMock).toHaveBeenCalledWith(
        RECORD_A,
        TRUSTOR,
        [{ userId: TRUSTEE, action: 'granted', previousRole: null, newRole: 'viewer' }],
        buildMemberRegistryRef('0xgrant', 10),
        undefined,
        'trustee_grant'
      );
    });

    it('calls changeRole instead of grantRole when the trustee already has a lower on-chain role', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, { trustLevel: 'controller' });
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: 'viewer', isActive: true });

      await TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, RECORD_A);

      expect(roleManagerMocks.changeRole).toHaveBeenCalledWith(RECORD_A, '0xTrusteeWallet', 'owner');
      expect(roleManagerMocks.grantRole).not.toHaveBeenCalled();
    });

    it('does not touch Firestore when the on-chain grant fails (no txHash)', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR] });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, { trustLevel: 'observer' });
      roleManagerMocks.grantRole.mockResolvedValue({ txHash: '', blockNumber: 0 });

      await TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, RECORD_A);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.viewers ?? []).not.toContain(TRUSTEE);
      expect(sharingMocks.grantEncryptionAccess).not.toHaveBeenCalled();
    });

    it('mirrors an already-auto-granted on-chain role, citing the anchor tx instead of making its own chain call', async () => {
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
      expect(sharingMocks.grantEncryptionAccess).toHaveBeenCalledWith(RECORD_A, TRUSTEE, TRUSTOR);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.viewers).toContain(TRUSTEE);

      expect(writeChangeMock).toHaveBeenCalledWith(
        RECORD_A,
        TRUSTOR,
        [{ userId: TRUSTEE, action: 'granted', previousRole: null, newRole: 'viewer' }],
        buildMemberRegistryRef('0xanchor', 99),
        undefined,
        'trustee_grant'
      );
    });

    it('still mirrors Firestore/encryption for an already-correct on-chain role, but skips the audit log when there is neither a chain call nor an anchor tx to cite', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR] });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, { trustLevel: 'observer' });
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: 'viewer', isActive: true });

      await TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, RECORD_A);

      expect(roleManagerMocks.grantRole).not.toHaveBeenCalled();
      expect(roleManagerMocks.changeRole).not.toHaveBeenCalled();
      expect(sharingMocks.grantEncryptionAccess).toHaveBeenCalledWith(RECORD_A, TRUSTEE, TRUSTOR);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.viewers).toContain(TRUSTEE);
      expect(writeChangeMock).not.toHaveBeenCalled();
    });

    it('skips entirely (no Firestore/encryption mirroring) when no role is resolved on either side', async () => {
      // custodian/controller need a real trustorRole to resolve anything — with the trustor
      // holding no role at all on this record, resolveTrusteeRole yields null, and with no
      // on-chain role either (isActive:false), finalRole ends up null too.
      await seedRecord(db, RECORD_A, { owners: ['someone-else'] });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE, { trustLevel: 'custodian' });
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: '', isActive: false });

      await TrusteePermissionService.grantAccessForNewRecord(TRUSTOR, RECORD_A);

      expect(sharingMocks.grantEncryptionAccess).not.toHaveBeenCalled();
      expect(writeChangeMock).not.toHaveBeenCalled();
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
      // Not tagged in trustees[] — independent access predating the trustee relationship.
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE);

      await TrusteePermissionService.revokeAccessForRemovedRecord(TRUSTOR, RECORD_A);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.viewers).toContain(TRUSTEE);
      expect(roleManagerMocks.revokeRole).not.toHaveBeenCalled();
    });

    it('self-heals by explicitly revoking on-chain when the role is still active despite drift', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE);
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: 'viewer', isActive: true });

      await TrusteePermissionService.revokeAccessForRemovedRecord(TRUSTOR, RECORD_A);

      expect(roleManagerMocks.revokeRole).toHaveBeenCalledWith(RECORD_A, '0xTrusteeWallet');

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.viewers).not.toContain(TRUSTEE);

      const keySnap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_A}_${TRUSTEE}`));
      expect(keySnap.data()?.isActive).toBe(false);

      expect(writeChangeMock).toHaveBeenCalledWith(
        RECORD_A,
        TRUSTOR,
        [{ userId: TRUSTEE, action: 'revoked', previousRole: 'viewer', newRole: null }],
        buildMemberRegistryRef('0xrevokerole', 12),
        undefined,
        'trustee_revoke'
      );
    });

    it('cites the unanchor tx (without an explicit chain call) when the role was already auto-revoked', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE);
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: '', isActive: false });

      await TrusteePermissionService.revokeAccessForRemovedRecord(TRUSTOR, RECORD_A, {
        txHash: '0xunanchor',
        blockNumber: 55,
      });

      expect(roleManagerMocks.revokeRole).not.toHaveBeenCalled();

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.viewers).not.toContain(TRUSTEE);

      expect(writeChangeMock).toHaveBeenCalledWith(
        RECORD_A,
        TRUSTOR,
        [{ userId: TRUSTEE, action: 'revoked', previousRole: 'viewer', newRole: null }],
        buildMemberRegistryRef('0xunanchor', 55),
        undefined,
        'trustee_revoke'
      );
    });

    it('still mirrors Firestore/wrappedKeys but skips the audit log when there is no unanchor tx to cite', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      await seedTrusteeRelationship(TRUSTOR, TRUSTEE);
      roleManagerMocks.getRoleDetails.mockResolvedValue({ role: '', isActive: false });

      await TrusteePermissionService.revokeAccessForRemovedRecord(TRUSTOR, RECORD_A);

      const recordSnap = await getDoc(doc(db, 'records', RECORD_A));
      expect(recordSnap.data()?.viewers).not.toContain(TRUSTEE);
      expect(writeChangeMock).not.toHaveBeenCalled();
    });
  });

  describe('updateTrusteeAccess', () => {
    it('is a no-op when there are no active trustee-derived wrappedKeys', async () => {
      await expect(
        TrusteePermissionService.updateTrusteeAccess(TRUSTOR, TRUSTEE, 'controller', REF)
      ).resolves.toBeUndefined();
    });

    it('ignores a record whose trustees[] does not include this trustee (not trustee-derived)', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });

      await TrusteePermissionService.updateTrusteeAccess(TRUSTOR, TRUSTEE, 'controller', REF);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.owners).not.toContain(TRUSTEE);
    });

    it('updates the role across trustee-derived records and logs an upgrade', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      await TrusteePermissionService.updateTrusteeAccess(TRUSTOR, TRUSTEE, 'controller', REF);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      const data = snap.data()!;
      expect(data.owners).toContain(TRUSTEE);
      expect(data.viewers).not.toContain(TRUSTEE);

      expect(writeChangeMock).toHaveBeenCalledWith(
        RECORD_A,
        TRUSTOR,
        [{ userId: TRUSTEE, action: 'upgraded', previousRole: 'viewer', newRole: 'owner' }],
        REF,
        undefined,
        'trustee_grant'
      );
    });

    it('logs a downgrade when the new role ranks lower than the previous one', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR, TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      await TrusteePermissionService.updateTrusteeAccess(TRUSTOR, TRUSTEE, 'observer', REF);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      expect(snap.data()?.viewers).toContain(TRUSTEE);

      expect(writeChangeMock).toHaveBeenCalledWith(
        RECORD_A,
        TRUSTOR,
        [{ userId: TRUSTEE, action: 'downgraded', previousRole: 'owner', newRole: 'viewer' }],
        REF,
        undefined,
        'trustee_grant'
      );
    });

    it('falls back to the trustor as changedBy when there is no authenticated caller', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      setCaller(null);

      await TrusteePermissionService.updateTrusteeAccess(TRUSTOR, TRUSTEE, 'controller', REF);

      expect(writeChangeMock).toHaveBeenCalledWith(
        RECORD_A,
        TRUSTOR,
        expect.anything(),
        REF,
        undefined,
        'trustee_grant'
      );
    });

    // Regression: a null blockchainRef (already-at-this-level-on-chain case, see
    // TrusteeBlockchainService.updateTrusteeLevel) still updates the role arrays AND still
    // writes the audit event (with blockchainRef: null) — there's no fresh tx to cite, but
    // who/what/when is still worth recording.
    it('still updates the role and logs the event (with a null blockchainRef)', async () => {
      await seedRecord(db, RECORD_A, { owners: [TRUSTOR], viewers: [TRUSTEE] });
      await tagTrustee(RECORD_A, TRUSTEE);
      await seedWrappedKey(RECORD_A, TRUSTEE, { isActive: true, grantedBy: TRUSTOR });
      setCaller(TRUSTOR);

      await TrusteePermissionService.updateTrusteeAccess(TRUSTOR, TRUSTEE, 'controller', null);

      const snap = await getDoc(doc(db, 'records', RECORD_A));
      const data = snap.data()!;
      expect(data.owners).toContain(TRUSTEE);
      expect(data.viewers).not.toContain(TRUSTEE);

      expect(writeChangeMock).toHaveBeenCalledWith(
        RECORD_A,
        TRUSTOR,
        [{ userId: TRUSTEE, action: 'upgraded', previousRole: 'viewer', newRole: 'owner' }],
        null,
        undefined,
        'trustee_grant'
      );
    });
  });
});
