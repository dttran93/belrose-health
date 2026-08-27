// test/orchestration/verificationService.test.ts
//
// Layer 3 (orchestration) — verificationService.ts, the first real exercise of its Firestore-first
// pattern (subjectService.test.ts mocks this module out entirely rather than running it). Real
// Firestore emulator, real credibilityScoreService (computeNormalizedCredibility/scoreEvents/
// record score aggregation) and real BlockchainSyncQueueService — only firebase/auth (needed by
// credibilityScoreService.getCurrentUser), WalletService.requireUserWalletAddress, and
// blockchainHealthRecordService's chain calls are mocked. Also covers recordReviewStatusService
// (a thin read-side composition of getVerification/getDisputesByRecordId) and
// credibilityScoreService.updateRecordScore's hash-scoping behavior, both folded in here per the
// test plan rather than getting their own files.

import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { doc, getDoc, getDocs, collection, setDoc } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import {
  connectTestFirestore,
  clearTestFirestore,
  seedRecord,
  seedVerification,
  seedDispute,
} from './helpers/testFirestore';

const { mockCurrentUser, walletMocks, healthRecordMocks } = vi.hoisted(() => ({
  mockCurrentUser: { uid: null as string | null },
  walletMocks: {
    requireUserWalletAddress: vi.fn(),
  },
  healthRecordMocks: {
    verifyRecord: vi.fn(),
    retractVerification: vi.fn(),
    modifyVerificationLevel: vi.fn(),
  },
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockCurrentUser.uid ? { uid: mockCurrentUser.uid } : null }),
}));

vi.mock('@/features/BlockchainWallet/services/walletService', () => ({
  WalletService: walletMocks,
}));

vi.mock('@/features/CredibilityRecord/services/blockchainHealthRecordService', () => ({
  blockchainHealthRecordService: healthRecordMocks,
}));

import {
  createVerification,
  recordSelfVerification,
  retractVerification,
  modifyVerificationLevel,
  getVerification,
  getVerificationsByRecordId,
  getVerificationsByUserId,
  getVerificationId,
} from '@/features/CredibilityRecord/services/verificationService';
import { getRecordReviewStatus } from '@/features/CredibilityRecord/services/recordReviewStatusService';
import { updateRecordScore } from '@/features/CredibilityRecord/services/credibilityScoreService';

const RECORD_ID = 'verification-service-record';
const RECORD_HASH = 'verification-service-hash';
const VERIFIER = 'verification-service-verifier';
const OTHER_USER = 'verification-service-other';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

const db = connectTestFirestore('belrose-orchestration-verification-service');

