// src/features/Trustee/services/trusteeBlockchainService.ts

import { id } from 'ethers';
import {
  BlockchainRoleManagerService,
  TrusteeLevel,
} from '@/features/Permissions/services/blockchainRoleManagerService';
import {
  BlockchainSyncQueueService,
  decodeRevertReason,
  SyncContext,
} from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { WalletService } from '@/features/BlockchainWallet/services/walletService';
import { BlockchainRef, buildMemberRegistryRef } from '@belrose/shared';

interface TrusteeResult {
  success: boolean;
  blockchainRef: BlockchainRef | null;
}

type TrusteeAction =
  | 'proposeTrustee'
  | 'acceptTrustee'
  | 'revokeTrustee'
  | 'declineTrustee'
  | 'updateTrusteeLevel'
  | 'downgradeTrusteeLevel';

export class TrusteeBlockchainService {
  // ==========================================================================
  // TRUSTEE FUNCTIONS
  // ==========================================================================

  /**
   * Trustor proposes a trustee relationship on-chain and grants record roles in one tx (Step 1)
   * msg.sender = trustor's wallet via PaymasterService
   */
  static async proposeTrustee(
    trustorId: string,
    trusteeId: string,
    level: TrusteeLevel,
    recordIds: string[]
  ): Promise<TrusteeResult> {
    const walletAddress = await WalletService.requireUserWalletAddress(trustorId);

    try {
      console.log('⛓️ Proposing trustee on blockchain...', { trustorId, trusteeId, level, recordCount: recordIds.length });

      const result = await BlockchainRoleManagerService.proposeTrustee(trusteeId, level, recordIds);
      const blockchainRef = buildMemberRegistryRef(result.txHash, result.blockNumber);
      console.log('✅ Trustee proposed on blockchain');
      return { success: true, blockchainRef };
    } catch (error) {
      await this.logTrusteeFailure({
        action: 'proposeTrustee',
        trustorId,
        trusteeId,
        callerId: trustorId,
        walletAddress,
        error,
      });
      return { success: false, blockchainRef: null };
    }
  }

  /**
   * Trustee accepts a pending proposal on-chain (Step 2)
   * msg.sender = trustee's wallet via PaymasterService
   */
  static async acceptTrustee(trustorId: string, trusteeId: string): Promise<TrusteeResult> {
    const walletAddress = await WalletService.requireUserWalletAddress(trusteeId);

    try {
      console.log('⛓️ Accepting trustee proposal on blockchain...', { trustorId, trusteeId });
      const result = await BlockchainRoleManagerService.acceptTrustee(trustorId);
      const blockchainRef = buildMemberRegistryRef(result.txHash, result.blockNumber);
      console.log('✅ Trustee accepted on blockchain');
      return { success: true, blockchainRef };
    } catch (error) {
      // "No pending proposal" covers several different on-chain states, only one of which is a
      // match for what we're trying to reach — a prior accept call that landed on-chain but
      // never made it into Firestore (same drift class as revokeTrustee's self-heal). If chain
      // status is Active, that's it — treat as already-accepted. Anything else (revoked/
      // declined/none) is a genuine failure — the invite is really gone — so it still throws.
      const reason = error instanceof Error ? decodeRevertReason(error.message) : null;
      if (reason === 'No pending proposal') {
        const onChainState = await BlockchainRoleManagerService.getTrusteeRelationship(
          id(trustorId),
          id(trusteeId)
        );
        if (onChainState.status === 'Active') {
          console.log(
            'ℹ️ Trustee relationship already active on-chain — treating as already accepted'
          );
          return { success: true, blockchainRef: null };
        }
      }

      await this.logTrusteeFailure({
        action: 'acceptTrustee',
        trustorId,
        trusteeId,
        callerId: trusteeId,
        walletAddress,
        error,
      });
      return { success: false, blockchainRef: null };
    }
  }

  /**
   * Trustee declines a pending proposal on-chain
   * msg.sender = trustee's wallet
   */
  static async declineTrustee(trustorId: string, trusteeId: string): Promise<TrusteeResult> {
    const walletAddress = await WalletService.requireUserWalletAddress(trusteeId);

    try {
      console.log('⛓️ Declining trustee proposal on blockchain...', { trustorId, trusteeId });
      const result = await BlockchainRoleManagerService.declineTrustee(trustorId);
      const blockchainRef = buildMemberRegistryRef(result.txHash, result.blockNumber);
      console.log('✅ Trustee proposal declined on blockchain');
      return { success: true, blockchainRef };
    } catch (error) {
      await this.logTrusteeFailure({
        action: 'declineTrustee',
        trustorId,
        trusteeId,
        callerId: trusteeId,
        walletAddress,
        error,
      });
      return { success: false, blockchainRef: null };
    }
  }

