// src/features/Subject/hooks/useSubjectFlow.ts

/**
 * useSubjectFlow Hook
 *
 * Manages all subject operations with a unified dialog flow:
 * - Adding subjects (self or others)
 * - Accepting/rejecting subject requests
 * - Removing subject status
 *
 * Phases:
 * - idle: No dialog open
 * - selecting: Choose self vs other, role selection
 * - searching: User search for "other" flow
 * - preparing: Wallet setup
 * - confirming: Final confirmation
 * - executing: Brief moment while tx is being submitted
 * - submitted: Tx handed off to OnChainActivityTray, dialog closing
 * - error: Pre-submission failure (tx never sent)
 */

import { useState, useCallback, useEffect } from 'react';
import { getAuth } from 'firebase/auth';
import { toast } from 'sonner';
import {
  SubjectPreparationService,
  type SubjectOperationType,
  type SubjectPreparationProgress,
} from '../services/subjectPreparationService';
import { SubjectService } from '../services/subjectService';
import { PermissionsService } from '@/features/Permissions/services/permissionsService';
import { FileObject, BelroseUserProfile } from '@/types/core';
import { doc, getDoc, getFirestore, updateDoc } from 'firebase/firestore';
import SubjectQueryService, { IncomingSubjectRequest } from '../services/subjectQueryService';
import { useOnChainActivityTray } from '@/features/OnChainActivityTray/OnChainActivityTrayContext';
import { getUserFacingErrorMessage } from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { RejectionReasons, SubjectConsentRequest, VerificationLevelOptions } from '@belrose/shared';
import { TrusteeRelationshipService } from '@/features/Trustee/services/trusteeRelationshipService';
import { CredibilityPreparationService } from '@/features/CredibilityRecord/services/credibilityPreparationService';

// ============================================================================
// TYPES
// ============================================================================

export type SubjectRole = 'sharer' | 'administrator' | 'owner';
export type SubjectChoice = 'self' | 'other';

export type SubjectDialogPhase =
  | 'idle'
  | 'selecting' // Choose self vs other
  | 'searching' // User search for "other" flow
  | 'preparing'
  | 'confirming'
  | 'executing' // Brief: tx being submitted, dialog about to close
  | 'submitted' // Tx handed off to tray, OnChainSubmittedContent showing
  | 'error'; // Pre-submission failure only — post-submission errors go to tray

export interface UseSubjectFlowOptions {
  /** The record to operate on */
  record: FileObject;
  /** Callbacks when an operation succeeds, Reject needs a separate one because it has to navigate away from the record */
  onSuccess?: () => void;
  onRejectSuccess?: () => void;
}

interface PendingOperation {
  type: SubjectOperationType;
  recordId: string;
  // For set subject flows
  subjectChoice?: SubjectChoice;
  selectedRole?: SubjectRole;
  selectedUser?: BelroseUserProfile;
  // For remove/reject flows
  reason?: string;
  revokeAccess?: boolean;
}

// Role hierarchy for comparison
const ROLE_HIERARCHY: Record<SubjectRole | 'none', number> = {
  none: 0,
  sharer: 1,
  administrator: 2,
  owner: 3,
};

// ============================================================================
// HELPER FUNCTIONS (exported for use in components)
// ============================================================================

/**
 * Get the user's current highest role for a record.
 *
 * Deliberately does NOT treat `uploadedBy` as an automatic administrator: uploaders start out in
 * `administrators` (see uploadUtils.ts), but nothing prevents them from later being removed like
 * any other admin — `uploadedBy` itself is permanent audit metadata, not a live role. Falling back
 * to it here used to report a stale 'administrator' role for a removed uploader, which fed
 * straight into confirmSetSubjectAsSelf/confirmRequestConsent's "does this user need a role
 * granted" check and silently skipped the grant. An uploader who wants guaranteed standing on
 * their own record can always make themselves owner — there's no gap this fallback needs to cover.
 */
