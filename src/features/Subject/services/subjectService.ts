// features/Subject/services/subjectService.ts

/**
 * SubjectService is an orchestrator for all subject-related operations
 *
 * Calls on Subject - Blockchain, Rejection, Consent, Membership, Permission services to orchestrate
 * - Setting yourself as subject
 * - Requesting someone else to be subject
 * - Rejecting/removing subject status
 * - Creator response to rejections
 * - Related blockchain anchoring/unanchoring
 *
 * Notifications are handled with functions/notifications/triggers -->
 * automatically send notifications for any updates within the records collections
 *
 * Access Permissions:
 * Access is handled in the useSubjectFlow with imports from PermissionService
 */

import { getFirestore, doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import SubjectBlockchainService from './subjectBlockchainService';
import { VerificationLevel } from '@/features/Credibility/services/blockchainHealthRecordService';
import {
  createVerification,
  recordSelfVerification,
} from '@/features/Credibility/services/verificationService';
import { SubjectRejectionService } from './subjectRejectionService';
import { getConsentRequestId, SubjectConsentService } from './subjectConsentService';
import SubjectMembershipService from './subjectMembershipService';
import SubjectPermissionService from './subjectPermissionService';
import { FileObject } from '@/types/core';
import SubjectRemovalService from './subjectRemovalService';
import { TrusteePermissionService } from '@/features/Trustee/services/trusteePermissionService';
import {
  buildHealthRecordRef,
  CreatorResponseStatus,
  RejectionReasons,
  SubjectConsentRequest,
  VerificationLevelOptions,
} from '@belrose/shared';
import { PermissionsService } from '@/features/Permissions/services/permissionsService';

// ============================================================================
// TYPES
// ============================================================================

export interface SetSubjectSelfResult {
  success: boolean;
  recordId: string;
  subjectId: string;
  blockchainAnchored?: boolean;
}

export interface RejectSubjectStatusResult {
  success: boolean;
  pendingCreatorDecision: boolean;
}

export interface RespondToRejectionResult {
  success: boolean;
  recordId: string;
  subjectId: string;
  response: CreatorResponseStatus;
}

export class SubjectService {
  // ============================================================================
  // PRIVATE HELPER
  // ============================================================================

  /**
   * Helper to ensure user is logged in and record exists/is accessible.
   * Centralizes the "Fetch-and-Authorize" logic.
   */
  private static async getAuthorizedRecord(recordId: string): Promise<{
    user: any;
    recordData: FileObject;
  }> {
    const user = getAuth().currentUser;
    if (!user) throw new Error('User not authenticated');

    const db = getFirestore();
    const recordRef = doc(db, 'records', recordId);
    const recordDoc = await getDoc(recordRef);

    if (!recordDoc.exists()) {
      throw new Error('Record not found');
    }

    // Standardize the data object with the ID
    const recordData = {
      id: recordDoc.id,
      ...recordDoc.data(),
    } as FileObject;

    // Check general management permissions
    if (!PermissionsService.canManageRecord(recordData, user.uid)) {
      throw new Error('You do not have permission to modify this record');
    }

    return { user, recordData };
  }

  // ============================================================================
  // SET SUBJECT METHODS
  // ============================================================================

  /**
   * Set the current user as the subject of a record
   *
   * This is immediate - no consent flow needed when you're claiming
   * a record is about yourself.
   *
   * Also anchors the subject on the blockchain.
   *
   * @param recordId - The Firestore document ID of the record
   */
  static async setSubjectAsSelf(
    recordId: string,
    selfVerifyLevel?: VerificationLevel
  ): Promise<SetSubjectSelfResult> {
    const { user, recordData } = await this.getAuthorizedRecord(recordId);

    console.log('👤 Setting subject as self for record:', recordId);

    try {
      // Check if already a subject
      if (recordData.subjects?.includes(user.uid)) {
        return { success: true, recordId, subjectId: user.uid, blockchainAnchored: true };
      }

      if (!recordData.recordHash) {
        throw new Error('Record does not have a hash for blockchain anchoring');
      }

      // Step 1: Anchor on blockchain (requires wallet signature)
      console.log('🔗 Anchoring subject on blockchain...');
      const txResult = await SubjectBlockchainService.anchorSubject(
        recordId,
        recordData.recordHash,
        user.uid,
        selfVerifyLevel
      );
      console.log('✅ Blockchain: Subject anchored');

      // Step 2: Update Firestore
      await SubjectMembershipService.addSubject(recordId, user.uid);
      console.log('✅ Firestore: Subject added');

      // Step 3: Grant access to any trustees of the subject
      try {
        await TrusteePermissionService.grantAccessForNewRecord(user.uid, recordId, txResult);
        console.log('✅ Access granted to subject trustees');
      } catch (trusteeError) {
        // Non-fatal — subject was successfully added
        console.error('⚠️ Failed to grant trustee access for new record:', trusteeError);
      }

      const blockchainRef = txResult
        ? buildHealthRecordRef(txResult.txHash, txResult.blockNumber)
        : undefined;

      // Step 4: Create audit consent request doc with blockchain ref (non-fatal)
      try {
        const db = getFirestore();
        const requestId = getConsentRequestId(recordId, user.uid);
        const now = Timestamp.now();
        const role: SubjectConsentRequest['requestedSubjectRole'] = recordData.owners?.includes(
          user.uid
        )
          ? 'owner'
          : recordData.administrators?.includes(user.uid)
            ? 'administrator'
            : 'sharer';
        await setDoc(doc(db, 'subjectConsentRequests', requestId), {
          recordId,
          subjectId: user.uid,
          requestedBy: user.uid,
          requestedSubjectRole: role,
          status: 'self_consented',
          createdAt: now,
          respondedAt: now,
          grantedAccessOnSubjectRequest: false,
          ...(blockchainRef ? { blockchainRef } : {}),
        } satisfies SubjectConsentRequest);
      } catch (consentError) {
        console.warn('⚠️ Failed to create self-add consent record:', consentError);
      }

      // Step 5: Mirror the anchor tx's self-verify into Firestore (non-fatal)
      // anchorRecord defaults selfVerifyLevel to Full when omitted, so mirror that same default.
      const appliedVerifyLevel = selfVerifyLevel ?? VerificationLevel.Full;
      if (blockchainRef && appliedVerifyLevel !== VerificationLevel.None) {
        try {
          await recordSelfVerification(
            recordId,
            recordData.recordHash,
            user.uid,
            appliedVerifyLevel as VerificationLevelOptions,
            blockchainRef
          );
          console.log('✅ Self-verification mirrored');
        } catch (verifyError) {
          console.warn('⚠️ Failed to mirror self-verification:', verifyError);
        }
      }

      console.log('✅ Subject set as self successfully');
      return {
        success: true,
        recordId,
        subjectId: user.uid,
        blockchainAnchored: txResult !== null,
      };
    } catch (error) {
      console.error('❌ Error setting subject as self:', error);
      throw error;
    }
  }

  /**
   * Anchor a trustor as the subject of a record on behalf of a controller trustee.
   * The caller must be an active controller trustee of trustorId (verified on-chain by isControllerOf).
   * No consent request is needed — controller authority is sufficient.
   */
  static async anchorSubjectAsController(
    recordId: string,
    trustorId: string,
    role: SubjectConsentRequest['requestedSubjectRole'] = 'sharer',
    selfVerifyLevel?: VerificationLevel
  ): Promise<void> {
    const user = getAuth().currentUser;
    if (!user) throw new Error('User not authenticated');

    const db = getFirestore();
    const recordRef = doc(db, 'records', recordId);
    const recordDoc = await getDoc(recordRef);
    if (!recordDoc.exists()) throw new Error('Record not found');

    const recordData = { id: recordDoc.id, ...recordDoc.data() } as FileObject;

    if (!recordData.recordHash) {
      throw new Error('Record does not have a hash for blockchain anchoring');
    }

    if (recordData.subjects?.includes(trustorId)) {
      return; // already a subject — idempotent
    }

    console.log('👤 Controller anchoring trustor as subject:', { recordId, trustorId });

    // Step 1: Anchor on blockchain — passes trustorId hash as subjectIdHash
    const txResult = await SubjectBlockchainService.anchorSubjectAsController(
      recordId,
      recordData.recordHash,
      user.uid,
      trustorId,
      selfVerifyLevel
    );
    console.log('✅ Blockchain: Subject anchored as controller');

    // Step 2: Update Firestore
    await SubjectMembershipService.addSubjectAsController(recordId, trustorId);
    console.log('✅ Firestore: Subject added');

    // Step 3: Fan out access to the trustor's own trustees (non-fatal)
    try {
      await TrusteePermissionService.grantAccessForNewRecord(trustorId, recordId, txResult);
      console.log("✅ Access granted to trustor's trustees");
    } catch (trusteeError) {
      console.error('⚠️ Failed to grant trustee access for new record:', trusteeError);
    }

    const blockchainRef = txResult
      ? buildHealthRecordRef(txResult.txHash, txResult.blockNumber)
      : undefined;

    // Step 4: Create audit consent request doc with blockchain ref (non-fatal)
    try {
      const db = getFirestore();
      const requestId = getConsentRequestId(recordId, trustorId);
      const now = Timestamp.now();
      await setDoc(doc(db, 'subjectConsentRequests', requestId), {
        recordId,
        subjectId: trustorId,
        requestedBy: user.uid,
        requestedSubjectRole: role,
        status: 'controller_consented',
        createdAt: now,
        respondedAt: now,
        grantedAccessOnSubjectRequest: false,
        ...(blockchainRef ? { blockchainRef } : {}),
      } satisfies SubjectConsentRequest);
    } catch (consentError) {
      console.warn('⚠️ Failed to create controller consent record:', consentError);
    }

    // Step 5: Mirror the anchor tx's self-verify into Firestore (non-fatal)
    // anchorRecordAsController defaults selfVerifyLevel to Full when omitted, and credits the
    // controller (caller), not the trustor, as the verifier — matching the on-chain behavior.
    const appliedVerifyLevel = selfVerifyLevel ?? VerificationLevel.Full;
    if (blockchainRef && appliedVerifyLevel !== VerificationLevel.None) {
      try {
        await recordSelfVerification(
          recordId,
          recordData.recordHash,
          user.uid,
          appliedVerifyLevel as VerificationLevelOptions,
          blockchainRef
        );
        console.log('✅ Self-verification mirrored');
      } catch (verifyError) {
        console.warn('⚠️ Failed to mirror self-verification:', verifyError);
      }
    }
  }

  /**
   * Request another user to confirm they are the subject of a record
   *
   * This creates a pending request that the target user must respond to.
   * Also grants the requested role immediately so they can preview the record
   * The record is NOT updated until they accept.
   *
   * @param recordId - The Firestore document ID of the record
   * @param subjectId - The userId of the proposed subject
   */
  static async requestSubjectConsent(
    recordId: string,
    subjectId: string,
    options?: {
      role?: 'sharer' | 'administrator' | 'owner';
      recordTitle?: string;
      /** Requester's own verification of the record's current hash — omit to skip. */
      verifyLevel?: VerificationLevelOptions;
    }
  ): Promise<{ success: true }> {
    const auth = getAuth();
    const db = getFirestore();
    const user = auth.currentUser;

    if (!user) {
      throw new Error('User not authenticated');
    }

    // Check: Fetch the record to verify permissions
    const recordRef = doc(db, 'records', recordId);
    const recordDoc = await getDoc(recordRef);

    if (!recordDoc.exists()) {
      throw new Error('Record not found');
    }

    // Permission checks. Must be owner/admin/uploader. target must not already be subject
    const recordData = recordDoc.data() as FileObject;

    if (!PermissionsService.canManageRecord(recordData, user.uid)) {
      throw new Error('You do not have permission to modify this record');
    }

    if (recordData.subjects?.includes(subjectId)) {
      throw new Error('This user is already a subject of this record');
    }

    // Check if a consent request already exists for this user/record pair
    const requestId = getConsentRequestId(recordId, subjectId);
    const existingRequestRef = doc(db, 'subjectConsentRequests', requestId);
    const existingRequest = await getDoc(existingRequestRef);

    if (existingRequest.exists()) {
      const data = existingRequest.data();

      // First check if there's a rejection, then check pending or accepted status
      if (data.rejection) {
        const rejectionType = data.rejection.rejectionType;
        const creatorResponseStatus = data.rejection.creatorResponse?.status;

        if (creatorResponseStatus === 'dropped') {
          throw new Error(
            'This subject request was previously dropped. ' +
              'Only the user themselves can now add themselves to this record.'
          );
        } else if (rejectionType === 'request_rejected') {
          throw new Error(
            'This user has previously declined a subject request for this record. ' +
              'Please review the rejection reason and escalate if needed.'
          );
        } else if (rejectionType === 'removed_after_acceptance') {
          throw new Error(
            'This user was previously a subject but removed themselves from this record. ' +
              'Please review the rejection reason and escalate if needed.'
          );
        } else if (rejectionType === 'self_removal') {
          throw new Error(
            'This user previously removed themselves as a subject of this record. ' +
              'Please review the rejection reason and escalate if needed.'
          );
        }
      } else {
        // No rejection - check the status
        if (data.status === 'pending') {
          throw new Error('A pending subject request already exists for this user');
        }

        if (data.status === 'accepted') {
          throw new Error('This user is already a subject of this record');
        }

        if (data.status === 'rejected') {
          throw new Error(
            'This user has previously declined a subject request for this record. ' +
              'Please review the rejection reason and escalate if needed.'
          );
        }
      }
    }

    // Delegate to SubjectConsentService for creating the request
    const recordTitle = options?.recordTitle || `Record ${recordId.slice(0, 8)}...`;

    // Optional: requester verifies the record's current content/provenance as part of the
    // request — matches the "provider creates and verifies, then requests patient anchor" flow.
    // Non-fatal: a failed verification shouldn't block the consent request itself.
    if (options?.verifyLevel && recordData.recordHash) {
      try {
        await createVerification(
          recordId,
          recordData.recordHash,
          user.uid,
          options.verifyLevel,
          recordTitle
        );
        console.log('✅ Requester verification recorded');
      } catch (verifyError) {
        console.warn('⚠️ Failed to record requester verification:', verifyError);
      }
    }

    await SubjectConsentService.requestConsent({
      recordId,
      subjectId,
      requestedBy: user.uid,
      requestedSubjectRole: options?.role || 'sharer',
      recordTitle,
    });

    return { success: true };
  }

  /**
   * Accept a pending subject request
   *
   * Called by the proposed subject to confirm they are indeed
   * the subject of the record.
   *
   * Also anchors the subject on the blockchain.
   *
   * @param recordId - The Firestore document ID of the record
   * @param signature - Optional wallet signature for blockchain verification
   */
  static async acceptSubjectRequest(
    recordId: string,
    selfVerifyLevel?: VerificationLevel
  ): Promise<{ success: true }> {
    const auth = getAuth();
    const db = getFirestore();
    const user = auth.currentUser;

    if (!user) {
      throw new Error('User not authenticated');
    }

    console.log('✅ Accepting subject request for record:', recordId);

    // Check 1: Find the consent request
    const requestId = getConsentRequestId(recordId, user.uid);
    const requestRef = doc(db, 'subjectConsentRequests', requestId);
    const requestDoc = await getDoc(requestRef);

    const requestData = requestDoc.data() as SubjectConsentRequest;

    if (
      !requestDoc.exists() ||
      requestDoc.data().status !== 'pending' ||
      requestData.subjectId !== user.uid
    ) {
      throw new Error('No pending subject request found for you');
    }

    // Check 2: Load record for blockchain anchoring
    const recordRef = doc(db, 'records', recordId);
    const recordDoc = await getDoc(recordRef);

    if (!recordDoc.exists()) {
      throw new Error('Record not found');
    }

    const recordData = recordDoc.data();
    const recordHash = recordData.recordHash;

    if (!recordHash) {
      throw new Error('Record does not have a hash for blockchain anchoring');
    }

    // Step 1: Anchor on blockchain
    console.log('🔗 Anchoring subject on blockchain...');
    const txResult = await SubjectBlockchainService.anchorSubject(
      recordId,
      recordHash,
      user.uid,
      selfVerifyLevel
    );
    console.log('✅ Blockchain: Subject anchored');

    // Step 2: Update Firestore Subject Consent
    await SubjectConsentService.acceptConsent(recordId, user.uid);
    console.log('✅ Firestore: Consent accepted');

    // Step 3: Update record's subject array
    await SubjectMembershipService.addSubject(recordId, user.uid);
    console.log('✅ Firestore: Subject added to record');

    // Step 4: Grant access to subject's trustees
    try {
      await TrusteePermissionService.grantAccessForNewRecord(user.uid, recordId, txResult);
      console.log('✅ Access granted to subject trustees');
    } catch (trusteeError) {
      // Non-fatal — subject request was successfully accepted
      console.error('⚠️ Failed to grant trustee access for new record:', trusteeError);
    }

    console.log('✅ Subject request accepted successfully');
    return { success: true };
  }

  /**
   * Reject a pending subject request
   *
   * Called by the proposed subject to decline being set as subject.
   *
   * @param recordId - The Firestore document ID of the record
   * @param reason - Optional reason for rejection
   */
  static async rejectSubjectRequest(
    recordId: string,
    reason?: string
  ): Promise<{ success: boolean }> {
    const auth = getAuth();
    const db = getFirestore();
    const user = auth.currentUser;

    if (!user) {
      throw new Error('User not authenticated');
    }

    console.log('❌ Rejecting subject request for record:', recordId);

    //Check: Must be the subject of the pending request
    const requestId = getConsentRequestId(recordId, user.uid);
    const requestRef = doc(db, 'subjectConsentRequests', requestId);
    const requestDoc = await getDoc(requestRef);
    const requestData = requestDoc.data() as SubjectConsentRequest;

    if (
      !requestDoc.exists() ||
      requestDoc.data().status !== 'pending' ||
      requestData.subjectId !== user.uid
    ) {
      throw new Error('No pending request found for you');
    }

    // Delegate to SubjectConsentService to reject the request
    await SubjectConsentService.rejectConsent(recordId, user.uid, reason);
    return { success: true };
  }

  /**
   * Reject or remove subject status (self-removal flow)
   *
   * Unified function that handles:
   * - Self-removal by owner/admin (added themselves, no consent flow)
   * - Removing oneself as subject (previously accepted via consent)
   *
   * In consent flow cases:
   * 1. Subject is immediately unlinked from the record
   * 2. The SubjectConsentRequest is updated with rejection data
   * 3. Creator is notified and must decide whether to escalate
   *
   * Atomic operation: blockchain first, then Firestore.
   *
   * @param recordId - The Firestore document ID of the record
   * @param reason - Reason for rejection
   */
  static async rejectSubjectStatus(
    recordId: string,
    reason: RejectionReasons
  ): Promise<RejectSubjectStatusResult> {
    const auth = getAuth();
    const db = getFirestore();
    const user = auth.currentUser;

    if (!user) {
      throw new Error('User not authenticated');
    }

    console.log('🚫 Rejecting/removing subject status for record:', recordId);

    try {
      const recordRef = doc(db, 'records', recordId);
      const recordDoc = await getDoc(recordRef);

      if (!recordDoc.exists()) {
        throw new Error('Record not found');
      }

      const recordData = recordDoc.data();
      const subjects: string[] = recordData.subjects || [];

      // Check if user is currently a subject
      if (!subjects.includes(user.uid)) {
        throw new Error('You are not a subject of this record');
      }

      // Check if there was a consent flow by looking up the consent request
      const requestId = getConsentRequestId(recordId, user.uid);
      const requestRef = doc(db, 'subjectConsentRequests', requestId);
      const requestDoc = await getDoc(requestRef);

      const hadConsentFlow = requestDoc.exists() && requestDoc.data()?.status === 'accepted';

      // Step 1: Unanchor from blockchain
      console.log('🔗 Unanchoring subject from blockchain...');
      const unanchorTxResult = await SubjectBlockchainService.unanchorSubject(recordId, user.uid);
      console.log('✅ Blockchain: Subject unanchored');

      // Step 2: Update Firestore (only if blockchain succeeded)
      await SubjectMembershipService.removeSubject(recordId, user.uid);
      console.log('✅ Firestore: Subject removed from record');

      let pendingCreatorDecision = false;

      // FLOW 1: SELF REMOVAL - No consent flow existed
      if (!hadConsentFlow) {
        console.log('✅ Self-removal complete (no consent flow existed)');
      } else {
        // FLOW 2: Consent flow existed, capture the rejection data
        const rejectionData = await SubjectRejectionService.rejectAfterAcceptance({
          recordId,
          subjectId: user.uid,
          reason,
        });

        pendingCreatorDecision =
          rejectionData.creatorResponse?.status === 'pending_creator_decision';
        console.log('✅ Subject status rejected after acceptance');
      }

      // Step 3: Remove any trustees that have access through the removed subject
      try {
        await TrusteePermissionService.revokeAccessForRemovedRecord(
          user.uid,
          recordId,
          unanchorTxResult
        );
        console.log('✅ Subject trustees removed from record');
      } catch (trusteeError) {
        // Non-fatal — subject removal already succeeded
        console.error('⚠️ Failed to revoke trustee access on subject removal:', trusteeError);
      }

      console.log('✅ Subject status rejection complete');
      return {
        success: true,
        pendingCreatorDecision,
      };
    } catch (error) {
      console.error('❌ Error rejecting subject status:', error);
      throw error;
    }
  }

  /**
   * Respond to a subject rejection
   *
   * Called by the record creator to decide whether to publicly list
   * the rejection. Comes from subject rejection service. This completes the rejection flow.
   *
   * @param recordId - The Firestore document ID of the record
   * @param subjectId - The userId of the subject who rejected
   * @param response - Requester's response to the rejection
   */
  static async respondToSubjectRejection(
    recordId: string,
    subjectId: string,
    response: CreatorResponseStatus
  ): Promise<RespondToRejectionResult> {
    return SubjectRejectionService.respondToRejection(recordId, subjectId, response);
  }

  /**
   * Request a subject to remove themselves from a record (by owner/admin)
   *
   * This is different from rejectSubjectStatus - this is when an owner
   * or admin wants to remove someone else as subject, not the subject removing themselves.
   *
   * Only a subject can unanchor themselves from the blockchain. Therefore, it must be the subject
   * who removes themselves as a subject. This flow allows an owner or admin to request a subject remove
   * themselves as subject
   *
   * @param recordId - The Firestore document ID of the record
   * @param subjectId - The userId of the subject to remove
   */
  static async requestSubjectRemoval(
    recordId: string,
    subjectId: string,
    reason?: string,
    recordTitle?: string
  ): Promise<{ success: boolean }> {
    const { user } = await this.getAuthorizedRecord(recordId);

    // Execute removal from subjects array
    await SubjectRemovalService.requestRemoval(recordId, subjectId, reason, recordTitle);

    console.log('✅ Subject sent removal request');

    return { success: true };
  }

  /**
   * Cancel a pending subject consent request
   *
   * Called by the record owner/admin to cancel a request they sent.
   * Simply deletes the pending request document.
   *
   * @param recordId - The Firestore document ID of the record
   * @param subjectId - The userId of the proposed subject
   */
  static async cancelSubjectConsentRequest(
    recordId: string,
    subjectId: string
  ): Promise<{ success: true }> {
    // 1. Fetch & Authorize
    const { user, recordData } = await this.getAuthorizedRecord(recordId);

    // 2. Permission check to make sure they can cancel request
    if (!SubjectPermissionService.canCancelRequest(recordData, user.uid)) {
      throw new Error('You do not have permission to cancel this request');
    }

    // 3. Cancel Request
    await SubjectConsentService.cancelConsent(recordId, subjectId);

    return { success: true };
  }
}

export default SubjectService;
