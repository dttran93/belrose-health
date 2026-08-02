import { BlockchainRef } from './blockchainAddresses';
import { TimestampLike } from './timestamp';

export type SubjectRequestStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'self_consented' // subject added themselves via setSubjectAsSelf
  | 'controller_consented'; // controller anchored trustor via anchorSubjectAsController

/**
 * Document structure for subjectConsentRequests collection
 * Document ID format: {recordId}_{targetUserId}
 */
export interface SubjectConsentRequest {
  recordId: string;
  subjectId: string;
  requestedBy: string;
  requestedSubjectRole: 'sharer' | 'administrator' | 'owner';
  status: SubjectRequestStatus;
  createdAt: TimestampLike;
  respondedAt?: TimestampLike;
  grantedAccessOnSubjectRequest: boolean;
  rejection?: SubjectRejectionData;
  encryptedRecordTitle?: string;
  encryptedRecordTitleIv?: string;
  blockchainRef?: BlockchainRef;
}

export type SubjectRejectionType = 'request_rejected' | 'removed_after_acceptance';
export type CreatorResponseStatus = 'pending_creator_decision' | 'dropped' | 'escalated';

/**
 * Creator's response to a subject rejection
 * Nested within SubjectConsentRequest.rejection
 */
export interface CreatorResponse {
  status: CreatorResponseStatus;
  lastModified?: TimestampLike;
}

/**
 * Rejection data - nested within SubjectConsentRequest
 * Only populated when a subject removes themselves AFTER accepting
 */
export interface SubjectRejectionData {
  rejectionType: SubjectRejectionType;
  rejectedAt: TimestampLike;
  reason: RejectionReasons;
  creatorResponse?: CreatorResponse;
}

export type RejectionReasons =
  | 'identity_mismatch'
  | 'content_dispute'
  | 'privacy'
  | 'duplicate'
  | 'other';

/**
 * Document structure for the records/{recordId}/subjectHistory subcollection — an
 * append-only audit ledger for changes to the subjects[] array, parallel to
 * permissionHistory but kept separate since "subject" is an orthogonal membership axis,
 * not a rung on the owner/administrator/sharer/viewer role ladder.
 *
 * changedBy is normally the subject themselves (self-anchor, self-unanchor, accept via
 * consent), except 'anchored_as_controller' where it's the controller acting on behalf
 * of a trustor (subjectId).
 */
export type SubjectHistoryAction = 'anchored' | 'anchored_as_controller' | 'unanchored';

export interface SubjectHistoryEvent {
  recordId: string;
  recordIdHash: string;
  subjectId: string;
  subjectIdHash: string;
  action: SubjectHistoryAction;
  changedBy: string;
  changedByIdHash: string;
  changedAt: TimestampLike;
  // null until the deferred blockchain call resolves — see writeSubjectHistoryEvent.ts
  blockchainRef: BlockchainRef | null;
  // True when this event came from acceptSubjectRequest (accepting a pending consent
  // request) rather than an immediate self-anchor/controller-anchor.
  viaConsent?: boolean;
}
