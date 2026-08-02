//src/features/Subject/services/subjectConsentService.ts

/**
 * This service owns all of the consent state management including:
 * - Creating/Accepting/Rejection/Canceling consent requests
 * - Enforcing valid state transitions
 *
 *  This is the KEY state management for the Subject feature. Everything builds off of
 *  the state of consents.
 */

import { encryptNotificationTitle } from '@/features/Notifications/services/encryptNotificationTitle';
import {
  CreatorResponseStatus,
  SubjectConsentRequest,
  SubjectRejectionType,
  SubjectRequestStatus,
} from '@belrose/shared';
import {
  deleteDoc,
  doc,
  DocumentReference,
  getDoc,
  getFirestore,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
/**
 * Generate the document ID for a consent request
 * Format: {recordId}_{targetUserId}
 */
export const getConsentRequestId = (recordId: string, subjectId: string): string => {
  return `${recordId}_${subjectId}`;
};

export class SubjectConsentService {
  // ============================================================================
  // CREATE
  // ============================================================================

  static async requestConsent(params: {
    recordId: string;
    subjectId: string;
    requestedBy: string;
    requestedSubjectRole: 'sharer' | 'administrator' | 'owner';
    recordTitle: string;
  }): Promise<{ requestId: string }> {
    const db = getFirestore();
    const requestId = getConsentRequestId(params.recordId, params.subjectId);
    const requestRef = doc(db, 'subjectConsentRequests', requestId);

    const existing = await getDoc(requestRef);

    if (existing.exists()) {
      const status = existing.data().status as SubjectRequestStatus;
      if (status === 'pending') {
        throw new Error('A pending consent request already exists');
      }
      if (status === 'accepted') {
        throw new Error('An accepted consent request already exists');
      }
    }

    const titleData = params.recordTitle
      ? await encryptNotificationTitle(params.recordTitle, params.recordId)
      : undefined;

    console.log('Title data testing:', { titleData, recordTitle: params.recordTitle });

    const consentRequest: SubjectConsentRequest = {
      recordId: params.recordId,
      subjectId: params.subjectId,
      requestedBy: params.requestedBy,
      requestedSubjectRole: params.requestedSubjectRole,
      status: 'pending',
      createdAt: Timestamp.now(),
      grantedAccessOnSubjectRequest: false,
      ...(titleData ?? {}),
    };

    await setDoc(requestRef, consentRequest);

    return { requestId };
  }

  // ============================================================================
  // ACCEPT
  // ============================================================================

  /**
   * Validates and prepares the pending → accepted transition without performing it — so
   * SubjectService.acceptSubjectRequest can include it in the same atomic writeBatch as the
   * subjects[] addition and subjectHistory event. A failure here after the subject was already
   * added would otherwise silently leave this request stuck at 'pending' forever.
   */
  static async prepareAcceptConsent(
    recordId: string,
    subjectId: string
  ): Promise<{ ref: DocumentReference; data: { status: 'accepted'; respondedAt: Timestamp } }> {
    const db = getFirestore();
    const requestRef = doc(db, 'subjectConsentRequests', getConsentRequestId(recordId, subjectId));
    const requestDoc = await getDoc(requestRef);

    if (!requestDoc.exists()) {
      throw new Error('Consent request not found');
    }

    const data = requestDoc.data() as SubjectConsentRequest;

    if (data.status !== 'pending') {
      throw new Error(`Cannot accept consent in status: ${data.status}`);
    }

    return { ref: requestRef, data: { status: 'accepted', respondedAt: Timestamp.now() } };
  }

  // ============================================================================
  // REJECT (PRE-ACCEPT)
  // ============================================================================

  static async rejectConsent(recordId: string, subjectId: string, reason?: string): Promise<void> {
    const db = getFirestore();
    const requestRef = doc(db, 'subjectConsentRequests', getConsentRequestId(recordId, subjectId));
    const requestDoc = await getDoc(requestRef);

    if (!requestDoc.exists()) {
      throw new Error('Consent request not found');
    }

    const data = requestDoc.data() as SubjectConsentRequest;

    if (data.status !== 'pending') {
      throw new Error(`Cannot reject consent in status: ${data.status}`);
    }

    await updateDoc(requestRef, {
      status: 'rejected',
      rejection: {
        rejectionType: 'request_rejected' as SubjectRejectionType,
        rejectedAt: Timestamp.now(),
        ...(reason && { reason }),
        creatorResponse: {
          status: 'pending_creator_decision' as CreatorResponseStatus,
        },
      },
    });
  }

  // ============================================================================
  // CANCEL
  // ============================================================================

  static async cancelConsent(recordId: string, subjectId: string): Promise<void> {
    const db = getFirestore();
    const requestRef = doc(db, 'subjectConsentRequests', getConsentRequestId(recordId, subjectId));
    const requestDoc = await getDoc(requestRef);

    if (!requestDoc.exists()) {
      return;
    }

    if (requestDoc.data().status !== 'pending') {
      throw new Error('Only pending consent requests can be cancelled');
    }

    await deleteDoc(requestRef);
  }
}
