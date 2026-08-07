// src/features/Permissions/services/permissionPreparationService.ts

/**
 * PermissionPreparationService
 *
 * Handles preparation and prerequisite verification for permission operations.
 * This service builds on top of BlockchainPreparationService to add
 * permission-specific checks.
 *
 * Prerequisites for permission operations:
 * 1. [Generic] Caller's SmartAccount registered and active on-chain
 * 2. [Permission-specific] Target's wallet registered and linked to active identity
 * 3. [Permission-specific] Record initialized on-chain (has at least one owner or admin)
 *
 * Usage:
 *   // Before granting a role to someone
 *   const prereqs = await PermissionPreparationService.verifyPrerequisites(recordId, targetWallet);
 *   if (!prereqs.ready) { ... show error: prereqs.reason ... }
 *
 *   // First-time setup for a record
 *   await PermissionPreparationService.prepare(recordId, 'owner');
 */

import { createPublicClient, http } from 'viem';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { BlockchainPreparationService } from '@/features/BlockchainWallet/services/blockchainPreparationService';
import { getAuth } from 'firebase/auth';
import { collection, doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';
import { BlockchainRef } from '@belrose/shared';
import { BlockchainRoleManagerService } from './blockchainRoleManagerService';
import { NETWORK } from '@belrose/shared';
import {
  buildPermissionHistoryDocId,
  preparePermissionChangeEventData,
} from './writePermissionChangeEvent';

// ==================== TYPES ====================

export interface PermissionPrerequisites {
  /** Whether all prerequisites are met */
  ready: boolean;

  /** Human-readable reason if not ready */
  reason?: string;

  /** Caller's smart account address (if available) */
  callerSmartAccountAddress?: string;

  /** Detailed check results */
  checks?: {
    callerReady: boolean;
    targetReady: boolean;
    recordInitialized: boolean;
  };
}

export interface PermissionPreparationStatus {
  /** Whether everything is ready for permission operations */
  isReady: boolean;

  /** Caller's smart account address */
  smartAccountAddress: string;

  /** Whether caller's smart account is registered on-chain */
  isSmartAccountRegistered: boolean;

  /** Whether record has been initialized on-chain */
  isRecordInitialized: boolean;

  /** Current role counts for the record */
  roleStats: {
    ownerCount: number;
    adminCount: number;
    sharerCount: number;
    viewerCount: number;
  };
}

export type InitialRole = 'administrator' | 'owner';

export interface InitializeRecordResult {
  success: boolean;
  blockchainRef?: BlockchainRef;
  role: InitialRole;
}

export interface PermissionPreparationProgress {
  step: 'computing' | 'saving' | 'registering' | 'initializing_record' | 'complete';
  message: string;
}

export type PermissionProgressCallback = (progress: PermissionPreparationProgress) => void;

// ==================== SERVICE ====================

export class PermissionPreparationService {
  private static publicClient = createPublicClient({
    chain: NETWORK.chainViem,
    transport: http(),
  });

  // ============================================================================
  // VERIFICATION METHODS (Read-only checks before operations)
  // ============================================================================

  /**
   * Verify all prerequisites are met before a permission operation.
   *
   * Use this before granting/revoking roles to fail fast with a clear message.
   *
   * Checks:
   * 1. Caller's SmartAccount is registered and active
   * 2. Target's wallet is registered and active (for role assignment)
   * 3. Record is initialized on-chain
   *
   * @param recordId - The record being modified
   * @param targetWallet - The target user's wallet address
   */
  static async verifyPrerequisites(
    recordId: string,
    targetWallet: string
  ): Promise<PermissionPrerequisites> {
    try {
      // Step 1: Check caller readiness using generic service
      const callerStatus = await BlockchainPreparationService.getStatus();

      if (!callerStatus.ready) {
        return {
          ready: false,
          reason: 'Your network account is not fully set up. Please complete the preparation step.',
          callerSmartAccountAddress: callerStatus.smartAccountAddress || undefined,
          checks: {
            callerReady: false,
            targetReady: false,
            recordInitialized: false,
          },
        };
      }

      // Step 2: Check target wallet and record
      const [isTargetActive, roleStats] = await Promise.all([
        BlockchainPreparationService.isActiveMember(targetWallet),
        BlockchainRoleManagerService.getRecordRoleStats(recordId),
      ]);

      // Step 3: Validate target
      if (!isTargetActive) {
        return {
          ready: false,
          reason:
            'The target user has not completed their network setup. They must set up their network account before receiving permissions.',
          callerSmartAccountAddress: callerStatus.smartAccountAddress || undefined,
          checks: {
            callerReady: true,
            targetReady: false,
            recordInitialized: roleStats.ownerCount > 0 || roleStats.adminCount > 0,
          },
        };
      }

      // Step 4: Validate record initialization
      const isRecordInitialized = roleStats.ownerCount > 0 || roleStats.adminCount > 0;
      if (!isRecordInitialized) {
        return {
          ready: false,
          reason:
            'This record has not been initialized on the network. Please run preparation first.',
          callerSmartAccountAddress: callerStatus.smartAccountAddress || undefined,
          checks: {
            callerReady: true,
            targetReady: true,
            recordInitialized: false,
          },
        };
      }

      // All checks passed
      return {
        ready: true,
        callerSmartAccountAddress: callerStatus.smartAccountAddress || undefined,
        checks: {
          callerReady: true,
          targetReady: true,
          recordInitialized: true,
        },
      };
    } catch (error) {
      console.error('❌ PermissionPreparationService: Error verifying prerequisites:', error);
      return {
        ready: false,
        reason: `Failed to verify network prerequisites: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Simplified verification for self-only operations.
   *
   * Use this for operations where the caller is the only participant
   * (e.g., voluntarilyLeaveOwnership, revoking own role).
   *
   * @param recordId - The record being modified
   */
  static async verifyCallerPrerequisites(recordId: string): Promise<PermissionPrerequisites> {
    try {
      // Check caller readiness
      const callerStatus = await BlockchainPreparationService.getStatus();

      if (!callerStatus.ready) {
        return {
          ready: false,
          reason: 'Your network account is not fully set up.',
          callerSmartAccountAddress: callerStatus.smartAccountAddress || undefined,
        };
      }

      // Check record initialization
      const roleStats = await BlockchainRoleManagerService.getRecordRoleStats(recordId);
      const isRecordInitialized = roleStats.ownerCount > 0 || roleStats.adminCount > 0;

      if (!isRecordInitialized) {
        return {
          ready: false,
          reason: 'This record has not been initialized on the network.',
          callerSmartAccountAddress: callerStatus.smartAccountAddress || undefined,
        };
      }

      return {
        ready: true,
        callerSmartAccountAddress: callerStatus.smartAccountAddress || undefined,
      };
    } catch (error) {
      console.error(
        '❌ PermissionPreparationService: Error verifying caller prerequisites:',
        error
      );
      return {
        ready: false,
        reason: `Failed to verify network prerequisites: ${(error as Error).message}`,
      };
    }
  }

  // ============================================================================
  // ADD this method to PermissionPreparationService in permissionPreparationService.ts
  //
  // prepareBatch handles the same smart-account + record-initialization flow
  // as prepare(), but for multiple records. Smart account setup runs once
  // (BlockchainPreparationService.ensureReady is idempotent). Record
  // initialization runs sequentially per record to avoid race conditions.
  // Per-record initialRole is checked against Firestore so owners are
  // initialized as 'owner' and admins as 'administrator', matching
  // usePermissionFlow.getCurrentUserRole.
  // ============================================================================

  /**
   * Prepare multiple records for permission operations in one call.
   *
   * - Smart account setup runs once (idempotent)
   * - Each record is checked for on-chain initialization; uninitialized
   *   records are initialized sequentially using the caller's Firestore role
   * - Already-initialized records are a no-op
   *
   * @param recordIds  - Records to prepare
   * @param onProgress - Optional progress callback (mirrors prepare())
   */
  static async prepareBatch(
    recordIds: string[],
    onProgress?: PermissionProgressCallback
  ): Promise<void> {
    if (recordIds.length === 0) return;

    console.log(`🔄 PermissionPreparationService.prepareBatch: ${recordIds.length} records`);

    // Step 1: Ensure smart account is ready — runs once for the whole batch
    const smartAccountAddress = await BlockchainPreparationService.ensureReady(progress => {
      onProgress?.(progress as PermissionPreparationProgress);
    });
    console.log('✅ Smart account ready:', smartAccountAddress);

    // Step 2: Check and initialize each record sequentially.
    // Sequential (not parallel) because initializeRecordRole hits a Cloud Function
    // that writes to the blockchain — running them concurrently risks nonce conflicts
    // on the admin wallet used by that function.

    const justInitialized = new Set<string>();

    for (const recordId of recordIds) {
      const roleStats = await BlockchainRoleManagerService.getRecordRoleStats(recordId);
      const isInitialized = roleStats.ownerCount > 0 || roleStats.adminCount > 0;

      if (isInitialized) {
        console.log(`ℹ️ Record already initialized: ${recordId}`);
        continue;
      }

      onProgress?.({
        step: 'initializing_record',
        message: `Initializing record on network…`,
      });

      // Determine the caller's Firestore role on this record — same logic as
      // getCurrentUserRole in usePermissionFlow
      const initialRole = await this.getCallerInitialRoleForRecord(recordId);
      console.log(`🚀 Initializing record ${recordId} as ${initialRole}…`);
      await this.initializeRecordRole(recordId, smartAccountAddress, initialRole);
      console.log(`✅ Record initialized: ${recordId}`);
      justInitialized.add(recordId);
    }

    // Step 3: Verify all records are ready. Don't need to verify records we just initialized
    const toVerify = recordIds.filter(id => !justInitialized.has(id));

    if (toVerify.length > 0) {
      const finalStatuses = await Promise.all(toVerify.map(id => this.getStatus(id)));
      const notReady = toVerify.filter((_, i) => !finalStatuses[i]?.isReady);
      if (notReady.length > 0) {
        throw new Error(
          `Preparation failed for ${notReady.length} record(s): ${notReady.join(', ')}`
        );
      }
    }

    onProgress?.({ step: 'complete', message: 'Preparation complete!' });
    console.log('✅ PermissionPreparationService.prepareBatch complete');
  }

  /**
   * Determine the caller's InitialRole for a specific record by checking Firestore.
   * Returns 'owner' if caller is in the owners array, otherwise 'administrator'.
   * Mirrors getCurrentUserRole in usePermissionFlow.
   */
  private static async getCallerInitialRoleForRecord(recordId: string): Promise<InitialRole> {
    const auth = getAuth();
    const uid = auth.currentUser?.uid;
    if (!uid) return 'administrator';

    try {
      const db = getFirestore();
      const snap = await getDoc(doc(db, 'records', recordId));
      if (!snap.exists()) return 'administrator';
      const owners: string[] = snap.data().owners ?? [];
      return owners.includes(uid) ? 'owner' : 'administrator';
    } catch {
      return 'administrator';
    }
  }

  // ============================================================================
  // STATUS & PREPARATION METHODS
  // ============================================================================

  /**
   * Get detailed preparation status for current user and a record.
   *
   * @param recordId - The record to check
   */
  static async getStatus(recordId: string): Promise<PermissionPreparationStatus> {
    // Get generic blockchain status
    const blockchainStatus = await BlockchainPreparationService.getStatus();

    // Get record-specific status
    const roleStats = await BlockchainRoleManagerService.getRecordRoleStats(recordId);
    const isRecordInitialized = roleStats.ownerCount > 0 || roleStats.adminCount > 0;

    return {
      smartAccountAddress: blockchainStatus.smartAccountAddress || '',
      isSmartAccountRegistered: blockchainStatus.checks.isRegisteredOnChain,
      isRecordInitialized,
      isReady: blockchainStatus.ready && isRecordInitialized,
      roleStats: {
        ownerCount: Number(roleStats.ownerCount),
        adminCount: Number(roleStats.adminCount),
        sharerCount: Number(roleStats.sharerCount),
        viewerCount: Number(roleStats.viewerCount),
      },
    };
  }

  /**
   * Prepare blockchain state for permission operations.
   *
   * This handles:
   * 1. Smart account setup (via BlockchainPreparationService)
   * 2. Record initialization (permission-specific)
   *
   * @param recordId - The record to prepare
   * @param initialRole - The role to assign to the caller ('owner' or 'administrator')
   * @param onProgress - Optional callback for progress updates
   */
  static async prepare(
    recordId: string,
    initialRole: InitialRole,
    onProgress?: PermissionProgressCallback
  ): Promise<void> {
    console.log('🔄 PermissionPreparationService: Starting preparation...');

    // Step 1: Ensure smart account is ready (generic preparation)
    const smartAccountAddress = await BlockchainPreparationService.ensureReady(progress => {
      // Forward progress updates
      onProgress?.(progress as PermissionPreparationProgress);
    });

    console.log('✅ PermissionPreparationService: Smart account ready:', smartAccountAddress);

    // Step 2: Check if record needs initialization
    const roleStats = await BlockchainRoleManagerService.getRecordRoleStats(recordId);
    const isRecordInitialized = roleStats.ownerCount > 0 || roleStats.adminCount > 0;

    if (!isRecordInitialized) {
      onProgress?.({
        step: 'initializing_record',
        message: 'Initializing record on network...',
      });

      console.log('🚀 PermissionPreparationService: Initializing record...');
      await this.initializeRecordRole(recordId, smartAccountAddress, initialRole);
      console.log('✅ PermissionPreparationService: Record initialized');
    } else {
      console.log('ℹ️ PermissionPreparationService: Record already initialized');
    }

    onProgress?.({
      step: 'complete',
      message: 'Preparation complete!',
    });

    // Step 3: Verify everything is ready
    const finalStatus = await this.getStatus(recordId);
    if (!finalStatus.isReady) {
      throw new Error('Preparation completed but verification failed. Please try again.');
    }

    console.log('✅ PermissionPreparationService: All preparations complete');
  }

  /**
   * Initialize a record's first role on the blockchain.
   *
   * This sets up the role hierarchy for a record by assigning the first
   * administrator or owner. After this, that user can grant additional
   * roles using the permission service.
   *
   * @param recordId - The Firestore document ID of the record
   * @param walletAddress - Wallet address of the first admin/owner
   * @param role - The initial role: 'administrator' or 'owner'
   */
  static async initializeRecordRole(
    recordId: string,
    walletAddress: string,
    role: InitialRole
  ): Promise<InitializeRecordResult> {
    console.log('🔗 Initializing record on network...', { recordId, role });

    try {
      const functions = getFunctions();
      const initFn = httpsCallable<
        { recordId: string; walletAddress: string; role: InitialRole },
        InitializeRecordResult
      >(functions, 'initializeRoleOnChain');

      const result = await initFn({ recordId, walletAddress, role });

      console.log('✅ Record initialized:', result.data.blockchainRef);

      // Log for audit trail (BackendChainParity needs a tx hash here) — only on a genuine new
      // initialization. The "already exists" catch branch below returns no blockchainRef, so it's
      // naturally skipped there. Same doc-ID scheme + event shape as every other
      // permissionHistory write (buildPermissionHistoryDocId + preparePermissionChangeEventData)
      // rather than a Firestore auto-ID — blockchainRef is already known here (the Cloud
      // Function's on-chain write already resolved by the time we get a response), so it's
      // written directly instead of starting null and getting filled in later. Fire-and-forget,
      // same as before: a failed audit-log write must never surface as a failure of the
      // initialization itself, which already succeeded on-chain.
      const userId = getAuth().currentUser?.uid;
      if (userId && result.data.blockchainRef) {
        try {
          const db = getFirestore();
          const historyRef = doc(
            collection(db, 'records', recordId, 'permissionHistory'),
            buildPermissionHistoryDocId(userId)
          );
          const eventData = await preparePermissionChangeEventData(recordId, userId, [
            { userId, action: 'granted', previousRole: null, newRole: role },
          ]);
          await setDoc(historyRef, { ...eventData, blockchainRef: result.data.blockchainRef });
        } catch (auditError) {
          console.warn('⚠️ Failed to write permission change event:', auditError);
        }
      }

      return result.data;
    } catch (error: any) {
      // Handle "already exists" gracefully - not really an error
      if (
        error.code === 'already-exists' ||
        error.code === 'functions/already-exists' ||
        error.message?.includes('already initialized') ||
        error.message?.includes('Conflict')
      ) {
        console.log('ℹ️ Record already initialized on network');
        return {
          success: true,
          blockchainRef: undefined,
          role: role,
        };
      }

      console.error('❌ Record initialization failed:', error);
      throw new Error(error.message || 'Failed to initialize record on network');
    }
  }
}
