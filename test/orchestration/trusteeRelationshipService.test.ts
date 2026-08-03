// test/orchestration/trusteeRelationshipService.test.ts
//
// Layer 3 (orchestration) — TrusteeRelationshipService, the orchestrator for the whole trustee
// relationship lifecycle (invite/revoke/edit/stepDown/accept/decline/resign + queries).
// Firestore-first: the relationship doc's own state transition commits first (real Firestore
// emulator), then the non-fatal TrusteePermissionService fan-out runs (mocked — its own behavior
// is covered in trusteePermissionService.test.ts), then the blockchain call is attempted as a
// separate, best-effort step tracked via the real BlockchainSyncQueueService (unmocked) and a new
// trusteeRelationships/{id}/trusteeHistory event (real Firestore). Every chain call goes straight
// to BlockchainRoleManagerService — no self-healing wrapper (TrusteeBlockchainService, which used
// to reinterpret certain "already done" revert reasons as success, was retired: now that
// Firestore always commits first regardless of chain outcome, that reclassification has nothing
// left to gate, and belongs in the reconciliation layer instead — any chain failure, benign or
// not, just lands in blockchainSyncQueue as 'failed'). WalletService, getUserProfile, and
// firebase/auth are mocked at the boundary.

import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { doc, getDoc, getDocs, collection, setDoc, Timestamp } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { connectTestFirestore, clearTestFirestore } from './helpers/testFirestore';

const { mockCurrentUser, roleManagerMocks, walletMocks, permissionMocks, profileMocks } =
  vi.hoisted(() => ({
    mockCurrentUser: { uid: null as string | null },
    roleManagerMocks: {
      proposeTrustee: vi.fn(),
      acceptTrustee: vi.fn(),
      declineTrustee: vi.fn(),
      revokeTrustee: vi.fn(),
      downgradeTrusteeLevel: vi.fn(),
      updateTrusteeLevel: vi.fn(),
    },
    walletMocks: {
      requireUserWalletAddress: vi.fn(),
    },
    permissionMocks: {
      getRecordsForTrustor: vi.fn(),
      grantPendingTrusteeAccess: vi.fn(),
      rollbackPendingTrusteeAccess: vi.fn(),
      revokeTrusteeAccess: vi.fn(),
      activateTrusteeAccess: vi.fn(),
      updateTrusteeAccess: vi.fn(),
    },
    profileMocks: {
      getUserProfile: vi.fn(),
    },
  }));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockCurrentUser.uid ? { uid: mockCurrentUser.uid } : null }),
}));

vi.mock('@/features/Users/services/userProfileService', () => ({
  getUserProfile: profileMocks.getUserProfile,
}));

vi.mock('@/features/Permissions/services/blockchainRoleManagerService', () => ({
  BlockchainRoleManagerService: roleManagerMocks,
}));

vi.mock('@/features/BlockchainWallet/services/walletService', () => ({
  WalletService: walletMocks,
}));

vi.mock('../../src/features/Trustee/services/trusteePermissionService', () => ({
  TrusteePermissionService: permissionMocks,
}));

import { TrusteeRelationshipService, getTrusteeRelationshipId } from '../../src/features/Trustee/services/trusteeRelationshipService';

const TRUSTOR = 'trustee-rel-trustor';
const TRUSTEE = 'trustee-rel-trustee';
const STRANGER = 'trustee-rel-stranger';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

function walletedProfile(overrides: Record<string, unknown> = {}) {
  return {
    onChainIdentity: { linkedWallets: [{ address: '0xWallet', isWalletActive: true }] },
    ...overrides,
  };
}

function noWalletProfile() {
  return { onChainIdentity: { linkedWallets: [] } };
}

const db = connectTestFirestore('belrose-orchestration-trustee-relationship');

async function seedRelationship(
  trustorId: string,
  trusteeId: string,
  overrides: Record<string, unknown> = {}
) {
  await setDoc(doc(db, 'trusteeRelationships', getTrusteeRelationshipId(trustorId, trusteeId)), {
    trustorId,
    trusteeId,
    trustLevel: 'observer',
    isActive: false,
    status: 'pending',
    createdAt: Timestamp.now(),
    respondedAt: null,
    revokedAt: null,
    revokedBy: null,
    statusUpdateReason: null,
    ...overrides,
  });
}

async function getTrusteeHistory(trustorId: string, trusteeId: string) {
  const relationshipId = getTrusteeRelationshipId(trustorId, trusteeId);
  const snap = await getDocs(collection(db, 'trusteeRelationships', relationshipId, 'trusteeHistory'));
  return snap.docs.map(d => d.data());
}

