// src/features/Sharing/services/sharingService.ts
/**
 * Service for managing encryption keys. Called primarily by permissionsService
 * Calls SharingKeyManagementService which has the RSA public/private key logic
 * Does not handle array updates or blockchain updates, those are handled by PermissionService
 */

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  DocumentReference,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { EncryptionKeyManager } from '@/features/Encryption/services/encryptionKeyManager';
import { SharingKeyManagementService } from './sharingKeyManagementService';
import { RecordDecryptionService } from '@/features/Encryption/services/recordDecryptionService';
import { WrappedKeyHistoryEvent } from '@/types/core';

export class SharingService {
  /**
   * Grant encryption access (create/reactivate wrappedKeys)
   * Role arrays in firebase and blockchain are handled in PermissionService
   * called by PermissionService.grantViewer/grantAdmin/grantOwner
   * @param recordID - The record ID
   * @param userID - The user getting the access
   * @param grantorID - the user granting the access
   * @param options - isActive flag for when trustor gives out wrappedKeys to trustee in inactive mode at first
   */
  static async grantEncryptionAccess(
    recordId: string,
    userId: string,
    grantorId: string,
    options?: { isActive?: boolean; isGuest?: boolean; expiresAt?: Date }
  ): Promise<void> {
    const auth = getAuth();
    if (!auth.currentUser) {
      throw new Error('User not authenticated');
    }

    const grant = await this.prepareEncryptionAccessGrant(recordId, userId, grantorId, options);

    if (!grant) {
      console.log('ℹ️  User already has active encryption access');
      return;
    }

    if (grant.isReactivation) {
      await updateDoc(grant.ref, grant.data);
      console.log('✅ Wrapped key reactivated');
    } else {
      await setDoc(grant.ref, grant.data);
      console.log('✅ Wrapped key created');
    }
  }

  /**
   * Does the lookups and client-side RSA-wrapping for grantEncryptionAccess, but returns the
   * write instead of performing it — for callers that need to include it in an atomic writeBatch
   * alongside the role-array update and permissionHistory event (see PermissionsService.grantAdmin).
   *
   * This matters because a wrappedKey write failing on its own — after the role arrays already
   * committed — is not recoverable the way a failed blockchain write or firebase write is: there is
   * no backend or admin-privileged retry, because re-deriving the wrapped key requires the ORIGINAL GRANTOR's
   * own encryption session (their master key, unlocked client-side) at the moment of the grant.
   * Batching this write with the role write is the only way to guarantee "has a role" and "has a
   * working key" can't drift apart from a partial Firestore failure.
   *
   * Returns null when the receiver already has active access (no-op, matching
   * grantEncryptionAccess's early return) — callers should skip adding anything to their batch.
   */
  static async prepareEncryptionAccessGrant(
    recordId: string,
    userId: string,
    grantorId: string,
    options?: { isActive?: boolean; isGuest?: boolean; expiresAt?: Date }
  ): Promise<{
    ref: DocumentReference;
    data: Record<string, unknown>;
    isReactivation: boolean;
  } | null> {
    const db = getFirestore();

    const masterKey = await EncryptionKeyManager.getSessionKey();
    if (!masterKey) {
      throw new Error('Encryption session not active. Please unlock your encryption.');
    }

    console.log('🔐 Preparing encryption access for record:', recordId, 'to user:', userId);

    const isActive = options?.isActive ?? true;
    const isGuest = options?.isGuest ?? false;
    const expiresAt = options?.expiresAt ?? null;

    // Step 1. Check for existing active wrapped key
    const wrappedKeyId = `${recordId}_${userId}`;
    const wrappedKeyRef = doc(db, 'wrappedKeys', wrappedKeyId);
    const existingWrappedKey = await getDoc(wrappedKeyRef);

    if (existingWrappedKey.exists() && existingWrappedKey.data()?.isActive) {
      return null;
    }

    // Step 2. Get receiver's public key
    const receiverRef = doc(db, 'users', userId);
    const receiverDoc = await getDoc(receiverRef);

    if (!receiverDoc.exists()) {
      throw new Error('User not found');
    }

    const receiverData = receiverDoc.data();

    if (!receiverData.encryption?.publicKey) {
      throw new Error('User has not completed their account setup (encryption keys missing).');
    }

    // Step 3. Decrypt record key and wrap for receiver
    const recordKey = await RecordDecryptionService.getRecordKey(recordId, masterKey);

    const receiverPublicKey = await SharingKeyManagementService.importPublicKey(
      receiverData.encryption.publicKey
    );

    const wrappedKeyForReceiver = await SharingKeyManagementService.wrapKey(
      recordKey,
      receiverPublicKey
    );
    console.log('✅ Key wrapped for receiver');

    // Step 4. Build (don't write) the wrapped key document
    const isReactivation = existingWrappedKey.exists();

    const data = isReactivation
      ? {
          wrappedKey: wrappedKeyForReceiver,
          isActive,
          isGuest,
          ...(expiresAt && { expiresAt }),
          reactivatedAt: new Date(),
          reactivatedBy: grantorId,
          history: arrayUnion(this.historyEvent('reactivated', grantorId)),
        }
      : {
          recordId,
          userId,
          wrappedKey: wrappedKeyForReceiver,
          createdAt: new Date(),
          isActive,
          isCreator: false,
          isGuest,
          ...(expiresAt && { expiresAt }),
          grantedBy: grantorId,
          history: arrayUnion(this.historyEvent('granted', grantorId)),
        };

    return { ref: wrappedKeyRef, data, isReactivation };
  }

