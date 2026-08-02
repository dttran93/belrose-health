// src/features/Trustee/services/trusteePermissionService.ts

/**
 * TrusteePermissionService
 *
 * Handles the fan-out of permissions when a trustee relationship is created or ended.
 * All privileged operations run on the TRUSTOR's client — they are always online
 * at invite time and have the session key needed for encryption fan-out.
 *
 * INVITE (called by trustor):
 *  - Queries all records where trustor is a subject
 *  - Resolves the correct role per record based on trust level
 *  - Grants blockchain role via grantRoleAsTrusteeBatch
 *  - Creates wrappedKeys for trustee (isActive: false) via SharingService
 *  - Updates Firestore role arrays + trustees[] on each record
 *  All access is pending until the trustee accepts.
 *
 * ACCEPT (called by trustee — minimal, just activates):
 *  - Flips all wrappedKeys for this trustor→trustee pair to isActive: true
 *  The trusteeRelationships doc itself is updated by TrusteeRelationshipService.
 *
 * DECLINE / REVOKE (rollback):
 *  - Removes trustee from role arrays + trustees[]
 *  - Deletes inactive wrappedKeys
 *  - Blockchain revocation handled upstream by TrusteeBlockchainService
 *
 * Trust level → role resolution (mirrors MemberRoleManager.sol):
 *  - Observer   → always viewer
 *  - Custodian  → mirrors trustor role, capped at administrator
 *  - Controller → mirrors trustor role exactly (including owner)
 */

import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  arrayUnion,
  updateDoc,
  doc,
  getDoc,
  arrayRemove,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { WalletService } from '@/features/BlockchainWallet/services/walletService';
import { TrustLevel } from './trusteeRelationshipService';
import { Role } from '@/features/Permissions/services/permissionsService';
import { BlockchainRoleManagerService } from '@/features/Permissions/services/blockchainRoleManagerService';
import { SharingService } from '@/features/Sharing/services/sharingService';
import { getAuth } from 'firebase/auth';
import writePermissionChangeEvent from '@/features/Permissions/services/writePermissionChangeEvent';
import { BlockchainRef, PermissionChange, buildMemberRegistryRef } from '@belrose/shared';
import { WrappedKeyHistoryEvent } from '@/types/core';

interface TrusteeRecordAccess {
  recordId: string;
  role: Role;
  hadPriorAccess: boolean; // true if trustee already had independent access before this relationship
  previousRole: Role | null;
  trustorRole: Role | null;
}

const ROLE_RANK: Record<Role, number> = { viewer: 1, sharer: 2, administrator: 3, owner: 4 };

/**
 * Look up a user's current role on a record from its role arrays.
 */
export function getRoleFromRecordData(
  data: { owners?: string[]; administrators?: string[]; sharers?: string[]; viewers?: string[] },
  userId: string
): Role | null {
  if (data.owners?.includes(userId)) return 'owner';
  if (data.administrators?.includes(userId)) return 'administrator';
  if (data.sharers?.includes(userId)) return 'sharer';
  if (data.viewers?.includes(userId)) return 'viewer';
  return null;
}

export class TrusteePermissionService {
  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Query all records where the trustor is an active subject.
   * Runs on the trustor's client — they have read access to their own records.
   *
   * Optionally pass trusteeId to also return the trustee's current role on each record.
   * Used by grantPendingTrusteeAccess to skip/upgrade appropriately.
   */
  static async getRecordsForTrustor(
    trustorId: string,
    trusteeId?: string
  ): Promise<
    {
      recordId: string;
      trustorRole: Role | null;
      currentTrusteeRole?: Role | null;
      recordTrustees: string[];
    }[]
  > {
    const db = getFirestore();
    const q = query(collection(db, 'records'), where('subjects', 'array-contains', trustorId));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(d => {
      const data = d.data();

      let trustorRole: Role | null = null;
      if (data.owners?.includes(trustorId)) trustorRole = 'owner';
      else if (data.administrators?.includes(trustorId)) trustorRole = 'administrator';
      else if (data.sharers?.includes(trustorId)) trustorRole = 'sharer';
      else if (data.viewers?.includes(trustorId)) trustorRole = 'viewer';

      const recordTrustees: string[] = data.trustees ?? [];

      if (!trusteeId) return { recordId: d.id, trustorRole, recordTrustees };

      let currentTrusteeRole: Role | null = null;
      if (data.owners?.includes(trusteeId)) currentTrusteeRole = 'owner';
      else if (data.administrators?.includes(trusteeId)) currentTrusteeRole = 'administrator';
      else if (data.sharers?.includes(trusteeId)) currentTrusteeRole = 'sharer';
      else if (data.viewers?.includes(trusteeId)) currentTrusteeRole = 'viewer';

      return { recordId: d.id, trustorRole, currentTrusteeRole, recordTrustees };
    });
  }

