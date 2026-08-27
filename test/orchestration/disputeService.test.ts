// test/orchestration/disputeService.test.ts
//
// Layer 3 (orchestration) — disputeService.ts, same Firestore-first shape as
// verificationService.test.ts (see that file's header for the general pattern — this comment
// only calls out what's different here). Additionally mocks EncryptionKeyManager.getSessionKey
// and RecordDecryptionService.getRecordKey (narrow, feature-boundary mocks — the full E2EE
// session/wrapped-key flow is already covered end-to-end by
// test/orchestration/recordDecryptionService.test.ts) to a single fixed real CryptoKey, so
// EncryptionService's real encryptText/decryptText do a genuine AES round-trip on dispute notes
// without needing to seed wrappedKeys/RSA keypair docs.

import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { doc, getDoc, getDocs, collection, setDoc } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { ethers } from 'ethers';
import {
  connectTestFirestore,
  clearTestFirestore,
  seedRecord,
  seedVerification,
  seedDispute,
} from './helpers/testFirestore';

const { mockCurrentUser, walletMocks, healthRecordMocks, encryptionMocks } = vi.hoisted(() => ({
  mockCurrentUser: { uid: null as string | null },
  walletMocks: {
    requireUserWalletAddress: vi.fn(),
  },
  healthRecordMocks: {
    disputeRecord: vi.fn(),
    retractDispute: vi.fn(),
    modifyDispute: vi.fn(),
  },
  encryptionMocks: {
    getSessionKey: vi.fn(),
    getRecordKey: vi.fn(),
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

vi.mock('@/features/Encryption/services/encryptionKeyManager', () => ({
  EncryptionKeyManager: { getSessionKey: encryptionMocks.getSessionKey },
}));

vi.mock('@/features/Encryption/services/recordDecryptionService', () => ({
  RecordDecryptionService: { getRecordKey: encryptionMocks.getRecordKey },
}));

import {
  createDispute,
  retractDispute,
  modifyDispute,
  getDispute,
  getDisputesByRecordId,
  getDisputesByUserId,
  getDisputeId,
} from '@/features/CredibilityRecord/services/disputeService';
import { EncryptionService } from '@/features/Encryption/services/encryptionService';

const RECORD_ID = 'dispute-service-record';
const RECORD_HASH = 'dispute-service-hash';
const DISPUTER = 'dispute-service-disputer';
const OTHER_USER = 'dispute-service-other';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

const db = connectTestFirestore('belrose-orchestration-dispute-service');

describe('disputeService (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.resetAllMocks();
    healthRecordMocks.disputeRecord.mockResolvedValue({ txHash: '0xdispute', blockNumber: 30 });
    healthRecordMocks.retractDispute.mockResolvedValue({ txHash: '0xretract', blockNumber: 31 });
    healthRecordMocks.modifyDispute.mockResolvedValue({ txHash: '0xmodify', blockNumber: 32 });
    walletMocks.requireUserWalletAddress.mockResolvedValue('0xWallet');

    // A fixed real record key — genuine AES round-trip for notes without needing a real E2EE
    // session/wrappedKeys setup. The mocked masterKey value itself is never actually used since
    // getRecordKey is also mocked to ignore it and return this fixed key.
    const recordKey = await EncryptionService.generateFileKey();
    encryptionMocks.getSessionKey.mockResolvedValue({} as CryptoKey);
    encryptionMocks.getRecordKey.mockResolvedValue(recordKey);

    setCaller(DISPUTER);
    await seedRecord(db, RECORD_ID, { owners: [DISPUTER] });
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  describe('createDispute', () => {
    it('creates pending then confirms on blockchain success', async () => {
      const id = await createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 2, 0);
      expect(id).toBe(getDisputeId(RECORD_HASH, DISPUTER));

      const snap = await getDoc(doc(db, 'disputes', id));
      expect(snap.data()).toMatchObject({
        chainStatus: 'confirmed',
        isActive: true,
        severity: 2,
        culpability: 0,
        validationWeight: 0,
        recordScoreAtCreation: 500, // INITIAL_SCORE fallback — record has no credibility.score yet
        normalizedCredibilityAtCreation: 1.0,
      });
      expect(snap.data()?.onChainHistory).toHaveLength(1);
      expect(snap.data()?.onChainHistory[0]).toMatchObject({
        action: 'disputed',
        blockchainRef: { txHash: '0xdispute', blockNumber: 30 },
      });
    });

    it('snapshots recordScoreAtCreation from the record when one already exists', async () => {
      await setDoc(doc(db, 'records', RECORD_ID), { credibility: { score: 742 } }, { merge: true });
      await createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 2, 0);
      const snap = await getDoc(doc(db, 'disputes', getDisputeId(RECORD_HASH, DISPUTER)));
      expect(snap.data()?.recordScoreAtCreation).toBe(742);
    });

    it('throws when the record does not exist', async () => {
      await expect(createDispute('nonexistent', RECORD_HASH, DISPUTER, 2, 0)).rejects.toThrow(
        'Record not found.'
      );
    });

    it('blocks a duplicate when the existing dispute is active and confirmed', async () => {
      await seedDispute(db, RECORD_ID, RECORD_HASH, DISPUTER, { chainStatus: 'confirmed', isActive: true });
      await expect(createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 3, 1)).rejects.toThrow(
        'You have already disputed this record. Use modify to update.'
      );
    });

    it('allows retry when the existing dispute is pending or previously failed', async () => {
      await seedDispute(db, RECORD_ID, RECORD_HASH, DISPUTER, { chainStatus: 'pending' });
      await expect(createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 3, 1)).resolves.toBeTruthy();
    });

    it('blocks disputing a recordHash the caller has an active verification on', async () => {
      await seedVerification(db, RECORD_ID, RECORD_HASH, DISPUTER, { isActive: true });
      await expect(createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 2, 0)).rejects.toThrow(
        'You cannot both verify and dispute the same record hash'
      );
    });

    it('allows disputing when the caller only has an inactive verification on the hash', async () => {
      await seedVerification(db, RECORD_ID, RECORD_HASH, DISPUTER, { isActive: false });
      await expect(createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 2, 0)).resolves.toBeTruthy();
    });

    it('throws before any write when the caller has no linked wallet', async () => {
      walletMocks.requireUserWalletAddress.mockRejectedValue(
        new Error('You must have a linked wallet to perform blockchain actions')
      );
      await expect(createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 2, 0)).rejects.toThrow('linked wallet');
      const snap = await getDoc(doc(db, 'disputes', getDisputeId(RECORD_HASH, DISPUTER)));
      expect(snap.exists()).toBe(false);
    });

    it('freezes recordScoreAtCreation on reactivation, even if the record score has since moved', async () => {
      await seedDispute(db, RECORD_ID, RECORD_HASH, DISPUTER, {
        isActive: false,
        chainStatus: 'confirmed',
        recordScoreAtCreation: 123,
      });
      await setDoc(doc(db, 'records', RECORD_ID), { credibility: { score: 999 } }, { merge: true });

      await createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 3, 1);
      const snap = await getDoc(doc(db, 'disputes', getDisputeId(RECORD_HASH, DISPUTER)));
      expect(snap.data()?.recordScoreAtCreation).toBe(123);
    });

    it('never touches validationWeight once the server has resolved it, even across reactivation', async () => {
      await seedDispute(db, RECORD_ID, RECORD_HASH, DISPUTER, {
        isActive: false,
        chainStatus: 'confirmed',
        validationWeight: 1,
      });

      await createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 3, 1);
      const snap = await getDoc(doc(db, 'disputes', getDisputeId(RECORD_HASH, DISPUTER)));
      expect(snap.data()?.validationWeight).toBe(1);
    });

    it('encrypts notes and computes a matching notesHash, round-tripping back to the original plaintext', async () => {
      const plaintext = 'The medication dosage listed here is incorrect.';
      await createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 2, 3, plaintext);

      const snap = await getDoc(doc(db, 'disputes', getDisputeId(RECORD_HASH, DISPUTER)));
      const data = snap.data()!;
      expect(data.encryptedNotes?.encrypted).toBeTruthy();
      expect(data.encryptedNotes.encrypted).not.toBe(plaintext);
      expect(data.notesHash).toBe(ethers.keccak256(ethers.toUtf8Bytes(plaintext)));

      const decrypted = await getDispute(RECORD_HASH, DISPUTER, true);
      expect(decrypted?.notes).toBe(plaintext);
    });

    it('stores no notes when none are provided', async () => {
      await createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 2, 0);
      const snap = await getDoc(doc(db, 'disputes', getDisputeId(RECORD_HASH, DISPUTER)));
      expect(snap.data()?.encryptedNotes).toBeNull();
      expect(snap.data()?.notesHash).toBe('');
    });

    it('culpability does not affect the record score — only severity does', async () => {
      await createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 2, 0);
      const recordASnap = await getDoc(doc(db, 'records', RECORD_ID));
      const eventsA = await getDocs(collection(db, 'records', RECORD_ID, 'scoreEvents'));

      // A different recordHash — dispute doc ids are scoped by {recordHash}_{disputerId}, not
      // recordId, so reusing RECORD_HASH here would collide with the dispute created above.
      const RECORD_ID_2 = 'dispute-service-record-2';
      const RECORD_HASH_2 = 'dispute-service-hash-2';
      await seedRecord(db, RECORD_ID_2, { owners: [DISPUTER] });
      await createDispute(RECORD_ID_2, RECORD_HASH_2, DISPUTER, 2, 5); // same severity, max culpability
      const recordBSnap = await getDoc(doc(db, 'records', RECORD_ID_2));
      const eventsB = await getDocs(collection(db, 'records', RECORD_ID_2, 'scoreEvents'));

      expect(recordBSnap.data()?.credibility?.score).toBe(recordASnap.data()?.credibility?.score);
      expect(eventsB.docs[0]!.data().contributionDelta).toBe(eventsA.docs[0]!.data().contributionDelta);
    });

    it('writes a scoreEvent and updates the record score even when the blockchain call fails', async () => {
      healthRecordMocks.disputeRecord.mockRejectedValue(new Error('transaction reverted'));

      await expect(createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 3, 2)).resolves.toBeTruthy();

      const snap = await getDoc(doc(db, 'disputes', getDisputeId(RECORD_HASH, DISPUTER)));
      expect(snap.data()?.chainStatus).toBe('failed');
      expect(snap.data()?.onChainHistory).toEqual([]);

      const events = await getDocs(collection(db, 'records', RECORD_ID, 'scoreEvents'));
      expect(events.size).toBe(1);

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.docs[0]!.data()).toMatchObject({
        status: 'failed',
        action: 'createDispute',
        error: 'transaction reverted',
      });
    });

    it('returns the right sets from the query helpers', async () => {
      await createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 2, 0);

      setCaller(OTHER_USER);
      walletMocks.requireUserWalletAddress.mockResolvedValue('0xWallet2');
      await createDispute(RECORD_ID, RECORD_HASH, OTHER_USER, 3, 1);

      const byRecord = await getDisputesByRecordId(RECORD_ID, false);
      expect(byRecord).toHaveLength(2);

      const byUser = await getDisputesByUserId(DISPUTER);
      expect(byUser).toHaveLength(1);
      expect(byUser[0]?.disputerId).toBe(DISPUTER);
    });
  });

  describe('retractDispute', () => {
    beforeEach(async () => {
      await createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 2, 0);
    });

    it('retracts and confirms on blockchain success', async () => {
      await retractDispute(RECORD_HASH, DISPUTER);
      const snap = await getDoc(doc(db, 'disputes', getDisputeId(RECORD_HASH, DISPUTER)));
      expect(snap.data()).toMatchObject({ isActive: false, chainStatus: 'confirmed' });
      expect(snap.data()?.onChainHistory).toHaveLength(2);
    });

    it('throws for a nonexistent dispute', async () => {
      await expect(retractDispute('nonexistent-hash', DISPUTER)).rejects.toThrow('Dispute not found');
    });

    it('throws when already inactive', async () => {
      await retractDispute(RECORD_HASH, DISPUTER);
      await expect(retractDispute(RECORD_HASH, DISPUTER)).rejects.toThrow('Dispute is already inactive');
    });

    it('throws for a non-owner caller and leaves the doc untouched', async () => {
      await seedDispute(db, RECORD_ID, RECORD_HASH, OTHER_USER, { disputerId: DISPUTER });
      await expect(retractDispute(RECORD_HASH, OTHER_USER)).rejects.toThrow(
        'You can only retract your own disputes'
      );
    });

    it('lets the Firestore retraction stand even when the blockchain call fails', async () => {
      healthRecordMocks.retractDispute.mockRejectedValue(new Error('reverted'));
      await expect(retractDispute(RECORD_HASH, DISPUTER)).resolves.toBeUndefined();
      const snap = await getDoc(doc(db, 'disputes', getDisputeId(RECORD_HASH, DISPUTER)));
      expect(snap.data()).toMatchObject({ isActive: false, chainStatus: 'failed' });
    });
  });

  describe('modifyDispute', () => {
    beforeEach(async () => {
      await createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 1, 0);
    });

    it('modifies and confirms on blockchain success, never touching encryptedNotes', async () => {
      await modifyDispute(RECORD_HASH, DISPUTER, 3, 2);
      const snap = await getDoc(doc(db, 'disputes', getDisputeId(RECORD_HASH, DISPUTER)));
      expect(snap.data()).toMatchObject({ severity: 3, culpability: 2, chainStatus: 'confirmed' });
      expect(snap.data()?.encryptedNotes).toBeNull();
      expect(snap.data()?.onChainHistory).toHaveLength(2);
      expect(snap.data()?.onChainHistory[1]).toMatchObject({
        action: 'modified',
        fromSeverity: 1,
        toSeverity: 3,
        fromCulpability: 0,
        toCulpability: 2,
      });
    });

    it('succeeds when only severity changes', async () => {
      await expect(modifyDispute(RECORD_HASH, DISPUTER, 3, 0)).resolves.toBeUndefined();
    });

    it('succeeds when only culpability changes', async () => {
      await expect(modifyDispute(RECORD_HASH, DISPUTER, 1, 4)).resolves.toBeUndefined();
    });

    it('throws when neither severity nor culpability changes', async () => {
      await expect(modifyDispute(RECORD_HASH, DISPUTER, 1, 0)).rejects.toThrow(
        'New values are the same as current values'
      );
    });

    it('throws for a nonexistent dispute', async () => {
      await expect(modifyDispute('nonexistent-hash', DISPUTER, 3, 2)).rejects.toThrow('Dispute not found');
    });

    it('throws when inactive', async () => {
      await retractDispute(RECORD_HASH, DISPUTER);
      await expect(modifyDispute(RECORD_HASH, DISPUTER, 3, 2)).rejects.toThrow(
        'Cannot modify an inactive dispute'
      );
    });

    it('throws for a non-owner caller', async () => {
      await seedDispute(db, RECORD_ID, RECORD_HASH, OTHER_USER, { disputerId: DISPUTER, severity: 1 });
      await expect(modifyDispute(RECORD_HASH, OTHER_USER, 3, 2)).rejects.toThrow(
        'You can only modify your own dispute'
      );
    });

    it('lets the Firestore modification stand even when the blockchain call fails', async () => {
      healthRecordMocks.modifyDispute.mockRejectedValue(new Error('reverted'));
      await expect(modifyDispute(RECORD_HASH, DISPUTER, 3, 2)).resolves.toBeUndefined();
      const snap = await getDoc(doc(db, 'disputes', getDisputeId(RECORD_HASH, DISPUTER)));
      expect(snap.data()).toMatchObject({ severity: 3, culpability: 2, chainStatus: 'failed' });
    });
  });

  describe('getDispute / getDisputesByRecordId', () => {
    it('decrypt:false never touches the encryption mocks', async () => {
      await createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 2, 0, 'some private note');
      encryptionMocks.getSessionKey.mockClear();

      const result = await getDispute(RECORD_HASH, DISPUTER, false);
      expect(result?.notes).toBe('');
      expect(encryptionMocks.getSessionKey).not.toHaveBeenCalled();

      const list = await getDisputesByRecordId(RECORD_ID, false);
      expect(list[0]?.notes).toBe('');
      expect(encryptionMocks.getSessionKey).not.toHaveBeenCalled();
    });

    it('falls back to a placeholder instead of throwing when decryption fails', async () => {
      await createDispute(RECORD_ID, RECORD_HASH, DISPUTER, 2, 0, 'some private note');
      encryptionMocks.getSessionKey.mockResolvedValue(null);

      const result = await getDispute(RECORD_HASH, DISPUTER, true);
      expect(result?.notes).toBe('[Unable to decrypt notes]');
    });
  });
});
