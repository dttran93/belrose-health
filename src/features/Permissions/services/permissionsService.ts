//src/features/Permissions/service/permissionsService.ts
/**
 * Service for managing record permissions
 * Handles role assignment (Firestore array + blockchain)
 * Calls SharingService for encryption Access
 * Integrates with roleInitializationService for first-time blockchain permission setup
 */

import {
  getFirestore,
  doc,
  collection,
  updateDoc,
  writeBatch,
  arrayRemove,
  arrayUnion,
  getDoc,
  DocumentReference,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import * as Sentry from '@sentry/react';
import { SharingService } from '@/features/Sharing/services/sharingService';
import { BlockchainRoleManagerService } from './blockchainRoleManagerService';
import { getUserProfile } from '@/features/Users/services/userProfileService';
import { BlockchainSyncQueueService } from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { WalletService } from '@/features/BlockchainWallet/services/walletService';
import {
  preparePermissionChangeEventData,
  buildPermissionHistoryDocId,
} from './writePermissionChangeEvent';
import {
  buildMemberRegistryRef,
  BlockchainRef,
  PermissionChange,
  RecordRole,
  ROLE_HIERARCHY,
} from '@belrose/shared';
import { id } from 'ethers';
import { FileObject } from '@/types/core';

interface RoleEligibility {
  enabled: boolean;
  reason?: string;
}

type RecordRoleArrays = {
  owners?: string[];
  administrators?: string[];
  sharers?: string[];
  viewers?: string[];
  subjects?: string[];
};

export type Role = RecordRole;

export class PermissionsService {
  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Unified grant role method calls the appropriate grant method based on role
   *
   * @param recordId - The record ID
   * @param targetUserId - The user ID to grant role to
   * @param role - The role to grant
   */

  static grantRole = async (
    recordId: string,
    userId: string,
    role: RecordRole,
    recordTitle?: string
  ): Promise<void> => {
    switch (role) {
      case 'owner':
        await PermissionsService.grantOwner(recordId, userId, recordTitle);
        break;
      case 'administrator':
        await PermissionsService.grantAdmin(recordId, userId, recordTitle);
        break;
      case 'sharer':
        await PermissionsService.grantSharer(recordId, userId, recordTitle);
        break;
      case 'viewer':
        await PermissionsService.grantViewer(recordId, userId, recordTitle);
        break;
    }
  };

  /**
   * Remove a role from a user on a record
   * Unified method that handles both admin-initiated and self-removal
   *
   * @param recordId - The record ID
   * @param targetUserId - The user ID to remove the role from
   * @param role - The role to remove
   */
  static removeRole = async (recordId: string, userId: string, role: RecordRole): Promise<void> => {
    switch (role) {
      case 'owner':
        await PermissionsService.removeOwner(recordId, userId);
        break;
      case 'administrator':
        await PermissionsService.removeAdmin(recordId, userId);
        break;
      case 'sharer':
        await PermissionsService.removeSharer(recordId, userId);
        break;
      case 'viewer':
        await PermissionsService.removeViewer(recordId, userId);
        break;
    }
  };

  /**
   * Get a user's wallet address from Firestore, with Permissions-specific error messages that
   * distinguish "this user has never signed up" from "this user exists but hasn't linked a
   * wallet yet" — the underlying Firestore read is shared via WalletService.getUserWalletStatus.
   */
  private static async getUserWalletAddress(userId: string): Promise<string> {
    const { profileExists, wallet } = await WalletService.getUserWalletStatus(userId);

    if (!profileExists) {
      throw new Error('User not found');
    }

    if (!wallet?.address) {
      throw new Error(
        `${userId} has no distributed network account. They must set up on the distributed network before managing permissions.`
      );
    }

    return wallet.address;
  }

  /**
   * Get current highest role for a user on a record
   */
  static getUserRole(recordData: RecordRoleArrays, userId: string): Role | null {
    if (recordData.owners?.includes(userId)) return 'owner';
    if (recordData.administrators?.includes(userId)) return 'administrator';
    if (recordData.sharers?.includes(userId)) return 'sharer';
    if (recordData.viewers?.includes(userId)) return 'viewer';
    return null;
  }

  /**
   * Change a user's role to any other role, dispatching to the correct grant/demote
   * method based on whether newRole is above or below their current role.
   * Used by the "Modify Access" flow, where the target role is picked directly
   * rather than being implied by which button the caller clicked.
   */
  static async changeRole(
    recordId: string,
    targetUserId: string,
    currentRole: Role,
    newRole: Role,
    recordTitle?: string
  ): Promise<void> {
    if (newRole === currentRole) return;

    if (ROLE_HIERARCHY[newRole] > ROLE_HIERARCHY[currentRole]) {
      return PermissionsService.grantRole(recordId, targetUserId, newRole, recordTitle);
    }

    switch (currentRole) {
      case 'owner':
        return PermissionsService.removeOwner(recordId, targetUserId, recordTitle, {
          demoteTo: newRole as 'administrator' | 'sharer' | 'viewer',
        });
      case 'administrator':
        return PermissionsService.removeAdmin(recordId, targetUserId, recordTitle, {
          demoteTo: newRole as 'sharer' | 'viewer',
        });
      case 'sharer':
        return PermissionsService.removeSharer(recordId, targetUserId, recordTitle, {
          demoteToViewer: true,
        });
      default:
        throw new Error(`Cannot downgrade from ${currentRole}`);
    }
  }

  /**
   * Compute which roles a caller may move a given target to, for the "Modify Access" UI.
   * This mirrors the permission rules already enforced by the grant/remove methods above
   * (and, ultimately, the smart contract) — it exists purely to disable dead-end choices
   * and explain why in the UI. The service methods remain the real enforcement boundary.
   *
   * Only meaningful for owner/admin callers, since those are the only roles this app lets
   * manage other users' permissions from. Any other caller sees everything disabled.
   */
  static getEligibleRoleTargets(
    record: RecordRoleArrays,
    callerId: string,
    targetUserId: string
  ): Record<Role, RoleEligibility> {
    const owners = record.owners ?? [];
    const administrators = record.administrators ?? [];
    const hasOwners = owners.length > 0;
    const callerIsOwner = owners.includes(callerId);
    const callerIsAdmin = administrators.includes(callerId);
    const isSelf = callerId === targetUserId;
    const targetIsSubject = record.subjects?.includes(targetUserId) ?? false;
    const targetRole = PermissionsService.getUserRole(record, targetUserId);

    const disabled: Record<Role, RoleEligibility> = {
      viewer: { enabled: false },
      sharer: { enabled: false },
      administrator: { enabled: false },
      owner: { enabled: false },
    };

    if (!targetRole) return disabled;

    // Owners can only change their own access — no one else may touch it (mirrors
    // removeOwner Rule 1 / the contract's voluntarilyLeaveOwnership-only demotion).
    if (targetRole === 'owner') {
      if (!isSelf) {
        const reason = 'Owners can only modify their own access.';
        return {
          viewer: { enabled: false, reason },
          sharer: { enabled: false, reason },
          administrator: { enabled: false, reason },
          owner: { enabled: false },
        };
      }
      const isLastOwnerNoAdmins = owners.length === 1 && administrators.length === 0;
      const reason = isLastOwnerNoAdmins
        ? 'Cannot remove the last owner while no administrators exist.'
        : undefined;
      return {
        viewer: { enabled: !isLastOwnerNoAdmins, reason },
        sharer: { enabled: !isLastOwnerNoAdmins, reason },
        administrator: { enabled: !isLastOwnerNoAdmins, reason },
        owner: { enabled: false },
      };
    }

    if (!callerIsOwner && !callerIsAdmin) {
      // Self-service is limited to fully leaving a role (see canRevokeAccess) — picking a
      // different tier for yourself is an owner/admin decision, not a unilateral one.
      const reason = isSelf
        ? 'You can only fully leave this role — ask an owner or administrator to change it instead.'
        : "You do not have permission to modify this user's access.";
      return {
        viewer: { enabled: false, reason: targetRole === 'viewer' ? undefined : reason },
        sharer: { enabled: false, reason: targetRole === 'sharer' ? undefined : reason },
        administrator: {
          enabled: false,
          reason: targetRole === 'administrator' ? undefined : reason,
        },
        owner: { enabled: false, reason },
      };
    }

    const result: Record<Role, RoleEligibility> = { ...disabled };

    // Upgrading to owner: an admin can only do this while no owner exists yet (bootstrap case).
    const ownerBlocked = !callerIsOwner && hasOwners;
    result.owner = {
      enabled: !ownerBlocked,
      reason: ownerBlocked ? 'Only an existing owner can appoint another owner.' : undefined,
    };

    if (targetRole === 'administrator') {
      // Demoting an admin: only an owner may, unless the admin is demoting themselves —
      // that restriction relaxes only once no owners exist at all (mirrors removeAdmin Rule 2).
      const demoteBlocked = hasOwners && !callerIsOwner && !isSelf;
      const reason = demoteBlocked
        ? "Only the record owner can modify another administrator's access."
        : undefined;
      result.sharer = { enabled: !demoteBlocked, reason };
      result.viewer = { enabled: !demoteBlocked, reason };
    } else {
      // Upgrading a viewer or sharer to administrator — owner/admin callers both allowed.
      result.administrator = { enabled: true };
    }

    if (targetRole === 'sharer') {
      result.viewer = targetIsSubject
        ? {
            enabled: false,
            reason: 'This user is a subject of the record and requires at least Sharer access.',
          }
        : { enabled: true };
    } else if (targetRole === 'viewer') {
      result.sharer = { enabled: true };
    }

    result[targetRole] = { enabled: false };

    return result;
  }

  /**
   * Whether a caller may fully revoke (as opposed to demote) a target's access.
   * Mirrors the unconditional guards in removeViewer/removeSharer/removeAdmin/removeOwner
   * that a `demoteTo` option doesn't relax — same UI-advisory caveat as getEligibleRoleTargets.
   */
  static canRevokeAccess(
    record: RecordRoleArrays,
    callerId: string,
    targetUserId: string
  ): RoleEligibility {
    const owners = record.owners ?? [];
    const administrators = record.administrators ?? [];
    const hasOwners = owners.length > 0;
    const callerIsOwner = owners.includes(callerId);
    const callerIsAdmin = administrators.includes(callerId);
    const isSelf = callerId === targetUserId;
    const targetIsSubject = record.subjects?.includes(targetUserId) ?? false;
    const targetRole = PermissionsService.getUserRole(record, targetUserId);

    if (!targetRole) {
      return { enabled: false, reason: 'This user has no active role on this record.' };
    }

    if (targetIsSubject) {
      return {
        enabled: false,
        reason:
          'This user is a subject of this record — remove them as a subject first, or demote their role instead.',
      };
    }

    if (targetRole === 'owner') {
      if (!isSelf) {
        return { enabled: false, reason: 'Owners can only be removed by themselves.' };
      }
      if (owners.length === 1 && administrators.length === 0) {
        return {
          enabled: false,
          reason: 'Cannot remove the last owner while no administrators exist.',
        };
      }
      return { enabled: true };
    }

    // Self-removal is always allowed regardless of the caller's own role — mirrors the
    // isSelfRemoval bypass in removeViewer/removeSharer/removeAdmin.
    if (!isSelf && !callerIsOwner && !callerIsAdmin) {
      return { enabled: false, reason: "You do not have permission to modify this user's access." };
    }

    if (targetRole === 'administrator') {
      if (hasOwners && !callerIsOwner && !isSelf) {
        return {
          enabled: false,
          reason: "Only the record owner can remove another administrator's access.",
        };
      }
      if (!hasOwners && administrators.length === 1) {
        return { enabled: false, reason: 'Cannot remove the last administrator from this record.' };
      }
      return { enabled: true };
    }

    return { enabled: true };
  }

  // ============================================================================
  // GRANT METHODS
  // ============================================================================

  /**
   * Add a viewer to a record
   * @param recordId - The record ID
   * @param targetUserId - The user ID to add as viewer
   * @throws Error if operation fails or user doesn't have permission
   * Mirrors to blockchain as well. Creates retry queue entry if blockchain mirroring fails
   */
  static async grantViewer(
    recordId: string,
    targetUserId: string,
    recordTitle?: string
  ): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    // Check 1: Does record exist
    const db = getFirestore();
    const recordRef = doc(db, 'records', recordId);
    const recordDoc = await getDoc(recordRef);

    if (!recordDoc.exists()) {
      throw new Error('Record not found');
    }

    const recordData = recordDoc.data();

    // Check 2: Permission check - only admins/owners/sharers can grant viewer
    const isCurrentUserSharer = recordData.sharers?.includes(currentUser.uid);
    const isCurrentUserAdmin = recordData.administrators?.includes(currentUser.uid);
    const isCurrentUserOwner = recordData.owners?.includes(currentUser.uid);

    if (!isCurrentUserAdmin && !isCurrentUserOwner && !isCurrentUserSharer) {
      throw new Error('You do not have permission to share this record');
    }

    // Check 3: Find and make sure targetUserId exists
    const targetProfile = await getUserProfile(targetUserId);

    if (!targetProfile) {
      throw new Error('Target user does not exist or has no profile');
    }

    // Check 4: If target is subject, they must get sharer or above
    if (recordData.subjects?.includes(targetUserId)) {
      throw new Error('This user is a subject of the record and requires at least Sharer access.');
    }

    // Check 5: Check existing role - don't demote to viewer from an equal/higher role
    const existingRole = this.getUserRole(recordData, targetUserId);

    if (existingRole === 'owner') {
      throw new Error('User is already an owner (higher role than viewer)');
    }
    if (existingRole === 'administrator') {
      throw new Error('User is already an administrator (higher role than viewer)');
    }
    if (existingRole === 'sharer') {
      throw new Error('User is already a sharer (higher role than viewer)');
    }
    if (existingRole === 'viewer') {
      throw new Error('User is already a viewer');
    }

    // Check 6: Ensure the user and target have wallet addresses for the blockchain transaction
    const userWalletAddress = await this.getUserWalletAddress(currentUser.uid);
    const targetWalletAddress = await this.getUserWalletAddress(targetUserId);

    // Note, preparation Service checks are covered in the initiation stage of the usePermissionFlow

    console.log('🔄 Granting viewer access:', targetUserId);

    const changes: PermissionChange[] = [
      {
        userId: targetUserId,
        action: 'granted', //Always granted, you never upgrade to viewer
        previousRole: existingRole ?? null,
        newRole: 'viewer',
      },
    ];

    const historyRef = doc(
      collection(db, 'records', recordId, 'permissionHistory'),
      buildPermissionHistoryDocId(targetUserId)
    );

    // Encryption key material must be prepared before the batch below — this does client-side
    // RSA-wrapping using the caller's own unlocked session key, which can fail for reasons
    // (encryption session not unlocked, receiver has no public key) that are validation
    // failures like the checks above, not infrastructure failures — so it throws before
    // anything is written, same as those checks.
    const encryptionGrant = await SharingService.prepareEncryptionAccessGrant(
      recordId,
      targetUserId,
      currentUser.uid
    );

    // Step 1: Atomic Firestore write — role array + permission history event + wrapped key,
    // all three or none. A wrapped-key write failing on its own, after the role already
    // committed, is not something a reconciliation engine could ever fix later (it needs THIS
    // grantor's session, not just any backend retry) — so it has to be all-or-nothing with the
    // role write itself, not a separate step. blockchainRef starts null; it's filled in below
    // once the chain call resolves.
    try {
      const eventData = await preparePermissionChangeEventData(
        recordId,
        currentUser.uid,
        changes,
        recordTitle
      );

      const batch = writeBatch(db);
      batch.update(recordRef, {
        viewers: arrayUnion(targetUserId),
      });
      batch.set(historyRef, eventData);
      if (encryptionGrant) {
        if (encryptionGrant.isReactivation) {
          batch.update(encryptionGrant.ref, encryptionGrant.data);
        } else {
          batch.set(encryptionGrant.ref, encryptionGrant.data);
        }
      }
      await batch.commit();
    } catch (firestoreError) {
      Sentry.captureException(firestoreError, {
        tags: { feature: 'permissions', action: 'grantViewer', recordId },
      });
      throw firestoreError;
    }

    // Step 2: Blockchain — best-effort, does not revert the Firestore write above. The
    // permission change already stands regardless of what happens here.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: 'grantRole',
      userId: currentUser.uid,
      userWalletAddress,
      permissionHistoryPath: historyRef.path,
      context: {
        type: 'permission',
        targetUserId,
        targetWalletAddress,
        role: 'viewer',
        recordId,
        recordIdHash: id(recordId),
      },
    });

    try {
      console.log('🔗 Granting viewer role on blockchain...');
      const tx = await BlockchainRoleManagerService.grantRole(
        recordId,
        targetWalletAddress,
        'viewer'
      );

      const blockchainRef: BlockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      await updateDoc(historyRef, { blockchainRef });
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log('✅ Blockchain: Viewer role granted');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);

      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log('✅ Viewer access granted successfully');
  }

  /**
   * Add a sharer to a record.
   * Sharer can view and grant viewer access but cannot edit.
   * This is the minimum role granted to active subjects.
   */
  static async grantSharer(
    recordId: string,
    targetUserId: string,
    recordTitle?: string
  ): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    // Check 1: Does record exist
    const db = getFirestore();
    const recordRef = doc(db, 'records', recordId);
    const recordDoc = await getDoc(recordRef);

    if (!recordDoc.exists()) {
      throw new Error('Record not found');
    }

    const recordData = recordDoc.data();

    // Check 2: Only admins/owners can grant sharer
    const isCurrentUserAdmin = recordData.administrators?.includes(currentUser.uid);
    const isCurrentUserOwner = recordData.owners?.includes(currentUser.uid);

    if (!isCurrentUserAdmin && !isCurrentUserOwner) {
      throw new Error('You do not have permission to share this record');
    }

    // Check 3: Find and make sure targetUserId exists
    const targetProfile = await getUserProfile(targetUserId);
    if (!targetProfile) {
      throw new Error('Target user does not exist or has no profile');
    }

    // Check 4: Don't demote from a higher role
    const existingRole = this.getUserRole(recordData, targetUserId);

    if (existingRole === 'owner') {
      throw new Error('User is already an owner (higher role than sharer)');
    }
    if (existingRole === 'administrator') {
      throw new Error('User is already an administrator (higher role than sharer)');
    }
    if (existingRole === 'sharer') {
      throw new Error('User is already a sharer');
    }

    // Check 5: Ensure wallets exist for blockchain transaction
    const userWalletAddress = await this.getUserWalletAddress(currentUser.uid);
    const targetWalletAddress = await this.getUserWalletAddress(targetUserId);

    console.log('🔄 Granting sharer access:', targetUserId);

    const changes: PermissionChange[] = [
      existingRole
        ? {
            userId: targetUserId,
            action: 'upgraded' as const,
            previousRole: existingRole as Role,
            newRole: 'sharer' as const,
          }
        : {
            userId: targetUserId,
            action: 'granted' as const,
            previousRole: null,
            newRole: 'sharer' as const,
          },
    ];

    const historyRef = doc(
      collection(db, 'records', recordId, 'permissionHistory'),
      buildPermissionHistoryDocId(targetUserId)
    );

    // Encryption key material must be prepared before the batch below — this does client-side
    // RSA-wrapping using the caller's own unlocked session key, which can fail for reasons
    // (encryption session not unlocked, receiver has no public key) that are validation
    // failures like the checks above, not infrastructure failures — so it throws before
    // anything is written, same as those checks.
    const encryptionGrant = await SharingService.prepareEncryptionAccessGrant(
      recordId,
      targetUserId,
      currentUser.uid
    );

    // Step 1: Atomic Firestore write — role arrays + permission history event + wrapped key,
    // all three or none. A wrapped-key write failing on its own, after the role already
    // committed, is not something a reconciliation engine could ever fix later (it needs THIS
    // grantor's session, not just any backend retry) — so it has to be all-or-nothing with the
    // role write itself, not a separate step. blockchainRef starts null; it's filled in below
    // once the chain call resolves.
    try {
      const eventData = await preparePermissionChangeEventData(
        recordId,
        currentUser.uid,
        changes,
        recordTitle
      );

      const batch = writeBatch(db);
      batch.update(recordRef, {
        sharers: arrayUnion(targetUserId),
        viewers: arrayRemove(targetUserId),
      });
      batch.set(historyRef, eventData);
      if (encryptionGrant) {
        if (encryptionGrant.isReactivation) {
          batch.update(encryptionGrant.ref, encryptionGrant.data);
        } else {
          batch.set(encryptionGrant.ref, encryptionGrant.data);
        }
      }
      await batch.commit();
    } catch (firestoreError) {
      Sentry.captureException(firestoreError, {
        tags: { feature: 'permissions', action: 'grantSharer', recordId },
      });
      throw firestoreError;
    }

    // Step 2: Blockchain — best-effort, does not revert the Firestore write above. The
    // permission change already stands regardless of what happens here.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: 'grantRole',
      userId: currentUser.uid,
      userWalletAddress,
      permissionHistoryPath: historyRef.path,
      context: {
        type: 'permission',
        targetUserId,
        targetWalletAddress,
        role: 'sharer',
        recordId,
        recordIdHash: id(recordId),
      },
    });

    try {
      console.log('🔗 Granting sharer role on blockchain...');
      const tx = await BlockchainRoleManagerService.grantRole(
        recordId,
        targetWalletAddress,
        'sharer'
      );

      const blockchainRef: BlockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      await updateDoc(historyRef, { blockchainRef });
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log('✅ Blockchain: Sharer role granted');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);

      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log('✅ Sharer access granted successfully');
  }

  /**
   * Add an administrator to a record
   * @param recordId - The record ID
   * @param targetUserId - The user ID to add as administrator
   * @throws Error if operation fails or user doesn't have permission
   */
  static async grantAdmin(
    recordId: string,
    targetUserId: string,
    recordTitle?: string
  ): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    // Check 1: does record exist
    const db = getFirestore();
    const recordRef = doc(db, 'records', recordId);
    const recordDoc = await getDoc(recordRef);

    if (!recordDoc.exists()) {
      throw new Error('Record not found');
    }

    const recordData = recordDoc.data();

    // Check 2: Permission check - only admins/owners can grant admin
    const isCurrentUserAdmin = recordData.administrators?.includes(currentUser.uid);
    const isCurrentUserOwner = recordData.owners?.includes(currentUser.uid);

    if (!isCurrentUserAdmin && !isCurrentUserOwner) {
      throw new Error('Only administrators or owners can add administrators');
    }

    // Check 3: Find and make sure targetUserId exists
    const targetProfile = await getUserProfile(targetUserId);

    if (!targetProfile) {
      throw new Error('Target user does not exist or has no profile');
    }

    // Check 4: Ensure the user and target have wallet addresses for the blockchain transaction
    const userWalletAddress = await this.getUserWalletAddress(currentUser.uid);
    const targetWalletAddress = await this.getUserWalletAddress(targetUserId);

    // Check 5: Check existing roles - can't demote owners
    const existingRole = this.getUserRole(recordData, targetUserId);

    if (existingRole === 'owner') {
      throw new Error('User is already an owner (higher role than administrator)');
    }
    if (existingRole === 'administrator') {
      throw new Error('User is already an administrator');
    }

    console.log('🔄 Granting administrator role:', targetUserId);

    const hasExistingRole = existingRole !== null;
    const changes: PermissionChange[] = [
      hasExistingRole
        ? {
            userId: targetUserId,
            action: 'upgraded' as const,
            previousRole: existingRole as Role, // narrowed — hasExistingRole guarantees non-null
            newRole: 'administrator' as const,
          }
        : {
            userId: targetUserId,
            action: 'granted' as const,
            previousRole: null,
            newRole: 'administrator' as const,
          },
    ];

    const historyRef = doc(
      collection(db, 'records', recordId, 'permissionHistory'),
      buildPermissionHistoryDocId(targetUserId)
    );

    // Step 1: Encryption Key preparation. Preparation function performs various checks
    // ahead of wrappedKey write (is there existing one, is this a guest etc.). Only performs checks and not writes
    // because the wrappedKey write needs to be atomic with role array + history event below.
    // If preparation fails, we won't be able to write an access key and there's no point in granting permission.
    const encryptionGrant = await SharingService.prepareEncryptionAccessGrant(
      recordId,
      targetUserId,
      currentUser.uid
    );

    // Step 2: Atomic Firestore write — role arrays + permission history event + wrapped key,
    // all three or none. blockchainRef starts null; it's filled in below once the chain call resolves.
    try {
      // Step 2A: Prepare permissionHistory event data. This is done here so we can include the encrypted title if available.
      const eventData = await preparePermissionChangeEventData(
        recordId,
        currentUser.uid,
        changes,
        recordTitle
      );

      // Step 2B: Write role array + permissionHistory event + wrapped key in a single batch
      const batch = writeBatch(db);
      batch.update(recordRef, {
        administrators: arrayUnion(targetUserId),
        sharers: arrayRemove(targetUserId),
        viewers: arrayRemove(targetUserId),
      });
      batch.set(historyRef, eventData);
      if (encryptionGrant) {
        if (encryptionGrant.isReactivation) {
          batch.update(encryptionGrant.ref, encryptionGrant.data);
        } else {
          batch.set(encryptionGrant.ref, encryptionGrant.data);
        }
      }
      await batch.commit();
    } catch (firestoreError) {
      Sentry.captureException(firestoreError, {
        tags: { feature: 'permissions', action: 'grantAdmin', recordId },
      });
      throw firestoreError;
    }

    // Step 3: Blockchain — best-effort, does not revert the Firestore write above. The
    // permission change already stands regardless of what happens here.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: hasExistingRole ? 'changeRole' : 'grantRole',
      userId: currentUser.uid,
      userWalletAddress,
      permissionHistoryPath: historyRef.path,
      context: {
        type: 'permission',
        targetUserId,
        targetWalletAddress,
        role: 'administrator',
        recordId,
        recordIdHash: id(recordId),
      },
    });

    try {
      console.log(
        `🔗 ${hasExistingRole ? 'Upgrading to' : 'Granting'} administrator role on blockchain...`
      );

      const tx = hasExistingRole
        ? await BlockchainRoleManagerService.changeRole(
            recordId,
            targetWalletAddress,
            'administrator'
          )
        : await BlockchainRoleManagerService.grantRole(
            recordId,
            targetWalletAddress,
            'administrator'
          );

      const blockchainRef: BlockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      await updateDoc(historyRef, { blockchainRef });
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log('✅ Blockchain: Administrator role set');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);

      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log('✅ Administrator access granted successfully');
  }

  /**
   * Add an owner to a record
   * @param recordId - The record ID
   * @param targetUserId - The user ID to add as owner
   * @throws Error if operation fails or user doesn't have permission
   * Mirrors to blockchain as well. Creates retry queue entry if blockchain mirroring fails
   */
  static async grantOwner(
    recordId: string,
    targetUserId: string,
    recordTitle?: string
  ): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    // Check 1: Does record exist
    const db = getFirestore();
    const recordRef = doc(db, 'records', recordId);
    const recordDoc = await getDoc(recordRef);

    if (!recordDoc.exists()) throw new Error('Record not found');
    const recordData = recordDoc.data();

    // Check 2: Permission check - only owners can add owners (or admins if no owners exist)
    const owners = recordData.owners || [];
    const admins = recordData.administrators || [];

    const canGrantOwner =
      owners.length > 0 ? owners.includes(currentUser.uid) : admins.includes(currentUser.uid);

    if (!canGrantOwner) {
      throw new Error('You do not have permission to add owners');
    }

    // Check 3: Find and make sure targetUserId exists
    const targetProfile = await getUserProfile(targetUserId);

    if (!targetProfile) {
      throw new Error('Target user does not exist or has no profile');
    }

    // Check 4: Ensure the user has a wallet for the blockchain transaction
    const userWalletAddress = await this.getUserWalletAddress(currentUser.uid);
    const targetWalletAddress = await this.getUserWalletAddress(targetUserId);

    // Check 5: Check if they're already an owner
    const existingRole = this.getUserRole(recordData, targetUserId);

    if (existingRole === 'owner') {
      throw new Error('User is already an owner');
    }

    console.log('🔄 Granting owner access:', targetUserId);

    const hasExistingRole = existingRole !== null;
    const changes: PermissionChange[] = [
      hasExistingRole
        ? {
            userId: targetUserId,
            action: 'upgraded' as const,
            previousRole: existingRole as Role,
            newRole: 'owner' as const,
          }
        : {
            userId: targetUserId,
            action: 'granted' as const,
            previousRole: null,
            newRole: 'owner' as const,
          },
    ];

    const historyRef = doc(
      collection(db, 'records', recordId, 'permissionHistory'),
      buildPermissionHistoryDocId(targetUserId)
    );

    // Encryption key material must be prepared before the batch below — this does client-side
    // RSA-wrapping using the caller's own unlocked session key, which can fail for reasons
    // (encryption session not unlocked, receiver has no public key) that are validation
    // failures like the checks above, not infrastructure failures — so it throws before
    // anything is written, same as those checks.
    const encryptionGrant = await SharingService.prepareEncryptionAccessGrant(
      recordId,
      targetUserId,
      currentUser.uid
    );

    // Step 1: Atomic Firestore write — role arrays + permission history event + wrapped key,
    // all three or none. A wrapped-key write failing on its own, after the role already
    // committed, is not something a reconciliation engine could ever fix later (it needs THIS
    // grantor's session, not just any backend retry) — so it has to be all-or-nothing with the
    // role write itself, not a separate step. blockchainRef starts null; it's filled in below
    // once the chain call resolves.
    try {
      const eventData = await preparePermissionChangeEventData(
        recordId,
        currentUser.uid,
        changes,
        recordTitle
      );

      const batch = writeBatch(db);
      batch.update(recordRef, {
        owners: arrayUnion(targetUserId),
        administrators: arrayRemove(targetUserId),
        sharers: arrayRemove(targetUserId),
        viewers: arrayRemove(targetUserId),
      });
      batch.set(historyRef, eventData);
      if (encryptionGrant) {
        if (encryptionGrant.isReactivation) {
          batch.update(encryptionGrant.ref, encryptionGrant.data);
        } else {
          batch.set(encryptionGrant.ref, encryptionGrant.data);
        }
      }
      await batch.commit();
    } catch (firestoreError) {
      Sentry.captureException(firestoreError, {
        tags: { feature: 'permissions', action: 'grantOwner', recordId },
      });
      throw firestoreError;
    }

    // Step 2: Blockchain — best-effort, does not revert the Firestore write above. The
    // permission change already stands regardless of what happens here.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: hasExistingRole ? 'changeRole' : 'grantRole',
      userId: currentUser.uid,
      userWalletAddress,
      permissionHistoryPath: historyRef.path,
      context: {
        type: 'permission',
        targetUserId,
        targetWalletAddress,
        role: 'owner',
        recordId,
        recordIdHash: id(recordId),
      },
    });

    try {
      console.log(
        `🔗 ${hasExistingRole ? 'Upgrading to' : 'Granting'} owner role on blockchain...`
      );

      const tx = hasExistingRole
        ? await BlockchainRoleManagerService.changeRole(recordId, targetWalletAddress, 'owner')
        : await BlockchainRoleManagerService.grantRole(recordId, targetWalletAddress, 'owner');

      const blockchainRef: BlockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      await updateDoc(historyRef, { blockchainRef });
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log('✅ Blockchain: Owner role set');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);

      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log('✅ Owner access granted successfully');
  }

  // ============================================================================
  // REMOVE METHODS
  // ============================================================================

  /**
   * Remove an viewer from a record
   * @param recordId - The record ID
   * @param targetUserId - The user ID to remove as viewer
   * @throws Error if operation fails or user doesn't have permission
   */
  static async removeViewer(
    recordId: string,
    targetUserId: string,
    recordTitle?: string
  ): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    // Check 1: Check that record exist
    const db = getFirestore();
    const recordRef = doc(db, 'records', recordId);
    const recordDoc = await getDoc(recordRef);

    if (!recordDoc.exists()) {
      throw new Error('Record not found');
    }

    const recordData = recordDoc.data();

    // Check 2: only admins/owners can remove viewers, or user can remove themselves
    const isAdmin = recordData.administrators?.includes(currentUser.uid);
    const isOwner = recordData.owners?.includes(currentUser.uid);
    const isSelfRemoval = targetUserId === currentUser.uid;
    const isCurrentUserSubject = recordData.subjects?.includes(currentUser.uid);

    if (!isAdmin && !isOwner && !isSelfRemoval && !isCurrentUserSubject) {
      throw new Error('You do not have permission to remove viewers');
    }

    // Check 3: Subjects with viewer permissions can only remove access that they granted
    let isSubjectWhoGranted = false;
    if (isCurrentUserSubject && !isAdmin && !isOwner && !isSelfRemoval) {
      try {
        const wrappedKeyDoc = await getDoc(doc(db, 'wrappedKeys', `${recordId}_${targetUserId}`));
        if (wrappedKeyDoc.exists()) {
          const grantedBy = wrappedKeyDoc.data()?.grantedBy;
          isSubjectWhoGranted = grantedBy === currentUser.uid;
        }
      } catch (error) {
        console.error('Error checking wrapped key:', error);
      }
    }

    if (isCurrentUserSubject && !isAdmin && !isOwner && !isSelfRemoval && !isSubjectWhoGranted) {
      throw new Error('Subjects with viewer permissions can only remove permissions they granted');
    }

    // Check 4: Verify user is actually a viewer
    if (!recordData.viewers?.includes(targetUserId)) {
      throw new Error('User is not a viewer of this record');
    }

    // Check 5: Can't remove a subject's permissions (must go through subject removal route first)
    const isTargetSubject = recordData.subjects?.includes(targetUserId);

    if (isTargetSubject) {
      throw new Error("Cannot remove a subject's access. Please remove them as subject first.");
    }

    // Check 6: verify the users have a wallet to do a blockchain transaction
    const userWalletAddress = await this.getUserWalletAddress(currentUser.uid);
    const targetWalletAddress = await this.getUserWalletAddress(targetUserId);

    console.log('🔄 Removing viewer access:', targetUserId);

    const changes: PermissionChange[] = [
      {
        userId: targetUserId,
        action: 'revoked',
        previousRole: 'viewer',
        newRole: null,
      },
    ];

    const historyRef = doc(
      collection(db, 'records', recordId, 'permissionHistory'),
      buildPermissionHistoryDocId(targetUserId)
    );

    // Unlike grant, this has no crypto dependency on the caller's session — it's a metadata-only
    // flip, recoverable later by anyone if it ever failed on its own. Still prepared before the
    // batch and included in it, for consistency and so the sharing dashboard's status is never
    // even transiently wrong.
    const encryptionRevoke = await SharingService.prepareEncryptionAccessRevoke(
      recordId,
      targetUserId,
      currentUser.uid
    );

    // Step 1: Atomic Firestore write — role array + permission history event + wrapped-key
    // deactivation, all three or none. blockchainRef starts null; it's filled in below once
    // the chain call resolves.
    try {
      const eventData = await preparePermissionChangeEventData(
        recordId,
        currentUser.uid,
        changes,
        recordTitle
      );

      const batch = writeBatch(db);
      batch.update(recordRef, {
        viewers: arrayRemove(targetUserId),
      });
      batch.set(historyRef, eventData);
      if (encryptionRevoke) {
        batch.update(encryptionRevoke.ref, encryptionRevoke.data);
      }
      await batch.commit();
    } catch (firestoreError) {
      Sentry.captureException(firestoreError, {
        tags: { feature: 'permissions', action: 'removeViewer', recordId },
      });
      throw firestoreError;
    }

    // Step 2: Blockchain — best-effort, does not revert the Firestore write above. The
    // permission change already stands regardless of what happens here.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: 'revokeRole',
      userId: currentUser.uid,
      userWalletAddress,
      permissionHistoryPath: historyRef.path,
      context: {
        type: 'permission',
        targetUserId,
        targetWalletAddress,
        role: 'viewer',
        recordId,
        recordIdHash: id(recordId),
      },
    });

    try {
      console.log('🔗 Revoking role on blockchain...');
      const tx = await BlockchainRoleManagerService.revokeRole(recordId, targetWalletAddress);

      const blockchainRef: BlockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      await updateDoc(historyRef, { blockchainRef });
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log('✅ Blockchain: Role revoked');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);

      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log('✅ Viewer access removed successfully');
  }

  /**
   * Remove a sharer from a record.
   * Admins/owners can remove any sharer; sharers can remove access they personally granted;
   * users can always remove themselves.
   */
  static async removeSharer(
    recordId: string,
    targetUserId: string,
    recordTitle?: string,
    options?: { demoteToViewer?: boolean }
  ): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    const db = getFirestore();
    const recordRef = doc(db, 'records', recordId);
    const recordDoc = await getDoc(recordRef);

    if (!recordDoc.exists()) {
      throw new Error('Record not found');
    }

    const recordData = recordDoc.data();

    const isAdmin = recordData.administrators?.includes(currentUser.uid);
    const isOwner = recordData.owners?.includes(currentUser.uid);
    const isSelfRemoval = targetUserId === currentUser.uid;
    const isCurrentUserSharer = recordData.sharers?.includes(currentUser.uid);
    const isCurrentUserSubject = recordData.subjects?.includes(currentUser.uid);

    if (!isAdmin && !isOwner && !isSelfRemoval && !isCurrentUserSharer && !isCurrentUserSubject) {
      throw new Error('You do not have permission to remove sharers');
    }

    // Sharers/subjects can only remove access they personally granted
    let isSharerWhoGranted = false;
    if ((isCurrentUserSharer || isCurrentUserSubject) && !isAdmin && !isOwner && !isSelfRemoval) {
      try {
        const wrappedKeyDoc = await getDoc(doc(db, 'wrappedKeys', `${recordId}_${targetUserId}`));
        if (wrappedKeyDoc.exists()) {
          isSharerWhoGranted = wrappedKeyDoc.data()?.grantedBy === currentUser.uid;
        }
      } catch (error) {
        console.error('Error checking wrapped key:', error);
      }
    }

    if (
      (isCurrentUserSharer || isCurrentUserSubject) &&
      !isAdmin &&
      !isOwner &&
      !isSelfRemoval &&
      !isSharerWhoGranted
    ) {
      throw new Error('Sharers can only remove permissions they personally granted');
    }

    // Check target is actually a sharer
    if (!recordData.sharers?.includes(targetUserId)) {
      throw new Error('User is not a sharer of this record');
    }

    // Cannot remove an active subject's access (minimum sharer)
    const isTargetSubject = recordData.subjects?.includes(targetUserId);
    if (isTargetSubject) {
      throw new Error("Cannot remove a subject's access. Please remove them as subject first.");
    }

    const userWalletAddress = await this.getUserWalletAddress(currentUser.uid);
    const targetWalletAddress = await this.getUserWalletAddress(targetUserId);

    console.log('🔄 Removing sharer access:', targetUserId);

    const demoteToViewer = options?.demoteToViewer ?? false;
    const changes: PermissionChange[] = [
      demoteToViewer
        ? {
            userId: targetUserId,
            action: 'downgraded' as const,
            previousRole: 'sharer' as const,
            newRole: 'viewer' as const,
          }
        : {
            userId: targetUserId,
            action: 'revoked' as const,
            previousRole: 'sharer' as const,
            newRole: null,
          },
    ];

    const historyRef = doc(
      collection(db, 'records', recordId, 'permissionHistory'),
      buildPermissionHistoryDocId(targetUserId)
    );

    // Only a full revoke drops encryption access — a viewer demotion still needs the key.
    const encryptionRevoke = demoteToViewer
      ? null
      : await SharingService.prepareEncryptionAccessRevoke(recordId, targetUserId, currentUser.uid);

    // Step 1: Atomic Firestore write — role arrays + permission history event + wrapped-key
    // deactivation (full revoke only), all together or none. blockchainRef starts null; it's
    // filled in below once the chain call resolves.
    try {
      const eventData = await preparePermissionChangeEventData(
        recordId,
        currentUser.uid,
        changes,
        recordTitle
      );

      const batch = writeBatch(db);
      batch.update(recordRef, {
        sharers: arrayRemove(targetUserId),
        ...(demoteToViewer && { viewers: arrayUnion(targetUserId) }),
      });
      batch.set(historyRef, eventData);
      if (encryptionRevoke) {
        batch.update(encryptionRevoke.ref, encryptionRevoke.data);
      }
      await batch.commit();
    } catch (firestoreError) {
      Sentry.captureException(firestoreError, {
        tags: { feature: 'permissions', action: 'removeSharer', recordId },
      });
      throw firestoreError;
    }

    // Step 2: Blockchain — best-effort, does not revert the Firestore write above. The
    // permission change already stands regardless of what happens here.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: demoteToViewer ? 'changeRole' : 'revokeRole',
      userId: currentUser.uid,
      userWalletAddress,
      permissionHistoryPath: historyRef.path,
      context: {
        type: 'permission',
        targetUserId,
        targetWalletAddress,
        role: 'sharer',
        recordId,
        recordIdHash: id(recordId),
      },
    });

    try {
      console.log(
        demoteToViewer
          ? '🔗 Demoting sharer to viewer on blockchain...'
          : '🔗 Revoking sharer role on blockchain...'
      );

      const tx = demoteToViewer
        ? await BlockchainRoleManagerService.changeRole(recordId, targetWalletAddress, 'viewer')
        : await BlockchainRoleManagerService.revokeRole(recordId, targetWalletAddress);

      const blockchainRef: BlockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      await updateDoc(historyRef, { blockchainRef });
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log(
        demoteToViewer ? '✅ Blockchain: Sharer demoted to viewer' : '✅ Blockchain: Sharer role revoked'
      );
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);

      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log('✅ Sharer access removed successfully');
  }

  /**
   * Remove an admin from a record
   * @param recordId - The record ID
   * @param targetUserId - The user ID to remove as admin
   * @param recordTitle - The title of the record
   * @param options - Can demote to 'sharer' or 'viewer' instead of full revocation
   * @throws Error if operation fails or user doesn't have permission
   */
  static async removeAdmin(
    recordId: string,
    targetUserId: string,
    recordTitle?: string,
    options?: { demoteTo?: 'sharer' | 'viewer' }
  ): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    // Check 1: Check record exists
    const db = getFirestore();
    const recordRef = doc(db, 'records', recordId);
    const recordDoc = await getDoc(recordRef);

    if (!recordDoc.exists()) {
      throw new Error('Record not found');
    }

    const recordData = recordDoc.data();

    // Check 2: Permission checks
    const isCurrentUserOwner = recordData.owners?.includes(currentUser.uid);
    const isCurrentUserAdmin = recordData.administrators?.includes(currentUser.uid);
    const isSelfRemoval = targetUserId === currentUser.uid;
    const hasOwners = recordData.owners?.length > 0;
    const isLastAdmin = recordData.administrators?.length === 1;

    // Rule 1: Check if caller is an admin or Owner of this record
    if (!isCurrentUserOwner && !isCurrentUserAdmin) {
      throw new Error('You are not an owner or administrator of this record');
    }

    // Rule 2: If there are owners, only owners can remove other admins. Admins can only remove themselves
    if (hasOwners && !isSelfRemoval && !isCurrentUserOwner) {
      throw new Error('Only the record owner can remove other administrators');
    }

    // Rule 3: Can't remove owner via removeAdmin (although this should never come up... but just in case)
    if (recordData.owners?.includes(targetUserId)) {
      throw new Error('Cannot remove the record owner as administrator');
    }

    // Rule 4: Check if user in question is actually an administrator
    if (!recordData.administrators?.includes(targetUserId)) {
      throw new Error('User is not an administrator of this record');
    }

    // Rule 5: Prevent removing yourself if you're the last administrator or owner
    if (!hasOwners && isLastAdmin) {
      throw new Error('Cannot remove the last administrator from a record');
    }

    // Rule 6: Subjects require at least sharer access — a full revoke (no demoteTo) must go
    // through the subject removal route first, and demoteTo may never be 'viewer'.
    const isTargetSubject = recordData.subjects?.includes(targetUserId);

    if (isTargetSubject && (!options?.demoteTo || options.demoteTo === 'viewer')) {
      throw new Error(
        options?.demoteTo === 'viewer'
          ? 'This user is a subject of the record and requires at least Sharer access.'
          : "Cannot remove a subject's access. Please remove them as subject first or demote to a different role."
      );
    }

    // Check 3: Check for and get wallets
    const userWalletAddress = await this.getUserWalletAddress(currentUser.uid);
    const targetWalletAddress = await this.getUserWalletAddress(targetUserId);

    console.log('🔄 Removing administrator access:', targetUserId);

    const demoteTo = options?.demoteTo;
    const changes: PermissionChange[] = [
      demoteTo
        ? {
            userId: targetUserId,
            action: 'downgraded' as const,
            previousRole: 'administrator' as const,
            newRole: demoteTo,
          }
        : {
            userId: targetUserId,
            action: 'revoked' as const,
            previousRole: 'administrator' as const,
            newRole: null,
          },
    ];

    const historyRef = doc(
      collection(db, 'records', recordId, 'permissionHistory'),
      buildPermissionHistoryDocId(targetUserId)
    );

    // Only a full revoke drops encryption access — sharer/viewer demotions still need the key.
    const encryptionRevoke = demoteTo
      ? null
      : await SharingService.prepareEncryptionAccessRevoke(recordId, targetUserId, currentUser.uid);

    // Step 1: Atomic Firestore write — role arrays + permission history event + wrapped-key
    // deactivation (full revoke only), all together or none. Previously the encryption revoke
    // had to run BEFORE the array update as two separate writes, specifically for self-removal:
    // wrappedKeys' `allow update` rule checks isAdminOrOwnerOfRecord(recordId), and Firestore
    // rules evaluate get() against the pre-write snapshot — so revoking your own key AFTER your
    // own admin status had already been removed would fail that check. Batching both into one
    // atomic write removes the ordering hazard entirely: everything in a batch is evaluated
    // against the same pre-batch snapshot regardless of write order.
    try {
      const eventData = await preparePermissionChangeEventData(
        recordId,
        currentUser.uid,
        changes,
        recordTitle
      );

      const batch = writeBatch(db);
      batch.update(recordRef, {
        administrators: arrayRemove(targetUserId),
        ...(demoteTo === 'sharer' ? { sharers: arrayUnion(targetUserId) } : {}),
        ...(demoteTo === 'viewer' ? { viewers: arrayUnion(targetUserId) } : {}),
      });
      batch.set(historyRef, eventData);
      if (encryptionRevoke) {
        batch.update(encryptionRevoke.ref, encryptionRevoke.data);
      }
      await batch.commit();
    } catch (firestoreError) {
      Sentry.captureException(firestoreError, {
        tags: { feature: 'permissions', action: 'removeAdmin', recordId },
      });
      throw firestoreError;
    }

    // Step 2: Blockchain — best-effort, does not revert the Firestore write above. The
    // permission change already stands regardless of what happens here.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: demoteTo ? 'changeRole' : 'revokeRole',
      userId: currentUser.uid,
      userWalletAddress,
      permissionHistoryPath: historyRef.path,
      context: {
        type: 'permission',
        targetUserId,
        targetWalletAddress,
        role: 'administrator',
        recordId,
        recordIdHash: id(recordId),
      },
    });

    try {
      console.log(
        demoteTo ? `🔗 Demoting to ${demoteTo} on blockchain...` : '🔗 Revoking role on blockchain...'
      );

      const tx = demoteTo
        ? await BlockchainRoleManagerService.changeRole(recordId, targetWalletAddress, demoteTo)
        : await BlockchainRoleManagerService.revokeRole(recordId, targetWalletAddress);

      const blockchainRef: BlockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      await updateDoc(historyRef, { blockchainRef });
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log(demoteTo ? `✅ Blockchain: Demoted to ${demoteTo}` : '✅ Blockchain: Role revoked');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);

      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log('✅ Administrator access removed successfully');
  }

  /**
   * Remove owner access from a record. Owners can only be removed by themselves
   * Optionally demotes to admin or viewer instead of full revocation
   * @param recordId - The record ID
   * @param targetUserId - the user being removed as an owner
   * @param options - Can demote to 'administrator', 'sharer', or 'viewer' otherwise access fully revoked
   */
  static async removeOwner(
    recordId: string,
    targetUserId: string,
    recordTitle?: string,
    options?: { demoteTo?: 'administrator' | 'sharer' | 'viewer' }
  ): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    // Check 1: Does record exist
    const db = getFirestore();
    const recordRef = doc(db, 'records', recordId);
    const recordDoc = await getDoc(recordRef);

    if (!recordDoc.exists()) {
      throw new Error('Record not found');
    }

    const recordData = recordDoc.data();

    // Check 2: Permission checks
    const isCurrentUserOwner = recordData.owners?.includes(currentUser.uid);
    const isSelfRemoval = targetUserId === currentUser.uid;

    // Rule 1: Owners can only be removed by themselves (no one can remove other owners)
    if (!isSelfRemoval) {
      throw new Error('Owners can only be removed by themselves. You cannot remove other owners.');
    }

    // Rule 2: Only owners can remove owners
    if (!isCurrentUserOwner) {
      throw new Error('You are not an owner of this record');
    }

    // Rule 3: Verify target is actually an owner
    if (!recordData.owners?.includes(targetUserId)) {
      throw new Error('User is not an owner of this record');
    }

    // Rule 4: Can't remove last owner unless there's at least one admin
    const isLastOwner = recordData.owners.length === 1;
    const hasAdmins = recordData.administrators && recordData.administrators.length > 0;

    if (isLastOwner && !hasAdmins) {
      throw new Error('Cannot remove the last owner when no administrators exist');
    }

    // Rule 5: Subjects require at least sharer access — a full revoke (no options) must go
    // through the subject removal route first, and demoteTo may never be 'viewer'.
    const isTargetSubject = recordData.subjects?.includes(targetUserId);

    if (isTargetSubject && (!options || options.demoteTo === 'viewer')) {
      throw new Error(
        options?.demoteTo === 'viewer'
          ? 'This user is a subject of the record and requires at least Sharer access.'
          : "Cannot remove a subject's access. Please remove them as subject first."
      );
    }

    //Check 3: Check for user's blockchain wallets
    const userWalletAddress = await this.getUserWalletAddress(currentUser.uid);
    const targetWalletAddress = await this.getUserWalletAddress(targetUserId);

    console.log('🔄 Removing owner access:', targetUserId);

    const demoteTo = options?.demoteTo;
    const changes: PermissionChange[] = [
      demoteTo
        ? {
            userId: targetUserId,
            action: 'downgraded' as const,
            previousRole: 'owner' as const,
            newRole: demoteTo, // Role — non-null, TypeScript is happy
          }
        : {
            userId: targetUserId,
            action: 'revoked' as const,
            previousRole: 'owner' as const,
            newRole: null, // null — matches revoked member
          },
    ];

    const historyRef = doc(
      collection(db, 'records', recordId, 'permissionHistory'),
      buildPermissionHistoryDocId(targetUserId)
    );

    // Only a full revoke drops encryption access — admin/sharer/viewer demotions still need
    // the key.
    const encryptionRevoke = demoteTo
      ? null
      : await SharingService.prepareEncryptionAccessRevoke(recordId, targetUserId, currentUser.uid);

    // Step 1: Atomic Firestore write — role arrays + permission history event + wrapped-key
    // deactivation (full revoke only), all together or none. See removeAdmin for why batching
    // eliminates the old "revoke encryption before updating arrays" ordering hazard for
    // self-removal.
    try {
      const eventData = await preparePermissionChangeEventData(
        recordId,
        currentUser.uid,
        changes,
        recordTitle
      );

      const batch = writeBatch(db);
      if (demoteTo === 'administrator') {
        batch.update(recordRef, {
          owners: arrayRemove(targetUserId),
          administrators: arrayUnion(targetUserId),
        });
      } else if (demoteTo === 'sharer') {
        batch.update(recordRef, {
          owners: arrayRemove(targetUserId),
          sharers: arrayUnion(targetUserId),
        });
      } else if (demoteTo === 'viewer') {
        batch.update(recordRef, {
          owners: arrayRemove(targetUserId),
          viewers: arrayUnion(targetUserId),
        });
      } else {
        batch.update(recordRef, {
          owners: arrayRemove(targetUserId),
        });
      }
      batch.set(historyRef, eventData);
      if (encryptionRevoke) {
        batch.update(encryptionRevoke.ref, encryptionRevoke.data);
      }
      await batch.commit();

      console.log(demoteTo ? `✅ Demoted to ${demoteTo}` : '✅ Removed from owners array');
    } catch (firestoreError) {
      Sentry.captureException(firestoreError, {
        tags: { feature: 'permissions', action: 'removeOwner', recordId },
      });
      throw firestoreError;
    }

    // Step 2: Blockchain — best-effort, does not revert the Firestore write above. Leave (and
    // optionally demote) is a single atomic contract call — an owner has no other way to
    // acquire a role for themselves once they've left, so this can't be split into two
    // transactions (see voluntarilyLeaveOwnership's contract docstring). The permission change
    // already stands regardless of what happens here.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: 'voluntarilyLeaveOwnership',
      userId: currentUser.uid,
      userWalletAddress,
      permissionHistoryPath: historyRef.path,
      context: {
        type: 'permission',
        targetUserId,
        targetWalletAddress,
        role: demoteTo || 'owner',
        recordId,
        recordIdHash: id(recordId),
      },
    });

    try {
      const tx = await BlockchainRoleManagerService.voluntarilyLeaveOwnership(recordId, demoteTo);

      const blockchainRef: BlockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      await updateDoc(historyRef, { blockchainRef });
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log(
        demoteTo ? `✅ Blockchain: Demoted to ${demoteTo}` : '✅ Blockchain: Ownership removed'
      );
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);

      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log('✅ Owner access removed successfully');
  }

  // ============================================================================
  // BATCH METHODS
  // ============================================================================

  /**
   * Batch methods for granting/changing/revoking roles. Key difference is that individual
   * grant functions throw specific errors while batch granting silently skips ineligible records
   * This is acceptable for a better user experience, don't want 1 ineligible record to throw
   * an entire set of record grants. But still can throw on batch preconditions (no wallet, no profile etc.)
   */

  /**
   * Grant a user a role across multiple records in one operation
   * @param recordIds - Array of record IDs
   * @param targetUserId - The user ID to grant roles to
   * @param newRoles - Array of roles — must match recordIds length
   */
  static async grantRoleBatch(
    recordIds: string[],
    targetUserId: string,
    newRoles: Role[]
  ): Promise<string[]> {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('User not authenticated');
    if (recordIds.length !== newRoles.length) throw new Error('Array length mismatch');

    const db = getFirestore();
    const targetProfile = await getUserProfile(targetUserId);
    if (!targetProfile) throw new Error('Target user does not exist or has no profile');

    const targetWalletAddress = targetProfile.wallet?.address;
    if (!targetWalletAddress) throw new Error('Target user does not have a linked network account');

    console.log(`🔄 Batch granting roles to ${targetUserId} across ${recordIds.length} records...`);

    // ── Pre-flight: validate permissions and filter eligible records ──────────
    // We check Firestore permissions up front so we only pass valid records
    // to the blockchain call. The contract also validates but we want to avoid
    // a failed tx that wastes gas on the sponsored paymaster.

    const eligible: {
      recordId: string;
      role: Role;
      existingRole: Role | null;
    }[] = [];

    for (let i = 0; i < recordIds.length; i++) {
      const recordId = recordIds[i];
      const role = newRoles[i];
      if (!recordId || !role) continue;

      const recordDoc = await getDoc(doc(db, 'records', recordId));
      if (!recordDoc.exists()) {
        console.warn(`⚠️ Record ${recordId} not found — skipping`);
        continue;
      }

      const data = recordDoc.data();
      const isOwner = data.owners?.includes(currentUser.uid);
      const isAdmin = data.administrators?.includes(currentUser.uid);
      const isSharer = data.sharers?.includes(currentUser.uid);

      // Mirrors the (fixed) single-record grant methods: owner/admin bootstrap an owner,
      // only owner/admin grant admin or sharer, sharer may additionally grant viewer.
      const canGrant =
        role === 'owner'
          ? data.owners?.length > 0
            ? isOwner
            : isOwner || isAdmin
          : role === 'administrator' || role === 'sharer'
            ? isOwner || isAdmin
            : isOwner || isAdmin || isSharer;

      if (!canGrant) {
        console.warn(`⚠️ No permission to grant ${role} on record ${recordId} — skipping`);
        continue;
      }

      // Subjects require at least sharer access — mirrors grantViewer's floor check.
      if (role === 'viewer' && data.subjects?.includes(targetUserId)) {
        console.warn(
          `⚠️ Target is a subject and requires at least sharer access on record ${recordId} — skipping`
        );
        continue;
      }

      // Skip if target already has equal or higher role
      const existingRole = PermissionsService.getUserRole(data, targetUserId);
      if (existingRole === role) {
        console.warn(`⚠️ Target already has role ${role} on record ${recordId} — skipping`);
        continue;
      }
      if (existingRole === 'owner') {
        console.warn(`⚠️ Target is already an owner on record ${recordId} — skipping`);
        continue;
      }
      if (existingRole === 'administrator' && (role === 'viewer' || role === 'sharer')) {
        console.warn(
          `⚠️ Cannot demote admin to ${role} via batch on record ${recordId} — skipping`
        );
        continue;
      }
      if (existingRole === 'sharer' && role === 'viewer') {
        console.warn(
          `⚠️ Cannot demote sharer to viewer via batch on record ${recordId} — skipping`
        );
        continue;
      }

      eligible.push({ recordId, role, existingRole });
    }

    if (eligible.length === 0) {
      console.log('ℹ️ No eligible records after pre-flight checks');
      return [];
    }

    // ── Step 1: Atomic Firestore write per eligible record — role arrays + permission
    // history event + wrapped key, all together or none, independently per record (one
    // record's Firestore failure doesn't block the others — same fault tolerance the
    // pre-flight filtering above already establishes). blockchainRef starts null on each
    // history event; filled in below once the single batch blockchain transaction resolves.
    const succeeded: { recordId: string; role: Role; historyRef: DocumentReference }[] = [];

    await Promise.all(
      eligible.map(async ({ recordId, role, existingRole }) => {
        const recordRef = doc(db, 'records', recordId);
        const historyRef = doc(
          collection(db, 'records', recordId, 'permissionHistory'),
          buildPermissionHistoryDocId(targetUserId)
        );

        try {
          const encryptionGrant = await SharingService.prepareEncryptionAccessGrant(
            recordId,
            targetUserId,
            currentUser.uid
          );

          const eventData = await preparePermissionChangeEventData(recordId, currentUser.uid, [
            existingRole
              ? {
                  userId: targetUserId,
                  action: 'upgraded' as const,
                  previousRole: existingRole, // already Role since existingRole is truthy
                  newRole: role,
                }
              : {
                  userId: targetUserId,
                  action: 'granted' as const,
                  previousRole: null,
                  newRole: role,
                },
          ]);

          const batch = writeBatch(db);
          if (role === 'owner') {
            batch.update(recordRef, {
              owners: arrayUnion(targetUserId),
              administrators: arrayRemove(targetUserId),
              sharers: arrayRemove(targetUserId),
              viewers: arrayRemove(targetUserId),
            });
          } else if (role === 'administrator') {
            batch.update(recordRef, {
              administrators: arrayUnion(targetUserId),
              sharers: arrayRemove(targetUserId),
              viewers: arrayRemove(targetUserId),
            });
          } else if (role === 'sharer') {
            batch.update(recordRef, {
              sharers: arrayUnion(targetUserId),
              viewers: arrayRemove(targetUserId),
            });
          } else {
            batch.update(recordRef, {
              viewers: arrayUnion(targetUserId),
            });
          }
          batch.set(historyRef, eventData);
          if (encryptionGrant) {
            if (encryptionGrant.isReactivation) {
              batch.update(encryptionGrant.ref, encryptionGrant.data);
            } else {
              batch.set(encryptionGrant.ref, encryptionGrant.data);
            }
          }
          await batch.commit();

          succeeded.push({ recordId, role, historyRef });
          console.log(`✅ Firestore updated for record ${recordId}`);
        } catch (err) {
          Sentry.captureException(err, {
            tags: { feature: 'permissions', action: 'grantRoleBatch', recordId },
          });
          console.error(`❌ Firestore update failed for record ${recordId}:`, err);
          // Don't throw — other records in the batch still proceed independently.
        }
      })
    );

    if (succeeded.length === 0) {
      console.log('ℹ️ No records were successfully updated in Firestore');
      return [];
    }

    // ── Step 2: Single blockchain transaction covering only the records that actually
    // got the Firestore write — best-effort, does not revert any of the Firestore writes
    // above. The permission changes already stand regardless of what happens here.
    const userWalletAddress = await this.getUserWalletAddress(currentUser.uid);
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: 'grantRoleBatch',
      userId: currentUser.uid,
      userWalletAddress,
      permissionHistoryPath: succeeded.map(s => s.historyRef.path),
      context: {
        type: 'permission',
        targetUserId,
        targetWalletAddress,
        role: succeeded.map(s => s.role),
        recordId: succeeded.map(s => s.recordId),
        recordIdHash: succeeded.map(s => id(s.recordId)),
      },
    });

    try {
      const tx = await BlockchainRoleManagerService.grantRoleBatch(
        succeeded.map(s => s.recordId),
        targetWalletAddress,
        succeeded.map(s => s.role)
      );

      const blockchainRef: BlockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      await Promise.all(succeeded.map(s => updateDoc(s.historyRef, { blockchainRef })));
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log(`✅ Blockchain: batch grant complete (${succeeded.length} records)`);
    } catch (blockchainError) {
      console.error('⚠️ Blockchain batch update failed:', blockchainError);

      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log(
      `✅ Batch grant complete — ${succeeded.length}/${eligible.length} records fully processed`
    );
    return succeeded.map(s => s.recordId);
  }

  /**
   * Revoke a user's role across multiple records in one operation
   * @param recordIds - Array of record IDs
   * @param targetUserId - The user ID to revoke roles from
   */
  static async revokeRoleBatch(recordIds: string[], targetUserId: string): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('User not authenticated');

    const db = getFirestore();
    const userWalletAddress = await this.getUserWalletAddress(currentUser.uid);
    const targetWalletAddress = await this.getUserWalletAddress(targetUserId);

    console.log(
      `🔄 Batch revoking roles for ${targetUserId} across ${recordIds.length} records...`
    );

    // ── Pre-flight: validate permissions and filter eligible records ──────────
    const eligible: { recordId: string; existingRole: Role }[] = [];

    for (const recordId of recordIds) {
      const recordDoc = await getDoc(doc(db, 'records', recordId));

      if (!recordDoc.exists()) {
        console.warn(`⚠️ Record ${recordId} not found — skipping`);
        continue;
      }

      const data = recordDoc.data();

      const isOwner = data.owners?.includes(currentUser.uid);
      const isAdmin = data.administrators?.includes(currentUser.uid);
      if (!isOwner && !isAdmin) {
        console.warn(`⚠️ No permission on record ${recordId} — skipping`);
        continue;
      }

      const existingRole = this.getUserRole(data, targetUserId);
      if (!existingRole) {
        console.warn(`⚠️ Target has no role on record ${recordId} — skipping`);
        continue;
      }
      if (existingRole === 'owner') {
        console.warn(`⚠️ Target is an owner on record ${recordId} — skipping`);
        continue;
      }
      if (data.subjects?.includes(targetUserId)) {
        console.warn(`⚠️ Target is a subject on record ${recordId} — skipping`);
        continue;
      }

      eligible.push({ recordId, existingRole });
    }

    if (eligible.length === 0) {
      console.log('ℹ️ No eligible records after pre-flight checks');
      return;
    }

    // ── Step 1: Atomic Firestore write per eligible record — role arrays + permission
    // history event + wrapped-key deactivation, all together or none, independently per
    // record. blockchainRef starts null on each history event; filled in below once the
    // single batch blockchain transaction resolves.
    const succeeded: { recordId: string; existingRole: Role; historyRef: DocumentReference }[] = [];

    await Promise.all(
      eligible.map(async ({ recordId, existingRole }) => {
        const recordRef = doc(db, 'records', recordId);
        const historyRef = doc(
          collection(db, 'records', recordId, 'permissionHistory'),
          buildPermissionHistoryDocId(targetUserId)
        );

        try {
          const encryptionRevoke = await SharingService.prepareEncryptionAccessRevoke(
            recordId,
            targetUserId,
            currentUser.uid
          );

          const eventData = await preparePermissionChangeEventData(recordId, currentUser.uid, [
            {
              userId: targetUserId,
              action: 'revoked',
              previousRole: existingRole,
              newRole: null,
            },
          ]);

          const batch = writeBatch(db);
          batch.update(recordRef, {
            owners: arrayRemove(targetUserId),
            administrators: arrayRemove(targetUserId),
            sharers: arrayRemove(targetUserId),
            viewers: arrayRemove(targetUserId),
          });
          batch.set(historyRef, eventData);
          if (encryptionRevoke) {
            batch.update(encryptionRevoke.ref, encryptionRevoke.data);
          }
          await batch.commit();

          succeeded.push({ recordId, existingRole, historyRef });
          console.log(`✅ Firestore updated for record ${recordId}`);
        } catch (err) {
          Sentry.captureException(err, {
            tags: { feature: 'permissions', action: 'revokeRoleBatch', recordId },
          });
          console.error(`❌ Firestore update failed for record ${recordId}:`, err);
          // Don't throw — other records in the batch still proceed independently.
        }
      })
    );

    if (succeeded.length === 0) {
      console.log('ℹ️ No records were successfully updated in Firestore');
      return;
    }

    // ── Step 2: Single blockchain transaction covering only the records that actually
    // got the Firestore write — best-effort, does not revert any of the Firestore writes
    // above. The permission changes already stand regardless of what happens here.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: 'revokeRoleBatch',
      userId: currentUser.uid,
      userWalletAddress,
      permissionHistoryPath: succeeded.map(s => s.historyRef.path),
      context: {
        type: 'permission',
        targetUserId,
        targetWalletAddress,
        role: succeeded.map(s => s.existingRole),
        recordId: succeeded.map(s => s.recordId),
        recordIdHash: succeeded.map(s => id(s.recordId)),
      },
    });

    try {
      const tx = await BlockchainRoleManagerService.revokeRoleBatch(
        succeeded.map(s => s.recordId),
        targetWalletAddress
      );

      const blockchainRef: BlockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      await Promise.all(succeeded.map(s => updateDoc(s.historyRef, { blockchainRef })));
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log(`✅ Blockchain: batch revoke complete (${succeeded.length} records)`);
    } catch (blockchainError) {
      console.error('⚠️ Blockchain batch update failed:', blockchainError);

      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log(`✅ Batch revoke complete`);
  }

  /**
   * Change a user's role across multiple records in one operation
   * @param recordIds - Array of record IDs
   * @param targetUserId - The user ID whose role is being changed
   * @param newRoles - Array of new roles — must match recordIds length
   */
  static async changeRoleBatch(
    recordIds: string[],
    targetUserId: string,
    newRoles: Role[]
  ): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('User not authenticated');
    if (recordIds.length !== newRoles.length) throw new Error('Array length mismatch');

    const db = getFirestore();
    const userWalletAddress = await this.getUserWalletAddress(currentUser.uid);
    const targetWalletAddress = await this.getUserWalletAddress(targetUserId);

    console.log(
      `🔄 Batch changing roles for ${targetUserId} across ${recordIds.length} records...`
    );

    // ── Pre-flight ────────────────────────────────────────────────────────────
    const eligible: {
      recordId: string;
      existingRole: Role;
      newRole: Role;
    }[] = [];

    for (let i = 0; i < recordIds.length; i++) {
      const recordId = recordIds[i];
      const newRole = newRoles[i];

      if (!recordId || !newRole) {
        console.warn(`⚠️ Missing recordId or role at index ${i} — skipping`);
        continue;
      }

      const recordDoc = await getDoc(doc(db, 'records', recordId));
      if (!recordDoc.exists()) {
        console.warn(`⚠️ Record ${recordId} not found — skipping`);
        continue;
      }

      const data = recordDoc.data();

      const hasOwners = data.owners?.length > 0;
      const isOwner = data.owners?.includes(currentUser.uid);
      const isAdmin = data.administrators?.includes(currentUser.uid);
      if (!isOwner && !isAdmin) {
        console.warn(`⚠️ No permission on record ${recordId} — skipping`);
        continue;
      }

      // Bootstrap-only: a non-owner admin may only appoint an owner while none exists yet —
      // mirrors grantOwner/grantRoleBatch.
      if (newRole === 'owner' && hasOwners && !isOwner) {
        console.warn(
          `⚠️ Only an existing owner can appoint another owner on record ${recordId} — skipping`
        );
        continue;
      }

      const existingRole = this.getUserRole(data, targetUserId);
      if (!existingRole) {
        console.warn(`⚠️ Target has no role on record ${recordId} — skipping`);
        continue;
      }
      if (existingRole === 'owner') {
        console.warn(`⚠️ Target is an owner on record ${recordId} — skipping`);
        continue;
      }
      if (existingRole === newRole) {
        console.warn(`⚠️ Target already has role ${newRole} on record ${recordId} — skipping`);
        continue;
      }

      // Only the record owner may change a different administrator's role once owners
      // exist — mirrors removeAdmin Rule 2.
      const isSelf = targetUserId === currentUser.uid;
      if (existingRole === 'administrator' && hasOwners && !isOwner && !isSelf) {
        console.warn(
          `⚠️ Only the record owner can change another administrator's role on record ${recordId} — skipping`
        );
        continue;
      }

      // Subjects require at least sharer access — mirrors grantViewer/grantRoleBatch.
      if (newRole === 'viewer' && data.subjects?.includes(targetUserId)) {
        console.warn(
          `⚠️ Target is a subject and requires at least sharer access on record ${recordId} — skipping`
        );
        continue;
      }

      eligible.push({ recordId, existingRole, newRole });
    }

    if (eligible.length === 0) {
      console.log('ℹ️ No eligible records after pre-flight checks');
      return;
    }

    const roleOrder: Record<Role, number> = { viewer: 0, sharer: 1, administrator: 2, owner: 3 };

    // ── Step 1: Atomic Firestore write per eligible record — role arrays + permission
    // history event + encryption grant (only when actually needed), all together or none,
    // independently per record. A downgrade to viewer/sharer never needs a NEW key (it
    // already has one); only an upgrade FROM viewer/sharer to something higher does.
    // changeRoleBatch never revokes encryption access outright — that's revokeRoleBatch's
    // job — so there's no revoke branch here. blockchainRef starts null on each history
    // event; filled in below once the single batch blockchain transaction resolves.
    const succeeded: {
      recordId: string;
      existingRole: Role;
      newRole: Role;
      historyRef: DocumentReference;
    }[] = [];

    await Promise.all(
      eligible.map(async ({ recordId, existingRole, newRole }) => {
        const recordRef = doc(db, 'records', recordId);
        const historyRef = doc(
          collection(db, 'records', recordId, 'permissionHistory'),
          buildPermissionHistoryDocId(targetUserId)
        );

        try {
          const needsEncryptionGrant =
            (existingRole === 'viewer' || existingRole === 'sharer') &&
            newRole !== 'viewer' &&
            newRole !== 'sharer';

          const encryptionGrant = needsEncryptionGrant
            ? await SharingService.prepareEncryptionAccessGrant(
                recordId,
                targetUserId,
                currentUser.uid
              )
            : null;

          const eventData = await preparePermissionChangeEventData(recordId, currentUser.uid, [
            roleOrder[newRole] > roleOrder[existingRole]
              ? {
                  userId: targetUserId,
                  action: 'upgraded' as const,
                  previousRole: existingRole,
                  newRole,
                }
              : {
                  userId: targetUserId,
                  action: 'downgraded' as const,
                  previousRole: existingRole,
                  newRole,
                },
          ]);

          const update: Record<string, unknown> = {};
          if (newRole === 'owner') {
            update.owners = arrayUnion(targetUserId);
            update.administrators = arrayRemove(targetUserId);
            update.sharers = arrayRemove(targetUserId);
            update.viewers = arrayRemove(targetUserId);
          } else if (newRole === 'administrator') {
            update.administrators = arrayUnion(targetUserId);
            update.owners = arrayRemove(targetUserId);
            update.sharers = arrayRemove(targetUserId);
            update.viewers = arrayRemove(targetUserId);
          } else if (newRole === 'sharer') {
            update.sharers = arrayUnion(targetUserId);
            update.owners = arrayRemove(targetUserId);
            update.administrators = arrayRemove(targetUserId);
            update.viewers = arrayRemove(targetUserId);
          } else {
            update.viewers = arrayUnion(targetUserId);
            update.owners = arrayRemove(targetUserId);
            update.administrators = arrayRemove(targetUserId);
            update.sharers = arrayRemove(targetUserId);
          }

          const batch = writeBatch(db);
          batch.update(recordRef, update);
          batch.set(historyRef, eventData);
          if (encryptionGrant) {
            if (encryptionGrant.isReactivation) {
              batch.update(encryptionGrant.ref, encryptionGrant.data);
            } else {
              batch.set(encryptionGrant.ref, encryptionGrant.data);
            }
          }
          await batch.commit();

          succeeded.push({ recordId, existingRole, newRole, historyRef });
          console.log(`✅ Firestore updated for record ${recordId}: ${existingRole} → ${newRole}`);
        } catch (err) {
          Sentry.captureException(err, {
            tags: { feature: 'permissions', action: 'changeRoleBatch', recordId },
          });
          console.error(`❌ Firestore update failed for record ${recordId}:`, err);
          // Don't throw — other records in the batch still proceed independently.
        }
      })
    );

    if (succeeded.length === 0) {
      console.log('ℹ️ No records were successfully updated in Firestore');
      return;
    }

    // ── Step 2: Single blockchain transaction covering only the records that actually
    // got the Firestore write — best-effort, does not revert any of the Firestore writes
    // above. The permission changes already stand regardless of what happens here.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: 'changeRoleBatch',
      userId: currentUser.uid,
      userWalletAddress,
      permissionHistoryPath: succeeded.map(s => s.historyRef.path),
      context: {
        type: 'permission',
        targetUserId,
        targetWalletAddress,
        role: succeeded.map(s => s.newRole),
        recordId: succeeded.map(s => s.recordId),
        recordIdHash: succeeded.map(s => id(s.recordId)),
      },
    });

    try {
      const tx = await BlockchainRoleManagerService.changeRoleBatch(
        succeeded.map(s => s.recordId),
        targetWalletAddress,
        succeeded.map(s => s.newRole)
      );

      const blockchainRef: BlockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      await Promise.all(succeeded.map(s => updateDoc(s.historyRef, { blockchainRef })));
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log(`✅ Blockchain: batch change complete (${succeeded.length} records)`);
    } catch (blockchainError) {
      console.error('⚠️ Blockchain batch update failed:', blockchainError);

      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log(`✅ Batch role change complete`);
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Get record ownership information from firebase
   */
  static async getRecordRoles(recordId: string): Promise<{
    owners: string[];
    administrators: string[];
    sharers: string[];
    viewers: string[];
  } | null> {
    try {
      const db = getFirestore();
      const recordDoc = await getDoc(doc(db, 'records', recordId));

      if (!recordDoc.exists()) return null;

      const recordData = recordDoc.data();

      return {
        owners: recordData.owners || [],
        administrators: recordData.administrators || [],
        sharers: recordData.sharers || [],
        viewers: recordData.viewers || [],
      };
    } catch (err) {
      console.error('Error getting record roles:', err);
      return null;
    }
  }

  /**
   * General check: Can this user manage the record (edit/request subjects)?
   */
  static canManageRecord(record: FileObject, userId: string): boolean {
    const isOwner = record.owners?.includes(userId);
    const isAdmin = record.administrators?.includes(userId);
    return isOwner || isAdmin;
  }
}