  /**
   * Resolve what role the trustee should get based on trust level + trustor's role.
   * Mirrors _resolveTrusteeRole in MemberRoleManager.sol.
   *
   * Sharers and viewers can only delegate viewer access — they cannot propagate
   * sharer rights they don't have the authority to grant directly.
   *
   * Optionally pass currentTrusteeRole to skip the grant if the trustee already has
   * an equal or higher role — prevents redundant grants and unintended downgrades
   * at invite time. Don't pass this for updateTrusteeAccess (downgrades are valid there).
   */
  private static resolveTrusteeRole(
    trustLevel: TrustLevel,
    trustorRole: Role | null,
    currentTrusteeRole?: Role | null
  ): Role | null {
    const resolved = (() => {
      if (trustLevel === 'observer') return 'viewer';
      if (!trustorRole) return null;
      // Sharers and viewers can only delegate viewer access
      if (trustorRole === 'sharer' || trustorRole === 'viewer') return 'viewer';
      if (trustLevel === 'custodian')
        return trustorRole === 'owner' ? 'administrator' : trustorRole; // admin → admin
      return trustorRole; // controller — full mirror (owner/admin only reach here)
    })();

    // If trustee already has an equal or higher role, no change needed
    if (currentTrusteeRole !== undefined && resolved !== null && currentTrusteeRole !== null) {
      const rank: Record<Role, number> = { viewer: 1, sharer: 2, administrator: 3, owner: 4 };
      if (rank[currentTrusteeRole] >= rank[resolved]) {
        console.log(`ℹ️ Trustee already has equal/higher role (${currentTrusteeRole}) — skipping`);
        return null;
      }
    }

    return resolved;
  }

  /**
   * Get the Firestore role array name for a given role.
   */
  private static roleToArray(role: Role): 'owners' | 'administrators' | 'sharers' | 'viewers' {
    switch (role) {
      case 'owner':
        return 'owners';
      case 'administrator':
        return 'administrators';
      case 'sharer':
        return 'sharers';
      case 'viewer':
        return 'viewers';
    }
  }

  /**
   * Builds a single wrappedKeys history entry for the batch/direct wrappedKeys mutations in this
   * file (activate/revoke) — mirrors SharingService's own historyEvent helper, since those are the
   * two other places (grant/revoke/reactivate) that stamp the same wrappedKeys.history array.
   */
  private static historyEvent(action: WrappedKeyHistoryEvent['action'], by: string): WrappedKeyHistoryEvent {
    return { action, by, at: new Date() };
  }

  // ============================================================================
  // PUBLIC METHODS
  // ============================================================================

