// src/features/Permissions/services/blockchainRoleManagerService.ts
//
// Frontend service for blockchain role management.
// Uses PaymasterService for all write transactions (handles sponsored vs direct).
//
// KEY ARCHITECTURE (matches MemberRoleManager.sol):
// - Members are registered by WALLET ADDRESS
// - Each wallet is linked to an IDENTITY (userIdHash)
// - One identity can have MULTIPLE wallets (EOA, Smart Account, etc.)
// - Roles are assigned to IDENTITIES, not wallets
// - Any wallet linked to an identity can exercise that identity's roles
//
// Read operations: No wallet needed (uses public RPC)
// Write operations: Routes through PaymasterService
//
// Note: Admin-only functions (addMember, setUserStatus, initializeRecordRole,
// deactivateWallet, reactivateWallet) are handled by Cloud Functions, not this frontend service.

import { ethers, Contract, id } from 'ethers';
import { PaymasterService } from '@/features/BlockchainWallet/services/paymasterService';
import { buildRpcUrl, MEMBER_ROLE_MANAGER, NETWORK } from '@belrose/shared';
import { MemberRoleManager__factory } from '@belrose/shared';
import { requireEnv } from '@/utils/utils';

// Contract address
const MEMBER_ROLE_MANAGER_ADDRESS = MEMBER_ROLE_MANAGER.proxy;

// RPC for read-only operations
const RPC_URL = buildRpcUrl(requireEnv('VITE_ALCHEMY_API_KEY'));

// ABI
const MEMBER_ROLE_MANAGER_ABI = MemberRoleManager__factory.abi;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Member status enum - matches MemberRoleManager.sol
 * NotRegistered = 0: Default/uninitialized
 * Inactive = 1: Cannot transact (banned/removed)
 * Active = 2: Default for new members
 * Verified = 3: User has verified their identity and email
 */
export enum MemberStatus {
  NotRegistered = 0,
  Inactive = 1,
  Active = 2,
  Verified = 3,
  VerifiedProvider = 4,
  Guest = 5,
}

export type RoleType = 'owner' | 'administrator' | 'sharer' | 'viewer';

/**
 * Wallet info from the wallets() mapping
 */
export interface WalletInfo {
  userIdHash: string;
  isWalletActive: boolean;
}

/**
 * Combined member info (wallet + identity status)
 */
export interface MemberInfo {
  userIdHash: string;
  isWalletActive: boolean;
  status: MemberStatus;
}

/**
 * Role details - simplified in new contract (no timestamps/grantedBy on-chain)
 */
export interface RoleDetails {
  role: RoleType | '';
  isActive: boolean;
}

export interface RecordRoleStats {
  ownerCount: number;
  adminCount: number;
  sharerCount: number;
  viewerCount: number;
}

export interface TransactionResult {
  txHash: string;
  blockNumber: number;
}

export type TrusteeLevel = 0 | 1 | 2; //Observer = 0, Custodian = 1, Controller = 2
export type TrusteeLevelName = 'Observer' | 'Custodian' | 'Controller';
export type TrusteeStatusName = 'None' | 'Pending' | 'Active' | 'Revoked' | 'Declined';

export interface TrusteeRelationship {
  status: TrusteeStatusName;
  level: TrusteeLevelName;
}

// ============================================================================
// SERVICE
// ============================================================================

export class BlockchainRoleManagerService {
  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Get a read-only contract instance (no wallet needed)
   */
  private static getReadOnlyContract(): Contract {
    const provider = new ethers.JsonRpcProvider(
      RPC_URL,
      {
        name: NETWORK.name,
        chainId: NETWORK.chainId,
      },
      {
        staticNetwork: true,
      }
    );
    return new ethers.Contract(MEMBER_ROLE_MANAGER_ADDRESS, MEMBER_ROLE_MANAGER_ABI, provider);
  }

