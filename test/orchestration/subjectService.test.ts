// test/orchestration/subjectService.test.ts
//
// Layer 3 (orchestration) — SubjectService, the big orchestrator for every subject operation.
// Real Firestore emulator, and real SubjectPermissionService/SubjectConsentService/
// SubjectRejectionService/SubjectRemovalService underneath (all already unit/orchestration-tested
// on their own) — only the cross-feature/blockchain edges are mocked:
// WalletService (wallet lookup only — SubjectBlockchainService was retired, its two wallet
// helpers moved into WalletService since that's the canonical place for wallet lookups),
// blockchainHealthRecordService (the actual chain calls — every SubjectService method is
// Firestore-first and calls this directly, owning its own BlockchainSyncQueueService lifecycle
// inline), TrusteePermissionService (Trustee fan-out, untested as its own feature),
// verificationService (Credibility), and firebase/auth.

import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { doc, getDoc, getDocs, collection, setDoc } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { connectTestFirestore, clearTestFirestore, seedRecord } from './helpers/testFirestore';

const { mockCurrentUser, walletMocks, healthRecordMocks, trusteeMocks, verificationMocks } =
  vi.hoisted(() => ({
    mockCurrentUser: { uid: null as string | null },
    walletMocks: {
      requireUserWalletAddress: vi.fn(),
    },
    // Every SubjectService method is Firestore-first now — each calls
    // blockchainHealthRecordService directly and owns the sync-queue lifecycle itself, rather
    // than going through a wrapper (see SubjectService.setSubjectAsSelf/rejectSubjectStatus/etc.).
    healthRecordMocks: {
      anchorRecord: vi.fn(),
      anchorRecordAsController: vi.fn(),
      unanchorRecord: vi.fn(),
    },
    trusteeMocks: {
      grantAccessForNewRecord: vi.fn(),
      revokeAccessForRemovedRecord: vi.fn(),
    },
    verificationMocks: {
      createVerification: vi.fn(),
      recordSelfVerification: vi.fn(),
    },
  }));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockCurrentUser.uid ? { uid: mockCurrentUser.uid } : null }),
}));

vi.mock('@/features/BlockchainWallet/services/walletService', () => ({
  WalletService: walletMocks,
}));

vi.mock('@/features/Credibility/services/blockchainHealthRecordService', () => ({
  blockchainHealthRecordService: healthRecordMocks,
  VerificationLevel: { None: 0, Provenance: 1, Full: 2 },
}));

vi.mock('@/features/Trustee/services/trusteePermissionService', () => ({
  TrusteePermissionService: trusteeMocks,
}));

vi.mock('@/features/Credibility/services/verificationService', () => ({
  createVerification: verificationMocks.createVerification,
  recordSelfVerification: verificationMocks.recordSelfVerification,
}));

import { SubjectService } from '../../src/features/Subject/services/subjectService';
import { getConsentRequestId } from '../../src/features/Subject/services/subjectConsentService';
import { VerificationLevel } from '@/features/Credibility/services/blockchainHealthRecordService';

const RECORD_ID = 'subject-service-record';
const OWNER = 'subject-service-owner';
const ADMIN = 'subject-service-admin';
const SUBJECT = 'subject-service-subject';
const STRANGER = 'subject-service-stranger';
const TRUSTOR = 'subject-service-trustor';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

const db = connectTestFirestore('belrose-orchestration-subject-service');