  /**
   * Fan out access to all trustor records at INVITE time.
   * Called by TrusteeRelationshipService.inviteTrustee — runs on the TRUSTOR's client.
   *
   * Creates all permissions in a pending state:
   *  - Blockchain role granted
   *  - wrappedKeys created with isActive: false
   *  - Trustee added to role arrays + trustees[] on each record
   *
   * Everything is live in Firestore but the wrappedKey is inactive,
   * so the trustee can't decrypt anything until they accept.
   *
   * Flow:
   *  1. Query all records where trustor is a subject
   *  2. Resolve role per record
   *  3. Batch grant blockchain roles
   *  4. Create inactive wrappedKeys via SharingService
   *  5. Update Firestore role arrays + trustees[]
   */
  static async grantPendingTrusteeAccess(
    trusteeId: string,
    trustLevel: TrustLevel,
    blockchainRef: BlockchainRef
  ): Promise<void> {
    const auth = getAuth();
    const trustorId = auth.currentUser?.uid;
    if (!trustorId) throw new Error('User not authenticated');

    console.log('🔄 Fanning out pending trustee access...', { trustorId, trusteeId, trustLevel });

    // Pass trusteeId so we can check their current role on each record
    const records = await this.getRecordsForTrustor(trustorId, trusteeId);

    if (records.length === 0) {
      console.log('ℹ️ No records found for trustor — nothing to fan out');
      return;
    }

    const accessList = records
      .map(({ recordId, trustorRole, currentTrusteeRole }) => ({
        recordId,
        // Pass currentTrusteeRole — skips if trustee already has equal/higher role
        role: this.resolveTrusteeRole(trustLevel, trustorRole, currentTrusteeRole),
        hadPriorAccess: currentTrusteeRole !== null,
        previousRole: currentTrusteeRole ?? null,
        trustorRole,
      }))
      .filter((r): r is TrusteeRecordAccess => r.role !== null);

    if (accessList.length === 0) {
      console.log('ℹ️ Trustor has no roles on any records — nothing to grant');
      return;
    }

    // Create inactive wrappedKeys + update Firestore arrays per record
    // We do these together so the record stays consistent even if we crash partway through
    const db = getFirestore();

    for (const { recordId, role, hadPriorAccess, previousRole, trustorRole } of accessList) {
      try {
        await SharingService.grantEncryptionAccess(recordId, trusteeId, trustorId, {
          isActive: false,
        });

        const roleArray = this.roleToArray(role);
        const trustorIsAdminOrOwner = trustorRole === 'owner' || trustorRole === 'administrator';

        const update: any = {
          [roleArray]: arrayUnion(trusteeId),
          ...(!hadPriorAccess && { trustees: arrayUnion(trusteeId) }),
        };

        if (trustorIsAdminOrOwner) {
          if (roleArray !== 'owners') update.owners = arrayRemove(trusteeId);
          if (roleArray !== 'administrators') update.administrators = arrayRemove(trusteeId);
          if (roleArray !== 'sharers') update.sharers = arrayRemove(trusteeId);
          if (roleArray !== 'viewers') update.viewers = arrayRemove(trusteeId);
        }

        await updateDoc(doc(db, 'records', recordId), update);

        const change: PermissionChange = hadPriorAccess
          ? {
              userId: trusteeId,
              action: 'upgraded',
              previousRole: previousRole as Role,
              newRole: role,
            }
          : { userId: trusteeId, action: 'granted', previousRole: null, newRole: role };

        await writePermissionChangeEvent(
          recordId,
          trustorId,
          [change],
          blockchainRef,
          undefined,
          'trustee_grant'
        );

        console.log(`✅ Pending access granted: ${trusteeId} as ${role} on record ${recordId}`);
      } catch (err) {
        console.error(`⚠️ Failed to grant pending access on record ${recordId}:`, err);
      }
    }

    console.log(`✅ Pending trustee access fan-out complete: ${accessList.length} records`);
  }

  /**
   * Activate all pending wrappedKeys when the trustee accepts the invite.
   * Called by TrusteeRelationshipService.acceptInvite — runs on the TRUSTEE's client.
   *
   * The trustee already has read access to records (they're in role arrays),
   * and they own their own wrappedKeys so they can update them.
   *
   * Note: TrusteeRelationshipService handles flipping the relationship doc to active.
   */
  /**
   * Activate all pending wrappedKeys when the trustee accepts the invite.
   * Called by TrusteeRelationshipService.acceptInvite — runs on the TRUSTEE's client.
   *
   * The trustee already has read access to records (they're in role arrays),
   * and they own their own wrappedKeys so they can update them.
   *
   * Note: TrusteeRelationshipService handles flipping the relationship doc to active.
   */
  static async activateTrusteeAccess(trustorId: string): Promise<void> {
    const auth = getAuth();
    const trusteeId = auth.currentUser?.uid;
    if (!trusteeId) throw new Error('User not authenticated');

    console.log('🔄 Activating trustee wrappedKeys...', { trustorId, trusteeId });

    const db = getFirestore();

    // Find all inactive wrappedKeys for this trustee that were granted by the trustor
    // wrappedKey format: `${recordId}_${trusteeId}`
    // We find them by querying for the trustee's keys where grantedBy === trustorId
    const q = query(
      collection(db, 'wrappedKeys'),
      where('userId', '==', trusteeId),
      where('grantedBy', '==', trustorId),
      where('isActive', '==', false)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      console.log('ℹ️ No pending wrappedKeys found to activate');
      return;
    }

    // Batch activate all pending wrappedKeys
    const batch = writeBatch(db);
    snapshot.docs.forEach(d => {
      batch.update(d.ref, {
        isActive: true,
        activatedAt: new Date(),
        history: arrayUnion(this.historyEvent('reactivated', trusteeId)),
      });
    });
    await batch.commit();

    console.log(`✅ Activated ${snapshot.size} wrappedKeys for trustee ${trusteeId}`);
  }

