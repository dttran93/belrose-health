//src/features/Subject/services/subjectQueryService.ts

/**
 * SubjectQueryService
 *
 * Centralized query service for all subject-related data:
 * - Record subjects
 * - Consent requests (pending, incoming, history)
 * - Removal requests (pending, incoming, outgoing)
 * - Rejection decisions
 *
 * Keeps all read operations in one place for consistency and maintainability.
 */

import {
  collection,
  doc,
  DocumentData,
  FirestoreDataConverter,
  getDoc,
  getDocs,
  getFirestore,
  query,
  QueryDocumentSnapshot,
  Timestamp,
  where,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import {
  SubjectRemovalRequest,
  RemovalRequestStatus,
  getRemovalRequestId,
} from './subjectRemovalService';
import { RejectionReasons, SubjectConsentRequest, SubjectRequestStatus } from '@belrose/shared';

// ============================================================================
// TYPES
// ============================================================================

export interface IncomingSubjectRequest {
  id: string;
  recordId: string;
  recordTitle?: string;
  requestedBy: string;
  requestedSubjectRole: 'sharer' | 'administrator' | 'owner';
  requestedAt: Timestamp;
  status: SubjectRequestStatus;
}

export interface IncomingRemovalRequest {
  id: string;
  recordId: string;
  recordTitle?: string;
  requestedBy: string;
  reason?: string;
  requestedAt: Timestamp;
  status: RemovalRequestStatus;
}

export interface PendingRejectionResponse {
  recordId: string;
  subjectId: string;
  subjectName?: string;
  rejectedAt: Timestamp;
  reason: RejectionReasons;
  recordTitle?: string;
}

export interface PendingRemovalRequest {
  recordId: string;
  requestedAt: Timestamp;
  requestedBy: string;
  reason?: string;
  recordTitle?: string;
}

// ============================================================================
// FIRESTORE CONVERTERS
// ============================================================================

/**
 * Converter for SubjectConsentRequest documents
 */
const consentRequestConverter: FirestoreDataConverter<SubjectConsentRequest> = {
  toFirestore: (data: SubjectConsentRequest): DocumentData => data,
  fromFirestore: (snapshot: QueryDocumentSnapshot): SubjectConsentRequest => {
    return { ...snapshot.data(), id: snapshot.id } as unknown as SubjectConsentRequest;
  },
};

/**
 * Converter for SubjectRemovalRequest documents
 */
const removalRequestConverter: FirestoreDataConverter<SubjectRemovalRequest> = {
  toFirestore: (data: SubjectRemovalRequest): DocumentData => data,
  fromFirestore: (snapshot: QueryDocumentSnapshot): SubjectRemovalRequest => {
    return { ...snapshot.data(), id: snapshot.id } as unknown as SubjectRemovalRequest;
  },
};

// ============================================================================
// SERVICE CLASS
// ============================================================================

export class SubjectQueryService {
  // A getter, not a field initializer: a field would call getFirestore() once at module-load
  // time, before any app has necessarily been initialized (e.g. in tests that import this module
  // without ever touching Firestore) — every other service in this codebase calls getFirestore()
  // fresh per method for the same reason.
  private static get db() {
    return getFirestore();
  }

  // ==========================================================================
  // RECORD SUBJECTS
  // ==========================================================================

  /**
   * Get all subjects for a record
   */
  static async getRecordSubjects(recordId: string): Promise<string[]> {
    const recordRef = doc(this.db, 'records', recordId);
    const recordDoc = await getDoc(recordRef);
    if (!recordDoc.exists()) throw new Error('Record not found');
    return recordDoc.data().subjects || [];
  }

  // ==========================================================================
  // CONSENT REQUEST QUERIES
  // ==========================================================================

  /**
   * Get pending consent requests for a specific record
   * Queries as both subject and requester to cover both permission paths
   */
  static async getPendingConsentRequestsForRecord(
    recordId: string
  ): Promise<SubjectConsentRequest[]> {
    const user = getAuth().currentUser;
    if (!user) throw new Error('User not authenticated');

    // Run two queries that each satisfy a security rule branch
    const [asSubject, asRequester] = await Promise.all([
      getDocs(
        query(
          collection(this.db, 'subjectConsentRequests').withConverter(consentRequestConverter),
          where('recordId', '==', recordId),
          where('status', '==', 'pending'),
          where('subjectId', '==', user.uid)
        )
      ),
      getDocs(
        query(
          collection(this.db, 'subjectConsentRequests').withConverter(consentRequestConverter),
          where('recordId', '==', recordId),
          where('status', '==', 'pending'),
          where('requestedBy', '==', user.uid)
        )
      ),
    ]);

    // Dedupe results
    const seen = new Set<string>();
    const results: SubjectConsentRequest[] = [];
    for (const doc of [...asSubject.docs, ...asRequester.docs]) {
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        results.push(doc.data());
      }
    }
    return results;
  }

  /**
   * Get rejected consent requests for a specific record
   * Excludes requests that have been dropped
   */
  static async getRejectedConsentRequestsForRecord(
    recordId: string
  ): Promise<SubjectConsentRequest[]> {
    const q = query(
      collection(this.db, 'subjectConsentRequests').withConverter(consentRequestConverter),
      where('recordId', '==', recordId),
      where('status', '==', 'rejected')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map(doc => doc.data())
      .filter(req => req.rejection?.creatorResponse?.status !== 'dropped');
  }

  /**
   * Get incoming consent requests for the current user
   */
  static async getIncomingConsentRequests(): Promise<IncomingSubjectRequest[]> {
    const user = getAuth().currentUser;
    if (!user) throw new Error('User not authenticated');

    const q = query(
      collection(this.db, 'subjectConsentRequests').withConverter(consentRequestConverter),
      where('subjectId', '==', user.uid),
      where('status', '==', 'pending')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        recordId: data.recordId,
        requestedBy: data.requestedBy,
        requestedSubjectRole: data.requestedSubjectRole,
        requestedAt: data.createdAt,
        status: data.status,
      };
    });
  }

  /**
   * Get history of all consent requests for a record
   */
  static async getAllConsentRequestsForRecord(recordId: string): Promise<SubjectConsentRequest[]> {
    const q = query(
      collection(this.db, 'subjectConsentRequests').withConverter(consentRequestConverter),
      where('recordId', '==', recordId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data());
  }

  /**
   * Get a specific consent request
   */
  static async getConsentRequest(
    recordId: string,
    subjectId: string
  ): Promise<SubjectConsentRequest | null> {
    const requestId = `${recordId}_${subjectId}`;
    const requestRef = doc(this.db, 'subjectConsentRequests', requestId).withConverter(
      consentRequestConverter
    );
    const requestDoc = await getDoc(requestRef);

    if (!requestDoc.exists()) return null;
    return requestDoc.data();
  }

  // ==========================================================================
  // REMOVAL REQUEST QUERIES
  // ==========================================================================

  /**
   * Get pending removal requests for a specific record
   *
   * Used by owners/admins to see what removal requests are outstanding.
   */
  static async getPendingRemovalRequestsForRecord(
    recordId: string,
    subjectId: string
  ): Promise<SubjectRemovalRequest[]> {
    const q = query(
      collection(this.db, 'subjectRemovalRequests').withConverter(removalRequestConverter),
      where('recordId', '==', recordId),
      where('subjectId', '==', subjectId),
      where('status', '==', 'pending')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data());
  }

  /**
   * Get incoming removal requests for the current user
   *
   * Used by subjects to see who is requesting they remove themselves.
   */
  static async getIncomingRemovalRequests(): Promise<IncomingRemovalRequest[]> {
    const user = getAuth().currentUser;
    if (!user) throw new Error('User not authenticated');

    const q = query(
      collection(this.db, 'subjectRemovalRequests').withConverter(removalRequestConverter),
      where('subjectId', '==', user.uid),
      where('status', '==', 'pending')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        recordId: data.recordId,
        recordTitle: data.recordTitle,
        requestedBy: data.requestedBy,
        reason: data.reason,
        requestedAt: data.createdAt,
        status: data.status,
      };
    });
  }

  /**
   * Get outgoing removal requests made by the current user
   *
   * Used by owners/admins to track their requests.
   */
  static async getOutgoingRemovalRequests(): Promise<SubjectRemovalRequest[]> {
    const user = getAuth().currentUser;
    if (!user) throw new Error('User not authenticated');

    const q = query(
      collection(this.db, 'subjectRemovalRequests').withConverter(removalRequestConverter),
      where('requestedBy', '==', user.uid)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data());
  }

  /**
   * Get a specific removal request
   */
  static async getRemovalRequest(
    recordId: string,
    subjectId: string
  ): Promise<SubjectRemovalRequest | null> {
    const requestId = `${recordId}_${subjectId}`;
    const requestRef = doc(this.db, 'subjectRemovalRequests', requestId).withConverter(
      removalRequestConverter
    );
    const requestDoc = await getDoc(requestRef);

    if (!requestDoc.exists()) return null;
    return requestDoc.data();
  }

  /**
   * Get all removal requests for a record (any status)
   *
   * Useful for showing history/audit trail.
   */
  static async getAllRemovalRequestsForRecord(recordId: string): Promise<SubjectRemovalRequest[]> {
    const q = query(
      collection(this.db, 'subjectRemovalRequests').withConverter(removalRequestConverter),
      where('recordId', '==', recordId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data());
  }

  // ==========================================================================
  // REJECTION QUERIES
  // ==========================================================================

  /**
   * Get rejections awaiting creator decision
   * Only queries requests where current user was the requester (creator)
   */
  static async getPendingRejectionResponses(recordId: string): Promise<PendingRejectionResponse[]> {
    const user = getAuth().currentUser;
    if (!user) throw new Error('User not authenticated');

    // Query only requests made by this user (they're the "creator" checking rejections)
    const q = query(
      collection(this.db, 'subjectConsentRequests').withConverter(consentRequestConverter),
      where('recordId', '==', recordId),
      where('requestedBy', '==', user.uid) // Satisfies security rule
    );

    const snapshot = await getDocs(q);

    return snapshot.docs
      .map(doc => doc.data())
      .filter(data => data.rejection?.creatorResponse?.status === 'pending_creator_decision')
      .map(data => ({
        recordId: data.recordId,
        subjectId: data.subjectId,
        rejectedAt: data.rejection!.rejectedAt,
        reason: data.rejection!.reason,
      }));
  }

  // ==========================================================================
  // COMBINED / CONVENIENCE QUERIES
  // ==========================================================================

  /**
   * Get all incoming requests (both consent and removal) for the current user
   *
   * Useful for a unified "inbox" view showing everything the user needs to respond to.
   */
  static async getAllIncomingRequests(): Promise<{
    consentRequests: IncomingSubjectRequest[];
    removalRequests: IncomingRemovalRequest[];
  }> {
    const [consentRequests, removalRequests] = await Promise.all([
      this.getIncomingConsentRequests(),
      this.getIncomingRemovalRequests(),
    ]);

    return { consentRequests, removalRequests };
  }

  /**
   * Get all pending requests and alerts for a record
   *
   * Used by both:
   * - Owners/admins to see outstanding requests
   * - Alert banners to show what needs attention
   */
  static async getRecordAlerts(recordId: string): Promise<{
    // For the current user
    hasPendingRequest: boolean;
    hasRemovalRequest: boolean;
    removalRequest: IncomingRemovalRequest | null;

    // For owners/admins (record-wide)
    pendingConsentRequests: SubjectConsentRequest[];
    pendingRemovalRequests: SubjectRemovalRequest[];
    pendingRejectionResponses: PendingRejectionResponse[];
  }> {
    const user = getAuth().currentUser;

    if (!user) {
      return {
        hasPendingRequest: false,
        hasRemovalRequest: false,
        removalRequest: null,
        pendingConsentRequests: [],
        pendingRemovalRequests: [],
        pendingRejectionResponses: [],
      };
    }

    // Debug each query separately to find the failing one
    let consentRequest: SubjectConsentRequest | null = null;
    let pendingConsentRequests: SubjectConsentRequest[] = [];
    let pendingRemovalRequests: SubjectRemovalRequest[] = [];
    let pendingRejectionResponses: PendingRejectionResponse[] = [];

    try {
      consentRequest = await this.getConsentRequest(recordId, user.uid);
    } catch (e) {
      console.error('✗ getConsentRequest failed:', e);
    }

    try {
      pendingConsentRequests = await this.getPendingConsentRequestsForRecord(recordId);
    } catch (e) {
      console.error('✗ getPendingConsentRequestsForRecord failed:', e);
    }

    try {
      pendingRemovalRequests = await this.getPendingRemovalRequestsForRecord(recordId, user.uid);
    } catch (e) {
      console.error('✗ getPendingRemovalRequestsForRecord failed:', e);
    }

    try {
      pendingRejectionResponses = await this.getPendingRejectionResponses(recordId);
    } catch (e) {
      console.error('✗ getPendingRejectionResponses failed:', e);
    }

    // Check if current user has a removal request for this record
    const userRemovalRequest = pendingRemovalRequests.find(r => r.subjectId === user.uid);

    return {
      // Current user alerts
      hasPendingRequest: consentRequest?.status === 'pending',
      hasRemovalRequest: !!userRemovalRequest,
      removalRequest: userRemovalRequest
        ? {
            id: getRemovalRequestId(userRemovalRequest.recordId, userRemovalRequest.subjectId),
            recordId: userRemovalRequest.recordId,
            recordTitle: userRemovalRequest.recordTitle,
            requestedBy: userRemovalRequest.requestedBy,
            reason: userRemovalRequest.reason,
            requestedAt: userRemovalRequest.createdAt,
            status: userRemovalRequest.status,
          }
        : null,

      // Record-wide data for owners/admins
      pendingConsentRequests,
      pendingRemovalRequests,
      pendingRejectionResponses,
    };
  }
}

export default SubjectQueryService;
