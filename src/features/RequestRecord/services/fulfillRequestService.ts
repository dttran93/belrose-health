// src/features/RecordRequest/services/fulfillRequestService.ts

/**
 * fulfillRequestService
 *
 * Handles the complete fulfillment flow when a provider uploads a record
 * in response to a patient's record request.
 *
 */

import {
  getFirestore,
  doc,
  collection,
  updateDoc,
  serverTimestamp,
  arrayUnion,
  getDoc,
  writeBatch,
} from 'firebase/firestore';
import { PermissionChange, RecordRequest } from '@belrose/shared';
import { PermissionsService, Role } from '@/features/Permissions/services/permissionsService';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getUserProfile } from '@/features/Users/services/userProfileService';
import { SharingKeyManagementService } from '@/features/Sharing/services/sharingKeyManagementService';
import { getAuth } from 'firebase/auth';
import { EncryptionKeyManager } from '@/features/Encryption/services/encryptionKeyManager';
import { base64ToArrayBuffer } from '@/utils/dataFormattingUtils';
import { EncryptionService } from '@/features/Encryption/services/encryptionService';
import {
  BlockchainSyncQueueService,
  getUserFacingErrorMessage,
} from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import {
  buildPermissionHistoryDocId,
  preparePermissionChangeEventData,
} from '@/features/Permissions/services/writePermissionChangeEvent';
import { id } from 'ethers';

// ── Firestore document ────────────────────────────────────────────────────────

export const DENY_REASONS = [
  { value: 'wrong_recipient', label: 'Wrong recipient. I am not the stated provider' },
  { value: 'never_held', label: 'I never saw this patient and never held their records' },
  {
    value: 'duplicate_request',
    label: 'I have already provided these records to this patient in response to another request',
  },
  {
    value: 'cannot_confirm',
    label:
      'I cannot confirm the identity or legitimacy of the requester and am withholding records',
  },
  { value: 'other', label: 'Other (please specify)' },
] as const;

export type DenyReasonValue = (typeof DENY_REASONS)[number]['value'];

// ── OnChainActivityTray ───────────────────────────────────────────────────────
//
// Structurally matches the subset of useOnChainActivityTray() that fulfillAsGuest needs.
// Defined locally (rather than importing OnChainActivityTrayContext) so this plain service
// module stays free of a dependency on a React context file — callers just pass their hook's
// addActivity/updateActivity through.

export interface ChainActivityHandle {
  addActivity: (input: { label: string; link?: string }) => string;
  updateActivity: (
    id: string,
    update: { status?: 'confirmed' | 'failed'; errorMessage?: string }
  ) => void;
}

export class FulfillRequestService {
  // ============================================================================
  // MAIN FULFILL FLOW
  // ============================================================================

  // In FulfillRequestService

  /**
   * Links an existing record to a pending request by granting the requester
   * a role and marking the request fulfilled.
   *
   * Used by LinkRequestModal when the record owner selects an existing record
   * to satisfy a request, as opposed to fulfill() which handles fresh uploads.
   *
   * @param recordRequest - The pending request to fulfill
   * @param recordId      - The already-uploaded record to link
   * @param role          - Access level to grant the requester
   */
  static async linkExistingRecord(
    recordRequest: RecordRequest,
    recordId: string,
    role: Role
  ): Promise<void> {
    // Step 1: Grant role — this handles the key wrapping internally
    try {
      await PermissionsService.grantRole(recordId, recordRequest.requesterId, role);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (!message.startsWith('User is already')) throw err; // re-throw anything unexpected
    }

    // Step 2: Mark request fulfilled
    const db = getFirestore();
    await updateDoc(doc(db, 'recordRequests', recordRequest.inviteCode), {
      status: 'fulfilled',
      fulfilledRecordIds: arrayUnion(recordId),
      fulfilledAt: serverTimestamp(),
    });
  }

