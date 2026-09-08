// src/features/CredibilityRecord/services/credibilityPreparationService.ts

/**
 * CredibilityPreparationService
 *
 * Handles preparation and prerequisite verification for credibility operations
 * (verify, dispute, react to disputes).
 *
 * This service builds on top of BlockchainPreparationService to add
 * credibility-specific checks.
 *
 * Prerequisites for credibility operations:
 * 1. [Generic] Caller's SmartAccount registered and active on-chain
 * 2. [Credibility-specific] Caller has an active role on the record
 *
 * Note: Unlike permissions, credibility operations do NOT require:
 * - The record to be anchored on-chain (providers can verify unanchored records)
 * - A target user to be registered (verification is about the record, not a person)
 *
 * Post-verification side effects (handled separately):
 * - If record has subjects who haven't anchored, notify them
 *
 */

import { getFirestore, doc, getDoc, collection, setDoc, updateDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { buildHealthRecordRef } from '@belrose/shared';
import { BlockchainPreparationService } from '@/features/BlockchainWallet/services/blockchainPreparationService';
import {
  BlockchainSyncQueueService,
  getUserFacingErrorMessage,
} from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { blockchainHealthRecordService } from './blockchainHealthRecordService';
import { PermissionPreparationService } from '@/features/Permissions/services/permissionPreparationService';
import { BlockchainRoleManagerService } from '@/features/Permissions/services/blockchainRoleManagerService';
import {
  buildRecordHashHistoryDocId,
  prepareRecordHashHistoryEventData,
} from '@/features/ViewEditRecord/services/writeRecordHashHistoryEvent';

// ==================== TYPES ====================

export type CredibilityOperationType =
  | 'verify'
  | 'dispute'
  | 'modifyVerification'
  | 'modifyDispute'
  | 'retractVerification'
  | 'retractDispute'
  | 'reactToDispute';

export interface CredibilityPrerequisites {
  ready: boolean;
  reason?: string;
  callerSmartAccountAddress?: string;
  checks?: {
    callerReady: boolean;
    hasRecordRole: boolean;
  };
  recordInfo?: {
    hasSubjects: boolean;
    subjectCount: number;
    isAnchored: boolean;
  };
}

export interface CredibilityPreparationStatus {
  isReady: boolean;
  smartAccountAddress: string;
  isSmartAccountRegistered: boolean;
  hasRecordRole: boolean;
  callerRole?: 'owner' | 'administrator' | 'viewer' | 'sharer';
}

export interface CredibilityPreparationProgress {
  step:
    | 'computing'
    | 'saving'
    | 'registering'
    | 'initializing_record'
    | 'ensuring_hash'
    | 'complete';
  message: string;
}

export type CredibilityProgressCallback = (progress: CredibilityPreparationProgress) => void;

// ==================== SERVICE ====================

export class CredibilityPreparationService {
  // ============================================================================
  // VERIFICATION METHODS (Read-only checks before operations)
  // ============================================================================

  /**
   * Verify all prerequisites are met before a credibility operation.
   *
   * Use this before verify/dispute/react operations to fail fast.
   *
   * Checks:
   * 1. Caller's SmartAccount is registered and active
   * 2. Caller has an active role on the record (any role counts)
   *
   * @param recordId - The record being verified/disputed
   */
  static async verifyPrerequisites(recordId: string): Promise<CredibilityPrerequisites> {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
      return {
        ready: false,
        reason: 'Please sign in to continue.',
        checks: {
          callerReady: false,
          hasRecordRole: false,
        },
      };
    }

    try {
      // Step 1: Check caller's blockchain readiness
      const callerStatus = await BlockchainPreparationService.getStatus();

      if (!callerStatus.ready) {
        return {
          ready: false,
          reason:
            'Your network account needs to be set up before you can verify records. This is a one-time setup.',
          callerSmartAccountAddress: callerStatus.smartAccountAddress || undefined,
          checks: {
            callerReady: false,
            hasRecordRole: false,
          },
        };
      }

      // Step 2: Check if caller has a role on the record
      const roleCheck = await this.checkCallerRecordRole(recordId, user.uid);

      if (!roleCheck.hasRole) {
        return {
          ready: false,
          reason:
            'You do not have access to this record. Only participants (owners, administrators, viewers, or subjects) can verify records.',
          callerSmartAccountAddress: callerStatus.smartAccountAddress || undefined,
          checks: {
            callerReady: true,
            hasRecordRole: false,
          },
          recordInfo: roleCheck.recordInfo,
        };
      }

      // All checks passed
      return {
        ready: true,
        callerSmartAccountAddress: callerStatus.smartAccountAddress || undefined,
        checks: {
          callerReady: true,
          hasRecordRole: true,
        },
        recordInfo: roleCheck.recordInfo,
      };
    } catch (error) {
      console.error('❌ CredibilityPreparationService: Error verifying prerequisites:', error);
      return {
        ready: false,
        reason: `Failed to verify prerequisites: ${(error as Error).message}`,
      };
    }
  }

  // ============================================================================
  // STATUS & PREPARATION METHODS
  // ============================================================================

  /**
   * Get detailed preparation status for credibility operations.
   *
   * @param recordId - The record to check
   */
  static async getStatus(recordId: string): Promise<CredibilityPreparationStatus> {
    const auth = getAuth();
    const user = auth.currentUser;

    // Get blockchain readiness
    const blockchainStatus = await BlockchainPreparationService.getStatus();

    // Get role info
    let hasRecordRole = false;
    let callerRole: CredibilityPreparationStatus['callerRole'];

    if (user) {
      const roleCheck = await this.checkCallerRecordRole(recordId, user.uid);
      hasRecordRole = roleCheck.hasRole;
      callerRole = roleCheck.role;
    }

    return {
      smartAccountAddress: blockchainStatus.smartAccountAddress || '',
      isSmartAccountRegistered: blockchainStatus.checks.isRegisteredOnChain,
      hasRecordRole,
      callerRole,
      isReady: blockchainStatus.ready && hasRecordRole,
    };
  }

  /**
   * Prepare for credibility operations.
   *
   * This ensures the caller's smart account is set up and registered.
   * Also initializes the record on-chain if needed and ensures the record hash exists.
   *
   * @param recordId - record ID the hash will be associated with
   * @param recordHash - The record hash to ensure exists on-chain
   * @param onProgress - Optional callback for progress updates
   * @returns The caller's smart account address
   */
  static async prepare(
    recordId: string,
    recordHash: string,
    onProgress?: CredibilityProgressCallback
  ): Promise<string> {
    console.log('🔄 CredibilityPreparationService: Starting preparation...');

    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) throw new Error('User not authenticated');

    // Step 1: Ensure wallet is ready
    const address = await BlockchainPreparationService.ensureReady(progress => {
      onProgress?.(progress as CredibilityPreparationProgress);
    });

    console.log('✅ CredibilityPreparationService: Ready with address:', address);

    // Step 2: Check if record role needs initialization

    const roleStats = await BlockchainRoleManagerService.getRecordRoleStats(recordId);
    const isRecordInitialized = roleStats.ownerCount > 0 || roleStats.adminCount > 0;

    if (!isRecordInitialized) {
      onProgress?.({ step: 'initializing_record', message: 'Initializing record...' });

      //Get user's Firestore role to determine initialization role
      const roleCheck = await this.checkCallerRecordRole(recordId, user.uid);

      if (!roleCheck.hasRole) {
        throw new Error('You do not have access to this record');
      }

      const initialRole: 'owner' | 'administrator' =
        roleCheck.role === 'owner' ? 'owner' : 'administrator';

      await PermissionPreparationService.initializeRecordRole(recordId, address, initialRole);
      console.log(`✅ Record initialized with role: ${initialRole}`);
    }

    // Step 3: Ensure record hash exists on blockchain
    try {
      onProgress?.({ step: 'ensuring_hash', message: 'Verifying record fingerprint...' });

      const isHashOnChain = await blockchainHealthRecordService.doesHashExist(recordHash);

      if (!isHashOnChain) {
        // recordHashHistory doc first (blockchainRef: null), same pattern as subjectHistory —
        // patched via follow-up updateDoc once the chain call resolves.
        const db = getFirestore();
        const historyRef = doc(
          collection(db, 'records', recordId, 'recordHashHistory'),
          buildRecordHashHistoryDocId(recordHash)
        );
        await setDoc(
          historyRef,
          prepareRecordHashHistoryEventData(recordId, recordHash, user.uid, 'credibility')
        );

        const syncRef = await BlockchainSyncQueueService.startAttempt({
          contract: 'HealthRecordCore',
          action: 'addRecordHash',
          userId: user.uid,
          userWalletAddress: address,
          permissionHistoryPath: historyRef.path,
          context: { type: 'addRecordHash', recordId, recordHash },
        });

        try {
          const tx = await blockchainHealthRecordService.addRecordHash(recordId, recordHash);
          await updateDoc(historyRef, {
            blockchainRef: buildHealthRecordRef(tx.txHash, tx.blockNumber),
          });
          await BlockchainSyncQueueService.recordSuccess(syncRef, tx);
          console.log('✅ Record hash added to network');
        } catch (error) {
          await BlockchainSyncQueueService.recordFailure(
            syncRef,
            getUserFacingErrorMessage(error, 'Failed to anchor record hash')
          );
          throw error;
        }
      } else {
        console.log('✅ Record hash already exists on network');
      }

      onProgress?.({ step: 'complete', message: 'Preparation complete' });

      return address;
    } catch (error) {
      console.error('❌ Failed to prepare record hash:', error);
      throw new Error(`Failed to prepare network: ${(error as Error).message}`);
    }
  }

  // ============================================================================
  // RECORD INFO HELPERS
  // ============================================================================

  /**
   * Get information about a record's subjects and anchoring status.
   *
   * Useful for determining if post-verification notifications are needed.
   *
   * @param recordId - The record to check
   */
  static async getRecordSubjectInfo(recordId: string): Promise<{
    subjects: string[];
    hasSubjects: boolean;
    // Note: isAnchored would require a blockchain call to check
    // For now, we just return subject info from Firestore
  }> {
    const db = getFirestore();
    const recordRef = doc(db, 'records', recordId);
    const recordSnap = await getDoc(recordRef);

    if (!recordSnap.exists()) {
      return {
        subjects: [],
        hasSubjects: false,
      };
    }

    const data = recordSnap.data();
    const subjects: string[] = data.subjects || [];

    return {
      subjects,
      hasSubjects: subjects.length > 0,
    };
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Check if a user has any role on a record.
   *
   * Roles checked: owner, administrator, viewer, subject, sharer
   */
  private static async checkCallerRecordRole(
    recordId: string,
    userId: string
  ): Promise<{
    hasRole: boolean;
    role?: 'owner' | 'administrator' | 'viewer' | 'sharer';
    recordInfo?: {
      hasSubjects: boolean;
      subjectCount: number;
      isAnchored: boolean;
    };
  }> {
    const db = getFirestore();
    const recordRef = doc(db, 'records', recordId);
    const recordSnap = await getDoc(recordRef);

    if (!recordSnap.exists()) {
      return { hasRole: false };
    }

    const data = recordSnap.data();

    // Check each role type
    const owners: string[] = data.owners || [];
    const administrators: string[] = data.administrators || [];
    const viewers: string[] = data.viewers || [];
    const subjects: string[] = data.subjects || [];
    const sharers: string[] = data.sharers || [];

    // Also check uploadedBy as implicit owner
    const isUploader = data.uploadedBy === userId;

    let role: 'owner' | 'administrator' | 'viewer' | 'sharer' | undefined;

    if (isUploader || owners.includes(userId)) {
      role = 'owner';
    } else if (administrators.includes(userId)) {
      role = 'administrator';
    } else if (viewers.includes(userId)) {
      role = 'viewer';
    } else if (sharers.includes(userId)) {
      role = 'sharer';
    }

    const recordInfo = {
      hasSubjects: subjects.length > 0,
      subjectCount: subjects.length,
      isAnchored: false, // Would need blockchain call to determine
    };

    return {
      hasRole: role !== undefined,
      role,
      recordInfo,
    };
  }
}