export const getUserRoleForRecord = (userId: string, record: FileObject): SubjectRole | null => {
  if (record.owners?.includes(userId)) return 'owner';
  if (record.administrators?.includes(userId)) return 'administrator';
  if (record.sharers?.includes(userId)) return 'sharer';
  return null;
};

/**
 * Check if selecting a role would be a downgrade
 */
export const isRoleDowngrade = (
  currentRole: SubjectRole | null,
  selectedRole: SubjectRole
): boolean => {
  const currentLevel = ROLE_HIERARCHY[currentRole || 'none'];
  const selectedLevel = ROLE_HIERARCHY[selectedRole];
  return selectedLevel < currentLevel;
};

/**
 * Get the minimum allowed role for a user (their current role or viewer if none)
 */
export const getMinimumAllowedRole = (userId: string, record: FileObject): SubjectRole => {
  const currentRole = getUserRoleForRecord(userId, record);
  return currentRole || 'sharer';
};

// ============================================================================
// HOOK
// ============================================================================

export function useSubjectFlow({ record, onSuccess, onRejectSuccess }: UseSubjectFlowOptions) {
  const recordId = record.id;
  const recordLink = `/app/records/${recordId}`;

  // Dialog state
  const [phase, setPhase] = useState<SubjectDialogPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pendingOperation, setPendingOperation] = useState<PendingOperation | null>(null);
  const [preparationProgress, setPreparationProgress] = useState<SubjectPreparationProgress | null>(
    null
  );

  // Selection state (for the selecting/searching phases)
  const [subjectChoice, setSubjectChoice] = useState<SubjectChoice>('self');
  const [selectedRole, setSelectedRole] = useState<SubjectRole>('sharer');
  const [selectedUser, setSelectedUser] = useState<BelroseUserProfile | null>(null);
  const [revokeAccess, setRevokeAccess] = useState<boolean>(true);

  // Subject status state
  const [isSubject, setIsSubject] = useState(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [currentSubjects, setCurrentSubjects] = useState<string[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<IncomingSubjectRequest[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(true);

  // Controller-anchor state: true when the selected user is a trustor the current user controls
  const [isControllerOfSelected, setIsControllerOfSelected] = useState(false);
  // Set of trustor UIDs for which the current user is an active controller (for badge display)
  const [controllerTrustorIds, setControllerTrustorIds] = useState<Set<string>>(new Set());

  // onChain Activity Tray. UI display for blockchain processing in background
  const { addActivity, updateActivity } = useOnChainActivityTray();
  const [submittedLabel, setSubmittedLabel] = useState('');

  // ==========================================================================
  // FETCH CURRENT STATUS
  // ==========================================================================

  /**
   * Check if current user is a subject of the record
   */
  const fetchSubjectStatus = useCallback(async () => {
    const auth = getAuth();
    const userId = auth.currentUser?.uid;

    if (!userId || !recordId) {
      setIsSubject(false);
      setCurrentSubjects([]);
      setIsLoadingStatus(false);
      return;
    }

    setIsLoadingStatus(true);
    try {
      const subjects = await SubjectQueryService.getRecordSubjects(recordId);
      setCurrentSubjects(subjects);
      setIsSubject(subjects.includes(userId));
    } catch (err) {
      console.error('Error fetching subject status:', err);
      setIsSubject(false);
      setCurrentSubjects([]);
    } finally {
      setIsLoadingStatus(false);
    }
  }, [recordId]);

  /**
   * Fetch incoming subject requests for the current user
   */
  const fetchIncomingRequests = useCallback(async () => {
    const auth = getAuth();
    const userId = auth.currentUser?.uid;

    if (!userId) {
      setIncomingRequests([]);
      setIsLoadingRequests(false);
      return;
    }

    setIsLoadingRequests(true);
    try {
      const requests = await SubjectQueryService.getIncomingConsentRequests();
      setIncomingRequests(requests);
    } catch (err) {
      console.error('Error fetching incoming requests:', err);
      setIncomingRequests([]);
    } finally {
      setIsLoadingRequests(false);
    }
  }, []);

  // Fetch on mount and when recordId changes
  useEffect(() => {
    fetchSubjectStatus();
    fetchIncomingRequests();
  }, [fetchSubjectStatus, fetchIncomingRequests]);

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * Reset dialog to idle state
   */
  const reset = useCallback(() => {
    setPhase('idle');
    setError(null);
    setPendingOperation(null);
    setPreparationProgress(null);
    setSubjectChoice('self');
    setSelectedRole('sharer');
    setSelectedUser(null);
    setRevokeAccess(true);
    setIsControllerOfSelected(false);
    setControllerTrustorIds(new Set());
  }, []);

  /**
   * Refetch all data after a successful operation
   */
  const refetchAll = useCallback(async () => {
    await Promise.all([fetchSubjectStatus(), fetchIncomingRequests()]);
  }, [fetchSubjectStatus, fetchIncomingRequests]);

  /**
   * Get the pending request for the current record (if any)
   */
  const getPendingRequestForRecord = useCallback(() => {
    return incomingRequests.find(req => req.recordId === recordId);
  }, [incomingRequests, recordId]);

  // ==========================================================================
  // PREPARATION
  // ==========================================================================

  /**
   * Run preparation with progress updates
   * Returns true if ready to proceed, false if failed
   */
  const runPreparation = useCallback(
    async (operationType: SubjectOperationType, overrideRecordId?: string): Promise<boolean> => {
      setPhase('preparing');
      setError(null);
      const targetRecordId = overrideRecordId ?? recordId;

      try {
        // Choose the right verification method based on operation type
        let prereqs;
        switch (operationType) {
          case 'setSubjectAsSelf':
            prereqs = await SubjectPreparationService.verifyPrerequisites(targetRecordId);
            break;
          case 'acceptSubjectRequest':
            prereqs = await SubjectPreparationService.verifyAcceptPrerequisites(targetRecordId);
            break;
          case 'rejectSubjectStatus':
            prereqs = await SubjectPreparationService.verifyRemovePrerequisites(targetRecordId);
            break;
          default:
            // For other operations (rejectSubjectRequest, removeSubjectByOwner),
            // just check basic wallet readiness
            prereqs = await SubjectPreparationService.verifyAcceptPrerequisites(targetRecordId);
        }

        if (prereqs.ready) {
          // Already ready, no preparation needed
          return true;
        }

        // Not ready - check why
        const walletNotReady = !prereqs.checks?.callerReady;
        const recordNotInitialized = !prereqs.checks?.recordInitialized;

        if (walletNotReady || recordNotInitialized) {
          // Either wallet needs setup OR record needs initialization — prepare() handles both
          await SubjectPreparationService.prepare(targetRecordId, progress => {
            setPreparationProgress(progress);
          });

          // Verify again after preparation
          const finalCheck =
            operationType === 'setSubjectAsSelf'
              ? await SubjectPreparationService.verifyPrerequisites(targetRecordId)
              : operationType === 'rejectSubjectStatus'
                ? await SubjectPreparationService.verifyRemovePrerequisites(targetRecordId)
                : await SubjectPreparationService.verifyAcceptPrerequisites(targetRecordId);

          if (!finalCheck.ready) {
            // Still not ready after wallet setup - must be a different issue
            throw new Error(finalCheck.reason || 'Preparation failed');
          }

          return true;
        } else {
          // Wallet ready + record initialized, but failed for a reason prepare() can't fix
          // (e.g., no permission, no record hash, already a subject)
          throw new Error(prereqs.reason || 'Prerequisites not met');
        }
      } catch (err) {
        const message = getUserFacingErrorMessage(err, 'Preparation failed');
        setError(message);
        setPhase('error');
        return false;
      }
    },
    [recordId]
  );

  // ==========================================================================
  // ADD SUBJECT FLOW (unified entry point)
  // ==========================================================================

  /**
   * Open the dialog to add a subject (starts at selection phase)
   */
  const initiateAddSubject = useCallback(() => {
    const auth = getAuth();
    const userId = auth.currentUser?.uid;

    // Pre-set the minimum role based on user's current role
    if (userId) {
      const minRole = getMinimumAllowedRole(userId, record);
      setSelectedRole(minRole);
    }

    // Check if user is already a subject
    if (userId && currentSubjects.includes(userId)) {
      setSubjectChoice('other');
    } else {
      setSubjectChoice('self');
    }

    setSelectedUser(null);
    setPhase('selecting');
  }, [record, currentSubjects]);

  /**
   * Move from selecting to next phase based on choice
   */
  const proceedFromSelection = useCallback(async () => {
    if (subjectChoice === 'self') {
      // For self, run preparation then go to confirming
      setPendingOperation({
        type: 'setSubjectAsSelf',
        recordId,
        subjectChoice: 'self',
        selectedRole,
      });

      const ready = await runPreparation('setSubjectAsSelf');
      if (ready) {
        setPhase('confirming');
      }
    } else {
      // Pre-load controller trustors so the search phase can badge them
      const controllerRels = await TrusteeRelationshipService.getActiveControllerTrustors();
      setControllerTrustorIds(new Set(controllerRels.map(r => r.trustorId)));
      setPhase('searching');
    }
  }, [subjectChoice, selectedRole, recordId, runPreparation]);

  /**
   * Select a user in the request flow and proceed to confirmation.
   * If the current user is an active controller of the selected user, branches to
   * the direct-anchor path (no consent request needed).
   */
  const selectUserAndProceed = useCallback(
    async (user: BelroseUserProfile) => {
      setSelectedUser(user);
      setPendingOperation({
        type: 'requestSubjectConsent',
        recordId,
        subjectChoice: 'other',
        selectedRole,
        selectedUser: user,
      });

      // Check for active controller relationship — determines which confirm screen to show
      const controllerRel = await TrusteeRelationshipService.getControllerRelationshipWith(
        user.uid
      );
      setIsControllerOfSelected(!!controllerRel);

      setPhase('confirming');
    },
    [recordId, selectedRole]
  );

  /**
   * Go back from searching to selection
   */
  const goBackToSelection = useCallback(() => {
    setSelectedUser(null);
    setPhase('selecting');
  }, []);

  /**
   * Go back from confirmation to searching
   */
  const goBackToSearching = useCallback(() => {
    setSelectedUser(null);
    setPhase('searching');
  }, []);

  // ==========================================================================
  // CONFIRM SET SELF AS SUBJECT
  // ==========================================================================

  const confirmSetSubjectAsSelf = useCallback(async () => {
    if (!pendingOperation || pendingOperation.subjectChoice !== 'self') return;

    const auth = getAuth();
    const userId = auth.currentUser?.uid;

    if (!userId) {
      setError('You must be signed in');
      setPhase('error');
      return;
    }

    // Capture these now before closing the dialog — closures in .then()/.catch()
    // will still reference them correctly
    const targetRole = pendingOperation.selectedRole || 'sharer';
    const currentRole = getUserRoleForRecord(userId, record);

    const activityId = addActivity({ label: 'Setting subject status', link: recordLink });

    // Fire tx — don't await
    const txPromise = SubjectService.setSubjectAsSelf(recordId);

    // Close dialog immediately
    setSubmittedLabel('Setting subject status');
    setPhase('submitted');

    // Resolve in background
    txPromise
      .then(async result => {
        if (!currentRole || ROLE_HIERARCHY[targetRole] > ROLE_HIERARCHY[currentRole]) {
          await PermissionsService.grantRole(recordId, userId, targetRole);
        }
        updateActivity(activityId, { status: 'confirmed' });
        await refetchAll();
        onSuccess?.();
      })
      .catch(err => {
        const message = getUserFacingErrorMessage(err, 'Failed to set subject status');
        updateActivity(activityId, { status: 'failed', errorMessage: message });
      });
  }, [pendingOperation, recordId, record, addActivity, updateActivity, refetchAll, onSuccess]);

  // ==========================================================================
  // CONFIRM REQUEST CONSENT
  // ==========================================================================

  /**
   * Create a subject request for another user to accept
   * No subject write to the blockchain, all firestore. But may pass grant role to Activity Tray
   */
  const confirmRequestConsent = useCallback(
    async (verifyLevel?: VerificationLevelOptions) => {
      if (!pendingOperation || pendingOperation.subjectChoice !== 'other' || !selectedUser) return;

      const auth = getAuth();
      const userId = auth.currentUser?.uid;

      if (!userId) {
        setError('You must be signed in');
        setPhase('error');
        return;
      }

      setPhase('executing');

      try {
        // Step 1: Run preparation for wallet readiness and initializing on-chain
        console.log('🔄 Step 1: Running preparation...');

        // Re-fetch the canonical recordHash from Firestore rather than trusting the `record`
        // prop — some callers (e.g. CombinedUploadFHIR) pass a locally-held snapshot that isn't
        // guaranteed to match what's currently persisted. requestSubjectConsent below does its
        // own fresh read for the same reason; using a stale hash here would register the wrong
        // hash on-chain and createVerification would revert with "Hash does not belong to this
        // record" since recordIdForHash was never bound for the hash it actually tries to verify.
        const currentRecordHash = verifyLevel
          ? (await getDoc(doc(getFirestore(), 'records', recordId))).data()?.recordHash
          : undefined;

        if (verifyLevel && currentRecordHash) {
          // Verifying also requires recordHash to be registered on-chain (recordIdForHash),
          // which SubjectPreparationService doesn't ensure — CredibilityPreparationService does
          // (it's a superset: wallet readiness + role init + hash registration).
          await CredibilityPreparationService.prepare(recordId, currentRecordHash);
        } else {
          await SubjectPreparationService.prepare(recordId, progress => {
            setPreparationProgress(progress);
          });
        }
        console.log('✅ Step 1 complete');

        //Step 2: Create the consent request
        console.log('🔄 Step 2: Creating consent request...');
        const recordTitle = record.belroseFields?.title || record.fileName;
        await SubjectService.requestSubjectConsent(recordId, selectedUser.uid, {
          role: pendingOperation.selectedRole || 'sharer',
          recordTitle,
          verifyLevel,
        });
        console.log('✅ Step 2 complete');

        // Step 3: Grant the role so the subject can preview the record
        console.log('🔄 Step 3: Checking/granting role...');
        const targetRole = pendingOperation.selectedRole || 'sharer';
        const currentRole = getUserRoleForRecord(selectedUser.uid, record);
        const needsRoleGrant =
          !currentRole || ROLE_HIERARCHY[targetRole] > ROLE_HIERARCHY[currentRole || 'none'];

        if (needsRoleGrant) {
          const activityId = addActivity({
            label: `Granting ${targetRole} access to subject`,
            link: recordLink,
          });

          // Close dialog — blockchain work continues in background
          setSubmittedLabel('Sending subject request');
          setPhase('submitted');

          PermissionsService.grantRole(recordId, selectedUser.uid, targetRole)
            .then(async () => {
              const requestId = `${recordId}_${selectedUser.uid}`;
              const requestRef = doc(getFirestore(), 'subjectConsentRequests', requestId);
              await updateDoc(requestRef, { grantedAccessOnSubjectRequest: true });
              updateActivity(activityId, { status: 'confirmed' });
              toast.success('Consent request sent. The user will be notified.');
              await refetchAll();
              onSuccess?.();
            })
            .catch(err => {
              const message = getUserFacingErrorMessage(err, 'Failed to grant access');
              updateActivity(activityId, { status: 'failed', errorMessage: message });
            });
        } else {
          // No blockchain write needed — wrap up synchronously
          toast.success('Consent request sent. The user will be notified.');
          reset();
          await refetchAll();
          onSuccess?.();
        }
      } catch (err) {
        const message = getUserFacingErrorMessage(err, 'Failed to send consent request');
        setError(message);
        setPhase('error');
        toast.error(message);
      }
    },
    [
      pendingOperation,
      selectedUser,
      recordId,
      record,
      addActivity,
      updateActivity,
      reset,
      refetchAll,
      onSuccess,
    ]
  );

  // ==========================================================================
  // CONTROLLER ANCHOR FLOW
  // ==========================================================================

  /**
   * Anchor the selected user as subject directly, using controller trustee authority.
   * Re-verifies the relationship before proceeding (belt-and-suspenders).
   */
  const confirmAnchorSubjectAsController = useCallback(async () => {
    if (!selectedUser) return;

    const auth = getAuth();
    const userId = auth.currentUser?.uid;
    if (!userId) {
      setError('You must be signed in');
      setPhase('error');
      return;
    }

    // Belt-and-suspenders: re-verify the controller relationship is still active
    const rel = await TrusteeRelationshipService.getControllerRelationshipWith(selectedUser.uid);
    if (!rel) {
      setError('Controller relationship no longer exists or has been revoked');
      setPhase('error');
      return;
    }

    const activityId = addActivity({ label: 'Anchoring subject as controller', link: recordLink });

    const txPromise = SubjectService.anchorSubjectAsController(
      recordId,
      selectedUser.uid,
      selectedRole
    );

    setSubmittedLabel('Anchoring subject as controller');
    setPhase('submitted');

    txPromise
      .then(async () => {
        updateActivity(activityId, { status: 'confirmed' });
        await refetchAll();
        onSuccess?.();
      })
      .catch(err => {
        const message = getUserFacingErrorMessage(err, 'Failed to anchor subject');
        updateActivity(activityId, { status: 'failed', errorMessage: message });
      });
  }, [selectedUser, recordId, recordLink, addActivity, updateActivity, refetchAll, onSuccess]);

  // ==========================================================================
  // ACCEPT SUBJECT REQUEST FLOW
  // ==========================================================================

  /**
   * Start the "accept subject request" flow
   */
  const initiateAcceptRequest = useCallback(async () => {
    setPendingOperation({
      type: 'acceptSubjectRequest',
      recordId,
    });

    const ready = await runPreparation('acceptSubjectRequest');
    if (ready) {
      setPhase('confirming');
    }
  }, [recordId, runPreparation]);

  /**
   * Execute the confirmed "accept subject request" operation
   */
  const confirmAcceptRequest = useCallback(async () => {
    if (!pendingOperation || pendingOperation.type !== 'acceptSubjectRequest') return;

    const auth = getAuth();
    if (!auth.currentUser?.uid) {
      setError('You must be signed in');
      setPhase('error');
      return;
    }

    const activityId = addActivity({ label: 'Accepting subject request', link: recordLink });

    // Fire tx — don't await
    const txPromise = SubjectService.acceptSubjectRequest(pendingOperation.recordId);

    // Close dialog immediately
    setSubmittedLabel('Accepting subject status');
    setPhase('submitted');

    // Resolve in background
    txPromise
      .then(async () => {
        updateActivity(activityId, { status: 'confirmed' });
        await refetchAll();
        onSuccess?.();
      })
      .catch(err => {
        const message = getUserFacingErrorMessage(err, 'Failed to accept request');
        updateActivity(activityId, { status: 'failed', errorMessage: message });
      });
  }, [pendingOperation, addActivity, updateActivity, refetchAll, onSuccess]);

  // ==========================================================================
  // REJECT SUBJECT REQUEST FLOW
  // ==========================================================================

  /**
   * Start the "reject subject request" flow
   * Note: This is for rejecting an incoming request, not removing existing subject status
   */
  const initiateRejectRequest = useCallback(
    (reason?: string) => {
      setPendingOperation({
        type: 'rejectSubjectRequest',
        recordId,
        reason,
      });

      // No blockchain operation needed for rejecting a request
      // Just go straight to confirming
      setPhase('confirming');
    },
    [recordId]
  );

  /**
   * Execute the confirmed "reject subject request" operation
   * No blockchain write for subject, but may need to revoke access if it was granted with the request
   */
  const confirmRejectRequest = useCallback(
    async (reason?: string) => {
      if (!pendingOperation || pendingOperation.type !== 'rejectSubjectRequest') return;

      const auth = getAuth();
      const userId = auth.currentUser?.uid;
      if (!userId) {
        setError('You must be signed in');
        setPhase('error');
        return;
      }

      setPhase('executing');

      try {
        // Fast Firestore reads/writes — await before closing dialog
        const db = getFirestore();
        const requestId = `${pendingOperation.recordId}_${userId}`;
        const requestRef = doc(db, 'subjectConsentRequests', requestId);
        const requestDoc = await getDoc(requestRef);
        const requestData = requestDoc.data() as SubjectConsentRequest | undefined;

        await SubjectService.rejectSubjectRequest(
          pendingOperation.recordId,
          reason || pendingOperation.reason
        );

        // Blockchain write — hand off to tray if needed
        if (requestData?.grantedAccessOnSubjectRequest) {
          const role = requestData.requestedSubjectRole;
          const activityId = addActivity({ label: 'Revoking record access' }); //Doesn't take link because it wouldn't go back to the record

          setSubmittedLabel('Declining subject request');
          setPhase('submitted');

          PermissionsService.removeRole(pendingOperation.recordId, userId, role)
            .then(async () => {
              updateActivity(activityId, { status: 'confirmed' });
              toast.success('Subject request declined and access revoked');
              await refetchAll();
              (onRejectSuccess ?? onSuccess)?.();
            })
            .catch(err => {
              const message = getUserFacingErrorMessage(err, 'Failed to revoke access');
              updateActivity(activityId, { status: 'failed', errorMessage: message });
            });
        } else {
          // No blockchain write — close normally
          toast.success('Subject request declined');
          reset();
          await refetchAll();
          (onRejectSuccess ?? onSuccess)?.();
        }
      } catch (err) {
        const message = getUserFacingErrorMessage(err, 'Failed to reject request');
        setError(message);
        setPhase('error');
        toast.error(message);
      }
    },
    [pendingOperation, addActivity, updateActivity, reset, refetchAll, onSuccess, onRejectSuccess]
  );

  // ==========================================================================
  // REMOVE SUBJECT STATUS FLOW
  // ==========================================================================

  /**
   * Start the "remove subject status" flow (self-removal)
   */
  const initiateRemoveSubjectStatus = useCallback(
    async (options?: { reason?: string; revokeAccess?: boolean }) => {
      setPendingOperation({
        type: 'rejectSubjectStatus',
        recordId,
        reason: options?.reason,
        revokeAccess: options?.revokeAccess,
      });

      const ready = await runPreparation('rejectSubjectStatus');
      if (ready) {
        setPhase('confirming');
      }
    },
    [recordId, runPreparation]
  );

  /**
   * Execute the confirmed "remove subject status" operation
   */
  const confirmRemoveSubjectStatus = useCallback(
    async (reason: RejectionReasons) => {
      if (!pendingOperation || pendingOperation.type !== 'rejectSubjectStatus') return;

      if (!reason) {
        setError('Please select a reason for removal');
        setPhase('error');
        return;
      }

      const auth = getAuth();
      const userId = auth.currentUser?.uid;
      if (!userId) {
        setError('You must be signed in');
        setPhase('error');
        return;
      }

      // Capture before dialog closes
      const shouldRevokeAccess = revokeAccess;

      const activityId = addActivity({ label: 'Removing subject status' }); //No link because user is being removed from the record

      // Fire tx — don't await
      const txPromise = SubjectService.rejectSubjectStatus(recordId, reason);

      // Close dialog immediately
      setSubmittedLabel('Removing subject status');
      setPhase('submitted');

      // Resolve in background
      txPromise
        .then(async result => {
          let accessRevoked = false;

          if (shouldRevokeAccess) {
            const db = getFirestore();
            const requestId = `${recordId}_${userId}`;
            const requestRef = doc(db, 'subjectConsentRequests', requestId);
            const requestDoc = await getDoc(requestRef);
            const requestData = requestDoc.data() as SubjectConsentRequest | undefined;

            if (requestData?.grantedAccessOnSubjectRequest) {
              const role = requestData.requestedSubjectRole;
              await PermissionsService.removeRole(recordId, userId, role);
              accessRevoked = true;
            }
          }

          updateActivity(activityId, { status: 'confirmed' });

          if (accessRevoked) {
            toast.success('You have been removed as a subject and your access has been revoked');
          } else if (result) {
            toast.success('You have been removed as a subject');
          }

          if (result.pendingCreatorDecision) {
            toast.info('The record creator will be notified of your removal');
          }

          await refetchAll();
          onSuccess?.();
        })
        .catch(err => {
          const message = getUserFacingErrorMessage(err, 'Failed to remove subject status');
          updateActivity(activityId, { status: 'failed', errorMessage: message });
        });
    },
    [pendingOperation, recordId, revokeAccess, addActivity, updateActivity, refetchAll, onSuccess]
  );

  /**
   * Fast-path for identity records: skip selection, go straight to preparing.
   * Always sets the user as owner of their own identity record.
   */
  const initiateAddSubjectAsSelf = useCallback(
    async (overrideRecordId?: string) => {
      const auth = getAuth();
      const userId = auth.currentUser?.uid;

      const targetRecordId = overrideRecordId ?? recordId; // ← use override if provided

      // Guard: already a subject
      if (userId && currentSubjects.includes(userId)) return;

      setSubjectChoice('self');
      setSelectedRole('owner');
      setSelectedUser(null);
      setPendingOperation({
        type: 'setSubjectAsSelf',
        recordId: targetRecordId,
        subjectChoice: 'self',
        selectedRole: 'owner',
      });

      const ready = await runPreparation('setSubjectAsSelf', targetRecordId);
      if (ready) {
        setPhase('confirming'); // still shows the confirm step before executing
      }
    },
    [recordId, currentSubjects, runPreparation]
  );

  // ==========================================================================
  // COMPUTED VALUES
  // ==========================================================================

  const pendingRequestForRecord = getPendingRequestForRecord();
  const hasPendingRequest = Boolean(pendingRequestForRecord);

  // ==========================================================================
  // RETURN
  // ==========================================================================

  return {
    // Dialog props
    dialogProps: {
      isOpen: phase !== 'idle',
      phase,
      operationType: pendingOperation?.type || 'setSubjectAsSelf',
      error,
      preparationProgress,
      // Selection state
      subjectChoice,
      setSubjectChoice,
      selectedRole,
      setSelectedRole,
      selectedUser,
      setSelectedUser,
      revokeAccess,
      setRevokeAccess,
      // Record info
      record,
      currentSubjects,
      isSubject,
      // Callbacks
      onClose: reset,
      onProceedFromSelection: proceedFromSelection,
      onSelectUser: selectUserAndProceed,
      onGoBackToSelection: goBackToSelection,
      onGoBackToSearching: goBackToSearching,
      onConfirmSetSubjectAsSelf: confirmSetSubjectAsSelf,
      onConfirmRequestConsent: confirmRequestConsent,
      onConfirmAnchorSubjectAsController: confirmAnchorSubjectAsController,
      onConfirmAcceptRequest: confirmAcceptRequest,
      onConfirmRejectRequest: confirmRejectRequest,
      onConfirmRemoveSubjectStatus: confirmRemoveSubjectStatus,
      submittedLabel,
      isControllerOfSelected,
      controllerTrustorIds,
    },

    // Current status
    isSubject,
    isLoadingStatus,
    currentSubjects,
    hasPendingRequest,
    pendingRequest: pendingRequestForRecord,
    incomingRequests,
    isLoadingRequests,

    // Actions
    initiateAddSubject,
    initiateAcceptRequest,
    initiateRejectRequest,
    initiateAddSubjectAsSelf,

    // Remove subject status
    initiateRemoveSubjectStatus,

    // Refetch
    refetch: refetchAll,

    // State
    isLoading: phase === 'preparing' || phase === 'executing',
    isDialogOpen: phase !== 'idle',
    phase,
    error,
    reset,
  };
}