  /**
   * Rollback all pending access when the trustee DECLINES an invite.
   * Called by TrusteeRelationshipService.declineInvite — runs on the TRUSTEE's client.
   *
   * Removes trustee from role arrays + trustees[], deletes inactive wrappedKeys.
   * Blockchain revocation is handled upstream by TrusteeBlockchainService.
   */
  static async rollbackPendingTrusteeAccess(
    trustorId: string,
    trusteeId: string,
    blockchainRef: BlockchainRef | null
  ): Promise<void> {
    const auth = getAuth();
    const currentUserId = auth.currentUser?.uid;
    if (!currentUserId) throw new Error('User not authenticated');

    //Can be called either by the trustor when revoking an invite or trustee when rejecting one
    if (currentUserId !== trustorId && currentUserId !== trusteeId) {
      throw new Error('Unauthorized: you are not a party to this trustee relationship');
    }

    const db = getFirestore();

    // Find all inactive wrappedKeys granted by the trustor to this trustee
    const q = query(
      collection(db, 'wrappedKeys'),
      where('userId', '==', trusteeId),
      where('grantedBy', '==', trustorId),
      where('isActive', '==', false)
    );

    const snapshot = await getDocs(q);

    for (const wrappedKeyDoc of snapshot.docs) {
      const { recordId } = wrappedKeyDoc.data();

      try {
        const recordRef = doc(db, 'records', recordId);
        const recordSnap = await getDoc(recordRef);
        const recordData = recordSnap.exists() ? recordSnap.data() : null;

        // Skip records where this trustee's access predates (or is independent of) the trust
        // relationship. grantPendingTrusteeAccess only adds the trustees[] marker when the
        // trustee didn't already have independent access (hadPriorAccess) — its absence here
        // means this role isn't trustee-derived, so it must be left alone. The records rule's
        // trustee-self-adjust branch also requires trustees[] membership, so attempting this
        // update for a non-trustee-derived role would fail permission-denied anyway.
        if (!recordData || !(recordData.trustees ?? []).includes(trusteeId)) {
          console.log(
            `ℹ️ Skipping record ${recordId} — trustee's access there is independent of this relationship`
          );
          continue;
        }

        const previousRole = getRoleFromRecordData(recordData, trusteeId);

        // Write the audit event BEFORE stripping the role below — permissionHistory's create
        // rule requires the writer to currently hold a role on the record, which they're about
        // to lose. blockchainRef may be null (no new on-chain tx — see
        // TrusteeBlockchainService's self-heal paths); the record of who/what/when is still
        // worth keeping either way.
        if (previousRole) {
          await writePermissionChangeEvent(
            recordId,
            currentUserId,
            [{ userId: trusteeId, action: 'revoked', previousRole, newRole: null }],
            blockchainRef,
            undefined,
            'trustee_revoke'
          );
        }

        // Remove from role arrays + trustees[] — we check all four role arrays
        // since we don't know which role they were granted without re-querying
        await updateDoc(recordRef, {
          owners: arrayRemove(trusteeId),
          administrators: arrayRemove(trusteeId),
          sharers: arrayRemove(trusteeId),
          viewers: arrayRemove(trusteeId),
          trustees: arrayRemove(trusteeId),
        });

        // Delete the inactive wrappedKey
        await deleteDoc(wrappedKeyDoc.ref);

        console.log(`✅ Rolled back pending access on record ${recordId}`);
      } catch (err) {
        console.error(`⚠️ Failed to rollback access on record ${recordId}:`, err);
      }
    }

    console.log('✅ Pending trustee access rollback complete');
  }

  /**
   * Revoke all active trustee access when the trustor REVOKES or trustee RESIGNS.
   * Called by TrusteeRelationshipService on revoke or resign.
   * Blockchain revocation is handled upstream — this handles Firestore + wrappedKeys only.
   */
  static async revokeTrusteeAccess(
    trustorId: string,
    trusteeId: string,
    blockchainRef: BlockchainRef | null
  ): Promise<void> {
    console.log('🔄 Revoking active trustee access...', { trustorId, trusteeId });

    const changedBy = getAuth().currentUser?.uid ?? trustorId;
    const db = getFirestore();

    // Find all active wrappedKeys for this trustee granted by the trustor
    const q = query(
      collection(db, 'wrappedKeys'),
      where('userId', '==', trusteeId),
      where('grantedBy', '==', trustorId),
      where('isActive', '==', true)
    );

    const snapshot = await getDocs(q);

    for (const wrappedKeyDoc of snapshot.docs) {
      const { recordId } = wrappedKeyDoc.data();

      try {
        const recordRef = doc(db, 'records', recordId);
        const recordSnap = await getDoc(recordRef);
        const recordData = recordSnap.exists() ? recordSnap.data() : null;

        // Skip records where this trustee's access predates (or is independent of) the trust
        // relationship. grantPendingTrusteeAccess only adds the trustees[] marker when the
        // trustee didn't already have independent access (hadPriorAccess) — its absence here
        // means this role isn't trustee-derived, so it must be left alone (the same physical
        // wrappedKey doc would otherwise get deactivated out from under their independent
        // access too, since it's one doc per record+user, not per-relationship). The records
        // rule's trustee-self-adjust branch also requires trustees[] membership, so attempting
        // this update for a non-trustee-derived role would fail permission-denied anyway.
        if (!recordData || !(recordData.trustees ?? []).includes(trusteeId)) {
          console.log(
            `ℹ️ Skipping record ${recordId} — trustee's access there is independent of this relationship`
          );
          continue;
        }

        const previousRole = getRoleFromRecordData(recordData, trusteeId);

        // Write the audit event BEFORE stripping the role below — permissionHistory's create
        // rule requires the writer to currently hold a role on the record, which they're about
        // to lose. blockchainRef may be null when the on-chain side was already in its end
        // state before this call (see TrusteeBlockchainService.revokeTrustee) — no fresh tx to
        // cite, but the record of who/what/when is still worth keeping.
        if (previousRole) {
          await writePermissionChangeEvent(
            recordId,
            changedBy,
            [{ userId: trusteeId, action: 'revoked', previousRole, newRole: null }],
            blockchainRef,
            undefined,
            'trustee_revoke'
          );
        }

        // Remove from all role arrays + trustees[]
        await updateDoc(recordRef, {
          owners: arrayRemove(trusteeId),
          administrators: arrayRemove(trusteeId),
          sharers: arrayRemove(trusteeId),
          viewers: arrayRemove(trusteeId),
          trustees: arrayRemove(trusteeId),
        });

        // Deactivate rather than delete — preserves audit trail
        await updateDoc(wrappedKeyDoc.ref, {
          isActive: false,
          revokedAt: new Date(),
          revokedBy: trustorId,
          history: arrayUnion(this.historyEvent('revoked', trustorId)),
        });

        console.log(`✅ Revoked access on record ${recordId}`);
      } catch (err) {
        console.error(`⚠️ Failed to revoke access on record ${recordId}:`, err);
      }
    }

    console.log('✅ Trustee access revocation complete');
  }