describe('verificationService (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.resetAllMocks();
    healthRecordMocks.verifyRecord.mockResolvedValue({ txHash: '0xverify', blockNumber: 10 });
    healthRecordMocks.retractVerification.mockResolvedValue({ txHash: '0xretract', blockNumber: 11 });
    healthRecordMocks.modifyVerificationLevel.mockResolvedValue({ txHash: '0xmodify', blockNumber: 12 });
    walletMocks.requireUserWalletAddress.mockResolvedValue('0xWallet');
    setCaller(VERIFIER);
    await seedRecord(db, RECORD_ID, { owners: [VERIFIER] });
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  describe('createVerification', () => {
    it('creates pending then confirms on blockchain success', async () => {
      const id = await createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 2);
      expect(id).toBe(getVerificationId(RECORD_HASH, VERIFIER));

      const snap = await getDoc(doc(db, 'verifications', id));
      expect(snap.data()).toMatchObject({
        chainStatus: 'confirmed',
        isActive: true,
        level: 2,
        normalizedCredibilityAtCreation: 1.0,
      });
      expect(snap.data()?.onChainHistory).toHaveLength(1);
      expect(snap.data()?.onChainHistory[0]).toMatchObject({
        action: 'verified',
        blockchainRef: { txHash: '0xverify', blockNumber: 10 },
      });
    });

    it('throws when the record does not exist', async () => {
      await expect(createVerification('nonexistent', RECORD_HASH, VERIFIER, 2)).rejects.toThrow(
        'Record not found.'
      );
    });

    it('blocks a duplicate when the existing verification is active and confirmed', async () => {
      await seedVerification(db, RECORD_ID, RECORD_HASH, VERIFIER, {
        chainStatus: 'confirmed',
        isActive: true,
      });
      await expect(createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 3)).rejects.toThrow(
        'You have already verified this record. Use modify to update.'
      );
    });

    it('allows retry when the existing verification is pending', async () => {
      await seedVerification(db, RECORD_ID, RECORD_HASH, VERIFIER, { chainStatus: 'pending' });
      await expect(createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 3)).resolves.toBeTruthy();
    });

    it('allows retry when the existing verification previously failed', async () => {
      await seedVerification(db, RECORD_ID, RECORD_HASH, VERIFIER, { chainStatus: 'failed' });
      await expect(createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 3)).resolves.toBeTruthy();
    });

    it('blocks verifying a recordHash the caller has an active dispute on', async () => {
      await seedDispute(db, RECORD_ID, RECORD_HASH, VERIFIER, { isActive: true });
      await expect(createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 2)).rejects.toThrow(
        'You cannot both verify and dispute the same record hash'
      );
    });

    it('allows verifying when the caller only has an inactive dispute on the hash', async () => {
      await seedDispute(db, RECORD_ID, RECORD_HASH, VERIFIER, { isActive: false });
      await expect(createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 2)).resolves.toBeTruthy();
    });

    it('throws before any write when the caller has no linked wallet', async () => {
      walletMocks.requireUserWalletAddress.mockRejectedValue(
        new Error('You must have a linked wallet to perform blockchain actions')
      );
      await expect(createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 2)).rejects.toThrow(
        'linked wallet'
      );
      const snap = await getDoc(doc(db, 'verifications', getVerificationId(RECORD_HASH, VERIFIER)));
      expect(snap.exists()).toBe(false);
    });

    it('freezes normalizedCredibilityAtCreation across retract -> reactivate, even if UserCredibility inputs change', async () => {
      await createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 2);
      await retractVerification(RECORD_HASH, VERIFIER);

      // Simulate the network average / verifier's own credibility having moved since.
      await setDoc(doc(db, 'users', VERIFIER), { credibility: { score: 900 } }, { merge: true });
      await setDoc(doc(db, 'credibilityStats', 'global'), { avgUserCredibility: 450 }, { merge: true });

      await createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 3);
      const snap = await getDoc(doc(db, 'verifications', getVerificationId(RECORD_HASH, VERIFIER)));
      expect(snap.data()?.normalizedCredibilityAtCreation).toBe(1.0);
    });

    it('writes a scoreEvent and updates the record score on blockchain success', async () => {
      await createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 2);

      const events = await getDocs(collection(db, 'records', RECORD_ID, 'scoreEvents'));
      expect(events.size).toBe(1);
      expect(events.docs[0]!.data()).toMatchObject({ eventType: 'verification', recordHash: RECORD_HASH });

      const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      // Bayesian average: (C*basePrior + verificationWeight[2]*normalizedCredibility) / (C + 1)
      //                 = (5*500 + 800*1.0) / 6 = 550
      expect(recordSnap.data()?.credibility?.score).toBe(550);

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(1);
      expect(syncDocs.docs[0]!.data()).toMatchObject({ status: 'confirmed', action: 'verifyRecord' });
    });

    it('still writes the scoreEvent and updates the record score when the blockchain call fails', async () => {
      healthRecordMocks.verifyRecord.mockRejectedValue(new Error('transaction reverted'));

      await expect(createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 2)).resolves.toBeTruthy();

      const snap = await getDoc(doc(db, 'verifications', getVerificationId(RECORD_HASH, VERIFIER)));
      expect(snap.data()?.chainStatus).toBe('failed');
      expect(snap.data()?.onChainHistory).toEqual([]);

      const events = await getDocs(collection(db, 'records', RECORD_ID, 'scoreEvents'));
      expect(events.size).toBe(1);
      const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      expect(recordSnap.data()?.credibility?.score).toBe(550);

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(1);
      expect(syncDocs.docs[0]!.data()).toMatchObject({
        status: 'failed',
        action: 'verifyRecord',
        error: 'transaction reverted',
      });
    });

    it('returns the right sets from the query helpers', async () => {
      await createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 2);

      setCaller(OTHER_USER);
      walletMocks.requireUserWalletAddress.mockResolvedValue('0xWallet2');
      await createVerification(RECORD_ID, RECORD_HASH, OTHER_USER, 3);

      const byRecord = await getVerificationsByRecordId(RECORD_ID);
      expect(byRecord).toHaveLength(2);

      const byUser = await getVerificationsByUserId(VERIFIER);
      expect(byUser).toHaveLength(1);
      expect(byUser[0]?.verifierId).toBe(VERIFIER);
    });
  });

  describe('recordSelfVerification', () => {
    const BLOCKCHAIN_REF = {
      txHash: '0xself',
      blockNumber: 20,
      chainId: 84532,
      contractAddress: '0xHealthRecordCore',
    };

    it('creates confirmed immediately without ever calling the chain', async () => {
      const id = await recordSelfVerification(RECORD_ID, RECORD_HASH, VERIFIER, 3, BLOCKCHAIN_REF);
      expect(id).toBe(getVerificationId(RECORD_HASH, VERIFIER));
      expect(healthRecordMocks.verifyRecord).not.toHaveBeenCalled();

      const snap = await getDoc(doc(db, 'verifications', id!));
      expect(snap.data()).toMatchObject({ chainStatus: 'confirmed', level: 3 });
      expect(snap.data()?.onChainHistory).toEqual([
        { action: 'verified', at: expect.anything(), blockchainRef: BLOCKCHAIN_REF },
      ]);

      const events = await getDocs(collection(db, 'records', RECORD_ID, 'scoreEvents'));
      expect(events.size).toBe(1);
    });

    it('returns null and writes nothing when already active and confirmed (mirrors the contract no-op)', async () => {
      await seedVerification(db, RECORD_ID, RECORD_HASH, VERIFIER, {
        isActive: true,
        chainStatus: 'confirmed',
      });
      const result = await recordSelfVerification(RECORD_ID, RECORD_HASH, VERIFIER, 3, BLOCKCHAIN_REF);
      expect(result).toBeNull();
    });

    it('returns null and writes nothing when the caller has an active dispute on the hash', async () => {
      await seedDispute(db, RECORD_ID, RECORD_HASH, VERIFIER, { isActive: true });
      const result = await recordSelfVerification(RECORD_ID, RECORD_HASH, VERIFIER, 3, BLOCKCHAIN_REF);
      expect(result).toBeNull();
      const snap = await getDoc(doc(db, 'verifications', getVerificationId(RECORD_HASH, VERIFIER)));
      expect(snap.exists()).toBe(false);
    });

    it('reactivates an inactive verification and reuses its frozen normalizedCredibilityAtCreation', async () => {
      await seedVerification(db, RECORD_ID, RECORD_HASH, VERIFIER, {
        isActive: false,
        chainStatus: 'confirmed',
        normalizedCredibilityAtCreation: 0.42,
      });
      await recordSelfVerification(RECORD_ID, RECORD_HASH, VERIFIER, 1, BLOCKCHAIN_REF);
      const snap = await getDoc(doc(db, 'verifications', getVerificationId(RECORD_HASH, VERIFIER)));
      expect(snap.data()?.normalizedCredibilityAtCreation).toBe(0.42);
    });
  });

  describe('retractVerification', () => {
    beforeEach(async () => {
      await createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 2);
    });

    it('retracts and confirms on blockchain success', async () => {
      await retractVerification(RECORD_HASH, VERIFIER);

      const snap = await getDoc(doc(db, 'verifications', getVerificationId(RECORD_HASH, VERIFIER)));
      expect(snap.data()).toMatchObject({ isActive: false, chainStatus: 'confirmed' });
      expect(snap.data()?.onChainHistory).toHaveLength(2); // 'verified' + 'retracted'

      const events = await getDocs(collection(db, 'records', RECORD_ID, 'scoreEvents'));
      expect(events.size).toBe(2);
    });

    it('throws for a nonexistent verification', async () => {
      await expect(retractVerification('nonexistent-hash', VERIFIER)).rejects.toThrow(
        'Verification not found'
      );
    });

    it('throws when already inactive', async () => {
      await retractVerification(RECORD_HASH, VERIFIER);
      await expect(retractVerification(RECORD_HASH, VERIFIER)).rejects.toThrow(
        'Verification is already inactive'
      );
    });

    it('throws for a non-owner caller and leaves the doc untouched', async () => {
      // The doc id already embeds the true owner (getVerificationId(hash, verifierId)), so a
      // mismatch can only arise from a forged doc — seed one directly to exercise the defensive
      // ownership check rather than the (unreachable via the real create path) ID lookup.
      await seedVerification(db, RECORD_ID, RECORD_HASH, OTHER_USER, { verifierId: VERIFIER });

      await expect(retractVerification(RECORD_HASH, OTHER_USER)).rejects.toThrow(
        'You can only retract your own verifications'
      );
      const snap = await getDoc(doc(db, 'verifications', getVerificationId(RECORD_HASH, OTHER_USER)));
      expect(snap.data()?.isActive).toBe(true);
    });

    it('lets the Firestore retraction stand even when the blockchain call fails', async () => {
      healthRecordMocks.retractVerification.mockRejectedValue(new Error('reverted'));

      await expect(retractVerification(RECORD_HASH, VERIFIER)).resolves.toBeUndefined();

      const snap = await getDoc(doc(db, 'verifications', getVerificationId(RECORD_HASH, VERIFIER)));
      expect(snap.data()).toMatchObject({ isActive: false, chainStatus: 'failed' });
      expect(snap.data()?.onChainHistory).toHaveLength(1); // only the original 'verified' entry

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.docs.some(d => d.data().status === 'failed' && d.data().action === 'retractVerification')).toBe(
        true
      );
    });
  });

  describe('modifyVerificationLevel', () => {
    beforeEach(async () => {
      await createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 1);
    });

    it('modifies and confirms on blockchain success', async () => {
      await modifyVerificationLevel(RECORD_HASH, VERIFIER, 3);

      const snap = await getDoc(doc(db, 'verifications', getVerificationId(RECORD_HASH, VERIFIER)));
      expect(snap.data()).toMatchObject({ level: 3, chainStatus: 'confirmed' });
      expect(snap.data()?.onChainHistory).toHaveLength(2);
      expect(snap.data()?.onChainHistory[1]).toMatchObject({
        action: 'modified',
        fromLevel: 1,
        toLevel: 3,
      });
    });

    it('throws for a nonexistent verification', async () => {
      await expect(modifyVerificationLevel('nonexistent-hash', VERIFIER, 3)).rejects.toThrow(
        'Verification not found'
      );
    });

    it('throws when inactive', async () => {
      await retractVerification(RECORD_HASH, VERIFIER);
      await expect(modifyVerificationLevel(RECORD_HASH, VERIFIER, 3)).rejects.toThrow(
        'Cannot modify an inactive verification'
      );
    });

    it('throws for a non-owner caller', async () => {
      // Same reasoning as retractVerification's non-owner test — forge a doc whose stored
      // verifierId doesn't match its own id-embedded owner to exercise the defensive check.
      await seedVerification(db, RECORD_ID, RECORD_HASH, OTHER_USER, { verifierId: VERIFIER });

      await expect(modifyVerificationLevel(RECORD_HASH, OTHER_USER, 3)).rejects.toThrow(
        'You can only modify your own verification'
      );
    });

    it('throws when the new level equals the current level', async () => {
      await expect(modifyVerificationLevel(RECORD_HASH, VERIFIER, 1)).rejects.toThrow(
        'New level is the same as current level'
      );
    });

    it('lets the Firestore modification stand even when the blockchain call fails', async () => {
      healthRecordMocks.modifyVerificationLevel.mockRejectedValue(new Error('reverted'));

      await expect(modifyVerificationLevel(RECORD_HASH, VERIFIER, 3)).resolves.toBeUndefined();

      const snap = await getDoc(doc(db, 'verifications', getVerificationId(RECORD_HASH, VERIFIER)));
      expect(snap.data()).toMatchObject({ level: 3, chainStatus: 'failed' });
    });
  });

  describe('getVerification', () => {
    it('returns the doc when it exists', async () => {
      await createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 2);
      const result = await getVerification(RECORD_HASH, VERIFIER);
      expect(result?.verifierId).toBe(VERIFIER);
    });

    it('returns null when it does not exist', async () => {
      const result = await getVerification('nonexistent-hash', VERIFIER);
      expect(result).toBeNull();
    });

    // Permission-denied reads can't be exercised here — this suite runs against
    // test/orchestration/permissive.rules. That branch is covered by test/rules/verifications.test.ts.
  });

  describe('record score mechanics — hash bump resets to BasePrior', () => {
    it('resets to INITIAL_SCORE when recomputed for a hash with no events yet', async () => {
      await createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 3);
      let recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      expect(recordSnap.data()?.credibility?.score).not.toBe(500);

      await updateRecordScore(RECORD_ID, 'a-brand-new-hash');
      recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      expect(recordSnap.data()?.credibility?.score).toBe(500);
    });
  });

  describe('getRecordReviewStatus (recordReviewStatusService)', () => {
    it('reflects verified-only status', async () => {
      await createVerification(RECORD_ID, RECORD_HASH, VERIFIER, 2);
      const status = await getRecordReviewStatus(RECORD_ID, RECORD_HASH, VERIFIER);
      expect(status).toMatchObject({
        hasVerification: true,
        hasDispute: false,
        hasAnyActiveReview: true,
        currentHashReviewed: true,
      });
    });

    it('reflects neither verified nor disputed', async () => {
      const status = await getRecordReviewStatus(RECORD_ID, RECORD_HASH, VERIFIER);
      expect(status.hasAnyActiveReview).toBe(false);
    });

    it('returns a safe default when currentRecordHash is missing', async () => {
      const status = await getRecordReviewStatus(RECORD_ID, undefined, VERIFIER);
      expect(status.hasAnyActiveReview).toBe(false);
    });
  });
});
