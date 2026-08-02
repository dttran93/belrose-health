// test/orchestration/subjectConsentService.test.ts
//
// Layer 3 (orchestration) — SubjectConsentService, the core consent-request state machine.
// Real Firestore emulator; no mocking needed — this service has no auth checks itself, and its
// one external call (encryptNotificationTitle) already gracefully returns null with no active
// encryption session (the default state here), so requests are simply created without encrypted
// title fields — a real, valid path in production too (session not unlocked yet).

import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { connectTestFirestore, clearTestFirestore } from './helpers/testFirestore';
import {
  SubjectConsentService,
  getConsentRequestId,
} from '../../src/features/Subject/services/subjectConsentService';

const RECORD_ID = 'subject-consent-record';
const SUBJECT = 'subject-consent-subject';
const REQUESTER = 'subject-consent-requester';

const db = connectTestFirestore('belrose-orchestration-subject-consent');

async function seedRequest(status: string, overrides: Record<string, unknown> = {}) {
  await setDoc(doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT)), {
    recordId: RECORD_ID,
    subjectId: SUBJECT,
    requestedBy: REQUESTER,
    requestedSubjectRole: 'sharer',
    status,
    createdAt: new Date(),
    grantedAccessOnSubjectRequest: false,
    ...overrides,
  });
}

describe('SubjectConsentService (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  describe('requestConsent', () => {
    it('creates a new pending consent request', async () => {
      const result = await SubjectConsentService.requestConsent({
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        requestedBy: REQUESTER,
        requestedSubjectRole: 'sharer',
        recordTitle: 'Lab Results',
      });

      expect(result.requestId).toBe(getConsentRequestId(RECORD_ID, SUBJECT));

      const snap = await getDoc(doc(db, 'subjectConsentRequests', result.requestId));
      const data = snap.data()!;
      expect(data.recordId).toBe(RECORD_ID);
      expect(data.subjectId).toBe(SUBJECT);
      expect(data.requestedBy).toBe(REQUESTER);
      expect(data.requestedSubjectRole).toBe('sharer');
      expect(data.status).toBe('pending');
      expect(data.createdAt).toBeDefined();
      expect(data.grantedAccessOnSubjectRequest).toBe(false);
    });

    it('succeeds without encrypted title fields when there is no active encryption session', async () => {
      const result = await SubjectConsentService.requestConsent({
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        requestedBy: REQUESTER,
        requestedSubjectRole: 'sharer',
        recordTitle: 'Lab Results',
      });

      const snap = await getDoc(doc(db, 'subjectConsentRequests', result.requestId));
      expect(snap.data()?.encryptedRecordTitle).toBeUndefined();
    });

    it('throws when an accepted request already exists', async () => {
      await seedRequest('accepted');

      await expect(
        SubjectConsentService.requestConsent({
          recordId: RECORD_ID,
          subjectId: SUBJECT,
          requestedBy: REQUESTER,
          requestedSubjectRole: 'sharer',
          recordTitle: 'Lab Results',
        })
      ).rejects.toThrow('An accepted consent request already exists');
    });

    it('throws when a pending request already exists', async () => {
      await seedRequest('pending');

      await expect(
        SubjectConsentService.requestConsent({
          recordId: RECORD_ID,
          subjectId: SUBJECT,
          requestedBy: REQUESTER,
          requestedSubjectRole: 'sharer',
          recordTitle: 'Lab Results',
        })
      ).rejects.toThrow('A pending consent request already exists');
    });

    it('allows a fresh request when a previous one was already rejected', async () => {
      await seedRequest('rejected', {
        rejection: { rejectionType: 'request_rejected', rejectedAt: new Date() },
      });

      const result = await SubjectConsentService.requestConsent({
        recordId: RECORD_ID,
        subjectId: SUBJECT,
        requestedBy: REQUESTER,
        requestedSubjectRole: 'administrator',
        recordTitle: 'Lab Results',
      });

      const snap = await getDoc(doc(db, 'subjectConsentRequests', result.requestId));
      expect(snap.data()?.status).toBe('pending');
      expect(snap.data()?.requestedSubjectRole).toBe('administrator');
      expect(snap.data()?.rejection).toBeUndefined();
    });
  });

  describe('prepareAcceptConsent', () => {
    it('throws when no request exists', async () => {
      await expect(
        SubjectConsentService.prepareAcceptConsent(RECORD_ID, SUBJECT)
      ).rejects.toThrow('Consent request not found');
    });

    it('throws when the request is not pending', async () => {
      await seedRequest('accepted');
      await expect(
        SubjectConsentService.prepareAcceptConsent(RECORD_ID, SUBJECT)
      ).rejects.toThrow('Cannot accept consent in status: accepted');
    });

    it('returns the accept-transition write without performing it', async () => {
      await seedRequest('pending');
      const result = await SubjectConsentService.prepareAcceptConsent(RECORD_ID, SUBJECT);

      expect(result.data.status).toBe('accepted');
      expect(result.data.respondedAt).toBeDefined();
      expect(result.ref.path).toBe(
        `subjectConsentRequests/${getConsentRequestId(RECORD_ID, SUBJECT)}`
      );

      // Confirms it really is unwritten — nothing happened to the doc yet.
      const snap = await getDoc(
        doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT))
      );
      expect(snap.data()?.status).toBe('pending');
    });
  });

  describe('rejectConsent', () => {
    it('throws when no request exists', async () => {
      await expect(SubjectConsentService.rejectConsent(RECORD_ID, SUBJECT)).rejects.toThrow(
        'Consent request not found'
      );
    });

    it('throws when the request is not pending', async () => {
      await seedRequest('accepted');
      await expect(SubjectConsentService.rejectConsent(RECORD_ID, SUBJECT)).rejects.toThrow(
        'Cannot reject consent in status: accepted'
      );
    });

    it('rejects a pending request with a reason', async () => {
      await seedRequest('pending');
      await SubjectConsentService.rejectConsent(RECORD_ID, SUBJECT, 'not me');

      const snap = await getDoc(
        doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT))
      );
      const data = snap.data()!;
      expect(data.status).toBe('rejected');
      expect(data.rejection.rejectionType).toBe('request_rejected');
      expect(data.rejection.reason).toBe('not me');
      expect(data.rejection.creatorResponse.status).toBe('pending_creator_decision');
    });

    it('rejects a pending request without a reason, omitting the reason field', async () => {
      await seedRequest('pending');
      await SubjectConsentService.rejectConsent(RECORD_ID, SUBJECT);

      const snap = await getDoc(
        doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT))
      );
      expect(snap.data()?.rejection.reason).toBeUndefined();
    });
  });

  describe('cancelConsent', () => {
    it('is a no-op when no request exists', async () => {
      await expect(
        SubjectConsentService.cancelConsent(RECORD_ID, SUBJECT)
      ).resolves.toBeUndefined();
    });

    it('throws when the request is not pending', async () => {
      await seedRequest('accepted');
      await expect(SubjectConsentService.cancelConsent(RECORD_ID, SUBJECT)).rejects.toThrow(
        'Only pending consent requests can be cancelled'
      );
    });

    it('deletes a pending request', async () => {
      await seedRequest('pending');
      await SubjectConsentService.cancelConsent(RECORD_ID, SUBJECT);

      const snap = await getDoc(
        doc(db, 'subjectConsentRequests', getConsentRequestId(RECORD_ID, SUBJECT))
      );
      expect(snap.exists()).toBe(false);
    });
  });
});