  /**
   * Fan out access to all active trustees when the trustor is added to a NEW record.
   * Called by SubjectService after addSubject succeeds — runs on whoever added the subject
   *
   * Mirrors grantPendingTrusteeAccess but for a single record and activates immediately
   * since existing trustees have already accepted.
   *
   * Note: HealthRecordCore.anchorRecord already triggers MemberRoleManager.extendTrusteeGrantsOnAnchor
   * as part of the anchor transaction, which may have already granted (or deliberately skipped) each
   * trustee's on-chain role before this runs. So this reads actual on-chain role state per trustee
   * rather than trusting Firestore's role arrays, and always mirrors Firestore/wrappedKeys regardless
   * of whether a chain write happens here.
   *
   * anchorTx is the subject's anchor transaction (HealthRecordCore.anchorRecord) that triggered this
   * fan-out — pass it so we can cite it as the audit-log source when a trustee's role turns out to
   * already be correct (i.e. extendTrusteeGrantsOnAnchor granted it automatically, in that same tx,
   * and we make no chain call of our own here). When we DO make our own grantRole/changeRole call
   * below, we cite THAT call's own ref instead — never the anchor's — since that's the tx that
   * actually did it.
   */
  static async grantAccessForNewRecord(
    subjectId: string,
    recordId: string,
    anchorTx?: { txHash: string; blockNumber: number } | null
  ): Promise<void> {
    console.log('🔄 Granting trustee access for new record...', { subjectId, recordId });

    const db = getFirestore();

    // Get active trustees for this subject
    const q = query(
      collection(db, 'trusteeRelationships'),
      where('trustorId', '==', subjectId),
      where('isActive', '==', true)
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      console.log('ℹ️ No active trustees for subject — nothing to fan out');
      return;
    }

    const recordDoc = await getDoc(doc(db, 'records', recordId));
    if (!recordDoc.exists()) throw new Error('Record not found');

    const recordData = recordDoc.data();
    let subjectRole: Role | null = null;
    if (recordData.owners?.includes(subjectId)) subjectRole = 'owner';
    else if (recordData.administrators?.includes(subjectId)) subjectRole = 'administrator';
    else if (recordData.sharers?.includes(subjectId)) subjectRole = 'sharer';
    else if (recordData.viewers?.includes(subjectId)) subjectRole = 'viewer';

    for (const relationshipDoc of snapshot.docs) {
      const { trusteeId, trustLevel } = relationshipDoc.data();

      // Firestore's role arrays, taken before any writes below — tells us whether the trustee
      // already had independent access (unrelated to this trustee relationship) and doubles as
      // the "previous role" for the audit log.
      const previousBackendRole = getRoleFromRecordData(recordData, trusteeId);

      try {
        // Trustor grants role from their own wallet (msg.sender = trustor, which holds the role)
        const trusteeWallet = await WalletService.getUserWalletAddress(trusteeId);
        if (!trusteeWallet) {
          console.error(`⚠️ No wallet found for trustee ${trusteeId} — skipping`);
          continue;
        }

        // Read the trustee's actual on-chain role rather than Firestore's arrays. This determines what we need to do on chain,
        // change an existing Role or grant a new role. Firestore/wrappedKeys are always updated regardless of whether a chain call is needed.
        const currentOnChainRoleDetails = await BlockchainRoleManagerService.getRoleDetails(
          recordId,
          trusteeWallet
        );
        const currentOnChainTrusteeRole: Role | null = currentOnChainRoleDetails.isActive
          ? (currentOnChainRoleDetails.role as Role)
          : null;

        const desiredRole = this.resolveTrusteeRole(
          trustLevel as TrustLevel,
          subjectRole,
          currentOnChainTrusteeRole
        );

        // The blockchainRef to cite for this trustee's audit-log entry, if any — set below to
        // whichever transaction actually produced the on-chain role.
        let roleChangeRef: BlockchainRef | undefined;

        if (desiredRole) {
          // No active role yet → grantRole; already has a different (lower) role → changeRole.
          // grantRole reverts if any role exists, changeRole reverts if the role is unchanged,
          // so which one applies depends entirely on currentOnChainTrusteeRole.
          const result = currentOnChainTrusteeRole
            ? await BlockchainRoleManagerService.changeRole(recordId, trusteeWallet, desiredRole)
            : await BlockchainRoleManagerService.grantRole(recordId, trusteeWallet, desiredRole);

          if (!result.txHash) {
            console.error(
              `⚠️ Blockchain ${currentOnChainTrusteeRole ? 'change' : 'grant'} failed for trustee ${trusteeId} on record ${recordId}`
            );
            continue;
          }

          roleChangeRef = buildMemberRegistryRef(result.txHash, result.blockNumber);
        } else if (anchorTx) {
          // Nothing to do on-chain — extendTrusteeGrantsOnAnchor already granted this role
          // automatically inside the anchor transaction itself. Cite that tx as the source,
          // tagged as a MemberRoleManager event since that's the contract that actually emitted
          // RoleGranted, even though it ran as an internal call within the anchor tx.
          roleChangeRef = buildMemberRegistryRef(anchorTx.txHash, anchorTx.blockNumber);
        }

        const finalRole = desiredRole ?? currentOnChainTrusteeRole;
        if (!finalRole) {
          console.log(`ℹ️ Skipping trustee ${trusteeId} on record ${recordId} — no role needed`);
          continue;
        }

        // Mirror Firestore + encryption regardless of whether we made a chain call above — both
        // calls are idempotent/no-op if already up to date, and this is the only way Firestore and
        // the trustee's wrappedKey learn about a role the auto-grant already set on-chain.
        await SharingService.grantEncryptionAccess(recordId, trusteeId, subjectId);

        // Only tag as trustee-derived if they didn't already have independent access
        await updateDoc(doc(db, 'records', recordId), {
          owners: arrayRemove(trusteeId),
          administrators: arrayRemove(trusteeId),
          sharers: arrayRemove(trusteeId),
          viewers: arrayRemove(trusteeId),
          [this.roleToArray(finalRole)]: arrayUnion(trusteeId),
          ...(!previousBackendRole && { trustees: arrayUnion(trusteeId) }),
        });

        // Only log when Firestore's role actually changed and we have a tx to cite — skips
        // both a true no-op (finalRole matches what Firestore already had) and the case where
        // no anchorTx was passed in and we made no chain call of our own.
        if (roleChangeRef && previousBackendRole !== finalRole) {
          const change: PermissionChange = previousBackendRole
            ? {
                userId: trusteeId,
                action: 'upgraded',
                previousRole: previousBackendRole,
                newRole: finalRole,
              }
            : { userId: trusteeId, action: 'granted', previousRole: null, newRole: finalRole };

          await writePermissionChangeEvent(
            recordId,
            subjectId,
            [change],
            roleChangeRef,
            undefined,
            'trustee_grant'
          );
        }

        console.log(`✅ Trustee ${trusteeId} at ${finalRole} on new record ${recordId}`);
      } catch (err) {
        console.error(`⚠️ Failed to grant trustee ${trusteeId} access on record ${recordId}:`, err);
      }
    }

    console.log(`✅ Trustee fan-out complete for new record ${recordId}`);
  }

