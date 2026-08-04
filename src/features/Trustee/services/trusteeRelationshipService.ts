// src/features/Trustee/services/trusteeRelationshipService.ts

/**
 * TrusteeRelationshipService
 *
 * Manages the lifecycle of trustee relationships between users.
 * A trustee is a user who has been granted account-level trust by another user (the trustor).
 *
 * Trust Levels:
 *  - observer:   Read-only access to all records where trustor is a subject <-- gets added as viewer for every record
 *  - custodian:  Same record-level permissions as the trustor on all their records <-- gets added with the same permission level
 *  - controller:   Full account-level access, including accepting records, requires blockchain transaction.
 *
 * Key design decisions:
 *  - Document ID: `${trustorId}_${trusteeId}` — mirrors wrappedKeys pattern, ensures
 *    uniqueness per pair and enables cheap direct lookups without querying
 *  - Soft delete only: relationships are never deleted, only status/isActive updated
 *  - Re-invitation reactivates the existing document rather than creating a new one
 *  - Controller appointments require a blockchain transaction to add the trustee's smart wallet/EOA wallet to the trustor's ID and store the tx hash
 *
 * Relationship to other services:
 *  - Permission resolution ("what can this trustee do on record X?") is handled
 *    by a separate TrusteePermissionService
 *  - Notifications are fired via Cloud Function triggers on status changes,
 *    not called directly here (same pattern as subjectConsentRequest triggers)
 *
 * Permission fan-out lifecycle:
 *  - inviteTrustee      → TrusteePermissionService.grantPendingTrusteeAccess
 *                         (trustor is online; creates inactive wrappedKeys + role arrays)
 *  - acceptInvite       → TrusteePermissionService.activateTrusteeAccess
 *                         (flips wrappedKeys to isActive: true)
 *  - declineInvite      → TrusteePermissionService.rollbackPendingTrusteeAccess
 *                         (removes from role arrays, deletes inactive wrappedKeys)
 *  - revokeTrustee      → TrusteePermissionService.revokeTrusteeAccess
 *  - resignAsTrustee    → TrusteePermissionService.revokeTrusteeAccess
 */