  /**
   * Fulfill a record request as a guest provider — the Firestore-only half. Rewraps the file
   * key for the requester and marks the request fulfilled; does NOT touch the chain. Callers
   * await this (it's the part the guest is actually waiting on), then fire
   * registerGuestFulfillmentOnChain without awaiting it — see LinkRequestModal.handleConfirm.
   *
   * Differences from the registered flow:
   * - No blockchain role grant for the provider (no wallet yet) — the provider's own
   *   `administrators[]` membership was already set client-side at upload time
   *   (createFirestoreRecord), but nothing here or in the later claim flow
   *   (GuestClaimAccountModal) ever registers the provider on-chain for this record. That's a
   *   known pre-existing gap, not something this method is responsible for closing.
   * - Encryption: requester's public RSA key wraps the file key directly
   *
   * @returns the permissionHistory doc id this call created — buildPermissionHistoryDocId bakes
   * in Date.now() + a random suffix, so it's NOT reproducible from (recordId, requesterId)
   * alone. Callers must pass this straight into registerGuestFulfillmentOnChain rather than
   * trying to re-derive it, or that call's updateDoc(historyRef, ...) targets a doc that was
   * never created.
   */
  static async fulfillAsGuest(recordRequest: RecordRequest, recordId: string): Promise<string> {
    const db = getFirestore();
    const auth = getAuth();
    const guestUid = auth.currentUser?.uid;
    if (!guestUid) throw new Error('Not authenticated');

    // ── Step 1: Retrieve file key from wrappedKeys using throwaway session key ────────
    const throwawayKey = await EncryptionKeyManager.getSessionKey();
    if (!throwawayKey) {
      throw new Error('Encryption session expired. Please reload the page and try again.');
    }

    const wrappedKeySnap = await getDoc(doc(db, 'wrappedKeys', `${recordId}_${guestUid}`));
    if (!wrappedKeySnap.exists()) {
      throw new Error('Record key not found.');
    }

    const encryptedKeyData = base64ToArrayBuffer(wrappedKeySnap.data().wrappedKey);
    const fileKeyData = await EncryptionService.decryptKeyWithMasterKey(
      encryptedKeyData,
      throwawayKey
    );
    const fileKey = await EncryptionService.importKey(fileKeyData);

    // Step 2: Wrap file key with requester's RSA public key
    // The requester is a registered user — their public key is in their profile
    const requesterProfile = await getUserProfile(recordRequest.requesterId);
    if (!requesterProfile?.encryption?.publicKey) {
      throw new Error('Requester does not have encryption keys set up');
    }

    const requesterPublicKey = await SharingKeyManagementService.importPublicKey(
      requesterProfile.encryption.publicKey
    );
    const wrappedKey = await SharingKeyManagementService.wrapKey(fileKey, requesterPublicKey);

    // Step 3: Determine granted vs. upgraded — mirrors PermissionsService.grantAdmin so the
    // audit event records the correct transition even in the rare case the requester already
    // held some role on this record.
    const recordRef = doc(db, 'records', recordId);
    const recordSnap = await getDoc(recordRef);
    if (!recordSnap.exists()) throw new Error('Record not found');
    const existingRole = PermissionsService.getUserRole(
      recordSnap.data(),
      recordRequest.requesterId
    );
    const changes: PermissionChange[] = [
      existingRole
        ? {
            userId: recordRequest.requesterId,
            action: 'upgraded',
            previousRole: existingRole,
            newRole: 'administrator',
          }
        : {
            userId: recordRequest.requesterId,
            action: 'granted',
            previousRole: null,
            newRole: 'administrator',
          },
    ];

    const historyDocId = buildPermissionHistoryDocId(recordRequest.requesterId);
    const historyRef = doc(collection(db, 'records', recordId, 'permissionHistory'), historyDocId);
    const eventData = await preparePermissionChangeEventData(recordId, guestUid, changes);

    // Step 4: Atomic Firestore write — wrappedKey + role array + permissionHistory event +
    // request status, all four or none. blockchainRef starts null; filled in by
    // registerGuestFulfillmentOnChain once the admin-signed chain call resolves.
    const batch = writeBatch(db);
    batch.set(doc(db, 'wrappedKeys', `${recordId}_${recordRequest.requesterId}`), {
      recordId,
      userId: recordRequest.requesterId,
      wrappedKey,
      isCreator: false,
      isActive: true,
      createdAt: serverTimestamp(),
    });
    batch.update(recordRef, { administrators: arrayUnion(recordRequest.requesterId) });
    batch.set(historyRef, eventData);
    batch.update(doc(db, 'recordRequests', recordRequest.inviteCode), {
      status: 'fulfilled',
      fulfilledRecordIds: arrayUnion(recordId),
      fulfilledAt: serverTimestamp(),
    });
    await batch.commit();

    return historyDocId;
  }

