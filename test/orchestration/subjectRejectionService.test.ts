// test/orchestration/subjectRejectionService.test.ts
//
// Layer 3 (orchestration) — SubjectRejectionService: the post-acceptance rejection flow and the
// creator's response to it. Real Firestore emulator; only firebase/auth is mocked (needed for
// respondToRejection's permission check — rejectAfterAcceptance itself never calls getAuth).

import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { connectTestFirestore, clearTestFirestore, seedRecord } from './helpers/testFirestore';

const { mockCurrentUser } = vi.hoisted(() => ({
  mockCurrentUser: { uid: null as string | null },
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockCurrentUser.uid ? { uid: mockCurrentUser.uid } : null }),
}));

import { SubjectRejectionService } from '../../src/features/Subject/services/subjectRejectionService';
import { getConsentRequestId } from '../../src/features/Subject/services/subjectConsentService';

const RECORD_ID = 'subject-rejection-record';
const SUBJECT = 'subject-rejection-subject';
const OWNER = 'subject-rejection-owner';
const ADMIN = 'subject-rejection-admin';
const UPLOADER = 'subject-rejection-uploader';
const STRANGER = 'subject-rejection-stranger';

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

const db = connectTestFirestore('belrose-orchestration-subject-rejection');

async function seedConsentRequest(status: string, overrides: Record<string, unknown> = {}) {
  await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
    recordId: RECORD_ID,
    subjectId: SUBJECT,
    requestedBy: OWNER,
    requestedSubjectRole: 'sharer',
    status,
    createdAt: new Date(),
    grantedAccessOnSubjectRequest: false,
    ...overrides,
  });
}

describe('SubjectRejectionService (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    setCaller(null);
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  describe('prepareRejectAfterAcceptance', () => {
    it('throws when no consent request exists', async () => {
      await expect(
        SubjectRejectionService.prepareRejectAfterAcceptance({
          recordId: RECORD_ID,
          subjectId: SUBJECT,
          reason: 'privacy',
        })
      ).rejects.toThrow('Consent request not found');
    });

    it('throws when the request was never accepted', async () => {
      await seedConsentRequest('pending');

      await expect(
        SubjectRejectionService.prepareRejectAfterAcceptance({
          recordId: RECORD_ID,
          subjectId: SUBJECT,
          reason: 'privacy',
        })
      ).rejects.toThrow('Rejection is only allowed after acceptance');
    });

    it('returns the rejection write without performing it', async () => {
      await seedConsentRequest('accepted');

      const result = await SubjectRejectionService.prepareRejectAfterAcceptance({
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        reason: 'privacy',
      });

      expect(result.rejectionData.rejectionType).toBe('removed_after_acceptance');
      expect(result.rejectionData.reason).toBe('privacy');
      expect(result.rejectionData.creatorResponse?.status).toBe('pending_creator_decision');
      expect(result.data).toEqual({ rejection: result.rejectionData });
      expect(result.ref.path).toBe(
        `subjectConsentRequests/${getConsentRequestId(RECORD_ID, SUBJECT)}`
      );

      // Confirms it really is unwritten — nothing happened to the doc yet.
      const snap = await getDoc(
        doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT))
      );
      expect(snap.data()?.rejection).toBeUndefined();
    });
  });

  describe('respondToRejection', () => {
    beforeEach(async () => {
      await seedRecord(db, RECORD_ID, { owners: [OWNER], administrators: [ADMIN] });
    });

    it('throws when not authenticated', async () => {
      await expect(
        SubjectRejectionService.respondToRejection(RECORD_ID, SUBJECT, 'dropped')
      ).rejects.toThrow('User not authenticated');
    });

    it('throws when the record does not exist', async () => {
      setCaller(OWNER);
      await expect(
        SubjectRejectionService.respondToRejection('nonexistent-record', SUBJECT, 'dropped')
      ).rejects.toThrow('Record not found');
    });

    it('denies a caller with no relationship to the record', async () => {
      setCaller(STRANGER);
      await expect(
        SubjectRejectionService.respondToRejection(RECORD_ID, SUBJECT, 'dropped')
      ).rejects.toThrow('Only the record owners or administrators can respond to rejections');
    });

    it('throws when no consent request exists', async () => {
      setCaller(OWNER);
      await expect(
        SubjectRejectionService.respondToRejection(RECORD_ID, SUBJECT, 'dropped')
      ).rejects.toThrow('Consent request not found');
    });

    it('throws when the consent request has no rejection recorded', async () => {
      setCaller(OWNER);
      await seedConsentRequest('accepted');

      await expect(
        SubjectRejectionService.respondToRejection(RECORD_ID, SUBJECT, 'dropped')
      ).rejects.toThrow('No rejection found for this subject');
    });

    it('throws when the rejection has already been responded to', async () => {
      setCaller(OWNER);
      await seedConsentRequest('rejected', {
        rejection: {
          rejectionType: 'removed_after_acceptance',
          rejectedAt: new Date(),
          creatorResponse: { status: 'dropped', lastModified: new Date() },
        },
      });

      await expect(
        SubjectRejectionService.respondToRejection(RECORD_ID, SUBJECT, 'escalated')
      ).rejects.toThrow('This rejection has already been responded to');
    });

    it('throws when the uploader tries to respond without being an owner or administrator', async () => {
      await seedRecord(db, RECORD_ID, {
        owners: [OWNER],
        administrators: [ADMIN],
        uploadedBy: UPLOADER,
      });
      await seedConsentRequest('rejected', {
        rejection: {
          rejectionType: 'removed_after_acceptance',
          rejectedAt: new Date(),
          creatorResponse: { status: 'pending_creator_decision' },
        },
      });
      setCaller(UPLOADER);

      await expect(
        SubjectRejectionService.respondToRejection(RECORD_ID, SUBJECT, 'dropped')
      ).rejects.toThrow('Only the record owners or administrators can respond to rejections');
    });

    it('records the creator response and returns the result', async () => {
      setCaller(ADMIN);
      await seedConsentRequest('rejected', {
        rejection: {
          rejectionType: 'removed_after_acceptance',
          rejectedAt: new Date(),
          creatorResponse: { status: 'pending_creator_decision' },
        },
      });

      const result = await SubjectRejectionService.respondToRejection(
        RECORD_ID,
        SUBJECT,
        'escalated'
      );

      expect(result).toEqual({
        success: true,
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        response: 'escalated',
      });

      const snap = await getDoc(
        doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT))
      );
      expect(snap.data()?.rejection.creatorResponse.status).toBe('escalated');
      expect(snap.data()?.rejection.creatorResponse.lastModified).toBeDefined();
    });
  });
});