  /**
   * Revoke each active trustee's role on a SINGLE record when the subject/trustor is removed
   * from it. Called by SubjectService.rejectSubjectStatus.
   *
   * Only touches access that was actually derived from a trustee relationship on this record
   * (tagged in the record's trustees[]) — a trustee who separately has independent access here
   * keeps it untouched.
   *
   * HealthRecordCore.unanchorRecord already triggers MemberRoleManager.retractTrusteeGrantsOnUnanchor
   * as part of the unanchor transaction, mirroring how anchorRecord's extendTrusteeGrantsOnAnchor
   * auto-grants — so by the time this runs, every trustee-derived role on this record should
   * already be revoked on-chain. This reads actual on-chain state per trustee rather than assuming
   * that happened, and only falls back to an explicit revokeRole call if it somehow didn't (e.g.
   * Firestore/chain drift). Firestore/wrappedKeys are always mirrored regardless of which path ran.
   *
   * unanchorTx is the subject's unanchor transaction that triggered this cleanup — cited as the
   * audit-log source when the on-chain state already reflects the revocation. When we DO make our
   * own revokeRole call below (the drift fallback), we cite THAT call's own ref instead.
   */
  static async revokeAccessForRemovedRecord(
    subjectId: string,
    recordId: string,
    unanchorTx?: { txHash: string; blockNumber: number } | null
  ): Promise<void> {
    console.log('🔄 Revoking trustee access for removed record...', { subjectId, recordId });

    const db = getFirestore();

    const q = query(
      collection(db, 'trusteeRelationships'),
      where('trustorId', '==', subjectId),
      where('isActive', '==', true)
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      console.log('ℹ️ No active trustees for subject — nothing to revoke');
      return;
    }

    const recordRef = doc(db, 'records', recordId);
    const recordDoc = await getDoc(recordRef);
    if (!recordDoc.exists()) {
      console.log('ℹ️ Record no longer exists — nothing to revoke');
      return;
    }

    const recordData = recordDoc.data();
    const trusteeDerivedIds: string[] = recordData.trustees ?? [];

    for (const relationshipDoc of snapshot.docs) {
      const { trusteeId } = relationshipDoc.data();

      // Only touch access that was actually derived from this trustee relationship on this
      // record — a trustee with independent access here (not tagged in trustees[]) keeps it.
      if (!trusteeDerivedIds.includes(trusteeId)) continue;

      const previousRole = getRoleFromRecordData(recordData, trusteeId);
      if (!previousRole) continue;

      try {
        const trusteeWallet = await WalletService.getUserWalletAddress(trusteeId);
        if (!trusteeWallet) {
          console.error(`⚠️ No wallet found for trustee ${trusteeId} — skipping`);
          continue;
        }

        const currentOnChainRoleDetails = await BlockchainRoleManagerService.getRoleDetails(
          recordId,
          trusteeWallet
        );

        // The blockchainRef to cite for this trustee's audit-log entry, if any.
        let roleChangeRef: BlockchainRef | undefined;

        if (!currentOnChainRoleDetails.isActive) {
          // Already revoked — retractTrusteeGrantsOnUnanchor handled it inside the unanchor tx.
          if (unanchorTx) {
            roleChangeRef = buildMemberRegistryRef(unanchorTx.txHash, unanchorTx.blockNumber);
          }
        } else {
          // Still active despite being tagged as trustee-derived — Firestore/chain drift.
          // Revoke it explicitly as a self-healing fallback.
          const result = await BlockchainRoleManagerService.revokeRole(recordId, trusteeWallet);
          if (!result.txHash) {
            console.error(
              `⚠️ Blockchain revoke failed for trustee ${trusteeId} on record ${recordId}`
            );
            continue;
          }
          roleChangeRef = buildMemberRegistryRef(result.txHash, result.blockNumber);
        }

        await updateDoc(recordRef, {
          owners: arrayRemove(trusteeId),
          administrators: arrayRemove(trusteeId),
          sharers: arrayRemove(trusteeId),
          viewers: arrayRemove(trusteeId),
          trustees: arrayRemove(trusteeId),
        });

        // Deactivate rather than delete — preserves audit trail, mirrors revokeTrusteeAccess.
        // wrappedKey format: `${recordId}_${trusteeId}` (see SharingService.grantEncryptionAccess).
        const wrappedKeyRef = doc(db, 'wrappedKeys', `${recordId}_${trusteeId}`);
        const wrappedKeySnap = await getDoc(wrappedKeyRef);
        if (wrappedKeySnap.exists()) {
          await updateDoc(wrappedKeyRef, {
            isActive: false,
            revokedAt: new Date(),
            revokedBy: subjectId,
            history: arrayUnion(this.historyEvent('revoked', subjectId)),
          });
        }

        if (roleChangeRef) {
          await writePermissionChangeEvent(
            recordId,
            subjectId,
            [{ userId: trusteeId, action: 'revoked', previousRole, newRole: null }],
            roleChangeRef,
            undefined,
            'trustee_revoke'
          );
        }

        console.log(`✅ Revoked trustee ${trusteeId} access on removed record ${recordId}`);
      } catch (err) {
        console.error(
          `⚠️ Failed to revoke trustee ${trusteeId} access on record ${recordId}:`,
          err
        );
      }
    }

    console.log(`✅ Trustee revocation complete for removed record ${recordId}`);
  }