  /**
   * Revoke a trustee relationship on-chain
   * Callable by either party — callerId determines whose wallet signs
   */
  static async revokeTrustee(
    trustorId: string,
    trusteeId: string,
    callerId: string
  ): Promise<TrusteeResult> {
    const walletAddress = await WalletService.requireUserWalletAddress(callerId);

    try {
      console.log('⛓️ Revoking trustee on blockchain...', { trustorId, trusteeId });
      const result = await BlockchainRoleManagerService.revokeTrustee(trustorId, trusteeId);
      const blockchainRef = buildMemberRegistryRef(result.txHash, result.blockNumber);
      console.log('✅ Trustee revoked on blockchain');
      return { success: true, blockchainRef };
    } catch (error) {
      // The relationship can already be Revoked on-chain from an earlier attempt that got the
      // transaction through but died before the Firestore write landed — that's the end state
      // we're trying to reach anyway, so treat it as already-done rather than a failure to
      // retry forever. blockchainRef is null since no new transaction happened here.
      const reason = error instanceof Error ? decodeRevertReason(error.message) : null;
      if (reason === 'No active or pending relationship') {
        console.log('ℹ️ Trustee relationship already inactive on-chain — treating as already revoked');
        return { success: true, blockchainRef: null };
      }

      await this.logTrusteeFailure({
        action: 'revokeTrustee',
        trustorId,
        trusteeId,
        callerId,
        walletAddress,
        error,
      });
      return { success: false, blockchainRef: null };
    }
  }

  /**
   * Trustee self-downgrades their trust level on-chain
   * msg.sender = trustee's wallet
   */
  static async downgradeTrusteeLevel(
    trustorId: string,
    trusteeId: string,
    newLevel: TrusteeLevel
  ): Promise<TrusteeResult> {
    const walletAddress = await WalletService.requireUserWalletAddress(trusteeId);

    try {
      console.log('⛓️ Downgrading trustee level on blockchain...', {
        trustorId,
        trusteeId,
        newLevel,
      });
      const result = await BlockchainRoleManagerService.downgradeTrusteeLevel(trustorId, newLevel);
      const blockchainRef = buildMemberRegistryRef(result.txHash, result.blockNumber);
      console.log('✅ Trustee level downgraded on blockchain');
      return { success: true, blockchainRef };
    } catch (error) {
      await this.logTrusteeFailure({
        action: 'downgradeTrusteeLevel',
        trustorId,
        trusteeId,
        callerId: trusteeId,
        walletAddress,
        error,
      });
      return { success: false, blockchainRef: null };
    }
  }

  static async updateTrusteeLevel(
    trustorId: string,
    trusteeId: string,
    newLevel: TrusteeLevel
  ): Promise<TrusteeResult> {
    const walletAddress = await WalletService.requireUserWalletAddress(trustorId);

    try {
      console.log('⛓️ Updating trustee level on blockchain...', { trustorId, trusteeId, newLevel });
      const result = await BlockchainRoleManagerService.updateTrusteeLevel(trusteeId, newLevel);
      const blockchainRef = buildMemberRegistryRef(result.txHash, result.blockNumber);
      console.log('✅ Trustee level updated on blockchain');
      return { success: true, blockchainRef };
    } catch (error) {
      // "Already this trust level" is unambiguous — it only fires when the chain's level
      // already equals newLevel exactly, unlike acceptTrustee's "No pending proposal" (which
      // covers several different states). A prior updateTrusteeLevel call can land on-chain but
      // never make it into Firestore (same drift class as revokeTrustee's self-heal) — treat
      // this as already-achieved rather than a failure to retry forever.
      const reason = error instanceof Error ? decodeRevertReason(error.message) : null;
      if (reason === 'Already this trust level') {
        console.log('ℹ️ Trustee already at this level on-chain — treating as already updated');
        return { success: true, blockchainRef: null };
      }

      await this.logTrusteeFailure({
        action: 'updateTrusteeLevel',
        trustorId,
        trusteeId,
        callerId: trustorId,
        walletAddress,
        error,
      });
      return { success: false, blockchainRef: null };
    }
  }

  // ==========================================================================
  // ERROR LOGGING
  // ==========================================================================

  private static async logTrusteeFailure(params: {
    action: TrusteeAction;
    trustorId: string;
    trusteeId: string;
    callerId: string;
    walletAddress: string;
    error: unknown;
  }) {
    const { action, trustorId, trusteeId, callerId, walletAddress, error } = params;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(`⚠️ Blockchain ${action} failed:`, error);

    const typeMap = {
      proposeTrustee: 'trustee-propose',
      acceptTrustee: 'trustee-accept',
      revokeTrustee: 'trustee-revoke',
      declineTrustee: 'trustee-decline',
      downgradeTrusteeLevel: 'trustee-level-update',
      updateTrusteeLevel: 'trustee-level-update',
    } as const;

    const context = {
      type: typeMap[action],
      trustorId,
      trustorIdHash: id(trustorId),
      trusteeId,
      trusteeIdHash: id(trusteeId),
    } as SyncContext;

    await BlockchainSyncQueueService.logFailure({
      contract: 'MemberRoleManager',
      action,
      userId: callerId,
      userWalletAddress: walletAddress,
      error: errorMessage,
      context,
    });
  }
}
