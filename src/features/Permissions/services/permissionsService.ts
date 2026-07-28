//src/features/Permissions/service/permissionsService.ts
/**
 * Service for managing record permissions
 * Handles role assignment (Firestore array + blockchain)
 * Calls SharingService for encryption Access
 * Integrates with roleInitializationService for first-time blockchain permission setup
 */

import { getFirestore, doc, updateDoc, arrayRemove, arrayUnion, getDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { SharingService } from '@/features/Sharing/services/sharingService';
import { BlockchainRoleManagerService } from './blockchainRoleManagerService';
import { getUserProfile } from '@/features/Users/services/userProfileService';
import { BlockchainSyncQueueService } from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import writePermissionChangeEvent from './writePermissionChangeEvent';
import { buildMemberRegistryRef, BlockchainRef, RecordRole, ROLE_HIERARCHY } from '@belrose/shared';
import { ethers, id } from 'ethers';
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
   * Get a user's wallet address from Firestore
   */
  private static async getUserWalletAddress(userId: string): Promise<string> {
    const db = getFirestore();
    const userDoc = await getDoc(doc(db, 'users', userId));

    if (!userDoc.exists()) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const walletAddress = userData.wallet?.address;

    if (!walletAddress) {
      throw new Error(
        `${userId} has no distributed network account. They must set up on the distributed network before managing permissions.`
      );
    }

    return walletAddress;
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

    // Step 1: Grant viewer role on blockchain

    let blockchainRef: BlockchainRef;

    try {
      console.log('🔗 Granting viewer role on blockchain...');
      const tx = await BlockchainRoleManagerService.grantRole(
        recordId,
        targetWalletAddress,
        'viewer'
      );
      blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      console.log('✅ Blockchain: Viewer role granted');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);

      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);

      await BlockchainSyncQueueService.logFailure({
        contract: 'MemberRoleManager',
        action: 'grantRole',
        userId: currentUser.uid,
        userWalletAddress: userWalletAddress,
        error: errorMessage,
        context: {
          type: 'permission',
          targetUserId: targetUserId,
          targetWalletAddress: targetWalletAddress,
          role: 'viewer',
          recordId,
          recordIdHash: id(recordId),
        },
      });

      throw blockchainError;
    }

    // Step 2: Grant encryption access
    await SharingService.grantEncryptionAccess(recordId, targetUserId, currentUser.uid);

    // Step 3: Write event log for audit/notification purposes
    await writePermissionChangeEvent(
      recordId,
      currentUser.uid,
      [
        {
          userId: targetUserId,
          action: 'granted', //Always granted, you never upgrade to viewer
          previousRole: existingRole ?? null,
          newRole: 'viewer',
        },
      ],
      blockchainRef,
      recordTitle
    );

    // Step 4: Add to viewers array in Firebase
    await updateDoc(recordRef, {
      viewers: arrayUnion(targetUserId),
    });

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

    let blockchainRef: BlockchainRef;

    try {
      console.log('🔗 Granting sharer role on blockchain...');
      const tx = await BlockchainRoleManagerService.grantRole(
        recordId,
        targetWalletAddress,
        'sharer'
      );
      blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      console.log('✅ Blockchain: Sharer role granted');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);
      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);
      await BlockchainSyncQueueService.logFailure({
        contract: 'MemberRoleManager',
        action: 'grantRole',
        userId: currentUser.uid,
        userWalletAddress,
        error: errorMessage,
        context: {
          type: 'permission',
          targetUserId,
          targetWalletAddress,
          role: 'sharer',
          recordId,
          recordIdHash: id(recordId),
        },
      });
      throw blockchainError;
    }

    // Step 2: Grant encryption access
    await SharingService.grantEncryptionAccess(recordId, targetUserId, currentUser.uid);

    // Step 3: Write event log
    await writePermissionChangeEvent(
      recordId,
      currentUser.uid,
      [
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
      ],
      blockchainRef,
      recordTitle
    );

    // Step 4: Add to sharers, remove from viewers (highest role only)
    await updateDoc(recordRef, {
      sharers: arrayUnion(targetUserId),
      viewers: arrayRemove(targetUserId),
    });

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

    // Step 1: Blockchain - determine action based on existing role
    // changeRole is in case they're being upgraded from viewer to admin
    let blockchainRef: BlockchainRef;
    const hasExistingRole = existingRole !== null;

    try {
      console.log(
        `🔗 ${hasExistingRole ? 'Upgrading to' : 'Granting'} administrator role on blockchain...`
      );

      if (hasExistingRole) {
        const tx = await BlockchainRoleManagerService.changeRole(
          recordId,
          targetWalletAddress,
          'administrator'
        );
        blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      } else {
        const tx = await BlockchainRoleManagerService.grantRole(
          recordId,
          targetWalletAddress,
          'administrator'
        );
        blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      }

      console.log('✅ Blockchain: Administrator role set');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);

      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);

      await BlockchainSyncQueueService.logFailure({
        contract: 'MemberRoleManager',
        action: hasExistingRole ? 'changeRole' : 'grantRole',
        userId: currentUser.uid,
        userWalletAddress: userWalletAddress,
        error: errorMessage,
        context: {
          type: 'permission',
          targetUserId: targetUserId,
          targetWalletAddress: targetWalletAddress,
          role: 'administrator',
          recordId,
          recordIdHash: id(recordId),
        },
      });

      throw blockchainError;
    }

    // Step 2: Grant encryption access
    await SharingService.grantEncryptionAccess(recordId, targetUserId, currentUser.uid);

    // Step 3: Write event log
    await writePermissionChangeEvent(
      recordId,
      currentUser.uid,
      [
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
      ],
      blockchainRef,
      recordTitle
    );

    // Step 4: Update arrays - add to admins, remove from lower roles (highest role only)
    await updateDoc(recordRef, {
      administrators: arrayUnion(targetUserId),
      sharers: arrayRemove(targetUserId),
      viewers: arrayRemove(targetUserId),
    });

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

    // Step 1: Blockchain - determine action based on existing role
    let blockchainRef: BlockchainRef;
    const hasExistingRole = existingRole !== null;

    try {
      console.log(
        `🔗 ${hasExistingRole ? 'Upgrading to' : 'Granting'} owner role on blockchain...`
      );

      if (hasExistingRole) {
        const tx = await BlockchainRoleManagerService.changeRole(
          recordId,
          targetWalletAddress,
          'owner'
        );
        blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      } else {
        const tx = await BlockchainRoleManagerService.grantRole(
          recordId,
          targetWalletAddress,
          'owner'
        );
        blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      }

      console.log('✅ Blockchain: Owner role set');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);
      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);
      await BlockchainSyncQueueService.logFailure({
        contract: 'MemberRoleManager',
        action: hasExistingRole ? 'changeRole' : 'grantRole',
        userId: currentUser.uid,
        userWalletAddress: userWalletAddress,
        error: errorMessage,
        context: {
          type: 'permission',
          targetUserId: targetUserId,
          targetWalletAddress: targetWalletAddress,
          role: 'owner',
          recordId,
          recordIdHash: id(recordId),
        },
      });

      throw blockchainError;
    }

    // Step 2: Grant encryption access
    await SharingService.grantEncryptionAccess(recordId, targetUserId, currentUser.uid);

    // Step 3: Write event log
    await writePermissionChangeEvent(
      recordId,
      currentUser.uid,
      [
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
      ],
      blockchainRef,
      recordTitle
    );

    // Step 4: Update arrays - add to owners, remove from lower roles (highest role only)
    await updateDoc(recordRef, {
      owners: arrayUnion(targetUserId),
      administrators: arrayRemove(targetUserId),
      sharers: arrayRemove(targetUserId),
      viewers: arrayRemove(targetUserId),
    });

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

    // Step 1: Revoke role on blockchain
    let blockchainRef: BlockchainRef;

    try {
      console.log('🔗 Revoking role on blockchain...');
      const tx = await BlockchainRoleManagerService.revokeRole(recordId, targetWalletAddress);
      blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      console.log('✅ Blockchain: Role revoked');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);

      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);

      await BlockchainSyncQueueService.logFailure({
        contract: 'MemberRoleManager',
        action: 'revokeRole',
        userId: currentUser.uid,
        userWalletAddress: userWalletAddress,
        error: errorMessage,
        context: {
          type: 'permission',
          targetUserId,
          targetWalletAddress: targetWalletAddress,
          role: 'viewer',
          recordId,
          recordIdHash: id(recordId),
        },
      });

      throw blockchainError;
    }

    // Step 2: Revoke encryption access
    await SharingService.revokeEncryptionAccess(recordId, targetUserId, currentUser.uid);

    // Step 3: Write event log
    await writePermissionChangeEvent(
      recordId,
      currentUser.uid,
      [
        {
          userId: targetUserId,
          action: 'revoked',
          previousRole: 'viewer',
          newRole: null,
        },
      ],
      blockchainRef,
      recordTitle
    );

    // Step 4: Remove from viewers array
    await updateDoc(recordRef, {
      viewers: arrayRemove(targetUserId),
    });

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

    let blockchainRef: BlockchainRef;

    try {
      if (demoteToViewer) {
        console.log('🔗 Demoting sharer to viewer on blockchain...');
        const tx = await BlockchainRoleManagerService.changeRole(
          recordId,
          targetWalletAddress,
          'viewer'
        );
        blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
        console.log('✅ Blockchain: Sharer demoted to viewer');
      } else {
        console.log('🔗 Revoking sharer role on blockchain...');
        const tx = await BlockchainRoleManagerService.revokeRole(recordId, targetWalletAddress);
        blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
        console.log('✅ Blockchain: Sharer role revoked');
      }
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);
      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);
      await BlockchainSyncQueueService.logFailure({
        contract: 'MemberRoleManager',
        action: demoteToViewer ? 'changeRole' : 'revokeRole',
        userId: currentUser.uid,
        userWalletAddress,
        error: errorMessage,
        context: {
          type: 'permission',
          targetUserId,
          targetWalletAddress,
          role: 'sharer',
          recordId,
          recordIdHash: id(recordId),
        },
      });
      throw blockchainError;
    }

    // Step 2: Revoke encryption access (only on full revoke — viewer still needs the key)
    if (!demoteToViewer) {
      await SharingService.revokeEncryptionAccess(recordId, targetUserId, currentUser.uid);
    }

    // Step 3: Write event log
    await writePermissionChangeEvent(
      recordId,
      currentUser.uid,
      [
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
      ],
      blockchainRef,
      recordTitle
    );

    // Step 4: Update role arrays
    await updateDoc(recordRef, {
      sharers: arrayRemove(targetUserId),
      ...(demoteToViewer && { viewers: arrayUnion(targetUserId) }),
    });

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

    // Step 1: Update blockchain
    let blockchainRef: BlockchainRef;

    try {
      if (demoteTo) {
        console.log(`🔗 Demoting to ${demoteTo} on blockchain...`);
        const tx = await BlockchainRoleManagerService.changeRole(
          recordId,
          targetWalletAddress,
          demoteTo
        );
        blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
        console.log(`✅ Blockchain: Demoted to ${demoteTo}`);
      } else {
        console.log('🔗 Revoking role on blockchain...');
        const tx = await BlockchainRoleManagerService.revokeRole(recordId, targetWalletAddress);
        blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
        console.log('✅ Blockchain: Role revoked');
      }
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);

      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);

      await BlockchainSyncQueueService.logFailure({
        contract: 'MemberRoleManager',
        action: 'revokeRole',
        userId: currentUser.uid,
        userWalletAddress: userWalletAddress,
        error: errorMessage,
        context: {
          type: 'permission',
          targetUserId,
          targetWalletAddress: targetWalletAddress,
          role: 'administrator',
          recordId,
          recordIdHash: id(recordId),
        },
      });

      throw blockchainError;
    }

    // Step 2: Write event log
    await writePermissionChangeEvent(
      recordId,
      currentUser.uid,
      [
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
      ],
      blockchainRef,
      recordTitle
    );

    // Step 3: Update Firestore arrays and encryption access if applicable
    if (demoteTo) {
      await updateDoc(recordRef, {
        administrators: arrayRemove(targetUserId),
        ...(demoteTo === 'sharer' ? { sharers: arrayUnion(targetUserId) } : {}),
        ...(demoteTo === 'viewer' ? { viewers: arrayUnion(targetUserId) } : {}),
      });
      console.log(`✅ Demoted to ${demoteTo}`);
    } else {
      // Revoke encryption access only if fully removing
      // Must remove before updating arrays, otherwise wrappedKey update will fail
      await SharingService.revokeEncryptionAccess(recordId, targetUserId, currentUser.uid);

      await updateDoc(recordRef, {
        administrators: arrayRemove(targetUserId),
      });
      console.log('✅ Removed from administrators array');
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

    // Step 1: Update blockchain — leave (and optionally demote) in a single atomic call.
    // An owner has no other way to acquire a role for themselves once they've left, so this
    // can't be split into two transactions (see voluntarilyLeaveOwnership's contract docstring).
    let blockchainRef: BlockchainRef;

    try {
      const tx = await BlockchainRoleManagerService.voluntarilyLeaveOwnership(recordId, demoteTo);
      blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      console.log(
        demoteTo ? `✅ Blockchain: Demoted to ${demoteTo}` : '✅ Blockchain: Ownership removed'
      );
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);

      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);

      await BlockchainSyncQueueService.logFailure({
        contract: 'MemberRoleManager',
        action: 'voluntarilyLeaveOwnership',
        userId: currentUser.uid,
        userWalletAddress: userWalletAddress,
        error: errorMessage,
        context: {
          type: 'permission',
          targetUserId,
          targetWalletAddress: targetWalletAddress,
          role: demoteTo || 'owner',
          recordId,
          recordIdHash: id(recordId),
        },
      });

      throw blockchainError;
    }

    // Step 2: Write event log
    await writePermissionChangeEvent(
      recordId,
      currentUser.uid,
      [
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
      ],
      blockchainRef,
      recordTitle
    );

    // Step 3: Update Firestore arrays
    if (demoteTo === 'administrator') {
      await updateDoc(recordRef, {
        owners: arrayRemove(targetUserId),
        administrators: arrayUnion(targetUserId),
      });
      console.log('✅ Demoted to administrator');
    } else if (demoteTo === 'sharer') {
      await updateDoc(recordRef, {
        owners: arrayRemove(targetUserId),
        sharers: arrayUnion(targetUserId),
      });
      console.log('✅ Demoted to sharer');
    } else if (demoteTo === 'viewer') {
      await updateDoc(recordRef, {
        owners: arrayRemove(targetUserId),
        viewers: arrayUnion(targetUserId),
      });
      console.log('✅ Demoted to viewer');
    } else {
      // Revoke encryption access only if fully removing
      // Must remove before updating arrays, otherwise wrappedKey update will fail
      await SharingService.revokeEncryptionAccess(recordId, targetUserId, currentUser.uid);

      await updateDoc(recordRef, {
        owners: arrayRemove(targetUserId),
      });
      console.log('✅ Removed from owners array');
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

    // ── Step 1: Single blockchain transaction for all eligible records ────────
    let batchBlockchainRef: BlockchainRef;

    try {
      const tx = await BlockchainRoleManagerService.grantRoleBatch(
        eligible.map(e => e.recordId),
        targetWalletAddress,
        eligible.map(e => e.role)
      );
      batchBlockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      console.log(`✅ Blockchain: batch grant complete (${eligible.length} records)`);
    } catch (blockchainError) {
      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);
      const userWalletAddress = await this.getUserWalletAddress(currentUser.uid);
      await BlockchainSyncQueueService.logFailure({
        contract: 'MemberRoleManager',
        action: 'grantRoleBatch',
        userId: currentUser.uid,
        userWalletAddress,
        error: errorMessage,
        context: {
          type: 'permission',
          targetUserId,
          targetWalletAddress,
          role: eligible.map(e => e.role),
          recordId: eligible.map(e => e.recordId),
          recordIdHash: eligible.map(e => ethers.id(e.recordId)),
        },
      });
      throw blockchainError; // surface to caller — don't do partial Firestore updates
    }

    // ── Steps 2 & 3: Encryption + Firestore per record (off-chain, parallel) ─
    const succeededRecordIds: string[] = [];

    await Promise.all(
      eligible.map(async ({ recordId, role, existingRole }) => {
        try {
          // Encryption access
          await SharingService.grantEncryptionAccess(recordId, targetUserId, currentUser.uid);

          // Write event log per record
          await writePermissionChangeEvent(
            recordId,
            currentUser.uid,
            [
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
            ],
            batchBlockchainRef
          );

          // Firestore role arrays
          const recordRef = doc(db, 'records', recordId);
          if (role === 'owner') {
            await updateDoc(recordRef, {
              owners: arrayUnion(targetUserId),
              administrators: arrayRemove(targetUserId),
              sharers: arrayRemove(targetUserId),
              viewers: arrayRemove(targetUserId),
            });
          } else if (role === 'administrator') {
            await updateDoc(recordRef, {
              administrators: arrayUnion(targetUserId),
              sharers: arrayRemove(targetUserId),
              viewers: arrayRemove(targetUserId),
            });
          } else if (role === 'sharer') {
            await updateDoc(recordRef, {
              sharers: arrayUnion(targetUserId),
              viewers: arrayRemove(targetUserId),
            });
          } else {
            await updateDoc(recordRef, {
              viewers: arrayUnion(targetUserId),
            });
          }

          succeededRecordIds.push(recordId);
          console.log(`✅ Encryption + Firestore updated for record ${recordId}`);
        } catch (err) {
          console.error(`❌ Post-blockchain update failed for record ${recordId}:`, err);
          // Don't throw — blockchain already succeeded, log for manual reconciliation
        }
      })
    );

    console.log(
      `✅ Batch grant complete — ${succeededRecordIds.length}/${eligible.length} records fully processed`
    );
    return succeededRecordIds;
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

    // ── Step 1: Single blockchain transaction ────────────────────────────────
    let batchBlockchainRef: BlockchainRef;

    try {
      const tx = await BlockchainRoleManagerService.revokeRoleBatch(
        eligible.map(e => e.recordId),
        targetWalletAddress
      );
      batchBlockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      console.log(`✅ Blockchain: batch revoke complete (${eligible.length} records)`);
    } catch (blockchainError) {
      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);
      await BlockchainSyncQueueService.logFailure({
        contract: 'MemberRoleManager',
        action: 'revokeRoleBatch',
        userId: currentUser.uid,
        userWalletAddress,
        error: errorMessage,
        context: {
          type: 'permission',
          targetUserId,
          targetWalletAddress,
          role: eligible.map(e => e.existingRole),
          recordId: eligible.map(e => e.recordId),
          recordIdHash: eligible.map(e => ethers.id(e.recordId)),
        },
      });
      throw blockchainError;
    }

    // ── Step 2: Encryption + Firestore per record (parallel) ─────────────────
    await Promise.all(
      eligible.map(async ({ recordId, existingRole }) => {
        try {
          await SharingService.revokeEncryptionAccess(recordId, targetUserId, currentUser.uid);

          await writePermissionChangeEvent(
            recordId,
            currentUser.uid,
            [
              {
                userId: targetUserId,
                action: 'revoked',
                previousRole: existingRole,
                newRole: null,
              },
            ],
            batchBlockchainRef
          );

          await updateDoc(doc(db, 'records', recordId), {
            owners: arrayRemove(targetUserId),
            administrators: arrayRemove(targetUserId),
            sharers: arrayRemove(targetUserId),
            viewers: arrayRemove(targetUserId),
          });

          console.log(`✅ Encryption + Firestore updated for record ${recordId}`);
        } catch (err) {
          console.error(`❌ Post-blockchain update failed for record ${recordId}:`, err);
        }
      })
    );

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

    // ── Step 1: Single blockchain transaction ────────────────────────────────
    let batchBlockchainRef: BlockchainRef;

    try {
      const tx = await BlockchainRoleManagerService.changeRoleBatch(
        eligible.map(e => e.recordId),
        targetWalletAddress,
        eligible.map(e => e.newRole)
      );
      batchBlockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);
      console.log(`✅ Blockchain: batch change complete (${eligible.length} records)`);
    } catch (blockchainError) {
      const errorMessage =
        blockchainError instanceof Error ? blockchainError.message : String(blockchainError);
      await BlockchainSyncQueueService.logFailure({
        contract: 'MemberRoleManager',
        action: 'changeRoleBatch',
        userId: currentUser.uid,
        userWalletAddress,
        error: errorMessage,
        context: {
          type: 'permission',
          targetUserId,
          targetWalletAddress,
          role: eligible.map(e => e.newRole),
          recordId: eligible.map(e => e.recordId),
          recordIdHash: eligible.map(e => ethers.id(e.recordId)),
        },
      });
      throw blockchainError;
    }

    // ── Step 2: Encryption + Firestore per record (parallel) ─────────────────
    const roleOrder: Record<Role, number> = { viewer: 0, sharer: 1, administrator: 2, owner: 3 };

    await Promise.all(
      eligible.map(async ({ recordId, existingRole, newRole }) => {
        try {
          if (
            (existingRole === 'viewer' || existingRole === 'sharer') &&
            newRole !== 'viewer' &&
            newRole !== 'sharer'
          ) {
            await SharingService.grantEncryptionAccess(recordId, targetUserId, currentUser.uid);
          }

          await writePermissionChangeEvent(
            recordId,
            currentUser.uid,
            [
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
            ],
            batchBlockchainRef
          );

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
          await updateDoc(doc(db, 'records', recordId), update);

          console.log(`✅ Role changed on record ${recordId}: ${existingRole} → ${newRole}`);
        } catch (err) {
          console.error(`❌ Post-blockchain update failed for record ${recordId}:`, err);
        }
      })
    );

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
