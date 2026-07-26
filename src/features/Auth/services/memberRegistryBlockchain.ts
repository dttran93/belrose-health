// src/features/Auth/services/memberRegistryBlockchain.ts
// Frontend service for member registry blockchain operations.
// Calls backend Cloud Functions which use the admin wallet to write to blockchain.

import { BlockchainRef } from '@belrose/shared';
import { getFunctions, httpsCallable } from 'firebase/functions';

// ==================== TYPES ====================
/**
 * Maps to the MemberStatus enum in the smart contract
 * Note: Order matters! Must match contract exactly.
 */
export enum MemberStatus {
  NotRegistered = 0,
  Inactive = 1,
  Active = 2,
  Verified = 3,
  VerifiedProvider = 4,
}

interface RegisterMemberResult {
  success: boolean;
  blockchainRef?: BlockchainRef;
  message?: string;
}

interface UpdateUserStatusResult {
  success: boolean;
  blockchainRef?: BlockchainRef;
}

interface WalletStatusResult {
  success: boolean;
  blockchainRef?: BlockchainRef;
}

interface RegisterMemberCompleteResult {
  success: boolean;
  walletAddress: string;
  smartAccountAddress: string;
  encryptedPrivateKey: string;
  encryptedPrivateKeyIV: string;
  authTag: string;
  blockchainRef: BlockchainRef;
}

// ==================== SERVICE ====================

/**
 * MemberRegistryBlockchain - Frontend service for blockchain member operations
 *
 * Key concepts from the smart contract:
 * - Members are identified by userIdHash (keccak256 of Firebase UID)
 * - Each identity can have multiple wallets (EOA, Smart Account, etc.)
 * - Status is set at the IDENTITY level, not wallet level
 * - Individual wallets can be activated/deactivated independently
 */
export class MemberRegistryBlockchain {
  // ==================== MEMBER REGISTRATION ====================

  /**
   * Full registration flow — generates EOA + smart account, registers both
   * on-chain in a single transaction, saves to Firestore.
   * Called during initial account registrations.
   * @param masterKeyHex - Master encryption key in hex format (used server-side to encrypt wallet)
   */
  static async registerMemberOnChainComplete(
    masterKeyHex: string
  ): Promise<RegisterMemberCompleteResult> {
    console.log('🔗 Registering member with wallet generation...');

    try {
      const functions = getFunctions();
      const registerFn = httpsCallable<{ masterKeyHex: string }, RegisterMemberCompleteResult>(
        functions,
        'registerMemberOnChainComplete'
      );

      const result = await registerFn({ masterKeyHex });

      console.log('✅ Member registered with wallets:', result.data.walletAddress);
      return result.data;
    } catch (error: any) {
      console.error('❌ Full registration failed:', error);

      if (error.code === 'already-exists' || error.code === 'functions/already-exists') {
        console.log('ℹ️ Member already registered');
        throw new Error('Member already registered');
      }

      throw new Error(error.message || 'Failed to complete registration on blockchain');
    }
  }

  /**
   * Register an individual wallet on the blockchain
   * - If first wallet for user: creates identity + links wallet
   * - If user exists: links additional wallet to existing identity
   * - Probably won't be used much? For special situations since registerMemberOnChainComplete
   * covers registration.
   * - Use case would be adding another EOA wallet or something instead
   * @param walletAddress - Wallet address (EOA or Smart Account)
   */
  static async registerMemberWallet(walletAddress: string): Promise<RegisterMemberResult> {
    console.log('🔗 Registering wallet on blockchain...', walletAddress);

    try {
      const functions = getFunctions();
      const registerFn = httpsCallable<{ walletAddress: string }, RegisterMemberResult>(
        functions,
        'registerMemberOnChain'
      );

      const result = await registerFn({ walletAddress });

      console.log('✅ Wallet registered:', result.data);
      return result.data;
    } catch (error: any) {
      console.error('❌ Wallet registration failed:', error);

      if (
        error.code === 'already-exists' ||
        error.code === 'functions/already-exists' ||
        error.message?.includes('already registered')
      ) {
        console.log('ℹ️ Wallet already registered on blockchain');
        return { success: true, message: 'Already registered' };
      }

      throw new Error(error.message || 'Failed to register on blockchain');
    }
  }

  // ==================== USER STATUS (IDENTITY LEVEL) ====================

  /**
   * Update a user's status on the blockchain
   * This affects ALL wallets linked to this identity
   *
   * @param userId - Firebase user ID (backend hashes it)
   * @param status - New status (Inactive, Active, Verified)
   */
  static async setUserStatus(
    userId: string,
    status: MemberStatus
  ): Promise<UpdateUserStatusResult> {
    console.log('🔗 Updating user status on blockchain...', { status: MemberStatus[status] });

    try {
      const functions = getFunctions();
      const updateFn = httpsCallable<{ userId: string; status: number }, UpdateUserStatusResult>(
        functions,
        'updateMemberStatus'
      );

      const result = await updateFn({ userId, status });

      console.log('✅ User status updated:', result.data);
      return result.data;
    } catch (error: any) {
      console.error('❌ Status update failed:', error);
      throw new Error(error.message || 'Failed to update status on blockchain');
    }
  }

  /**
   * Mark user as verified after identity verification
   */
  static async markUserAsVerified(userId: string): Promise<UpdateUserStatusResult> {
    return this.setUserStatus(userId, MemberStatus.Verified);
  }

  /**
   * Deactivate a user - prevents ALL their wallets from transacting
   */
  static async deactivateUser(userId: string): Promise<UpdateUserStatusResult> {
    return this.setUserStatus(userId, MemberStatus.Inactive);
  }

  /**
   * Reactivate a user
   */
  static async reactivateUser(userId: string): Promise<UpdateUserStatusResult> {
    return this.setUserStatus(userId, MemberStatus.Active);
  }

  // ==================== WALLET STATUS (INDIVIDUAL WALLET) ====================

  /**
   * Deactivate a specific wallet
   * The identity remains active, but this wallet cannot transact
   */
  static async deactivateWallet(walletAddress: string): Promise<WalletStatusResult> {
    console.log('🔗 Deactivating wallet on blockchain...');

    try {
      const functions = getFunctions();
      const deactivateFn = httpsCallable<{ walletAddress: string }, WalletStatusResult>(
        functions,
        'deactivateWalletOnChain'
      );

      const result = await deactivateFn({ walletAddress });

      console.log('✅ Wallet deactivated:', result.data.blockchainRef);
      return result.data;
    } catch (error: any) {
      console.error('❌ Wallet deactivation failed:', error);
      throw new Error(error.message || 'Failed to deactivate wallet on blockchain');
    }
  }

  /**
   * Reactivate a specific wallet
   */
  static async reactivateWallet(walletAddress: string): Promise<WalletStatusResult> {
    console.log('🔗 Reactivating wallet on blockchain...');

    try {
      const functions = getFunctions();
      const reactivateFn = httpsCallable<{ walletAddress: string }, WalletStatusResult>(
        functions,
        'reactivateWalletOnChain'
      );

      const result = await reactivateFn({ walletAddress });

      console.log('✅ Wallet reactivated:', result.data.blockchainRef);
      return result.data;
    } catch (error: any) {
      console.error('❌ Wallet reactivation failed:', error);
      throw new Error(error.message || 'Failed to reactivate wallet on blockchain');
    }
  }
}