describe('SubjectService (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.resetAllMocks();
    healthRecordMocks.anchorRecord.mockResolvedValue({ txHash: '0xabc', blockNumber: 1 });
    healthRecordMocks.anchorRecordAsController.mockResolvedValue({ txHash: '0xabc2', blockNumber: 2 });
    walletMocks.requireUserWalletAddress.mockResolvedValue('0xWallet');
    healthRecordMocks.unanchorRecord.mockResolvedValue({ txHash: '0xdef', blockNumber: 3 });
    trusteeMocks.grantAccessForNewRecord.mockResolvedValue(undefined);
    trusteeMocks.revokeAccessForRemovedRecord.mockResolvedValue(undefined);
    verificationMocks.createVerification.mockResolvedValue(undefined);
    verificationMocks.recordSelfVerification.mockResolvedValue(undefined);
    setCaller(null);
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  describe('setSubjectAsSelf', () => {
    it('throws when not authenticated', async () => {
      await expect(SubjectService.setSubjectAsSelf(RECORD_ID)).rejects.toThrow(
        'User not authenticated'
      );
    });

    it('throws when the record does not exist', async () => {
      setCaller(OWNER);
      await expect(SubjectService.setSubjectAsSelf(RECORD_ID)).rejects.toThrow('Record not found');
    });

    it('denies a caller who cannot manage the record', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      setCaller(STRANGER);
      await expect(SubjectService.setSubjectAsSelf(RECORD_ID)).rejects.toThrow(
        'You do not have permission to modify this record'
      );
    });

    it('is a no-op success when already a subject — never touches the blockchain', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER], subjects: [OWNER] });
      setCaller(OWNER);

      const result = await SubjectService.setSubjectAsSelf(RECORD_ID);

      expect(result).toEqual({
        success: true,
        recordId: RECORD_ID,
        subjectId: OWNER,
        blockchainAnchored: true,
      });
      expect(healthRecordMocks.anchorRecord).not.toHaveBeenCalled();
    });

    it('throws when the record has no recordHash', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      setCaller(OWNER);

      await expect(SubjectService.setSubjectAsSelf(RECORD_ID)).rejects.toThrow(
        'Record does not have a hash for blockchain anchoring'
      );
    });

    it('anchors, adds the subject, fans out to trustees, and records a self_consented audit doc', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      await setDoc(doc(db, 'records', RECORD_ID), { recordHash: '0xhash' }, { merge: true });
      setCaller(OWNER);

      const result = await SubjectService.setSubjectAsSelf(RECORD_ID);

      expect(result).toEqual({
        success: true,
        recordId: RECORD_ID,
        subjectId: OWNER,
        blockchainAnchored: true,
      });

      const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      expect(recordSnap.data()?.subjects).toEqual([OWNER]);

      expect(trusteeMocks.grantAccessForNewRecord).toHaveBeenCalledWith(OWNER, RECORD_ID, {
        txHash: '0xabc',
        blockNumber: 1,
      });

      const consentSnap = await getDoc(
        doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, OWNER))
      );
      expect(consentSnap.data()?.status).toBe('self_consented');
      expect(consentSnap.data()?.requestedSubjectRole).toBe('owner');

      expect(verificationMocks.recordSelfVerification).toHaveBeenCalled();

      const events = await getDocs(collection(db, 'records', RECORD_ID, 'subjectHistory'));
      expect(events.size).toBe(1);
      expect(events.docs[0]!.data()).toMatchObject({
        action: 'anchored',
        subjectId: OWNER,
        changedBy: OWNER,
      });
      expect(events.docs[0]!.data().blockchainRef).toMatchObject({ txHash: '0xabc', blockNumber: 1 });

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(1);
      expect(syncDocs.docs[0]!.data()).toMatchObject({ status: 'confirmed', action: 'anchorRecord' });
    });

    it('does not call recordSelfVerification when selfVerifyLevel is None', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      await setDoc(doc(db, 'records', RECORD_ID), { recordHash: '0xhash' }, { merge: true });
      setCaller(OWNER);

      await SubjectService.setSubjectAsSelf(RECORD_ID, VerificationLevel.None);

      expect(verificationMocks.recordSelfVerification).not.toHaveBeenCalled();
    });

    it('does not fail the whole operation when trustee fan-out rejects', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      await setDoc(doc(db, 'records', RECORD_ID), { recordHash: '0xhash' }, { merge: true });
      setCaller(OWNER);
      trusteeMocks.grantAccessForNewRecord.mockRejectedValue(new Error('trustee service down'));

      const result = await SubjectService.setSubjectAsSelf(RECORD_ID);
      expect(result.success).toBe(true);

      const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      expect(recordSnap.data()?.subjects).toEqual([OWNER]);
    });

    it('keeps the Firestore addition when the blockchain anchor call rejects, and logs it for reconciliation', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      await setDoc(doc(db, 'records', RECORD_ID), { recordHash: '0xhash' }, { merge: true });
      setCaller(OWNER);
      healthRecordMocks.anchorRecord.mockRejectedValue(new Error('transaction reverted'));

      // Firestore-first: the chain call is best-effort and does not revert the addition that
      // already succeeded, so this resolves rather than throwing.
      const result = await SubjectService.setSubjectAsSelf(RECORD_ID);

      expect(result.blockchainAnchored).toBe(false);
      const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      expect(recordSnap.data()?.subjects).toEqual([OWNER]);
      expect(verificationMocks.recordSelfVerification).not.toHaveBeenCalled();

      const events = await getDocs(collection(db, 'records', RECORD_ID, 'subjectHistory'));
      expect(events.size).toBe(1);
      // No confirmed tx to cite — the audit event still exists, just without a chain reference yet.
      expect(events.docs[0]!.data().blockchainRef).toBeNull();

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(1);
      expect(syncDocs.docs[0]!.data()).toMatchObject({
        status: 'failed',
        action: 'anchorRecord',
        error: 'transaction reverted',
        permissionHistoryPath: `records/${RECORD_ID}/subjectHistory/${events.docs[0]!.id}`,
      });
    });

    it('throws before any write when the caller has no linked wallet', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      await setDoc(doc(db, 'records', RECORD_ID), { recordHash: '0xhash' }, { merge: true });
      setCaller(OWNER);
      walletMocks.requireUserWalletAddress.mockRejectedValue(
        new Error('You must have a linked wallet to perform blockchain actions')
      );

      await expect(SubjectService.setSubjectAsSelf(RECORD_ID)).rejects.toThrow(
        'You must have a linked wallet to perform blockchain actions'
      );
      const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      expect(recordSnap.data()?.subjects).toEqual([]);
    });
  });

  describe('anchorSubjectAsController', () => {
    it('throws when not authenticated', async () => {
      await expect(SubjectService.anchorSubjectAsController(RECORD_ID, TRUSTOR)).rejects.toThrow(
        'User not authenticated'
      );
    });

    it('throws when the record does not exist', async () => {
      setCaller(OWNER);
      await expect(SubjectService.anchorSubjectAsController(RECORD_ID, TRUSTOR)).rejects.toThrow(
        'Record not found'
      );
    });

    it('throws when the record has no recordHash', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      setCaller(OWNER);
      await expect(SubjectService.anchorSubjectAsController(RECORD_ID, TRUSTOR)).rejects.toThrow(
        'Record does not have a hash for blockchain anchoring'
      );
    });

    it('is idempotent when the trustor is already a subject', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER], subjects: [TRUSTOR] });
      await setDoc(doc(db, 'records', RECORD_ID), { recordHash: '0xhash' }, { merge: true });
      setCaller(OWNER);

      await SubjectService.anchorSubjectAsController(RECORD_ID, TRUSTOR);
      expect(healthRecordMocks.anchorRecordAsController).not.toHaveBeenCalled();
    });

    it('anchors the trustor as subject and credits the controller as verifier', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      await setDoc(doc(db, 'records', RECORD_ID), { recordHash: '0xhash' }, { merge: true });
      setCaller(OWNER);

      await SubjectService.anchorSubjectAsController(RECORD_ID, TRUSTOR, 'administrator');

      const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      expect(recordSnap.data()?.subjects).toEqual([TRUSTOR]);

      expect(trusteeMocks.grantAccessForNewRecord).toHaveBeenCalledWith(TRUSTOR, RECORD_ID, {
        txHash: '0xabc2',
        blockNumber: 2,
      });

      const consentSnap = await getDoc(
        doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, TRUSTOR))
      );
      expect(consentSnap.data()?.status).toBe('controller_consented');
      expect(consentSnap.data()?.requestedBy).toBe(OWNER);
      expect(consentSnap.data()?.requestedSubjectRole).toBe('administrator');

      // The controller (caller), not the trustor, is credited as verifier.
      expect(verificationMocks.recordSelfVerification).toHaveBeenCalledWith(
        RECORD_ID,
        '0xhash',
        OWNER,
        expect.anything(),
        expect.anything()
      );

      // changedBy is the controller, subjectId is the trustor — the labeling bug this
      // refactor fixed (previously the sync-queue context mislabeled the trustor as the
      // controller).
      const events = await getDocs(collection(db, 'records', RECORD_ID, 'subjectHistory'));
      expect(events.size).toBe(1);
      expect(events.docs[0]!.data()).toMatchObject({
        action: 'anchored_as_controller',
        subjectId: TRUSTOR,
        changedBy: OWNER,
      });
      expect(events.docs[0]!.data().blockchainRef).toMatchObject({ txHash: '0xabc2', blockNumber: 2 });

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(1);
      expect(syncDocs.docs[0]!.data()).toMatchObject({
        status: 'confirmed',
        action: 'anchorRecord',
        context: expect.objectContaining({ subjectId: TRUSTOR }),
      });

      // The transient proof field is cleaned up after the batch.
      expect(recordSnap.data()?.controllerAnchorFor).toBeUndefined();
    });

    it('does not fail when trustee fan-out rejects', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      await setDoc(doc(db, 'records', RECORD_ID), { recordHash: '0xhash' }, { merge: true });
      setCaller(OWNER);
      trusteeMocks.grantAccessForNewRecord.mockRejectedValue(new Error('down'));

      await expect(
        SubjectService.anchorSubjectAsController(RECORD_ID, TRUSTOR)
      ).resolves.toBeUndefined();
    });

    it('keeps the Firestore addition when the blockchain anchor call rejects, and logs it for reconciliation', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      await setDoc(doc(db, 'records', RECORD_ID), { recordHash: '0xhash' }, { merge: true });
      setCaller(OWNER);
      healthRecordMocks.anchorRecordAsController.mockRejectedValue(new Error('transaction reverted'));

      await expect(
        SubjectService.anchorSubjectAsController(RECORD_ID, TRUSTOR)
      ).resolves.toBeUndefined();

      const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      expect(recordSnap.data()?.subjects).toEqual([TRUSTOR]);

      const events = await getDocs(collection(db, 'records', RECORD_ID, 'subjectHistory'));
      expect(events.size).toBe(1);
      expect(events.docs[0]!.data().blockchainRef).toBeNull();

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(1);
      expect(syncDocs.docs[0]!.data()).toMatchObject({ status: 'failed', action: 'anchorRecord' });
    });

    it('throws before any write when the controller has no linked wallet', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      await setDoc(doc(db, 'records', RECORD_ID), { recordHash: '0xhash' }, { merge: true });
      setCaller(OWNER);
      walletMocks.requireUserWalletAddress.mockRejectedValue(
        new Error('You must have a linked wallet to perform blockchain actions')
      );

      await expect(
        SubjectService.anchorSubjectAsController(RECORD_ID, TRUSTOR)
      ).rejects.toThrow('You must have a linked wallet to perform blockchain actions');
      const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      expect(recordSnap.data()?.subjects).toEqual([]);
    });
  });

  describe('requestSubjectConsent', () => {
    beforeEach(async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
    });

    it('throws when not authenticated', async () => {
      await expect(
        SubjectService.requestSubjectConsent(RECORD_ID, SUBJECT)
      ).rejects.toThrow('User not authenticated');
    });

    it('throws when the record does not exist', async () => {
      setCaller(OWNER);
      await expect(
        SubjectService.requestSubjectConsent('nonexistent', SUBJECT)
      ).rejects.toThrow('Record not found');
    });

    it('denies a caller who cannot manage the record', async () => {
      setCaller(STRANGER);
      await expect(
        SubjectService.requestSubjectConsent(RECORD_ID, SUBJECT)
      ).rejects.toThrow('You do not have permission to modify this record');
    });

    it('throws when the target is already a subject', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER], subjects: [SUBJECT] });
      setCaller(OWNER);
      await expect(
        SubjectService.requestSubjectConsent(RECORD_ID, SUBJECT)
      ).rejects.toThrow('This user is already a subject of this record');
    });

    it('creates a new pending request when none exists', async () => {
      setCaller(OWNER);
      const result = await SubjectService.requestSubjectConsent(RECORD_ID, SUBJECT, {
        role: 'administrator',
      });

      expect(result).toEqual({ success: true });
      const snap = await getDoc(
        doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT))
      );
      expect(snap.data()?.status).toBe('pending');
      expect(snap.data()?.requestedSubjectRole).toBe('administrator');
      // recordTitle (default-computed here, since none was provided) is only ever persisted in
      // its ENCRYPTED form (see encryptNotificationTitle) — never as plaintext on the doc. With no
      // active encryption session in this test, encryption itself is skipped entirely, so neither
      // field appears at all — see subjectConsentService.test.ts for that same swallowed-null path.
      expect(snap.data()?.recordTitle).toBeUndefined();
      expect(snap.data()?.encryptedRecordTitle).toBeUndefined();
    });

    it('passes a provided recordTitle through to encryption rather than storing it as plaintext', async () => {
      setCaller(OWNER);
      await SubjectService.requestSubjectConsent(RECORD_ID, SUBJECT, { recordTitle: 'Lab Results' });

      const snap = await getDoc(
        doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT))
      );
      expect(snap.data()?.recordTitle).toBeUndefined();
      expect(snap.data()?.encryptedRecordTitle).toBeUndefined();
    });

    it('throws the "dropped" message when the creator already dropped a prior rejection', async () => {
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'rejected',
        rejection: { rejectionType: 'request_rejected', creatorResponse: { status: 'dropped' } },
      });
      setCaller(OWNER);

      await expect(SubjectService.requestSubjectConsent(RECORD_ID, SUBJECT)).rejects.toThrow(
        'previously dropped'
      );
    });

    it('throws the declined message for a request_rejected rejection still pending creator decision', async () => {
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'rejected',
        rejection: {
          rejectionType: 'request_rejected',
          creatorResponse: { status: 'pending_creator_decision' },
        },
      });
      setCaller(OWNER);

      await expect(SubjectService.requestSubjectConsent(RECORD_ID, SUBJECT)).rejects.toThrow(
        'previously declined a subject request'
      );
    });

    it('throws the removed_after_acceptance message', async () => {
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'rejected',
        rejection: {
          rejectionType: 'removed_after_acceptance',
          creatorResponse: { status: 'pending_creator_decision' },
        },
      });
      setCaller(OWNER);

      await expect(SubjectService.requestSubjectConsent(RECORD_ID, SUBJECT)).rejects.toThrow(
        'previously a subject but removed themselves'
      );
    });

    it('throws the self_removal message', async () => {
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'rejected',
        rejection: {
          rejectionType: 'self_removal',
          creatorResponse: { status: 'pending_creator_decision' },
        },
      });
      setCaller(OWNER);

      await expect(SubjectService.requestSubjectConsent(RECORD_ID, SUBJECT)).rejects.toThrow(
        'previously removed themselves as a subject'
      );
    });

    it('throws "pending request already exists" for a plain pending request with no rejection', async () => {
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'pending',
      });
      setCaller(OWNER);

      await expect(SubjectService.requestSubjectConsent(RECORD_ID, SUBJECT)).rejects.toThrow(
        'A pending subject request already exists for this user'
      );
    });

    it('throws "already a subject" for a plain accepted request with no rejection', async () => {
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'accepted',
      });
      setCaller(OWNER);

      await expect(SubjectService.requestSubjectConsent(RECORD_ID, SUBJECT)).rejects.toThrow(
        'This user is already a subject of this record'
      );
    });

    it('throws the declined message for a plain rejected status with no rejection field', async () => {
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'rejected',
      });
      setCaller(OWNER);

      await expect(SubjectService.requestSubjectConsent(RECORD_ID, SUBJECT)).rejects.toThrow(
        'previously declined a subject request'
      );
    });

    it('non-fatally attempts a requester verification when verifyLevel and recordHash are given', async () => {
      await setDoc(doc(db, 'records', RECORD_ID), { recordHash: '0xhash' }, { merge: true });
      setCaller(OWNER);
      verificationMocks.createVerification.mockRejectedValue(new Error('verify failed'));

      const result = await SubjectService.requestSubjectConsent(RECORD_ID, SUBJECT, {
        verifyLevel: 1 as any,
      });

      expect(result.success).toBe(true);
      expect(verificationMocks.createVerification).toHaveBeenCalled();
    });
  });

  describe('acceptSubjectRequest', () => {
    it('throws when not authenticated', async () => {
      await expect(SubjectService.acceptSubjectRequest(RECORD_ID)).rejects.toThrow(
        'User not authenticated'
      );
    });

    it('throws when there is no pending request for the caller', async () => {
      setCaller(SUBJECT);
      await expect(SubjectService.acceptSubjectRequest(RECORD_ID)).rejects.toThrow(
        'No pending subject request found for you'
      );
    });

    it('throws when the record no longer exists', async () => {
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'pending',
      });
      setCaller(SUBJECT);

      await expect(SubjectService.acceptSubjectRequest(RECORD_ID)).rejects.toThrow(
        'Record not found'
      );
    });

    it('throws when the record has no recordHash', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'pending',
      });
      setCaller(SUBJECT);

      await expect(SubjectService.acceptSubjectRequest(RECORD_ID)).rejects.toThrow(
        'Record does not have a hash for blockchain anchoring'
      );
    });

    it('accepts: anchors, marks the consent accepted, adds the subject, and fans out trustee access', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      await setDoc(doc(db, 'records', RECORD_ID), { recordHash: '0xhash' }, { merge: true });
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'pending',
      });
      setCaller(SUBJECT);

      const result = await SubjectService.acceptSubjectRequest(RECORD_ID);
      expect(result).toEqual({ success: true });

      const consentSnap = await getDoc(
        doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT))
      );
      expect(consentSnap.data()?.status).toBe('accepted');

      const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      expect(recordSnap.data()?.subjects).toEqual([SUBJECT]);

      expect(trusteeMocks.grantAccessForNewRecord).toHaveBeenCalledWith(SUBJECT, RECORD_ID, {
        txHash: '0xabc',
        blockNumber: 1,
      });

      const events = await getDocs(collection(db, 'records', RECORD_ID, 'subjectHistory'));
      expect(events.size).toBe(1);
      expect(events.docs[0]!.data()).toMatchObject({
        action: 'anchored',
        subjectId: SUBJECT,
        changedBy: SUBJECT,
        viaConsent: true,
      });
      expect(events.docs[0]!.data().blockchainRef).toMatchObject({ txHash: '0xabc', blockNumber: 1 });
    });

    it('throws before any write when the caller has no linked wallet', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      await setDoc(doc(db, 'records', RECORD_ID), { recordHash: '0xhash' }, { merge: true });
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'pending',
      });
      setCaller(SUBJECT);
      walletMocks.requireUserWalletAddress.mockRejectedValue(
        new Error('You must have a linked wallet to perform blockchain actions')
      );

      await expect(SubjectService.acceptSubjectRequest(RECORD_ID)).rejects.toThrow(
        'You must have a linked wallet to perform blockchain actions'
      );
      const consentSnap = await getDoc(
        doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT))
      );
      expect(consentSnap.data()?.status).toBe('pending');
      const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      expect(recordSnap.data()?.subjects).toEqual([]);
    });

    it('keeps the Firestore accept + subject addition when the blockchain anchor call rejects, and logs it for reconciliation', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      await setDoc(doc(db, 'records', RECORD_ID), { recordHash: '0xhash' }, { merge: true });
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'pending',
      });
      setCaller(SUBJECT);
      healthRecordMocks.anchorRecord.mockRejectedValue(new Error('transaction reverted'));

      await expect(SubjectService.acceptSubjectRequest(RECORD_ID)).resolves.toEqual({
        success: true,
      });

      const consentSnap = await getDoc(
        doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT))
      );
      expect(consentSnap.data()?.status).toBe('accepted');

      const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      expect(recordSnap.data()?.subjects).toEqual([SUBJECT]);

      const events = await getDocs(collection(db, 'records', RECORD_ID, 'subjectHistory'));
      expect(events.size).toBe(1);
      expect(events.docs[0]!.data().blockchainRef).toBeNull();

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(1);
      expect(syncDocs.docs[0]!.data()).toMatchObject({ status: 'failed', action: 'anchorRecord' });
    });
  });

  describe('rejectSubjectRequest', () => {
    it('throws when not authenticated', async () => {
      await expect(SubjectService.rejectSubjectRequest(RECORD_ID)).rejects.toThrow(
        'User not authenticated'
      );
    });

    it('throws when there is no pending request for the caller', async () => {
      setCaller(SUBJECT);
      await expect(SubjectService.rejectSubjectRequest(RECORD_ID)).rejects.toThrow(
        'No pending request found for you'
      );
    });

    it('rejects the pending request', async () => {
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'pending',
      });
      setCaller(SUBJECT);

      const result = await SubjectService.rejectSubjectRequest(RECORD_ID, 'not me');
      expect(result).toEqual({ success: true });

      const snap = await getDoc(
        doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT))
      );
      expect(snap.data()?.status).toBe('rejected');
      expect(snap.data()?.rejection.reason).toBe('not me');
    });
  });

  describe('rejectSubjectStatus', () => {
    it('throws when not authenticated', async () => {
      await expect(SubjectService.rejectSubjectStatus(RECORD_ID, 'privacy')).rejects.toThrow(
        'User not authenticated'
      );
    });

    it('throws when the record does not exist', async () => {
      setCaller(SUBJECT);
      await expect(SubjectService.rejectSubjectStatus(RECORD_ID, 'privacy')).rejects.toThrow(
        'Record not found'
      );
    });

    it('throws when the caller is not a subject of the record', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      setCaller(SUBJECT);
      await expect(SubjectService.rejectSubjectStatus(RECORD_ID, 'privacy')).rejects.toThrow(
        'You are not a subject of this record'
      );
    });

    it('throws before any write when the caller has no linked wallet', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER], subjects: [SUBJECT] });
      setCaller(SUBJECT);
      walletMocks.requireUserWalletAddress.mockRejectedValue(
        new Error('You must have a linked wallet to perform blockchain actions')
      );

      await expect(SubjectService.rejectSubjectStatus(RECORD_ID, 'privacy')).rejects.toThrow(
        'You must have a linked wallet to perform blockchain actions'
      );
      const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      expect(recordSnap.data()?.subjects).toEqual([SUBJECT]);
    });

    it('FLOW 1 — self-removal with no prior consent flow: unanchors and removes, no pending creator decision', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER], subjects: [SUBJECT] });
      setCaller(SUBJECT);

      const result = await SubjectService.rejectSubjectStatus(RECORD_ID, 'privacy');

      expect(result).toEqual({ success: true, pendingCreatorDecision: false });
      const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      expect(recordSnap.data()?.subjects).toEqual([]);
      expect(trusteeMocks.revokeAccessForRemovedRecord).toHaveBeenCalledWith(
        SUBJECT,
        RECORD_ID,
        { txHash: '0xdef', blockNumber: 3 }
      );

      const events = await getDocs(collection(db, 'records', RECORD_ID, 'subjectHistory'));
      expect(events.size).toBe(1);
      expect(events.docs[0]!.data()).toMatchObject({
        action: 'unanchored',
        subjectId: SUBJECT,
        changedBy: SUBJECT,
      });
      expect(events.docs[0]!.data().blockchainRef).toMatchObject({ txHash: '0xdef', blockNumber: 3 });

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(1);
      expect(syncDocs.docs[0]!.data()).toMatchObject({ status: 'confirmed', action: 'unanchorRecord' });
    });

    it('FLOW 2 — removal after an accepted consent flow: captures the rejection and flags pending creator decision', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER], subjects: [SUBJECT] });
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'accepted',
      });
      setCaller(SUBJECT);

      const result = await SubjectService.rejectSubjectStatus(RECORD_ID, 'privacy');

      expect(result).toEqual({ success: true, pendingCreatorDecision: true });
      const consentSnap = await getDoc(
        doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT))
      );
      expect(consentSnap.data()?.rejection.rejectionType).toBe('removed_after_acceptance');

      const events = await getDocs(collection(db, 'records', RECORD_ID, 'subjectHistory'));
      expect(events.size).toBe(1);
      expect(events.docs[0]!.data().action).toBe('unanchored');
    });

    it('does not fail when revoking trustee access rejects', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER], subjects: [SUBJECT] });
      setCaller(SUBJECT);
      trusteeMocks.revokeAccessForRemovedRecord.mockRejectedValue(new Error('down'));

      await expect(SubjectService.rejectSubjectStatus(RECORD_ID, 'privacy')).resolves.toEqual({
        success: true,
        pendingCreatorDecision: false,
      });
    });

    it('keeps the Firestore removal when the blockchain unanchor call rejects, and logs it for reconciliation', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER], subjects: [SUBJECT] });
      setCaller(SUBJECT);
      healthRecordMocks.unanchorRecord.mockRejectedValue(new Error('transaction reverted'));

      // Firestore-first: the chain call is best-effort and does not revert the removal that
      // already succeeded, so this resolves rather than throwing.
      await expect(SubjectService.rejectSubjectStatus(RECORD_ID, 'privacy')).resolves.toEqual({
        success: true,
        pendingCreatorDecision: false,
      });

      const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
      expect(recordSnap.data()?.subjects).toEqual([]);

      const events = await getDocs(collection(db, 'records', RECORD_ID, 'subjectHistory'));
      expect(events.size).toBe(1);
      // No confirmed tx to cite — the audit event still exists, just without a chain reference yet.
      expect(events.docs[0]!.data().blockchainRef).toBeNull();

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.size).toBe(1);
      expect(syncDocs.docs[0]!.data()).toMatchObject({
        status: 'failed',
        action: 'unanchorRecord',
        error: 'transaction reverted',
        permissionHistoryPath: `records/${RECORD_ID}/subjectHistory/${events.docs[0]!.id}`,
      });

      // Trustee revoke fan-out still runs afterward, consuming a null tx result.
      expect(trusteeMocks.revokeAccessForRemovedRecord).toHaveBeenCalledWith(
        SUBJECT,
        RECORD_ID,
        null
      );
    });
  });

  describe('respondToSubjectRejection', () => {
    it('delegates to SubjectRejectionService.respondToRejection', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'rejected',
        rejection: { creatorResponse: { status: 'pending_creator_decision' } },
      });
      setCaller(OWNER);

      const result = await SubjectService.respondToSubjectRejection(RECORD_ID, SUBJECT, 'dropped');
      expect(result).toEqual({
        success: true,
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        response: 'dropped',
      });
    });
  });

  describe('requestSubjectRemoval', () => {
    it('throws when the caller cannot manage the record', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER], subjects: [SUBJECT] });
      setCaller(STRANGER);

      await expect(
        SubjectService.requestSubjectRemoval(RECORD_ID, SUBJECT)
      ).rejects.toThrow('You do not have permission to modify this record');
    });

    it('creates a removal request', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER], subjects: [SUBJECT] });
      setCaller(OWNER);

      const result = await SubjectService.requestSubjectRemoval(RECORD_ID, SUBJECT, 'reason', 'title');
      expect(result).toEqual({ success: true });
    });
  });

  describe('cancelSubjectConsentRequest', () => {
    it('throws when the caller cannot manage the record', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'pending',
      });
      setCaller(STRANGER);

      await expect(
        SubjectService.cancelSubjectConsentRequest(RECORD_ID, SUBJECT)
      ).rejects.toThrow('You do not have permission to modify this record');
    });

    it('cancels a pending request', async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER] });
      await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        status: 'pending',
      });
      setCaller(OWNER);

      const result = await SubjectService.cancelSubjectConsentRequest(RECORD_ID, SUBJECT);
      expect(result).toEqual({ success: true });

      const snap = await getDoc(
        doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT))
      );
      expect(snap.exists()).toBe(false);
    });
  });
});