  /**
   * Step 5 of the guest fulfillment flow, split out from fulfillAsGuest so callers can fire it
   * without awaiting it — best-effort, does not revert the Firestore grant fulfillAsGuest already
   * committed. Admin cloud function handles this — guest has no wallet to call the contract
   * directly.
   *
   * @param historyDocId - The permissionHistory doc id *returned by* the matching
   * fulfillAsGuest call. Must be threaded through rather than recomputed — the id bakes in
   * Date.now() + a random suffix, so recomputing it here would target a doc that was never
   * created.
   * @param activity - Optional OnChainActivityTray handle (addActivity/updateActivity) so the
   * caller can surface this call in the bottom-right tray, same as other blockchain writes in
   * the app. Omitted entirely in tests / non-UI callers.
   */
  static async registerGuestFulfillmentOnChain(
    recordRequest: RecordRequest,
    recordId: string,
    historyDocId: string,
    activity?: ChainActivityHandle
  ): Promise<void> {
    const db = getFirestore();
    const auth = getAuth();
    const guestUid = auth.currentUser?.uid;
    if (!guestUid) throw new Error('Not authenticated');

    const requesterProfile = await getUserProfile(recordRequest.requesterId);
    const historyRef = doc(collection(db, 'records', recordId, 'permissionHistory'), historyDocId);

    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: 'initializeRoleOnChainForRequester',
      userId: guestUid,
      // Guest providers have no wallet of their own — omit rather than pass undefined
      // (Firestore's SDK rejects explicit undefined field values in this codebase).
      permissionHistoryPath: historyRef.path,
      context: {
        type: 'permission',
        targetUserId: recordRequest.requesterId,
        targetWalletAddress: requesterProfile?.wallet?.address ?? '',
        role: 'administrator',
        recordId,
        recordIdHash: id(recordId),
      },
    });

    const activityId = activity?.addActivity({
      label: 'Registering requester on-chain',
      link: `/app/records/${recordId}?view=permissions`,
    });

    try {
      const initFn = httpsCallable(getFunctions(), 'initializeRoleOnChainForRequester');
      const result: any = await initFn({
        recordId,
        requesterUserId: recordRequest.requesterId,
        role: 'administrator',
      });
      const blockchainRef = result.data.blockchainRef;
      await updateDoc(historyRef, { blockchainRef });
      await BlockchainSyncQueueService.recordSuccess(syncRef, {
        txHash: blockchainRef.txHash,
        blockNumber: blockchainRef.blockNumber,
      });
      if (activityId) {
        activity!.updateActivity(activityId, { status: 'confirmed' });
      }
    } catch (err) {
      // Covers genuine chain failures and the CF's self-healed already-exists throw alike —
      // neither is special-cased, both land as a 'failed' sync-queue entry for reconciliation.
      const errorMessage = getUserFacingErrorMessage(err, 'Blockchain transaction failed');
      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
      if (activityId) {
        activity!.updateActivity(activityId, { status: 'failed', errorMessage });
      }
    }
  }
}