  /**
   * Encode function call data for a write transaction
   */
  private static encodeFunctionData(functionName: string, args: unknown[]): `0x${string}` {
    const iface = new ethers.Interface(MEMBER_ROLE_MANAGER_ABI);
    return iface.encodeFunctionData(functionName, args) as `0x${string}`;
  }

  /**
   * Execute a write transaction via PaymasterService
   */
  private static async executeWrite(
    functionName: string,
    args: unknown[]
  ): Promise<TransactionResult> {
    const data = this.encodeFunctionData(functionName, args);

    return await PaymasterService.sendTransaction({
      to: MEMBER_ROLE_MANAGER_ADDRESS as `0x${string}`,
      data,
    });
  }

  // ==========================================================================
  // MEMBER REGISTRY - VIEW FUNCTIONS (Read-only, no gas)
  // ==========================================================================

  /**
   * Get raw wallet info from the wallets() mapping
   */
  static async getWalletInfo(walletAddress: string): Promise<WalletInfo | null> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('wallets');
      const result = await fn(walletAddress);

      // If userIdHash is zero, wallet isn't registered
      if (result[0] === ethers.ZeroHash) {
        return null;
      }

      return {
        userIdHash: result[0],
        isWalletActive: result[1],
      };
    } catch (error) {
      console.error('Error getting wallet info:', error);
      return null;
    }
  }

  /**
   * Check if an address is an active member
   * (wallet is active AND identity status is Active or Verified)
   */
  static async isActiveMember(walletAddress: string): Promise<boolean> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('isActiveMember');
      return await fn(walletAddress);
    } catch (error) {
      console.error('Error checking active member status:', error);
      return false;
    }
  }

  /**
   * Check if an address is a verified member
   */
  static async isVerifiedMember(walletAddress: string): Promise<boolean> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('isVerifiedMember');
      return await fn(walletAddress);
    } catch (error) {
      console.error('Error checking verified member status:', error);
      return false;
    }
  }

  /**
   * Get the identity (userIdHash) for a wallet address
   * Returns null/zero hash if wallet not registered
   */
  static async getUserForWallet(walletAddress: string): Promise<string | null> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getUserForWallet');
      const userIdHash = await fn(walletAddress);

      if (userIdHash === ethers.ZeroHash) {
        return null;
      }

      return userIdHash;
    } catch (error) {
      console.error('Error getting user for wallet:', error);
      return null;
    }
  }

  /**
   * Get all wallet addresses linked to an identity
   */
  static async getWalletsForUser(userId: string): Promise<string[]> {
    try {
      const userIdHash = id(userId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getWalletsForUser');
      return await fn(userIdHash);
    } catch (error) {
      console.error('Error getting wallets for user:', error);
      return [];
    }
  }

  /**
   * Get the status of an identity (by userIdHash)
   */
  static async getUserStatus(userIdHash: string): Promise<MemberStatus> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getUserStatus');
      const status = await fn(userIdHash);
      return Number(status) as MemberStatus;
    } catch (error) {
      console.error('Error getting user status:', error);
      return MemberStatus.NotRegistered;
    }
  }

  /**
   * Get combined member info for a wallet (convenience method)
   * Returns null if wallet isn't registered
   */
  static async getMemberInfo(walletAddress: string): Promise<MemberInfo | null> {
    try {
      const walletInfo = await this.getWalletInfo(walletAddress);
      if (!walletInfo) return null;

      const status = await this.getUserStatus(walletInfo.userIdHash);

      return {
        userIdHash: walletInfo.userIdHash,
        isWalletActive: walletInfo.isWalletActive,
        status,
      };
    } catch (error) {
      console.error('Error getting member info:', error);
      return null;
    }
  }

  /**
   * Get total number of registered identities
   */
  static async getTotalUsers(): Promise<number> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getTotalUsers');
      const total = await fn();
      return Number(total);
    } catch (error) {
      console.error('Error getting total users:', error);
      return 0;
    }
  }

  // ==========================================================================
  // ROLE MANAGEMENT - VIEW FUNCTIONS (Read-only, no gas)
  // ==========================================================================

  /**
   * Check if wallet's identity has any active role on a record
   */
  static async hasActiveRole(recordId: string, walletAddress: string): Promise<boolean> {
    try {
      const recordIdHash = id(recordId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('hasActiveRole');
      return await fn(recordIdHash, walletAddress);
    } catch (error) {
      console.error('Error checking active role:', error);
      return false;
    }
  }

  /**
   * Check if wallet's identity has a specific role on a record
   */
  static async hasRole(recordId: string, walletAddress: string, role: RoleType): Promise<boolean> {
    try {
      const recordIdHash = id(recordId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('hasRole');
      return await fn(recordIdHash, walletAddress, role);
    } catch (error) {
      console.error('Error checking role:', error);
      return false;
    }
  }

  /**
   * Check if wallet's identity is owner or administrator of a record
   */
  static async isOwnerOrAdmin(recordId: string, walletAddress: string): Promise<boolean> {
    try {
      const recordIdHash = id(recordId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('isOwnerOrAdmin');
      return await fn(recordIdHash, walletAddress);
    } catch (error) {
      console.error('Error checking owner/admin status:', error);
      return false;
    }
  }

  /**
   * Get role details for a wallet on a record
   */
  static async getRoleDetails(recordId: string, walletAddress: string): Promise<RoleDetails> {
    try {
      const recordIdHash = id(recordId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getRoleDetails');
      const result = await fn(recordIdHash, walletAddress);

      return {
        role: (result[0] as RoleType) || '',
        isActive: result[1],
      };
    } catch (error) {
      console.error('Error getting role details:', error);
      return { role: '', isActive: false };
    }
  }

  /**
   * Get role details by identity hash (instead of wallet)
   */
  static async getRoleDetailsByUser(recordId: string, userIdHash: string): Promise<RoleDetails> {
    try {
      const recordIdHash = id(recordId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getRoleDetailsByUser');
      const result = await fn(recordIdHash, userIdHash);

      return {
        role: (result[0] as RoleType) || '',
        isActive: result[1],
      };
    } catch (error) {
      console.error('Error getting role details by user:', error);
      return { role: '', isActive: false };
    }
  }

  /**
   * Get all owner identity hashes for a record
   * Note: Returns userIdHashes, not wallet addresses
   */
  static async getRecordOwners(recordId: string): Promise<string[]> {
    try {
      const recordIdHash = id(recordId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getAllRecordParticipants');
      const result = await fn(recordIdHash);
      return result.owners;
    } catch (error) {
      console.error('Error getting record owners:', error);
      return [];
    }
  }

  /**
   * Get all administrator identity hashes for a record
   * Note: Returns userIdHashes, not wallet addresses
   */
  static async getRecordAdmins(recordId: string): Promise<string[]> {
    try {
      const recordIdHash = id(recordId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getAllRecordParticipants');
      const result = await fn(recordIdHash);
      return result.admins;
    } catch (error) {
      console.error('Error getting record admins:', error);
      return [];
    }
  }

  /**
   * Get all viewer identity hashes for a record
   * Note: Returns userIdHashes, not wallet addresses
   */
  static async getRecordViewers(recordId: string): Promise<string[]> {
    try {
      const recordIdHash = id(recordId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getAllRecordParticipants');
      const result = await fn(recordIdHash);
      return result.viewers;
    } catch (error) {
      console.error('Error getting record viewers:', error);
      return [];
    }
  }

  /**
   * Get all sharers for a record
   * Note: Returns userIdHashes, not wallet addresses
   */
  static async getRecordSharers(recordId: string): Promise<string[]> {
    try {
      const recordIdHash = id(recordId);
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getAllRecordParticipants');
      const result = await fn(recordIdHash);
      return result.sharers;
    } catch (error) {
      console.error('Error getting record sharers:', error);
      return [];
    }
  }

  /**
   * Get role statistics for a record (owner/admin/viewer counts)
   */
  static async getRecordRoleStats(recordId: string): Promise<RecordRoleStats> {
    try {
      const recordIdHash = id(recordId);

      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getRecordRoleStats');
      const result = await fn(recordIdHash);

      return {
        ownerCount: Number(result[0]),
        adminCount: Number(result[1]),
        sharerCount: Number(result[2]),
        viewerCount: Number(result[3]),
      };
    } catch (error) {
      console.error('Error getting record role stats:', error);
      return { ownerCount: 0, adminCount: 0, sharerCount: 0, viewerCount: 0 };
    }
  }

  /**
   * Get total number of roles across all records
   */
  static async getTotalRoles(): Promise<number> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getTotalRoles');
      const total = await fn();
      return Number(total);
    } catch (error) {
      console.error('Error getting total roles:', error);
      return 0;
    }
  }

  // ==========================================================================
  // ROLE MANAGEMENT - WRITE FUNCTIONS (Via PaymasterService)
  // ==========================================================================

  /**
   * Grant a role to a user for a specific record
   *
   * Requirements (enforced by smart contract):
   * - Caller must be an active member
   * - Caller must have an active role on the record
   * - To grant 'owner': caller must be owner (or admin if no owner exists)
   * - To grant 'administrator' or 'viewer': caller must be owner or admin
   * - Target identity must not already have a role (use changeRole instead)
   */
  static async grantRole(
    recordId: string,
    targetWalletAddress: string,
    role: RoleType
  ): Promise<TransactionResult> {
    console.log('🔗 Granting role on blockchain...', { recordId, targetWalletAddress, role });
    const recordIdHash = id(recordId);
    const result = await this.executeWrite('grantRole', [recordIdHash, targetWalletAddress, role]);
    console.log('✅ Role granted:', result.txHash);
    return result;
  }

  /**
   * Change a user's existing role to a different role
   *
   * Requirements (enforced by smart contract):
   * - Caller must be an active member
   * - Target identity must have an active role
   * - Owners cannot be demoted (must use voluntarilyLeaveOwnership)
   * - To promote to 'owner': caller must be owner (or admin if no owner exists)
   * - To promote to 'administrator': caller must be owner or admin
   * - To demote to 'viewer': caller must be owner, or admin demoting themselves
   */
  static async changeRole(
    recordId: string,
    targetWalletAddress: string,
    newRole: RoleType
  ): Promise<TransactionResult> {
    console.log('🔗 Changing role on blockchain...', {
      recordId,
      targetWalletAddress,
      newRole,
    });
    const recordIdHash = id(recordId);
    const result = await this.executeWrite('changeRole', [
      recordIdHash,
      targetWalletAddress,
      newRole,
    ]);
    console.log('✅ Role changed:', result.txHash);
    return result;
  }

  /**
   * Revoke a user's role entirely
   *
   * Requirements (enforced by smart contract):
   * - Target identity must have an active role
   * - Owners cannot be revoked (must use voluntarilyLeaveOwnership)
   * - Self-revoke is always allowed (for non-owners)
   * - To revoke others: caller must be owner or admin
   * - Admins can only revoke other admins if no owner exists
   * - Cannot revoke last administrator if no owner exists
   */
  static async revokeRole(
    recordId: string,
    targetWalletAddress: string
  ): Promise<TransactionResult> {
    console.log('🔗 Revoking role on blockchain...', { recordId, targetWalletAddress });
    const recordIdHash = id(recordId);
    const result = await this.executeWrite('revokeRole', [recordIdHash, targetWalletAddress]);
    console.log('✅ Role revoked:', result.txHash);
    return result;
  }

  /**
   * Owner voluntarily removes their own ownership, optionally taking on a lesser role
   * instead of losing all access entirely. Must happen atomically in this one call — an
   * owner has no other way to acquire a role for themselves once they've lost the owner
   * role (grantRole requires an active role to call; changeRole refuses to touch an owner).
   *
   * Requirements (enforced by smart contract):
   * - Caller must be an owner of the record
   * - Cannot leave if you're the last owner AND there are no admins
   * - If demoting to viewer, caller cannot be an active subject (subject floor is sharer)
   */
  static async voluntarilyLeaveOwnership(
    recordId: string,
    newRole?: RoleType
  ): Promise<TransactionResult> {
    console.log('🔗 Leaving ownership on blockchain...', { recordId, newRole });
    const recordIdHash = id(recordId);
    const result = await this.executeWrite('voluntarilyLeaveOwnership', [
      recordIdHash,
      newRole ?? '',
    ]);
    console.log('✅ Ownership left:', result.txHash);
    return result;
  }

  // ==========================================================================
  // BATCH ROLE MANAGEMENT - WRITE FUNCTIONS
  // ==========================================================================

  static async grantRoleBatch(
    recordIds: string[],
    targetWalletAddress: string,
    roles: RoleType[]
  ): Promise<TransactionResult> {
    const recordIdHashes = recordIds.map(recordId => id(recordId));

    console.log('🔗 Batch granting roles on blockchain...', {
      recordIds,
      recordIdHashes,
      targetWalletAddress,
      roles,
    });
    const result = await this.executeWrite('grantRoleBatch', [
      recordIdHashes,
      targetWalletAddress,
      roles,
    ]);
    console.log('✅ Batch roles granted:', result.txHash);
    return result;
  }

  static async changeRoleBatch(
    recordIds: string[],
    targetWalletAddress: string,
    newRoles: RoleType[]
  ): Promise<TransactionResult> {
    const recordIdHashes = recordIds.map(recordId => id(recordId));

    console.log('🔗 Batch changing roles on blockchain...', {
      recordIds,
      recordIdHashes,
      targetWalletAddress,
      newRoles,
    });
    const result = await this.executeWrite('changeRoleBatch', [
      recordIdHashes,
      targetWalletAddress,
      newRoles,
    ]);
    console.log('✅ Batch roles changed:', result.txHash);
    return result;
  }

  static async revokeRoleBatch(
    recordIds: string[],
    targetWalletAddress: string
  ): Promise<TransactionResult> {
    const recordIdHashes = recordIds.map(recordId => id(recordId));
    console.log('🔗 Batch revoking roles on blockchain...', {
      recordIds,
      recordIdHashes,
      targetWalletAddress,
    });
    const result = await this.executeWrite('revokeRoleBatch', [
      recordIdHashes,
      targetWalletAddress,
    ]);
    console.log('✅ Batch roles revoked:', result.txHash);
    return result;
  }

  // ==========================================================================
  // TRUSTEE RELATIONSHIPS - WRITE FUNCTIONS
  // ==========================================================================

  /**
   * Trustor proposes a trustee relationship (Step 1)
   * Called by the TRUSTOR — msg.sender must be an active member
   * @param trusteeIdHash Identity hash of the proposed trustee
   * @param level 0=Observer, 1=Custodian, 2=Controller
   */
  static async proposeTrustee(
    trusteeId: string,
    level: TrusteeLevel,
    recordIds: string[]
  ): Promise<TransactionResult> {
    const trusteeIdHash = ethers.id(trusteeId);
    const recordIdHashes = recordIds.map(rid => id(rid));
    console.log('🔗 Proposing trustee on blockchain...', {
      trusteeId,
      level,
      recordCount: recordIds.length,
    });
    const result = await this.executeWrite('proposeTrustee', [
      trusteeIdHash,
      level,
      recordIdHashes,
    ]);
    console.log('✅ Trustee proposed:', result.txHash);
    return result;
  }

  static async declineTrustee(trustorId: string): Promise<TransactionResult> {
    const trustorIdHash = ethers.id(trustorId);
    console.log('🔗 Declining trustee proposal on blockchain...', { trustorId });
    const result = await this.executeWrite('declineTrustee', [trustorIdHash]);
    console.log('✅ Trustee proposal declined:', result.txHash);
    return result;
  }

  /**
   * Trustee accepts a pending proposal (Step 2)
   * Called by the TRUSTEE — msg.sender must be an active member
   */
  static async acceptTrustee(trustorId: string): Promise<TransactionResult> {
    console.log('🔗 Accepting trustee proposal on blockchain...', { trustorId });
    const trustorIdHash = ethers.id(trustorId);
    const result = await this.executeWrite('acceptTrustee', [trustorIdHash]);
    console.log('✅ Trustee accepted:', result.txHash);
    return result;
  }

  /**
   * Revoke a trustee relationship — callable by either party
   */
  static async revokeTrustee(trustorId: string, trusteeId: string): Promise<TransactionResult> {
    console.log('🔗 Revoking trustee on blockchain...', { trustorId, trusteeId });
    const trustorIdHash = ethers.id(trustorId);
    const trusteeIdHash = ethers.id(trusteeId);
    const result = await this.executeWrite('revokeTrustee', [trustorIdHash, trusteeIdHash]);
    console.log('✅ Trustee revoked:', result.txHash);
    return result;
  }

  /**
   * Upgrade a trustee relationship, only callable by Trustor
   */
  static async updateTrusteeLevel(
    trusteeId: string,
    newLevel: TrusteeLevel
  ): Promise<TransactionResult> {
    console.log('🔗 Updating trustee level on blockchain...', { trusteeId, newLevel });
    const trusteeIdHash = ethers.id(trusteeId);
    const result = await this.executeWrite('updateTrusteeLevel', [trusteeIdHash, newLevel]);
    console.log('✅ Trustee level updated:', result.txHash);
    return result;
  }

  /**
   * Trustee self-downgrades their trust level (callable by trustee only)
   */
  static async downgradeTrusteeLevel(
    trustorId: string,
    newLevel: TrusteeLevel
  ): Promise<TransactionResult> {
    console.log('🔗 Downgrading trustee level on blockchain...', { trustorId, newLevel });
    const trustorIdHash = ethers.id(trustorId);
    const result = await this.executeWrite('downgradeTrusteeLevel', [trustorIdHash, newLevel]);
    console.log('✅ Trustee level downgraded:', result.txHash);
    return result;
  }

  // ==========================================================================
  // TRUSTEE RELATIONSHIPS - VIEW FUNCTIONS
  // ==========================================================================

  static async isControllerOf(trustorIdHash: string, trusteeIdHash: string): Promise<boolean> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('isControllerOf');
      return await fn(trustorIdHash, trusteeIdHash);
    } catch (error) {
      console.error('Error checking controller status:', error);
      return false;
    }
  }

  static async getTrusteeRelationship(
    trustorIdHash: string,
    trusteeIdHash: string
  ): Promise<TrusteeRelationship> {
    try {
      const statusMap: Record<number, TrusteeStatusName> = {
        0: 'None',
        1: 'Pending',
        2: 'Active',
        3: 'Revoked',
        4: 'Declined',
      };
      const levelMap: Record<number, TrusteeLevelName> = {
        0: 'Observer',
        1: 'Custodian',
        2: 'Controller',
      };
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getTrusteeRelationship');
      const result = await fn(trustorIdHash, trusteeIdHash);
      return {
        status: statusMap[Number(result[0])] ?? 'None',
        level: levelMap[Number(result[1])] ?? 'Observer',
      };
    } catch (error) {
      console.error('Error getting trustee relationship:', error);
      return { status: 'None', level: 'Observer' };
    }
  }

  // ==========================================================================
  // UTILITY FUNCTIONS
  // ==========================================================================

  /**
   * Get the contract address (useful for debugging/display)
   */
  static getContractAddress(): string {
    return MEMBER_ROLE_MANAGER_ADDRESS;
  }
}