async function getSyncQueueDocs() {
  const snap = await getDocs(collection(db, 'blockchainSyncQueue'));
  return snap.docs.map(d => d.data());
}

describe('TrusteeRelationshipService (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.resetAllMocks();
    setCaller(null);

    profileMocks.getUserProfile.mockImplementation(async (uid: string) => {
      if (uid === TRUSTOR || uid === TRUSTEE) return walletedProfile();
      return null;
    });
    walletMocks.requireUserWalletAddress.mockResolvedValue('0xWallet');
    permissionMocks.getRecordsForTrustor.mockResolvedValue([]);
    permissionMocks.grantPendingTrusteeAccess.mockResolvedValue([]);
    permissionMocks.rollbackPendingTrusteeAccess.mockResolvedValue([]);
    permissionMocks.revokeTrusteeAccess.mockResolvedValue([]);
    permissionMocks.activateTrusteeAccess.mockResolvedValue(undefined);
    permissionMocks.updateTrusteeAccess.mockResolvedValue([]);
    roleManagerMocks.proposeTrustee.mockResolvedValue({ txHash: '0xpropose', blockNumber: 1 });
    roleManagerMocks.acceptTrustee.mockResolvedValue({ txHash: '0xaccept', blockNumber: 2 });
    roleManagerMocks.declineTrustee.mockResolvedValue({ txHash: '0xdecline', blockNumber: 3 });
    roleManagerMocks.revokeTrustee.mockResolvedValue({ txHash: '0xrevoke', blockNumber: 4 });
    roleManagerMocks.downgradeTrusteeLevel.mockResolvedValue({ txHash: '0xdowngrade', blockNumber: 5 });
    roleManagerMocks.updateTrusteeLevel.mockResolvedValue({ txHash: '0xupdate', blockNumber: 6 });
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  describe('inviteTrustee', () => {
    it('throws when not authenticated', async () => {
      await expect(TrusteeRelationshipService.inviteTrustee(TRUSTEE, 'observer')).rejects.toThrow(
        'User not authenticated'
      );
    });

    it('throws when inviting yourself', async () => {
      setCaller(TRUSTOR);
      await expect(TrusteeRelationshipService.inviteTrustee(TRUSTOR, 'observer')).rejects.toThrow(
        'You cannot appoint yourself as a trustee'
      );
    });

    it('throws when the target user has no profile', async () => {
      setCaller(TRUSTOR);
      await expect(
        TrusteeRelationshipService.inviteTrustee('nonexistent-user', 'observer')
      ).rejects.toThrow('Target user does not exist or has no profile');
    });

    it('throws when the trustor has no active wallet', async () => {
      profileMocks.getUserProfile.mockImplementation(async (uid: string) => {
        if (uid === TRUSTOR) return noWalletProfile();
        if (uid === TRUSTEE) return walletedProfile();
        return null;
      });
      setCaller(TRUSTOR);

      await expect(TrusteeRelationshipService.inviteTrustee(TRUSTEE, 'observer')).rejects.toThrow(
        'Trustor does not have an existing blockchain account'
      );
    });

    it('throws when the trustee has no active wallet', async () => {
      profileMocks.getUserProfile.mockImplementation(async (uid: string) => {
        if (uid === TRUSTOR) return walletedProfile();
        if (uid === TRUSTEE) return noWalletProfile();
        return null;
      });
      setCaller(TRUSTOR);

      await expect(TrusteeRelationshipService.inviteTrustee(TRUSTEE, 'observer')).rejects.toThrow(
        'Trustee does not have an existing blockchain account'
      );
    });

    it('throws when the target is already an active trustee', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'active' });
      setCaller(TRUSTOR);

      await expect(TrusteeRelationshipService.inviteTrustee(TRUSTEE, 'observer')).rejects.toThrow(
        'This user is already an active trustee'
      );
    });

    it('throws when an invite is already pending', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'pending' });
      setCaller(TRUSTOR);

      await expect(TrusteeRelationshipService.inviteTrustee(TRUSTEE, 'observer')).rejects.toThrow(
        'An invite is already pending for this user'
      );
    });

    it('throws before any write when the trustor has no wallet linked (WalletService check)', async () => {
      walletMocks.requireUserWalletAddress.mockRejectedValue(
        new Error('You must have a linked wallet to perform blockchain actions')
      );
      setCaller(TRUSTOR);

      await expect(TrusteeRelationshipService.inviteTrustee(TRUSTEE, 'observer')).rejects.toThrow(
        'You must have a linked wallet to perform blockchain actions'
      );
      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      expect(snap.exists()).toBe(false);
    });

    it('creates a new pending relationship, fans out permissions, then proposes on-chain with a deferred blockchainRef', async () => {
      permissionMocks.getRecordsForTrustor.mockResolvedValue([
        { recordId: 'r1', trustorRole: 'owner', recordTrustees: [] },
      ]);
      setCaller(TRUSTOR);

      await TrusteeRelationshipService.inviteTrustee(TRUSTEE, 'custodian');

      expect(permissionMocks.getRecordsForTrustor).toHaveBeenCalledWith(TRUSTOR, TRUSTEE);
      expect(permissionMocks.grantPendingTrusteeAccess).toHaveBeenCalledWith(TRUSTEE, 'custodian');
      expect(roleManagerMocks.proposeTrustee).toHaveBeenCalledWith(TRUSTEE, 1, ['r1']);

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      const data = snap.data()!;
      expect(data.status).toBe('pending');
      expect(data.isActive).toBe(false);
      expect(data.trustLevel).toBe('custodian');
      expect(data).not.toHaveProperty('onChainEvents');

      const history = await getTrusteeHistory(TRUSTOR, TRUSTEE);
      expect(history).toHaveLength(1);
      expect(history[0]!.action).toBe('propose');
      expect(history[0]!.blockchainRef).toMatchObject({ txHash: '0xpropose', blockNumber: 1 });

      const syncDocs = await getSyncQueueDocs();
      expect(syncDocs).toHaveLength(1);
      expect(syncDocs[0]).toMatchObject({ status: 'confirmed', action: 'proposeTrustee' });
    });

    it('creates the invite and fans out access even when the on-chain proposal rejects, logging it for reconciliation', async () => {
      roleManagerMocks.proposeTrustee.mockRejectedValue(new Error('transaction reverted'));
      setCaller(TRUSTOR);

      // Firestore-first: the chain call is best-effort and does not revert the invite/fan-out
      // that already succeeded, so this resolves rather than throwing.
      await expect(
        TrusteeRelationshipService.inviteTrustee(TRUSTEE, 'observer')
      ).resolves.toBeUndefined();

      expect(permissionMocks.grantPendingTrusteeAccess).toHaveBeenCalledWith(TRUSTEE, 'observer');

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      expect(snap.data()?.status).toBe('pending');

      // The trusteeHistory event is written atomically with the relationship doc's own
      // state-transition — it's the audit record of what happened in Firestore, independent of
      // whether the chain call ever confirms. blockchainRef stays null since there's no tx to cite.
      const history = await getTrusteeHistory(TRUSTOR, TRUSTEE);
      expect(history).toHaveLength(1);
      expect(history[0]!.action).toBe('propose');
      expect(history[0]!.blockchainRef).toBeNull();

      const syncDocs = await getSyncQueueDocs();
      expect(syncDocs).toHaveLength(1);
      expect(syncDocs[0]).toMatchObject({
        status: 'failed',
        action: 'proposeTrustee',
        error: 'transaction reverted',
      });
    });

    it('reactivates a previously revoked relationship as a new pending invite, appending a second trusteeHistory event', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'revoked', trustLevel: 'controller' });
      await setDoc(
        doc(
          collection(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE), 'trusteeHistory'),
          'old-event'
        ),
        { action: 'propose', changedBy: TRUSTOR, changedAt: Timestamp.now(), blockchainRef: { txHash: '0xold', chainId: 1, blockNumber: 0, contractAddress: '0x1' } }
      );
      setCaller(TRUSTOR);

      await TrusteeRelationshipService.inviteTrustee(TRUSTEE, 'observer');

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      const data = snap.data()!;
      expect(data.status).toBe('pending');
      expect(data.trustLevel).toBe('observer');

      const history = await getTrusteeHistory(TRUSTOR, TRUSTEE);
      expect(history).toHaveLength(2);
    });
  });

  describe('revokeTrustee', () => {
    it('throws when not authenticated', async () => {
      await expect(TrusteeRelationshipService.revokeTrustee(TRUSTEE)).rejects.toThrow(
        'User not authenticated'
      );
    });

    it('throws when no relationship exists', async () => {
      setCaller(TRUSTOR);
      await expect(TrusteeRelationshipService.revokeTrustee(TRUSTEE)).rejects.toThrow(
        'Trustee relationship not found'
      );
    });

    it('throws when already revoked', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'revoked' });
      setCaller(TRUSTOR);
      await expect(TrusteeRelationshipService.revokeTrustee(TRUSTEE)).rejects.toThrow(
        'Relationship is already revoked'
      );
    });

    it('throws when the relationship was declined', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'declined' });
      setCaller(TRUSTOR);
      await expect(TrusteeRelationshipService.revokeTrustee(TRUSTEE)).rejects.toThrow(
        'Cannot revoke a declined relationship'
      );
    });

    it('revokes an active relationship via revokeTrusteeAccess, deferring blockchainRef', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'active', isActive: true });
      setCaller(TRUSTOR);

      await TrusteeRelationshipService.revokeTrustee(TRUSTEE);

      expect(permissionMocks.revokeTrusteeAccess).toHaveBeenCalledWith(TRUSTOR, TRUSTEE);
      expect(permissionMocks.rollbackPendingTrusteeAccess).not.toHaveBeenCalled();

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      const data = snap.data()!;
      expect(data.status).toBe('revoked');
      expect(data.isActive).toBe(false);
      expect(data.revokedBy).toBe(TRUSTOR);
      expect(data.statusUpdateReason).toBe('trustor_revoked');

      const history = await getTrusteeHistory(TRUSTOR, TRUSTEE);
      expect(history).toHaveLength(1);
      expect(history[0]!.action).toBe('revoke');
      expect(history[0]!.blockchainRef).toMatchObject({ txHash: '0xrevoke', blockNumber: 4 });
    });

    it('revokes a pending relationship via rollbackPendingTrusteeAccess instead', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'pending' });
      setCaller(TRUSTOR);

      await TrusteeRelationshipService.revokeTrustee(TRUSTEE);

      expect(permissionMocks.rollbackPendingTrusteeAccess).toHaveBeenCalledWith(TRUSTOR, TRUSTEE);
      expect(permissionMocks.revokeTrusteeAccess).not.toHaveBeenCalled();
    });

    it('keeps the relationship revoked in Firestore when the blockchain call rejects (including a benign "already done" revert), and logs it for reconciliation', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'active', isActive: true });
      roleManagerMocks.revokeTrustee.mockRejectedValue(new Error('transaction reverted'));
      setCaller(TRUSTOR);

      await expect(TrusteeRelationshipService.revokeTrustee(TRUSTEE)).resolves.toBeUndefined();

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      expect(snap.data()?.status).toBe('revoked');
      const history = await getTrusteeHistory(TRUSTOR, TRUSTEE);
      expect(history).toHaveLength(1);
      expect(history[0]!.action).toBe('revoke');
      expect(history[0]!.blockchainRef).toBeNull();

      const syncDocs = await getSyncQueueDocs();
      expect(syncDocs).toHaveLength(1);
      expect(syncDocs[0]).toMatchObject({
        status: 'failed',
        action: 'revokeTrustee',
        error: 'transaction reverted',
      });
    });
  });

  describe('editTrusteeRelationship', () => {
    it('throws when not authenticated', async () => {
      await expect(
        TrusteeRelationshipService.editTrusteeRelationship(TRUSTEE, 'controller')
      ).rejects.toThrow('User not authenticated');
    });

    it('throws when no relationship exists', async () => {
      setCaller(TRUSTOR);
      await expect(
        TrusteeRelationshipService.editTrusteeRelationship(TRUSTEE, 'controller')
      ).rejects.toThrow('Trustee relationship not found');
    });

    it('throws when the relationship is not active', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'pending' });
      setCaller(TRUSTOR);
      await expect(
        TrusteeRelationshipService.editTrusteeRelationship(TRUSTEE, 'controller')
      ).rejects.toThrow('Can only edit an active trustee relationship');
    });

    it('throws when selecting the same trust level', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'active', trustLevel: 'custodian' });
      setCaller(TRUSTOR);
      await expect(
        TrusteeRelationshipService.editTrusteeRelationship(TRUSTEE, 'custodian')
      ).rejects.toThrow('Trustee already has this trust level');
    });

    it('upgrades the trust level, marks statusUpdateReason as an upgrade, and defers blockchainRef', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'active', trustLevel: 'observer' });
      setCaller(TRUSTOR);

      await TrusteeRelationshipService.editTrusteeRelationship(TRUSTEE, 'custodian');

      expect(roleManagerMocks.updateTrusteeLevel).toHaveBeenCalledWith(TRUSTEE, 1);
      expect(permissionMocks.updateTrusteeAccess).toHaveBeenCalledWith(TRUSTOR, TRUSTEE, 'custodian');

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      const data = snap.data()!;
      expect(data.trustLevel).toBe('custodian');
      expect(data.statusUpdateReason).toBe('trust_level_upgrade');

      const history = await getTrusteeHistory(TRUSTOR, TRUSTEE);
      expect(history).toHaveLength(1);
      expect(history[0]!.action).toBe('level-update');
      expect(history[0]!.blockchainRef).toMatchObject({ txHash: '0xupdate', blockNumber: 6 });
    });

    it('downgrades the trust level and marks statusUpdateReason as a downgrade', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'active', trustLevel: 'controller' });
      setCaller(TRUSTOR);

      await TrusteeRelationshipService.editTrusteeRelationship(TRUSTEE, 'custodian');

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      expect(snap.data()?.statusUpdateReason).toBe('trust_level_downgrade');
    });

    it('still updates Firestore even when the permission fan-out rejects (non-fatal)', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'active', trustLevel: 'observer' });
      permissionMocks.updateTrusteeAccess.mockRejectedValue(new Error('fan-out down'));
      setCaller(TRUSTOR);

      await TrusteeRelationshipService.editTrusteeRelationship(TRUSTEE, 'custodian');

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      expect(snap.data()?.trustLevel).toBe('custodian');
    });

    it('keeps the Firestore level change when the blockchain call rejects (including a benign "already done" revert), and logs it for reconciliation', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'active', trustLevel: 'observer' });
      roleManagerMocks.updateTrusteeLevel.mockRejectedValue(new Error('transaction reverted'));
      setCaller(TRUSTOR);

      await expect(
        TrusteeRelationshipService.editTrusteeRelationship(TRUSTEE, 'custodian')
      ).resolves.toBeUndefined();

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      expect(snap.data()?.trustLevel).toBe('custodian');
      const history = await getTrusteeHistory(TRUSTOR, TRUSTEE);
      expect(history).toHaveLength(1);
      expect(history[0]!.action).toBe('level-update');
      expect(history[0]!.blockchainRef).toBeNull();

      const syncDocs = await getSyncQueueDocs();
      expect(syncDocs).toHaveLength(1);
      expect(syncDocs[0]).toMatchObject({ status: 'failed', action: 'updateTrusteeLevel' });
    });
  });

  describe('stepDownTrusteeLevel', () => {
    it('throws when not authenticated', async () => {
      await expect(
        TrusteeRelationshipService.stepDownTrusteeLevel(TRUSTOR, 'observer')
      ).rejects.toThrow('User not authenticated');
    });

    it('throws when no relationship exists', async () => {
      setCaller(TRUSTEE);
      await expect(
        TrusteeRelationshipService.stepDownTrusteeLevel(TRUSTOR, 'observer')
      ).rejects.toThrow('Trustee relationship not found');
    });

    it('throws when the relationship is not active', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'pending' });
      setCaller(TRUSTEE);
      await expect(
        TrusteeRelationshipService.stepDownTrusteeLevel(TRUSTOR, 'observer')
      ).rejects.toThrow('Can only step down from an active relationship');
    });

    it('throws when attempting to step up (or sideways) instead of down', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'active', trustLevel: 'custodian' });
      setCaller(TRUSTEE);
      await expect(
        TrusteeRelationshipService.stepDownTrusteeLevel(TRUSTOR, 'controller')
      ).rejects.toThrow('Can only step down to a lower trust level');
      await expect(
        TrusteeRelationshipService.stepDownTrusteeLevel(TRUSTOR, 'custodian')
      ).rejects.toThrow('Can only step down to a lower trust level');
    });

    it('steps down the trust level on success, deferring blockchainRef', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'active', trustLevel: 'controller' });
      setCaller(TRUSTEE);

      await TrusteeRelationshipService.stepDownTrusteeLevel(TRUSTOR, 'observer');

      expect(roleManagerMocks.downgradeTrusteeLevel).toHaveBeenCalledWith(TRUSTOR, 0);
      expect(permissionMocks.updateTrusteeAccess).toHaveBeenCalledWith(TRUSTOR, TRUSTEE, 'observer');

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      const data = snap.data()!;
      expect(data.trustLevel).toBe('observer');
      expect(data.statusUpdateReason).toBe('trust_level_downgrade');

      const history = await getTrusteeHistory(TRUSTOR, TRUSTEE);
      expect(history).toHaveLength(1);
      expect(history[0]!.blockchainRef).toMatchObject({ txHash: '0xdowngrade', blockNumber: 5 });
    });

    it('still updates Firestore even when the permission fan-out rejects (non-fatal)', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'active', trustLevel: 'controller' });
      permissionMocks.updateTrusteeAccess.mockRejectedValue(new Error('fan-out down'));
      setCaller(TRUSTEE);

      await TrusteeRelationshipService.stepDownTrusteeLevel(TRUSTOR, 'observer');

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      expect(snap.data()?.trustLevel).toBe('observer');
    });

    it('keeps the Firestore step-down when the blockchain call rejects, and logs it for reconciliation', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'active', trustLevel: 'controller' });
      roleManagerMocks.downgradeTrusteeLevel.mockRejectedValue(new Error('transaction reverted'));
      setCaller(TRUSTEE);

      await expect(
        TrusteeRelationshipService.stepDownTrusteeLevel(TRUSTOR, 'observer')
      ).resolves.toBeUndefined();

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      expect(snap.data()?.trustLevel).toBe('observer');
      const history = await getTrusteeHistory(TRUSTOR, TRUSTEE);
      expect(history).toHaveLength(1);
      expect(history[0]!.action).toBe('level-update');
      expect(history[0]!.blockchainRef).toBeNull();

      const syncDocs = await getSyncQueueDocs();
      expect(syncDocs).toHaveLength(1);
      expect(syncDocs[0]).toMatchObject({ status: 'failed', action: 'downgradeTrusteeLevel' });
    });
  });

  describe('acceptInvite', () => {
    it('throws when not authenticated', async () => {
      await expect(TrusteeRelationshipService.acceptInvite(TRUSTOR)).rejects.toThrow(
        'User not authenticated'
      );
    });

    it('throws when no invite exists', async () => {
      setCaller(TRUSTEE);
      await expect(TrusteeRelationshipService.acceptInvite(TRUSTOR)).rejects.toThrow(
        'Trustee invite not found'
      );
    });

    it('throws with the current status when the invite is not pending', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'active' });
      setCaller(TRUSTEE);
      await expect(TrusteeRelationshipService.acceptInvite(TRUSTOR)).rejects.toThrow(
        'Cannot accept an invite with status: active'
      );
    });

    it('throws when the caller is not the intended recipient', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'pending', trusteeId: STRANGER });
      setCaller(TRUSTEE);
      await expect(TrusteeRelationshipService.acceptInvite(TRUSTOR)).rejects.toThrow(
        'You are not the intended recipient of this invite'
      );
    });

    it('throws when the trustee has no active wallet (onChainIdentity check)', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'pending' });
      profileMocks.getUserProfile.mockImplementation(async (uid: string) =>
        uid === TRUSTEE ? noWalletProfile() : walletedProfile()
      );
      setCaller(TRUSTEE);

      await expect(TrusteeRelationshipService.acceptInvite(TRUSTOR)).rejects.toThrow(
        'You need an active blockchain wallet to accept a trustee invite'
      );
    });

    it('activates the relationship on success, deferring blockchainRef', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'pending' });
      setCaller(TRUSTEE);

      await TrusteeRelationshipService.acceptInvite(TRUSTOR);

      expect(permissionMocks.activateTrusteeAccess).toHaveBeenCalledWith(TRUSTOR);

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      const data = snap.data()!;
      expect(data.status).toBe('active');
      expect(data.isActive).toBe(true);
      expect(data.respondedAt).toBeDefined();

      const history = await getTrusteeHistory(TRUSTOR, TRUSTEE);
      expect(history).toHaveLength(1);
      expect(history[0]!.action).toBe('accept');
      expect(history[0]!.blockchainRef).toMatchObject({ txHash: '0xaccept', blockNumber: 2 });
    });

    it('keeps the Firestore acceptance when the blockchain call rejects (including a benign "already done" revert), and logs it for reconciliation', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'pending' });
      roleManagerMocks.acceptTrustee.mockRejectedValue(new Error('transaction reverted'));
      setCaller(TRUSTEE);

      await expect(TrusteeRelationshipService.acceptInvite(TRUSTOR)).resolves.toBeUndefined();

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      expect(snap.data()?.status).toBe('active');
      const history = await getTrusteeHistory(TRUSTOR, TRUSTEE);
      expect(history).toHaveLength(1);
      expect(history[0]!.action).toBe('accept');
      expect(history[0]!.blockchainRef).toBeNull();

      const syncDocs = await getSyncQueueDocs();
      expect(syncDocs).toHaveLength(1);
      expect(syncDocs[0]).toMatchObject({ status: 'failed', action: 'acceptTrustee' });
    });
  });

  describe('declineInvite', () => {
    it('throws when not authenticated', async () => {
      await expect(TrusteeRelationshipService.declineInvite(TRUSTOR)).rejects.toThrow(
        'User not authenticated'
      );
    });

    it('throws when no invite exists', async () => {
      setCaller(TRUSTEE);
      await expect(TrusteeRelationshipService.declineInvite(TRUSTOR)).rejects.toThrow(
        'Trustee invite not found'
      );
    });

    it('throws with the current status when the invite is not pending', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'declined' });
      setCaller(TRUSTEE);
      await expect(TrusteeRelationshipService.declineInvite(TRUSTOR)).rejects.toThrow(
        'Cannot decline an invite with status: declined'
      );
    });

    it('rolls back pending permissions, marks the relationship declined, then defers blockchainRef', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'pending' });
      setCaller(TRUSTEE);

      await TrusteeRelationshipService.declineInvite(TRUSTOR);

      expect(permissionMocks.rollbackPendingTrusteeAccess).toHaveBeenCalledWith(TRUSTOR, TRUSTEE);

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      const data = snap.data()!;
      expect(data.status).toBe('declined');
      expect(data.isActive).toBe(false);
      expect(data.revokedBy).toBe(TRUSTEE);

      const history = await getTrusteeHistory(TRUSTOR, TRUSTEE);
      expect(history).toHaveLength(1);
      expect(history[0]!.action).toBe('decline');
      expect(history[0]!.blockchainRef).toMatchObject({ txHash: '0xdecline', blockNumber: 3 });
    });

    it('keeps the Firestore decline when the blockchain call rejects, and logs it for reconciliation', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'pending' });
      roleManagerMocks.declineTrustee.mockRejectedValue(new Error('transaction reverted'));
      setCaller(TRUSTEE);

      await expect(TrusteeRelationshipService.declineInvite(TRUSTOR)).resolves.toBeUndefined();

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      expect(snap.data()?.status).toBe('declined');
      const history = await getTrusteeHistory(TRUSTOR, TRUSTEE);
      expect(history).toHaveLength(1);
      expect(history[0]!.action).toBe('decline');
      expect(history[0]!.blockchainRef).toBeNull();

      const syncDocs = await getSyncQueueDocs();
      expect(syncDocs).toHaveLength(1);
      expect(syncDocs[0]).toMatchObject({ status: 'failed', action: 'declineTrustee' });
    });
  });

  describe('resignAsTrustee', () => {
    it('throws when not authenticated', async () => {
      await expect(TrusteeRelationshipService.resignAsTrustee(TRUSTOR)).rejects.toThrow(
        'User not authenticated'
      );
    });

    it('throws when no relationship exists', async () => {
      setCaller(TRUSTEE);
      await expect(TrusteeRelationshipService.resignAsTrustee(TRUSTOR)).rejects.toThrow(
        'Trustee relationship not found'
      );
    });

    it('throws when the relationship is not active', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'pending' });
      setCaller(TRUSTEE);
      await expect(TrusteeRelationshipService.resignAsTrustee(TRUSTOR)).rejects.toThrow(
        'Can only resign from an active trustee relationship'
      );
    });

    it('revokes access and marks the relationship declined with trustee_resigned as the reason', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'active', isActive: true });
      setCaller(TRUSTEE);

      await TrusteeRelationshipService.resignAsTrustee(TRUSTOR);

      expect(permissionMocks.revokeTrusteeAccess).toHaveBeenCalledWith(TRUSTOR, TRUSTEE);

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      const data = snap.data()!;
      // Resignation lands on 'declined', not 'revoked' — distinct from the trustor-initiated
      // revokeTrustee flow above, even though both call the same TrusteePermissionService method.
      expect(data.status).toBe('declined');
      expect(data.isActive).toBe(false);
      expect(data.revokedBy).toBe(TRUSTEE);
      expect(data.statusUpdateReason).toBe('trustee_resigned');

      const history = await getTrusteeHistory(TRUSTOR, TRUSTEE);
      expect(history).toHaveLength(1);
      expect(history[0]!.action).toBe('revoke');
    });

    it('keeps the Firestore resignation when the blockchain call rejects, and logs it for reconciliation', async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'active', isActive: true });
      roleManagerMocks.revokeTrustee.mockRejectedValue(new Error('transaction reverted'));
      setCaller(TRUSTEE);

      await expect(TrusteeRelationshipService.resignAsTrustee(TRUSTOR)).resolves.toBeUndefined();

      const snap = await getDoc(
        doc(db, 'trusteeRelationships', getTrusteeRelationshipId(TRUSTOR, TRUSTEE))
      );
      expect(snap.data()?.status).toBe('declined');
      const history = await getTrusteeHistory(TRUSTOR, TRUSTEE);
      expect(history).toHaveLength(1);
      expect(history[0]!.action).toBe('revoke');
      expect(history[0]!.blockchainRef).toBeNull();

      const syncDocs = await getSyncQueueDocs();
      expect(syncDocs).toHaveLength(1);
      expect(syncDocs[0]).toMatchObject({ status: 'failed', action: 'revokeTrustee' });
    });
  });

  describe('query methods', () => {
    beforeEach(async () => {
      await seedRelationship(TRUSTOR, TRUSTEE, { status: 'active', isActive: true, trustLevel: 'controller' });
      await seedRelationship(TRUSTOR, STRANGER, { status: 'pending', isActive: false });
    });

    describe('getTrusteesForTrustor', () => {
      it('throws when not authenticated', async () => {
        await expect(TrusteeRelationshipService.getTrusteesForTrustor()).rejects.toThrow(
          'User not authenticated'
        );
      });

      it('returns only active relationships for the given trustor', async () => {
        setCaller(TRUSTOR);
        const result = await TrusteeRelationshipService.getTrusteesForTrustor(TRUSTOR);
        expect(result).toHaveLength(1);
        expect(result[0]!.trusteeId).toBe(TRUSTEE);
      });

      it('defaults to the current user when no trustorId is given', async () => {
        setCaller(TRUSTOR);
        const result = await TrusteeRelationshipService.getTrusteesForTrustor();
        expect(result).toHaveLength(1);
      });
    });

    describe('getTrustorAccountsForTrustee', () => {
      it('throws when not authenticated', async () => {
        await expect(TrusteeRelationshipService.getTrustorAccountsForTrustee()).rejects.toThrow(
          'User not authenticated'
        );
      });

      it("returns the accounts the caller actively manages", async () => {
        setCaller(TRUSTEE);
        const result = await TrusteeRelationshipService.getTrustorAccountsForTrustee();
        expect(result).toHaveLength(1);
        expect(result[0]!.trustorId).toBe(TRUSTOR);
      });
    });

    describe('getPendingInvitesForTrustee', () => {
      it('throws when not authenticated', async () => {
        await expect(TrusteeRelationshipService.getPendingInvitesForTrustee()).rejects.toThrow(
          'User not authenticated'
        );
      });

      it('returns only pending invites for the caller', async () => {
        setCaller(STRANGER);
        const result = await TrusteeRelationshipService.getPendingInvitesForTrustee();
        expect(result).toHaveLength(1);
        expect(result[0]!.trustorId).toBe(TRUSTOR);
      });
    });

    describe('getRelationship', () => {
      it('returns null when no relationship exists', async () => {
        await expect(
          TrusteeRelationshipService.getRelationship(TRUSTOR, 'nobody')
        ).resolves.toBeNull();
      });

      it('returns the relationship data when it exists', async () => {
        const result = await TrusteeRelationshipService.getRelationship(TRUSTOR, TRUSTEE);
        expect(result?.trustLevel).toBe('controller');
      });
    });

    describe('getControllerRelationshipWith', () => {
      it('returns null when not authenticated', async () => {
        await expect(
          TrusteeRelationshipService.getControllerRelationshipWith(TRUSTOR)
        ).resolves.toBeNull();
      });

      it('returns the relationship when the caller is an active controller trustee', async () => {
        setCaller(TRUSTEE);
        const result = await TrusteeRelationshipService.getControllerRelationshipWith(TRUSTOR);
        expect(result?.trustLevel).toBe('controller');
      });

      it('returns null when the caller is only a pending (not-yet-active) trustee', async () => {
        setCaller(STRANGER);
        const result = await TrusteeRelationshipService.getControllerRelationshipWith(TRUSTOR);
        expect(result).toBeNull();
      });
    });

    describe('getActiveControllerTrustors', () => {
      it('returns an empty array when not authenticated', async () => {
        await expect(TrusteeRelationshipService.getActiveControllerTrustors()).resolves.toEqual([]);
      });

      it('returns only active controller-level relationships for the caller', async () => {
        setCaller(TRUSTEE);
        const result = await TrusteeRelationshipService.getActiveControllerTrustors();
        expect(result).toHaveLength(1);
        expect(result[0]!.trustorId).toBe(TRUSTOR);
      });

      it('excludes active relationships at a lower trust level', async () => {
        await seedRelationship('another-trustor', TRUSTEE, {
          status: 'active',
          isActive: true,
          trustLevel: 'observer',
        });
        setCaller(TRUSTEE);

        const result = await TrusteeRelationshipService.getActiveControllerTrustors();
        expect(result.map(r => r.trustorId)).toEqual([TRUSTOR]);
      });
    });
  });
});
