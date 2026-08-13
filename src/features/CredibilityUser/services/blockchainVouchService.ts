// src/features/CredibilityUser/services/blockchainVouchService.ts
//
// Frontend service for vouch operations on MemberRoleManager.
//
// Read operations: No wallet needed (uses public RPC)
// Write operations: Routes through PaymasterService

import { ethers, Contract, id } from 'ethers';
import {
  PaymasterService,
  TransactionResult,
} from '@/features/BlockchainWallet/services/paymasterService';
import { buildRpcUrl, MEMBER_ROLE_MANAGER, NETWORK } from '@belrose/shared';
import { MemberRoleManager__factory } from '@belrose/shared';
import { requireEnv } from '@/utils/utils';

// ============================================================================
// CONFIG
// ============================================================================

const MEMBER_ROLE_MANAGER_ADDRESS = MEMBER_ROLE_MANAGER.proxy;
const RPC_URL = buildRpcUrl(requireEnv('VITE_ALCHEMY_API_KEY'));
const RPC_URL_FALLBACK = NETWORK.rpcUrlFallback;

// ============================================================================
// ABI
// ============================================================================

const MEMBER_ROLE_MANAGER_ABI = MemberRoleManager__factory.abi;

// ============================================================================
// TYPES
// ============================================================================

export enum VouchStatus {
  None = 0,
  Active = 1,
  Retracted = 2,
}

// ============================================================================
// SERVICE
// ============================================================================

export class blockchainVouchService {
  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private static getReadOnlyContract(): Contract {
    const provider = new ethers.FallbackProvider([
      new ethers.JsonRpcProvider(
        RPC_URL,
        { name: NETWORK.name, chainId: NETWORK.chainId },
        { staticNetwork: true }
      ),
      new ethers.JsonRpcProvider(
        RPC_URL_FALLBACK,
        { name: NETWORK.name, chainId: NETWORK.chainId },
        { staticNetwork: true }
      ),
    ]);
    return new ethers.Contract(MEMBER_ROLE_MANAGER_ADDRESS, MEMBER_ROLE_MANAGER_ABI, provider);
  }

  private static encodeFunctionData(functionName: string, args: unknown[]): `0x${string}` {
    const iface = new ethers.Interface(MEMBER_ROLE_MANAGER_ABI);
    return iface.encodeFunctionData(functionName, args) as `0x${string}`;
  }

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
  // WRITE FUNCTIONS
  // ==========================================================================

  /**
   * Give a vouch to another active member.
   * @param voucheeId - Firebase UID of the user being vouched for (will be hashed)
   */
  static async giveVouch(voucheeId: string): Promise<TransactionResult> {
    console.log('🤝 Giving vouch to:', voucheeId);
    const voucheeIdHash = id(voucheeId);
    const result = await this.executeWrite('giveVouch', [voucheeIdHash]);
    console.log('✅ Vouch given:', result.txHash);
    return result;
  }

  /**
   * Retract a previously given vouch.
   * @param voucheeId - Firebase UID of the user being un-vouched (will be hashed)
   */
  static async retractVouch(voucheeId: string): Promise<TransactionResult> {
    console.log('↩️ Retracting vouch for:', voucheeId);
    const voucheeIdHash = id(voucheeId);
    const result = await this.executeWrite('retractVouch', [voucheeIdHash]);
    console.log('✅ Vouch retracted:', result.txHash);
    return result;
  }

  // ==========================================================================
  // VIEW FUNCTIONS
  // ==========================================================================

  /**
   * Check if a user is currently actively vouching for another user.
   */
  static async hasVouched(voucherId: string, voucheeId: string): Promise<boolean> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('hasVouched');
      return await fn(id(voucherId), id(voucheeId));
    } catch (error) {
      console.error('Error checking hasVouched:', error);
      return false;
    }
  }

  /**
   * Get the full vouch status (None, Active, or Retracted) between two users.
   */
  static async getVouchStatus(voucherId: string, voucheeId: string): Promise<VouchStatus> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getVouchStatus');
      const result = await fn(id(voucherId), id(voucheeId));
      return Number(result) as VouchStatus;
    } catch (error) {
      console.error('Error getting vouch status:', error);
      return VouchStatus.None;
    }
  }

  /**
   * Get all identity hashes a user is currently actively vouching for.
   */
  static async getVouchesGiven(voucherId: string): Promise<string[]> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getVouchesGiven');
      return await fn(id(voucherId));
    } catch (error) {
      console.error('Error getting vouches given:', error);
      return [];
    }
  }

  /**
   * Get all identity hashes currently actively vouching for a user.
   */
  static async getVouchesReceived(voucheeId: string): Promise<string[]> {
    try {
      const contract = this.getReadOnlyContract();
      const fn = contract.getFunction('getVouchesReceived');
      return await fn(id(voucheeId));
    } catch (error) {
      console.error('Error getting vouches received:', error);
      return [];
    }
  }
}