  /**
   * Update trustee's role across all trustor records when trust level changes.
   * Called by TrusteeRelationshipService.editTrusteeRelationship.
   */
  static async updateTrusteeAccess(
    trustorId: string,
    trusteeId: string,
    newTrustLevel: TrustLevel,
    blockchainRef: BlockchainRef | null
  ): Promise<void> {
    console.log('🔄 Updating trustee access across records...', {
      trustorId,
      trusteeId,
      newTrustLevel,
    });

    const changedBy = getAuth().currentUser?.uid ?? trustorId;
    const db = getFirestore();

    // Only touch records where the trustee's access was granted via this relationship.
    // Records where they have independent access (e.g. they're the uploader) are excluded —
    // they were never added to trustees[] at invite time (hadPriorAccess guard).
    const keysQuery = query(
      collection(db, 'wrappedKeys'),
      where('userId', '==', trusteeId),
      where('grantedBy', '==', trustorId),
      where('isActive', '==', true)
    );
    const keysSnapshot = await getDocs(keysQuery);
    const trusteeDerivedRecordIds = new Set(
      keysSnapshot.docs.map(d => d.data().recordId as string)
    );

    if (trusteeDerivedRecordIds.size === 0) {
      console.log('ℹ️ No trustee-derived records found — nothing to update');
      return;
    }

    // Fetch only the specific records already identified from wrappedKeys rather than
    // querying all trustor records — the trustee (who may be the caller) has individual
    // read access to these records but cannot do a broad subjects-contains collection query.
    const recordSnapshots = await Promise.all(
      [...trusteeDerivedRecordIds].map(id => getDoc(doc(db, 'records', id)))
    );

    const accessList: TrusteeRecordAccess[] = recordSnapshots
      .filter(snap => snap.exists())
      .map(snap => {
        const data = snap.data()!;
        let trustorRole: Role | null = null;
        if (data.owners?.includes(trustorId)) trustorRole = 'owner';
        else if (data.administrators?.includes(trustorId)) trustorRole = 'administrator';
        else if (data.sharers?.includes(trustorId)) trustorRole = 'sharer';
        else if (data.viewers?.includes(trustorId)) trustorRole = 'viewer';
        return {
          recordId: snap.id,
          trustorRole,
          previousRole: getRoleFromRecordData(data, trusteeId),
          recordTrustees: (data.trustees ?? []) as string[],
        };
      })
      // Only update records tagged in trustees[] — records where the trustee had prior
      // independent access were promoted at invite time but NOT added to trustees[].
      .filter(({ recordTrustees }) => recordTrustees.includes(trusteeId))
      .map(({ recordId, trustorRole, previousRole }) => ({
        recordId,
        role: this.resolveTrusteeRole(newTrustLevel, trustorRole),
        hadPriorAccess: false,
        previousRole,
        trustorRole,
      }))
      .filter((r): r is TrusteeRecordAccess => r.role !== null);

    if (accessList.length === 0) {
      console.log('ℹ️ No trustee-derived records with roles to update');
      return;
    }

    for (const { recordId, role, previousRole } of accessList) {
      try {
        await updateDoc(doc(db, 'records', recordId), {
          owners: arrayRemove(trusteeId),
          administrators: arrayRemove(trusteeId),
          sharers: arrayRemove(trusteeId),
          viewers: arrayRemove(trusteeId),
          [this.roleToArray(role)]: arrayUnion(trusteeId),
        });

        // blockchainRef may be null when the on-chain side was already at this level before
        // this call (see TrusteeBlockchainService.updateTrusteeLevel) — no fresh tx to cite,
        // but the record of who/what/when is still worth keeping.
        const change: PermissionChange = !previousRole
          ? { userId: trusteeId, action: 'granted', previousRole: null, newRole: role }
          : ROLE_RANK[previousRole] < ROLE_RANK[role]
            ? { userId: trusteeId, action: 'upgraded', previousRole, newRole: role }
            : { userId: trusteeId, action: 'downgraded', previousRole, newRole: role };

        await writePermissionChangeEvent(
          recordId,
          changedBy,
          [change],
          blockchainRef,
          undefined,
          'trustee_grant'
        );

        console.log(`✅ Updated ${trusteeId} to ${role} on record ${recordId}`);
      } catch (err) {
        console.error(`⚠️ Failed to update role on record ${recordId}:`, err);
      }
    }

    console.log(`✅ Trustee access update complete: ${accessList.length} records`);
  }
}