import {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
  writeBatch,
  query,
  collection,
  where,
  getDocs,
  Timestamp,
  DocumentReference,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { id } from 'ethers';
import * as Sentry from '@sentry/react';
import { getUserProfile } from '@/features/Users/services/userProfileService';
import { Role } from '@/features/Permissions/services/permissionsService';
import { BlockchainRoleManagerService } from '@/features/Permissions/services/blockchainRoleManagerService';
import { WalletService } from '@/features/BlockchainWallet/services/walletService';
import {
  BlockchainSyncQueueService,
  getUserFacingErrorMessage,
} from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { TrusteePermissionService } from './trusteePermissionService';
import {
  buildTrusteeHistoryDocId,
  prepareTrusteeHistoryEventData,
} from './writeTrusteeHistoryEvent';
import { buildMemberRegistryRef } from '@belrose/shared';

// ============================================================================
// TYPES
// ============================================================================

export type TrustLevel = 'observer' | 'custodian' | 'controller';
export type TrusteeStatus = 'pending' | 'active' | 'revoked' | 'declined';
export type StatusUpdate =
  | 'trustor_revoked'
  | 'trustee_resigned'
  | 'trust_level_upgrade'
  | 'trust_level_downgrade';

export type TrusteeHistoryAction = 'propose' | 'accept' | 'revoke' | 'decline' | 'level-update';

// One entry per record a trustee relationship's fan-out has actually touched. previousRole is
// the trustee's role on that record immediately before this relationship touched it — null means
// the relationship is the sole reason they have any role there at all (strip completely on full
// revoke); a real Role means they already had independent access at that lower role and were
// upgraded (downgrade back to it on full revoke, never strip). See
// TrusteePermissionService.grantPendingTrusteeAccess/revokeTrusteeAccess.
export interface TrusteeGrantedRecord {
  recordId: string;
  previousRole: Role | null;
}

export interface TrusteeRelationship {
  // Core identifiers
  trustorId: string;
  trusteeId: string;
  trustLevel: TrustLevel;

  // Status — soft delete, mirrors wrappedKeys isActive pattern
  isActive: boolean;
  status: TrusteeStatus;

  // Lifecycle timestamps
  createdAt: Timestamp;
  respondedAt: Timestamp | null;
  revokedAt: Timestamp | null;
  revokedBy: string | null; // uid — could be either party
  statusUpdateReason: StatusUpdate | null;

  // Set to true for auto-created relationships on dependent accounts
  isDependentRelationship?: boolean;

  // Records this relationship's fan-out has actually granted, one entry per record, appended
  // incrementally (via arrayUnion, atomically with each record's own grant) by
  // TrusteePermissionService.grantPendingTrusteeAccess as each record's fan-out succeeds — not
  // pre-populated at invite time, so a record only ever appears here if it was genuinely
  // granted, never merely attempted. Reset to [] at the start of every invite/reactivation cycle
  // and cleared back to [] once TrusteePermissionService.revokeTrusteeAccess finishes tearing
  // the relationship down. Lets activateTrusteeAccess/revokeTrusteeAccess scope their work to
  // exactly the records this relationship touched instead of broadly scanning wrappedKeys for
  // this trustor/trustee pair, which could otherwise pick up a stale key left behind by an
  // earlier cycle that covered a different record set.
  recordIdsGranted?: TrusteeGrantedRecord[];
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate the document ID for a trustee relationship.
 * Format: `${trustorId}_${trusteeId}`
 * Mirrors the wrappedKeys pattern: `${recordId}_${userId}`
 */
export const getTrusteeRelationshipId = (trustorId: string, trusteeId: string): string => {
  return `${trustorId}_${trusteeId}`;
};

const trustLevelMap = { observer: 0, custodian: 1, controller: 2 } as const;

// ============================================================================
// SERVICE
// ============================================================================

export class TrusteeRelationshipService {
  // ============================================================================
  // INVITE METHODS (Called by trustor)
  // ============================================================================

  /**
   * Invite a user to become a trustee. Only called by the trustor.
   *
   * If a relationship document already exists (previous revocation or decline),
   * reactivates it as a new pending invite rather than creating a duplicate.
   *
   * Permission fan-out happens at invite time (not accept time) because the
   * trustor is guaranteed online and has the session key needed for encryption.
   * wrappedKeys are created with isActive: false — trustee can't decrypt until
   * they accept.
   *
   * Firestore-first: the relationship doc's own state transition commits first, then the
   * non-fatal per-record fan-out runs, then the on-chain proposal (one tx covering every
   * fanned-out record — mirrors PermissionsService.grantRoleBatch's template) is attempted as a
   * separate, best-effort step. A chain failure no longer blocks the invite or its per-record
   * pending access from existing in Firestore.
   *
   * @param trusteeId - The userId of the person being invited
   * @param trustLevel - The level of trust being granted
   */
  static async inviteTrustee(trusteeId: string, trustLevel: TrustLevel): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) throw new Error('User not authenticated');

    const trustorId = currentUser.uid;
    const currentUserProfile = await getUserProfile(trustorId);

    if (trustorId === trusteeId) {
      throw new Error('You cannot appoint yourself as a trustee');
    }

    // Check 1: Verify target user exists
    const targetProfile = await getUserProfile(trusteeId);
    if (!targetProfile) throw new Error('Target user does not exist or has no profile');

    // Check 2: Requires a blockchain wallet for both parties
    if (!currentUserProfile?.onChainIdentity?.linkedWallets.some(w => w.isWalletActive)) {
      throw new Error('Trustor does not have an existing blockchain account');
    }
    if (!targetProfile?.onChainIdentity?.linkedWallets.some(w => w.isWalletActive)) {
      throw new Error('Trustee does not have an existing blockchain account');
    }

    const db = getFirestore();
    const relationshipId = getTrusteeRelationshipId(trustorId, trusteeId);
    const relationshipRef = doc(db, 'trusteeRelationships', relationshipId);
    const existing = await getDoc(relationshipRef);
    const now = Timestamp.now();

    if (existing.exists()) {
      const existingData = existing.data() as TrusteeRelationship;
      if (existingData.status === 'active') {
        throw new Error('This user is already an active trustee');
      }
      if (existingData.status === 'pending') {
        throw new Error('An invite is already pending for this user');
      }
    }

    // Fetch records so roles can be requested atomically with the proposal — read-only,
    // before any write.
    const trustorRecords = await TrusteePermissionService.getRecordsForTrustor(
      trustorId,
      trusteeId
    );
    const recordIds = trustorRecords.map(r => r.recordId);

    // Fails before any write if the trustor has no wallet linked.
    const userWalletAddress = await WalletService.requireUserWalletAddress(trustorId);

    // Step 1: Atomic Firestore write — the relationship doc's own state transition (create or
    // reactivate) plus its trusteeHistory event, both or neither. blockchainRef starts null;
    // it's filled in below once the chain call resolves — the event itself is the audit record
    // of what happened in Firestore regardless of blockchain outcome.
    const historyRef = doc(
      collection(db, 'trusteeRelationships', relationshipId, 'trusteeHistory'),
      buildTrusteeHistoryDocId(trusteeId)
    );
    const historyEventData = prepareTrusteeHistoryEventData(
      relationshipId,
      trustorId,
      trusteeId,
      trustorId,
      'propose',
      trustLevel,
      recordIds
    );
    try {
      const batch = writeBatch(db);
      if (existing.exists()) {
        console.log('🔄 Reactivating existing trustee relationship as new invite');
        batch.update(relationshipRef, {
          trustLevel,
          status: 'pending',
          isActive: false,
          createdAt: now,
          respondedAt: null,
          revokedAt: null,
          revokedBy: null,
          statusUpdateReason: null,
          recordIdsGranted: [],
        });
      } else {
        console.log('🔄 Creating new trustee relationship invite');
        batch.set(relationshipRef, {
          trustorId,
          trusteeId,
          trustLevel,
          isActive: false,
          status: 'pending',
          createdAt: now,
          respondedAt: null,
          revokedAt: null,
          revokedBy: null,
          statusUpdateReason: null,
          recordIdsGranted: [],
        } satisfies TrusteeRelationship);
      }
      batch.set(historyRef, historyEventData);
      await batch.commit();
    } catch (firestoreError) {
      Sentry.captureException(firestoreError, {
        tags: { feature: 'trustee', action: 'inviteTrustee', relationshipId },
      });
      throw firestoreError;
    }
    console.log('✅ Firestore: Invite created');

    // Step 2: Non-fatal per-record fan-out (wrappedKeys + Firestore arrays + permissionHistory,
    // atomic per record). Trustor is online so the session key is available.
    const succeeded = await TrusteePermissionService.grantPendingTrusteeAccess(
      trusteeId,
      trustLevel
    );
    console.log('✅ Pending permissions granted');

    // Step 3: Blockchain proposal — one tx covering every record in the original request
    // (unfiltered by fan-out success — the chain grant and the Firestore fan-out are
    // independent failure domains). Best-effort, does not revert the Firestore writes above.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: 'proposeTrustee',
      userId: trustorId,
      userWalletAddress,
      permissionHistoryPath: succeeded.map(s => s.historyRef.path),
      context: {
        type: 'trustee-propose',
        trustorId,
        trustorIdHash: id(trustorId),
        trusteeId,
        trusteeIdHash: id(trusteeId),
      },
    });

    try {
      console.log('🔗 Proposing trustee on blockchain...');
      const tx = await BlockchainRoleManagerService.proposeTrustee(
        trusteeId,
        trustLevelMap[trustLevel],
        recordIds
      );
      const blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);

      await Promise.all(succeeded.map(s => updateDoc(s.historyRef, { blockchainRef }))); //Writes blockchain ref to each record's permissionHistory. all part of the same onChain transaction grantTrusteeAccesstoNewRecord
      await updateDoc(historyRef, { blockchainRef }); //Writes blockchain ref to the trusteeHistory event for this relationship
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log('✅ Blockchain: Trustee proposed');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain proposal failed:', blockchainError);

      const errorMessage = getUserFacingErrorMessage(
        blockchainError,
        'Blockchain transaction failed'
      );

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log(`✅ Trustee invite sent: ${trustorId} → ${trusteeId} (${trustLevel})`);
  }

  /**
   * Revoke an active or pending trustee relationship.
   * Only the trustor can call this.
   *
   * Firestore-first: the relationship doc's own status transition commits first, then the
   * non-fatal per-record access rollback runs, then the blockchain revocation is attempted as a
   * separate, best-effort step tracked by BlockchainSyncQueueService — a chain failure no
   * longer blocks the revocation from taking effect in Firestore, matching
   * PermissionsService/SubjectService's pattern.
   *
   * @param trusteeId - The userId of the trustee to revoke
   */
  static async revokeTrustee(trusteeId: string): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) throw new Error('User not authenticated');

    const trustorId = currentUser.uid;
    const db = getFirestore();
    const relationshipId = getTrusteeRelationshipId(trustorId, trusteeId);
    const relationshipRef = doc(db, 'trusteeRelationships', relationshipId);
    const existing = await getDoc(relationshipRef);

    if (!existing.exists()) throw new Error('Trustee relationship not found');

    const data = existing.data() as TrusteeRelationship;

    if (data.status === 'revoked') throw new Error('Relationship is already revoked');
    if (data.status === 'declined') throw new Error('Cannot revoke a declined relationship');

    // Fails before any write if the trustor has no wallet linked.
    const userWalletAddress = await WalletService.requireUserWalletAddress(trustorId);

    const previousStatus = data.status;
    // Captured before Step 1 clears it — Step 2 needs the pre-revoke list, and the clear has to
    // land atomically with the status transition (same write, same rules branch) rather than as
    // a follow-up write after status has already changed, which no rules branch would permit.
    const recordIdsGranted = data.recordIdsGranted ?? [];

    // Step 1: Atomic Firestore write — the relationship doc's own state transition plus its
    // trusteeHistory event, both or neither. blockchainRef starts null; filled in below once the
    // chain call resolves. Wrapped in Sentry on failure; nothing else below runs if this fails.
    const historyRef = doc(
      collection(db, 'trusteeRelationships', relationshipId, 'trusteeHistory'),
      buildTrusteeHistoryDocId(trusteeId)
    );
    const historyEventData = prepareTrusteeHistoryEventData(
      relationshipId,
      trustorId,
      trusteeId,
      trustorId,
      'revoke'
    );
    try {
      const batch = writeBatch(db);
      batch.update(relationshipRef, {
        isActive: false,
        status: 'revoked',
        revokedAt: Timestamp.now(),
        revokedBy: trustorId,
        statusUpdateReason: 'trustor_revoked',
        recordIdsGranted: [],
      });
      batch.set(historyRef, historyEventData);
      await batch.commit();
    } catch (firestoreError) {
      Sentry.captureException(firestoreError, {
        tags: { feature: 'trustee', action: 'revokeTrustee', relationshipId },
      });
      throw firestoreError;
    }
    console.log('✅ Firestore: Relationship marked revoked');

    // Step 2: Non-fatal per-record access rollback — active relationships strip/downgrade
    // wrappedKeys + role arrays; pending relationships delete inactive wrappedKeys + remove role
    // arrays. Each record's write is already atomic within these methods.
    const succeeded =
      previousStatus === 'active'
        ? await TrusteePermissionService.revokeTrusteeAccess(trustorId, trusteeId, recordIdsGranted)
        : previousStatus === 'pending'
          ? await TrusteePermissionService.rollbackPendingTrusteeAccess(
              trustorId,
              trusteeId,
              recordIdsGranted
            )
          : [];

    // Step 3: Blockchain — best-effort, does not revert the Firestore write above. The
    // revocation already stands regardless of what happens here.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: 'revokeTrustee',
      userId: trustorId,
      userWalletAddress,
      permissionHistoryPath: succeeded.map(s => s.historyRef.path),
      context: {
        type: 'trustee-revoke',
        trustorId,
        trustorIdHash: id(trustorId),
        trusteeId,
        trusteeIdHash: id(trusteeId),
      },
    });

    try {
      console.log('🔗 Revoking trustee on blockchain...');
      const tx = await BlockchainRoleManagerService.revokeTrustee(trustorId, trusteeId);
      const blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);

      await Promise.all(succeeded.map(s => updateDoc(s.historyRef, { blockchainRef })));
      await updateDoc(historyRef, { blockchainRef });
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log('✅ Blockchain: Trustee revoked');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain revocation failed:', blockchainError);

      const errorMessage = getUserFacingErrorMessage(
        blockchainError,
        'Blockchain revocation failed'
      );

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log(`✅ Trustee revoked: ${trustorId} revoked ${trusteeId}`);
  }

  /**
   * Edit the trust level of an active trustee relationship.
   * Only the trustor can call this.
   *
   * Firestore-first, same shape as revokeTrustee — see that method's doc comment.
   *
   * @param trusteeId - The userId of the trustee
   * @param newTrustLevel - The new trust level to set
   */
  static async editTrusteeRelationship(
    trusteeId: string,
    newTrustLevel: TrustLevel
  ): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) throw new Error('User not authenticated');

    const trustorId = currentUser.uid;
    const db = getFirestore();
    const relationshipId = getTrusteeRelationshipId(trustorId, trusteeId);
    const relationshipRef = doc(db, 'trusteeRelationships', relationshipId);
    const existing = await getDoc(relationshipRef);

    if (!existing.exists()) throw new Error('Trustee relationship not found');

    const data = existing.data() as TrusteeRelationship;

    if (data.status !== 'active') {
      throw new Error('Can only edit an active trustee relationship');
    }

    if (data.trustLevel === newTrustLevel) {
      throw new Error('Trustee already has this trust level');
    }

    const isUpgrade =
      (data.trustLevel === 'observer' && newTrustLevel !== 'observer') ||
      (data.trustLevel === 'custodian' && newTrustLevel === 'controller');

    // Fails before any write if the trustor has no wallet linked.
    const userWalletAddress = await WalletService.requireUserWalletAddress(trustorId);

    // Step 1: Atomic Firestore write — the relationship doc's own state transition plus its
    // trusteeHistory event, both or neither. blockchainRef starts null; filled in below once the
    // chain call resolves.
    const historyRef = doc(
      collection(db, 'trusteeRelationships', relationshipId, 'trusteeHistory'),
      buildTrusteeHistoryDocId(trusteeId)
    );
    const historyEventData = prepareTrusteeHistoryEventData(
      relationshipId,
      trustorId,
      trusteeId,
      trustorId,
      'level-update',
      newTrustLevel
    );
    try {
      const batch = writeBatch(db);
      batch.update(relationshipRef, {
        trustLevel: newTrustLevel,
        statusUpdateReason: isUpgrade ? 'trust_level_upgrade' : 'trust_level_downgrade',
      });
      batch.set(historyRef, historyEventData);
      await batch.commit();
    } catch (firestoreError) {
      Sentry.captureException(firestoreError, {
        tags: { feature: 'trustee', action: 'editTrusteeRelationship', relationshipId },
      });
      throw firestoreError;
    }
    console.log('✅ Firestore: Trust level updated');

    // Step 2: Non-fatal per-record access update. Fan-out errors don't block the blockchain
    // step below — the relationship doc's own state transition has already committed.
    let succeeded: { recordId: string; historyRef: DocumentReference }[] = [];
    try {
      succeeded = await TrusteePermissionService.updateTrusteeAccess(
        trustorId,
        trusteeId,
        newTrustLevel,
        data.recordIdsGranted ?? []
      );
    } catch (err) {
      console.error('⚠️ Permission fan-out failed during trust level edit (non-fatal):', err);
    }

    // Step 3: Update trust level on blockchain — best-effort, does not revert the Firestore
    // write above.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: 'updateTrusteeLevel',
      userId: trustorId,
      userWalletAddress,
      permissionHistoryPath: succeeded.map(s => s.historyRef.path),
      context: {
        type: 'trustee-level-update',
        trustorId,
        trustorIdHash: id(trustorId),
        trusteeId,
        trusteeIdHash: id(trusteeId),
      },
    });

    try {
      console.log('🔗 Updating trust level on blockchain...');
      const tx = await BlockchainRoleManagerService.updateTrusteeLevel(
        trusteeId,
        trustLevelMap[newTrustLevel]
      );
      const blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);

      await Promise.all(succeeded.map(s => updateDoc(s.historyRef, { blockchainRef })));
      await updateDoc(historyRef, { blockchainRef });
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log('✅ Blockchain: Trust level updated');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);

      const errorMessage = getUserFacingErrorMessage(blockchainError, 'Blockchain update failed');

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log(`✅ Trust level updated: ${trustorId} → ${trusteeId} (${newTrustLevel})`);
  }

  // ============================================================================
  // RESPONSE METHODS (Called by trustee)
  // ============================================================================

  /**
   * Accept a pending trustee invite.
   * Only the trustee (the invited user) can call this.
   *
   * Activates all wrappedKeys that were created at invite time (isActive: false → true).
   * The trustee already has role array access — this just unlocks decryption.
   *
   * Firestore-first, same shape as revokeTrustee — see that method's doc comment.
   * activateTrusteeAccess is already one atomic writeBatch, so this method is mostly a
   * reordering: the relationship flips to active before the blockchain acceptance is attempted.
   *
   * @param trustorId - The userId of the trustor who sent the invite
   */
  static async acceptInvite(trustorId: string): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) throw new Error('User not authenticated');

    const trusteeId = currentUser.uid;
    const currentUserProfile = await getUserProfile(trusteeId);
    const db = getFirestore();
    const relationshipId = getTrusteeRelationshipId(trustorId, trusteeId);
    const relationshipRef = doc(db, 'trusteeRelationships', relationshipId);
    const existing = await getDoc(relationshipRef);

    if (!existing.exists()) throw new Error('Trustee invite not found');

    const data = existing.data() as TrusteeRelationship;

    if (data.status !== 'pending') {
      throw new Error(`Cannot accept an invite with status: ${data.status}`);
    }

    if (data.trusteeId !== trusteeId) {
      throw new Error('You are not the intended recipient of this invite');
    }

    const activeWallets =
      currentUserProfile?.onChainIdentity?.linkedWallets
        ?.filter(w => w.isWalletActive)
        .map(w => w.address) ?? [];

    if (activeWallets.length === 0) {
      throw new Error('You need an active blockchain wallet to accept a trustee invite');
    }

    // Fails before any write if the trustee has no wallet linked.
    const userWalletAddress = await WalletService.requireUserWalletAddress(trusteeId);

    // Step 1: Atomic Firestore write — the relationship doc's own state transition plus its
    // trusteeHistory event, both or neither. blockchainRef starts null; filled in below once the
    // chain call resolves.
    const historyRef = doc(
      collection(db, 'trusteeRelationships', relationshipId, 'trusteeHistory'),
      buildTrusteeHistoryDocId(trusteeId)
    );
    const historyEventData = prepareTrusteeHistoryEventData(
      relationshipId,
      trustorId,
      trusteeId,
      trusteeId,
      'accept'
    );
    try {
      const batch = writeBatch(db);
      batch.update(relationshipRef, {
        isActive: true,
        status: 'active',
        respondedAt: Timestamp.now(),
      });
      batch.set(historyRef, historyEventData);
      await batch.commit();
    } catch (firestoreError) {
      Sentry.captureException(firestoreError, {
        tags: { feature: 'trustee', action: 'acceptInvite', relationshipId },
      });
      throw firestoreError;
    }
    console.log('✅ Firestore: Invite marked active');

    // Step 2: Activate all wrappedKeys created at invite time (already one atomic writeBatch).
    // This is the only thing the trustee needs to do — role arrays were already
    // updated by the trustor at invite time.
    await TrusteePermissionService.activateTrusteeAccess(trustorId);

    // Step 3: Accept on blockchain — best-effort, does not revert the Firestore write above.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: 'acceptTrustee',
      userId: trusteeId,
      userWalletAddress,
      context: {
        type: 'trustee-accept',
        trustorId,
        trustorIdHash: id(trustorId),
        trusteeId,
        trusteeIdHash: id(trusteeId),
      },
    });

    try {
      console.log('🔗 Accepting trustee on blockchain...');
      const tx = await BlockchainRoleManagerService.acceptTrustee(trustorId);
      const blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);

      await updateDoc(historyRef, { blockchainRef });
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log('✅ Blockchain: Trustee accepted');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain acceptance failed:', blockchainError);

      const errorMessage = getUserFacingErrorMessage(
        blockchainError,
        'Blockchain acceptance failed'
      );

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log(`✅ Trustee invite accepted: ${trusteeId} accepted invite from ${trustorId}`);
  }

  /**
   * Trustee self-downgrades their own trust level.
   * Only the trustee can call this, and only to a strictly lower level.
   * Upgrades require trustor approval via editTrusteeRelationship.
   *
   * Firestore-first, same shape as editTrusteeRelationship.
   *
   * @param trustorId - The userId of the trustor
   * @param newTrustLevel - The new (lower) trust level
   */
  static async stepDownTrusteeLevel(trustorId: string, newTrustLevel: TrustLevel): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('User not authenticated');

    const trusteeId = currentUser.uid;
    const db = getFirestore();
    const relationshipId = getTrusteeRelationshipId(trustorId, trusteeId);
    const relationshipRef = doc(db, 'trusteeRelationships', relationshipId);
    const existing = await getDoc(relationshipRef);

    if (!existing.exists()) throw new Error('Trustee relationship not found');

    const data = existing.data() as TrusteeRelationship;

    if (data.status !== 'active') throw new Error('Can only step down from an active relationship');

    const LEVEL_ORDER: TrustLevel[] = ['observer', 'custodian', 'controller'];
    if (LEVEL_ORDER.indexOf(newTrustLevel) >= LEVEL_ORDER.indexOf(data.trustLevel)) {
      throw new Error('Can only step down to a lower trust level');
    }

    // Fails before any write if the trustee has no wallet linked.
    const userWalletAddress = await WalletService.requireUserWalletAddress(trusteeId);

    // Step 1: Atomic Firestore write — the relationship doc's own state transition plus its
    // trusteeHistory event, both or neither. blockchainRef starts null; filled in below once the
    // chain call resolves.
    const historyRef = doc(
      collection(db, 'trusteeRelationships', relationshipId, 'trusteeHistory'),
      buildTrusteeHistoryDocId(trusteeId)
    );
    const historyEventData = prepareTrusteeHistoryEventData(
      relationshipId,
      trustorId,
      trusteeId,
      trusteeId,
      'level-update',
      newTrustLevel
    );
    try {
      const batch = writeBatch(db);
      batch.update(relationshipRef, {
        trustLevel: newTrustLevel,
        statusUpdateReason: 'trust_level_downgrade',
      });
      batch.set(historyRef, historyEventData);
      await batch.commit();
    } catch (firestoreError) {
      Sentry.captureException(firestoreError, {
        tags: { feature: 'trustee', action: 'stepDownTrusteeLevel', relationshipId },
      });
      throw firestoreError;
    }
    console.log('✅ Firestore: Trust level stepped down');

    // Step 2: Non-fatal per-record access update. Fan-out errors don't block the blockchain
    // step below — the relationship doc's own state transition has already committed.
    let succeeded: { recordId: string; historyRef: DocumentReference }[] = [];
    try {
      succeeded = await TrusteePermissionService.updateTrusteeAccess(
        trustorId,
        trusteeId,
        newTrustLevel,
        data.recordIdsGranted ?? []
      );
    } catch (err) {
      console.error('⚠️ Permission fan-out failed during step-down (non-fatal):', err);
    }

    // Step 3: Update on blockchain — trustee signs, trustorId passed as arg. Best-effort, does
    // not revert the Firestore write above.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: 'downgradeTrusteeLevel',
      userId: trusteeId,
      userWalletAddress,
      permissionHistoryPath: succeeded.map(s => s.historyRef.path),
      context: {
        type: 'trustee-level-update',
        trustorId,
        trustorIdHash: id(trustorId),
        trusteeId,
        trusteeIdHash: id(trusteeId),
      },
    });

    try {
      console.log('🔗 Downgrading trust level on blockchain...');
      const tx = await BlockchainRoleManagerService.downgradeTrusteeLevel(
        trustorId,
        trustLevelMap[newTrustLevel]
      );
      const blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);

      await Promise.all(succeeded.map(s => updateDoc(s.historyRef, { blockchainRef })));
      await updateDoc(historyRef, { blockchainRef });
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log('✅ Blockchain: Trust level downgraded');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain update failed:', blockchainError);

      const errorMessage = getUserFacingErrorMessage(
        blockchainError,
        'Blockchain transaction failed'
      );

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log(
      `✅ Trust level stepped down: ${trusteeId} → ${newTrustLevel} (trustor: ${trustorId})`
    );
  }

  /**
   * Decline a pending trustee invite.
   * Only the trustee (the invited user) can call this.
   *
   * Rolls back all permissions granted at invite time:
   * removes from role arrays and deletes inactive wrappedKeys.
   *
   * Firestore-first, same shape as revokeTrustee — see that method's doc comment.
   * declineTrustee has no self-heal ambiguity worth wrapping (unlike accept/revoke/
   * updateLevel), so this calls BlockchainRoleManagerService directly.
   *
   * @param trustorId - The userId of the trustor who sent the invite
   */
  static async declineInvite(trustorId: string): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) throw new Error('User not authenticated');

    const trusteeId = currentUser.uid;
    const db = getFirestore();
    const relationshipId = getTrusteeRelationshipId(trustorId, trusteeId);
    const relationshipRef = doc(db, 'trusteeRelationships', relationshipId);
    const existing = await getDoc(relationshipRef);

    if (!existing.exists()) throw new Error('Trustee invite not found');

    const data = existing.data() as TrusteeRelationship;

    if (data.status !== 'pending') {
      throw new Error(`Cannot decline an invite with status: ${data.status}`);
    }

    // Fails before any write if the trustee has no wallet linked.
    const userWalletAddress = await WalletService.requireUserWalletAddress(trusteeId);

    // Captured before Step 1 clears it — see revokeTrustee's identical comment for why the
    // clear has to land atomically with the status transition rather than as a follow-up write.
    const recordIdsGranted = data.recordIdsGranted ?? [];

    // Step 1: Atomic Firestore write — the relationship doc's own state transition plus its
    // trusteeHistory event, both or neither. blockchainRef starts null; filled in below once the
    // chain call resolves.
    const historyRef = doc(
      collection(db, 'trusteeRelationships', relationshipId, 'trusteeHistory'),
      buildTrusteeHistoryDocId(trusteeId)
    );
    const historyEventData = prepareTrusteeHistoryEventData(
      relationshipId,
      trustorId,
      trusteeId,
      trusteeId,
      'decline'
    );
    try {
      const batch = writeBatch(db);
      batch.update(relationshipRef, {
        isActive: false,
        status: 'declined',
        respondedAt: Timestamp.now(),
        revokedBy: trusteeId,
        recordIdsGranted: [],
      });
      batch.set(historyRef, historyEventData);
      await batch.commit();
    } catch (firestoreError) {
      Sentry.captureException(firestoreError, {
        tags: { feature: 'trustee', action: 'declineInvite', relationshipId },
      });
      throw firestoreError;
    }
    console.log('✅ Firestore: Invite marked declined');

    // Step 2: Roll back all pending permissions granted at invite time (non-fatal per record).
    const succeeded = await TrusteePermissionService.rollbackPendingTrusteeAccess(
      trustorId,
      trusteeId,
      recordIdsGranted
    );

    // Step 3: Blockchain decline — revokes roles granted at proposal time. Best-effort, does
    // not revert the Firestore write above.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: 'declineTrustee',
      userId: trusteeId,
      userWalletAddress,
      permissionHistoryPath: succeeded.map(s => s.historyRef.path),
      context: {
        type: 'trustee-decline',
        trustorId,
        trustorIdHash: id(trustorId),
        trusteeId,
        trusteeIdHash: id(trusteeId),
      },
    });

    try {
      console.log('🔗 Declining trustee proposal on blockchain...');
      const tx = await BlockchainRoleManagerService.declineTrustee(trustorId);
      const blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);

      await Promise.all(succeeded.map(s => updateDoc(s.historyRef, { blockchainRef })));
      await updateDoc(historyRef, { blockchainRef });
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log('✅ Blockchain: Trustee proposal declined');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain decline failed:', blockchainError);

      const errorMessage = getUserFacingErrorMessage(
        blockchainError,
        'Blockchain transaction failed'
      );

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log(`✅ Trustee invite declined: ${trusteeId} declined invite from ${trustorId}`);
  }

  /**
   * Resign from an active trustee relationship.
   * Only the trustee can call this.
   *
   * Firestore-first, same shape as revokeTrustee — see that method's doc comment.
   *
   * @param trustorId - The userId of the trustor
   */
  static async resignAsTrustee(trustorId: string): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) throw new Error('User not authenticated');

    const trusteeId = currentUser.uid;
    const db = getFirestore();
    const relationshipId = getTrusteeRelationshipId(trustorId, trusteeId);
    const relationshipRef = doc(db, 'trusteeRelationships', relationshipId);
    const existing = await getDoc(relationshipRef);

    if (!existing.exists()) throw new Error('Trustee relationship not found');

    const data = existing.data() as TrusteeRelationship;

    if (data.status !== 'active') {
      throw new Error('Can only resign from an active trustee relationship');
    }

    // Fails before any write if the trustee has no wallet linked.
    const userWalletAddress = await WalletService.requireUserWalletAddress(trusteeId);

    // Captured before Step 1 clears it — see revokeTrustee's identical comment for why the
    // clear has to land atomically with the status transition rather than as a follow-up write.
    const recordIdsGranted = data.recordIdsGranted ?? [];

    // Step 1: Atomic Firestore write — the relationship doc's own state transition plus its
    // trusteeHistory event, both or neither. blockchainRef starts null; filled in below once the
    // chain call resolves.
    const historyRef = doc(
      collection(db, 'trusteeRelationships', relationshipId, 'trusteeHistory'),
      buildTrusteeHistoryDocId(trusteeId)
    );
    const historyEventData = prepareTrusteeHistoryEventData(
      relationshipId,
      trustorId,
      trusteeId,
      trusteeId,
      'revoke'
    );
    try {
      const batch = writeBatch(db);
      batch.update(relationshipRef, {
        status: 'declined',
        isActive: false,
        revokedAt: Timestamp.now(),
        revokedBy: trusteeId,
        statusUpdateReason: 'trustee_resigned',
        recordIdsGranted: [],
      });
      batch.set(historyRef, historyEventData);
      await batch.commit();
    } catch (firestoreError) {
      Sentry.captureException(firestoreError, {
        tags: { feature: 'trustee', action: 'resignAsTrustee', relationshipId },
      });
      throw firestoreError;
    }
    console.log('✅ Firestore: Relationship marked resigned');

    // Step 2: Non-fatal per-record access revocation.
    const succeeded = await TrusteePermissionService.revokeTrusteeAccess(
      trustorId,
      trusteeId,
      recordIdsGranted
    );

    // Step 3: Blockchain — best-effort, does not revert the Firestore write above.
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: 'revokeTrustee',
      userId: trusteeId,
      userWalletAddress,
      permissionHistoryPath: succeeded.map(s => s.historyRef.path),
      context: {
        type: 'trustee-revoke',
        trustorId,
        trustorIdHash: id(trustorId),
        trusteeId,
        trusteeIdHash: id(trusteeId),
      },
    });

    try {
      console.log('🔗 Resigning as trustee on blockchain...');
      const tx = await BlockchainRoleManagerService.revokeTrustee(trustorId, trusteeId);
      const blockchainRef = buildMemberRegistryRef(tx.txHash, tx.blockNumber);

      await Promise.all(succeeded.map(s => updateDoc(s.historyRef, { blockchainRef })));
      await updateDoc(historyRef, { blockchainRef });
      await BlockchainSyncQueueService.recordSuccess(syncRef, tx);

      console.log('✅ Blockchain: Trustee resigned');
    } catch (blockchainError) {
      console.error('⚠️ Blockchain revocation failed:', blockchainError);

      const errorMessage = getUserFacingErrorMessage(
        blockchainError,
        'Blockchain revocation failed'
      );

      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    console.log(`✅ Trustee resigned: ${trusteeId} resigned from ${trustorId}'s account`);
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Get all active trustees for a given trustor.
   * Used to render the "My Trustees" list on the trustor's settings/profile page.
   *
   * @param trustorId - Defaults to current user if not provided
   */
  static async getTrusteesForTrustor(trustorId?: string): Promise<TrusteeRelationship[]> {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('User not authenticated');

    const db = getFirestore();
    const targetId = trustorId || currentUser.uid;

    const q = query(
      collection(db, 'trusteeRelationships'),
      where('trustorId', '==', targetId),
      where('isActive', '==', true)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => d.data() as TrusteeRelationship);
  }

  /**
   * Get all accounts the current user is an active trustee for.
   * Used to render "Accounts I Manage" on the trustee's dashboard.
   */
  static async getTrustorAccountsForTrustee(): Promise<TrusteeRelationship[]> {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('User not authenticated');

    const db = getFirestore();

    const q = query(
      collection(db, 'trusteeRelationships'),
      where('trusteeId', '==', currentUser.uid),
      where('isActive', '==', true)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => d.data() as TrusteeRelationship);
  }

  /**
   * Get all pending invites for the current user.
   */
  static async getPendingInvitesForTrustee(): Promise<TrusteeRelationship[]> {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('User not authenticated');

    const db = getFirestore();

    const q = query(
      collection(db, 'trusteeRelationships'),
      where('trusteeId', '==', currentUser.uid),
      where('status', '==', 'pending')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => d.data() as TrusteeRelationship);
  }

  /**
   * Get a single relationship by trustor + trustee pair.
   * Useful for checking if a relationship exists before showing invite UI.
   */
  static async getRelationship(
    trustorId: string,
    trusteeId: string
  ): Promise<TrusteeRelationship | null> {
    const db = getFirestore();
    const relationshipId = getTrusteeRelationshipId(trustorId, trusteeId);
    const snap = await getDoc(doc(db, 'trusteeRelationships', relationshipId));

    if (!snap.exists()) return null;
    return snap.data() as TrusteeRelationship;
  }

  /**
   * Check whether the current user is an active controller trustee of the given trustorId.
   * Uses a direct document lookup (no composite index needed).
   */
  static async getControllerRelationshipWith(
    trustorId: string
  ): Promise<TrusteeRelationship | null> {
    const currentUser = getAuth().currentUser;
    if (!currentUser) return null;

    const rel = await TrusteeRelationshipService.getRelationship(trustorId, currentUser.uid);
    if (rel && rel.isActive && rel.trustLevel === 'controller') return rel;
    return null;
  }

  /**
   * Returns all active relationships where the current user is a controller trustee.
   * Filters client-side after the trusteeId + isActive index query to avoid a new composite index.
   */
  static async getActiveControllerTrustors(): Promise<TrusteeRelationship[]> {
    const currentUser = getAuth().currentUser;
    if (!currentUser) return [];

    const db = getFirestore();
    const q = query(
      collection(db, 'trusteeRelationships'),
      where('trusteeId', '==', currentUser.uid),
      where('isActive', '==', true)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs
      .map(d => d.data() as TrusteeRelationship)
      .filter(r => r.trustLevel === 'controller');
  }
}