  /**
   * Builds a single wrappedKeys history entry. Kept as one helper so every call site (grant,
   * reactivate, revoke) stamps the same shape.
   */
  private static historyEvent(
    action: WrappedKeyHistoryEvent['action'],
    by: string
  ): WrappedKeyHistoryEvent {
    return { action, by, at: new Date() };
  }

  /**
   * Revoke encryption access (deactivates wrapped key).
   * Does NOT remove from role arrays or update blockchain.
   * Called by PermissionsService.removeViewer/removeAdmin/removeOwner
   */
  static async revokeEncryptionAccess(
    recordId: string,
    userId: string,
    revokerId: string
  ): Promise<void> {
    const auth = getAuth();
    if (!auth.currentUser) {
      throw new Error('User not authenticated');
    }

    const revoke = await this.prepareEncryptionAccessRevoke(recordId, userId, revokerId);
    if (!revoke) {
      return;
    }

    await updateDoc(revoke.ref, revoke.data);
    console.log('✅ Wrapped key deactivated');
  }

  /**
   * Looks up the wrapped key for revokeEncryptionAccess but returns the write instead of
   * performing it — for callers including it in an atomic writeBatch alongside the role-array
   * update and permissionHistory event (see PermissionsService.removeViewer). Unlike
   * prepareEncryptionAccessGrant, this has no crypto dependency on the caller's own session —
   * it's a metadata-only flip — so batching it is for consistency and to keep the sharing
   * dashboard's status accurate, not to avoid an unrecoverable failure.
   *
   * Returns null when there's nothing to revoke (no wrappedKey doc, or already inactive) —
   * callers should skip adding anything to their batch.
   */
  static async prepareEncryptionAccessRevoke(
    recordId: string,
    userId: string,
    revokerId: string
  ): Promise<{ ref: DocumentReference; data: Record<string, unknown> } | null> {
    const db = getFirestore();

    console.log('🔐 Preparing encryption revoke for record:', recordId, 'from user:', userId);

    const wrappedKeyId = `${recordId}_${userId}`;
    const wrappedKeyRef = doc(db, 'wrappedKeys', wrappedKeyId);
    const wrappedKeyDoc = await getDoc(wrappedKeyRef);

    if (!wrappedKeyDoc.exists()) {
      console.log('ℹ️  No wrapped key found - user may never have had access');
      return null;
    }

    if (!wrappedKeyDoc.data()?.isActive) {
      console.log('ℹ️  Wrapped key already inactive');
      return null;
    }

    return {
      ref: wrappedKeyRef,
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedBy: revokerId,
        history: arrayUnion(this.historyEvent('revoked', revokerId)),
      },
    };
  }

  /**
   * Check if a user has active encryption access to a record
   */
  static async hasEncryptionAccess(recordId: string, userId: string): Promise<boolean> {
    const db = getFirestore();

    const wrappedKeyId = `${recordId}_${userId}`;
    const wrappedKeyRef = doc(db, 'wrappedKeys', wrappedKeyId);
    const wrappedKeyDoc = await getDoc(wrappedKeyRef);

    if (!wrappedKeyDoc.exists()) {
      return false;
    }

    return wrappedKeyDoc.data()?.isActive === true;
  }
}
