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
 *  - Blockchain revocation handled upstream by TrusteeRelationshipService
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
  writeBatch,
  DocumentReference,
} from 'firebase/firestore';
import { id } from 'ethers';
import * as Sentry from '@sentry/react';
import { WalletService } from '@/features/BlockchainWallet/services/walletService';
import {
  BlockchainSyncQueueService,
  getUserFacingErrorMessage,
} from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { TrustLevel } from './trusteeRelationshipService';
import { Role } from '@/features/Permissions/services/permissionsService';
import { BlockchainRoleManagerService } from '@/features/Permissions/services/blockchainRoleManagerService';
import { SharingService } from '@/features/Sharing/services/sharingService';
import { getAuth } from 'firebase/auth';
import {
  preparePermissionChangeEventData,
  buildPermissionHistoryDocId,
} from '@/features/Permissions/services/writePermissionChangeEvent';
import { PermissionChange, buildMemberRegistryRef } from '@belrose/shared';
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
  private static historyEvent(
    action: WrappedKeyHistoryEvent['action'],
    by: string
  ): WrappedKeyHistoryEvent {
    return { action, by, at: new Date() };
  }

  // ============================================================================
  // PUBLIC METHODS
  // ============================================================================

  /**
   * Fan out access to all trustor records at INVITE time.
   * Called by TrusteeRelationshipService.inviteTrustee — runs on the TRUSTOR's client.
   *
   * Creates all permissions in a pending state — role arrays + an inactive wrappedKey +
   * permissionHistory event, atomically per record — so the trustee has record-level access
   * but can't decrypt anything until they accept. Firestore-first: this runs BEFORE the
   * blockchain proposal, so blockchainRef starts null on each event; the caller fills it in
   * once the chain call resolves. Returns the records actually written to (mirroring
   * PermissionsService.grantRoleBatch's succeeded-list pattern), non-fatal per record.
   */
  static async grantPendingTrusteeAccess(
    trusteeId: string,
    trustLevel: TrustLevel
  ): Promise<{ recordId: string; role: Role; historyRef: DocumentReference }[]> {
    const auth = getAuth();
    const trustorId = auth.currentUser?.uid;
    if (!trustorId) throw new Error('User not authenticated');

    console.log('🔄 Fanning out pending trustee access...', { trustorId, trusteeId, trustLevel });

    // Pass trusteeId so we can check their current role on each record
    const records = await this.getRecordsForTrustor(trustorId, trusteeId);

    if (records.length === 0) {
      console.log('ℹ️ No records found for trustor — nothing to fan out');
      return [];
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
      return [];
    }

    const db = getFirestore();
    const succeeded: { recordId: string; role: Role; historyRef: DocumentReference }[] = [];

    for (const { recordId, role, hadPriorAccess, previousRole, trustorRole } of accessList) {
      try {
        const encryptionGrant = await SharingService.prepareEncryptionAccessGrant(
          recordId,
          trusteeId,
          trustorId,
          { isActive: false }
        );

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

        const change: PermissionChange = hadPriorAccess
          ? {
              userId: trusteeId,
              action: 'upgraded',
              previousRole: previousRole as Role,
              newRole: role,
            }
          : { userId: trusteeId, action: 'granted', previousRole: null, newRole: role };

        const historyRef = doc(
          collection(db, 'records', recordId, 'permissionHistory'),
          buildPermissionHistoryDocId(trusteeId)
        );
        const eventData = await preparePermissionChangeEventData(
          recordId,
          trustorId,
          [change],
          undefined,
          'trustee_grant'
        );

        const batch = writeBatch(db);
        batch.update(doc(db, 'records', recordId), update);
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
        console.log(`✅ Pending access granted: ${trusteeId} as ${role} on record ${recordId}`);
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: 'trustee', action: 'grantPendingTrusteeAccess', recordId },
        });
        console.error(`⚠️ Failed to grant pending access on record ${recordId}:`, err);
      }
    }

    console.log(`✅ Pending trustee access fan-out complete: ${succeeded.length} records`);
    return succeeded;
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
   * Rollback all pending access when the trustee DECLINES an invite (or the trustor revokes
   * one). Firestore-first: each record's role-array removal, wrappedKey deletion, and
   * permissionHistory event commit atomically together. The blockchain revocation is a
   * separate, best-effort step the caller owns — this returns the records it actually touched
   * so the caller can fill in blockchainRef once the chain call resolves.
   */
  static async rollbackPendingTrusteeAccess(
    trustorId: string,
    trusteeId: string
  ): Promise<{ recordId: string; historyRef: DocumentReference }[]> {
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
    const succeeded: { recordId: string; historyRef: DocumentReference }[] = [];

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

        const batch = writeBatch(db);
        batch.update(recordRef, {
          owners: arrayRemove(trusteeId),
          administrators: arrayRemove(trusteeId),
          sharers: arrayRemove(trusteeId),
          viewers: arrayRemove(trusteeId),
          trustees: arrayRemove(trusteeId),
        });
        batch.delete(wrappedKeyDoc.ref);

        // Only write the audit event when there was actually a role to revoke — mirrors the
        // original defensive guard. blockchainRef starts null; the caller fills it in once the
        // chain call resolves.
        let historyRef: DocumentReference | undefined;
        if (previousRole) {
          historyRef = doc(
            collection(db, 'records', recordId, 'permissionHistory'),
            buildPermissionHistoryDocId(trusteeId)
          );
          const eventData = await preparePermissionChangeEventData(
            recordId,
            currentUserId,
            [{ userId: trusteeId, action: 'revoked', previousRole, newRole: null }],
            undefined,
            'trustee_revoke'
          );
          batch.set(historyRef, eventData);
        }

        await batch.commit();

        if (historyRef) succeeded.push({ recordId, historyRef });
        console.log(`✅ Rolled back pending access on record ${recordId}`);
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: 'trustee', action: 'rollbackPendingTrusteeAccess', recordId },
        });
        console.error(`⚠️ Failed to rollback access on record ${recordId}:`, err);
      }
    }

    console.log('✅ Pending trustee access rollback complete');
    return succeeded;
  }

  /**
   * Revoke all active trustee access when the trustor REVOKES or trustee RESIGNS.
   * Called by TrusteeRelationshipService on revoke or resign — Firestore-first: each record's
   * role-array removal, wrappedKey deactivation, and permissionHistory event commit atomically
   * together. The blockchain revocation is a separate, best-effort step the caller owns; this
   * method never gates on it — it returns the records it actually touched so the caller can
   * fill in blockchainRef on each history event once the chain call resolves.
   *
   * One record's failure doesn't block the others — non-fatal per record, same as today.
   */
  static async revokeTrusteeAccess(
    trustorId: string,
    trusteeId: string
  ): Promise<{ recordId: string; historyRef: DocumentReference }[]> {
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
    const succeeded: { recordId: string; historyRef: DocumentReference }[] = [];

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

        const revoke = await SharingService.prepareEncryptionAccessRevoke(
          recordId,
          trusteeId,
          trustorId
        );

        const batch = writeBatch(db);
        batch.update(recordRef, {
          owners: arrayRemove(trusteeId),
          administrators: arrayRemove(trusteeId),
          sharers: arrayRemove(trusteeId),
          viewers: arrayRemove(trusteeId),
          trustees: arrayRemove(trusteeId),
        });
        if (revoke) {
          batch.update(revoke.ref, revoke.data);
        }

        // Only write the audit event when there was actually a role to revoke — previousRole
        // should always be set given the trustees[] check above, but this mirrors the original
        // defensive guard rather than assuming it. blockchainRef starts null; the caller fills
        // it in once the chain call resolves.
        let historyRef: DocumentReference | undefined;
        if (previousRole) {
          historyRef = doc(
            collection(db, 'records', recordId, 'permissionHistory'),
            buildPermissionHistoryDocId(trusteeId)
          );
          const eventData = await preparePermissionChangeEventData(
            recordId,
            changedBy,
            [{ userId: trusteeId, action: 'revoked', previousRole, newRole: null }],
            undefined,
            'trustee_revoke'
          );
          batch.set(historyRef, eventData);
        }

        await batch.commit();

        if (historyRef) succeeded.push({ recordId, historyRef });
        console.log(`✅ Revoked access on record ${recordId}`);
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: 'trustee', action: 'revokeTrusteeAccess', recordId },
        });
        console.error(`⚠️ Failed to revoke access on record ${recordId}:`, err);
      }
    }

    console.log('✅ Trustee access revocation complete');
    return succeeded;
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

    // The acting user (whoever triggered this fan-out — the subject themselves, or a
    // controller trustee anchoring on their behalf) doesn't change per trustee in this loop,
    // so it's resolved once. Best-effort, non-throwing — this whole method is already a
    // decoupled, non-fatal step from SubjectService's perspective.
    const actingUserId = getAuth().currentUser?.uid ?? subjectId;
    const actingWalletAddress =
      (await WalletService.getUserWalletAddress(actingUserId)) ?? undefined;

    for (const relationshipDoc of snapshot.docs) {
      const { trusteeId, trustLevel } = relationshipDoc.data();

      // Firestore's role arrays, taken before any writes below — tells us whether the trustee
      // already had independent access (unrelated to this trustee relationship) and doubles as
      // the "previous role" for the audit log.
      const previousBackendRole = getRoleFromRecordData(recordData, trusteeId);

      try {
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
        const finalRole = desiredRole ?? currentOnChainTrusteeRole;

        if (!finalRole) {
          console.log(`ℹ️ Skipping trustee ${trusteeId} on record ${recordId} — no role needed`);
          continue;
        }

        // desiredRole truthy means we need to make our own grantRole/changeRole call below —
        // Firestore-first, so the write happens now with blockchainRef: null and gets filled in
        // once that chain call resolves. Otherwise, either extendTrusteeGrantsOnAnchor already
        // granted this role automatically inside the anchor transaction (cite it directly, no
        // deferral needed), or there's nothing new to log at all.
        const needsOwnChainCall = !!desiredRole;
        const immediateRef =
          !needsOwnChainCall && anchorTx
            ? buildMemberRegistryRef(anchorTx.txHash, anchorTx.blockNumber)
            : undefined;
        const shouldLogChange =
          (needsOwnChainCall || immediateRef) && previousBackendRole !== finalRole;

        // Mirror Firestore + encryption regardless of whether we make a chain call below — both
        // are idempotent/no-op if already up to date, and this is the only way Firestore and
        // the trustee's wrappedKey learn about a role the auto-grant already set on-chain.
        const encryptionGrant = await SharingService.prepareEncryptionAccessGrant(
          recordId,
          trusteeId,
          subjectId
        );

        let historyRef: DocumentReference | undefined;
        const batch = writeBatch(db);
        // Only tag as trustee-derived if they didn't already have independent access
        batch.update(doc(db, 'records', recordId), {
          owners: arrayRemove(trusteeId),
          administrators: arrayRemove(trusteeId),
          sharers: arrayRemove(trusteeId),
          viewers: arrayRemove(trusteeId),
          [this.roleToArray(finalRole)]: arrayUnion(trusteeId),
          ...(!previousBackendRole && { trustees: arrayUnion(trusteeId) }),
        });
        if (encryptionGrant) {
          if (encryptionGrant.isReactivation) {
            batch.update(encryptionGrant.ref, encryptionGrant.data);
          } else {
            batch.set(encryptionGrant.ref, encryptionGrant.data);
          }
        }
        if (shouldLogChange) {
          const change: PermissionChange = previousBackendRole
            ? {
                userId: trusteeId,
                action: 'upgraded',
                previousRole: previousBackendRole,
                newRole: finalRole,
              }
            : { userId: trusteeId, action: 'granted', previousRole: null, newRole: finalRole };

          historyRef = doc(
            collection(db, 'records', recordId, 'permissionHistory'),
            buildPermissionHistoryDocId(trusteeId)
          );
          const eventData = await preparePermissionChangeEventData(
            recordId,
            subjectId,
            [change],
            undefined,
            'trustee_grant'
          );
          batch.set(historyRef, eventData);
        }

        try {
          await batch.commit();
        } catch (firestoreError) {
          Sentry.captureException(firestoreError, {
            tags: { feature: 'trustee', action: 'grantAccessForNewRecord', recordId },
          });
          throw firestoreError;
        }

        // No chain call needed from us — either cite the anchor tx directly (no deferral), or
        // there's nothing further to do for this trustee.
        if (!needsOwnChainCall) {
          if (historyRef && immediateRef) {
            await updateDoc(historyRef, { blockchainRef: immediateRef });
          }
          console.log(`✅ Trustee ${trusteeId} at ${finalRole} on new record ${recordId}`);
          continue;
        }

        // We need our own grantRole/changeRole call — best-effort, tracked, does not revert
        // the Firestore write above. No active role yet → grantRole; already has a different
        // (lower) role → changeRole.
        const syncRef = await BlockchainSyncQueueService.startAttempt({
          contract: 'MemberRoleManager',
          action: currentOnChainTrusteeRole ? 'changeRole' : 'grantRole',
          userId: actingUserId,
          userWalletAddress: actingWalletAddress,
          permissionHistoryPath: historyRef?.path,
          context: {
            type: 'permission',
            targetUserId: trusteeId,
            targetWalletAddress: trusteeWallet,
            role: finalRole,
            recordId,
            recordIdHash: id(recordId),
          },
        });

        try {
          const result = currentOnChainTrusteeRole
            ? await BlockchainRoleManagerService.changeRole(recordId, trusteeWallet, desiredRole!)
            : await BlockchainRoleManagerService.grantRole(recordId, trusteeWallet, desiredRole!);

          const blockchainRef = buildMemberRegistryRef(result.txHash, result.blockNumber);
          if (historyRef) await updateDoc(historyRef, { blockchainRef });
          await BlockchainSyncQueueService.recordSuccess(syncRef, result);

          console.log(`✅ Trustee ${trusteeId} at ${finalRole} on new record ${recordId}`);
        } catch (chainError) {
          console.error(
            `⚠️ Blockchain ${currentOnChainTrusteeRole ? 'change' : 'grant'} failed for trustee ${trusteeId} on record ${recordId}:`,
            chainError
          );
          const errorMessage = getUserFacingErrorMessage(
            chainError,
            'Blockchain transaction failed'
          );
          await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
        }
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

    // The acting user doesn't change per trustee in this loop — resolved once, best-effort.
    const actingUserId = getAuth().currentUser?.uid ?? subjectId;
    const actingWalletAddress =
      (await WalletService.getUserWalletAddress(actingUserId)) ?? undefined;

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

        // Firestore-first: the role removal + wrappedKey deactivation commit atomically
        // regardless of on-chain state. If already revoked on-chain (retractTrusteeGrantsOnUnanchor
        // handled it inside the unanchor tx), no chain call is needed from us — the history
        // event (if any) cites that tx directly. If still active (Firestore/chain drift), we
        // need our own revokeRole call below, so the event starts with blockchainRef: null.
        const alreadyRevokedOnChain = !currentOnChainRoleDetails.isActive;
        const immediateRef =
          alreadyRevokedOnChain && unanchorTx
            ? buildMemberRegistryRef(unanchorTx.txHash, unanchorTx.blockNumber)
            : undefined;
        const shouldLogChange = alreadyRevokedOnChain ? !!immediateRef : true;

        const revoke = await SharingService.prepareEncryptionAccessRevoke(
          recordId,
          trusteeId,
          subjectId
        );

        let historyRef: DocumentReference | undefined;
        const batch = writeBatch(db);
        batch.update(recordRef, {
          owners: arrayRemove(trusteeId),
          administrators: arrayRemove(trusteeId),
          sharers: arrayRemove(trusteeId),
          viewers: arrayRemove(trusteeId),
          trustees: arrayRemove(trusteeId),
        });
        if (revoke) {
          batch.update(revoke.ref, revoke.data);
        }
        if (shouldLogChange) {
          historyRef = doc(
            collection(db, 'records', recordId, 'permissionHistory'),
            buildPermissionHistoryDocId(trusteeId)
          );
          const eventData = await preparePermissionChangeEventData(
            recordId,
            subjectId,
            [{ userId: trusteeId, action: 'revoked', previousRole, newRole: null }],
            undefined,
            'trustee_revoke'
          );
          batch.set(historyRef, eventData);
        }

        try {
          await batch.commit();
        } catch (firestoreError) {
          Sentry.captureException(firestoreError, {
            tags: { feature: 'trustee', action: 'revokeAccessForRemovedRecord', recordId },
          });
          throw firestoreError;
        }

        if (alreadyRevokedOnChain) {
          if (historyRef && immediateRef) {
            await updateDoc(historyRef, { blockchainRef: immediateRef });
          }
          console.log(`✅ Revoked trustee ${trusteeId} access on removed record ${recordId}`);
          continue;
        }

        // Still active despite being tagged as trustee-derived — self-healing fallback.
        // Best-effort, tracked, does not revert the Firestore write above.
        const syncRef = await BlockchainSyncQueueService.startAttempt({
          contract: 'MemberRoleManager',
          action: 'revokeRole',
          userId: actingUserId,
          userWalletAddress: actingWalletAddress,
          permissionHistoryPath: historyRef?.path,
          context: {
            type: 'permission',
            targetUserId: trusteeId,
            targetWalletAddress: trusteeWallet,
            role: previousRole,
            recordId,
            recordIdHash: id(recordId),
          },
        });

        try {
          const result = await BlockchainRoleManagerService.revokeRole(recordId, trusteeWallet);
          const blockchainRef = buildMemberRegistryRef(result.txHash, result.blockNumber);
          if (historyRef) await updateDoc(historyRef, { blockchainRef });
          await BlockchainSyncQueueService.recordSuccess(syncRef, result);

          console.log(`✅ Revoked trustee ${trusteeId} access on removed record ${recordId}`);
        } catch (chainError) {
          console.error(
            `⚠️ Blockchain revoke failed for trustee ${trusteeId} on record ${recordId}:`,
            chainError
          );
          const errorMessage = getUserFacingErrorMessage(
            chainError,
            'Blockchain transaction failed'
          );
          await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
        }
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
   * Called by TrusteeRelationshipService.editTrusteeRelationship/stepDownTrusteeLevel.
   * Firestore-first: each record's role-array change + permissionHistory event commit
   * atomically together, non-fatal per record. Returns the records actually touched so the
   * caller can fill in blockchainRef once the chain call resolves.
   */
  static async updateTrusteeAccess(
    trustorId: string,
    trusteeId: string,
    newTrustLevel: TrustLevel
  ): Promise<{ recordId: string; historyRef: DocumentReference }[]> {
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
      return [];
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
      return [];
    }

    const succeeded: { recordId: string; historyRef: DocumentReference }[] = [];

    for (const { recordId, role, previousRole } of accessList) {
      try {
        const recordRef = doc(db, 'records', recordId);
        const historyRef = doc(
          collection(db, 'records', recordId, 'permissionHistory'),
          buildPermissionHistoryDocId(trusteeId)
        );

        const change: PermissionChange = !previousRole
          ? { userId: trusteeId, action: 'granted', previousRole: null, newRole: role }
          : ROLE_RANK[previousRole] < ROLE_RANK[role]
            ? { userId: trusteeId, action: 'upgraded', previousRole, newRole: role }
            : { userId: trusteeId, action: 'downgraded', previousRole, newRole: role };

        // blockchainRef starts null; the caller (TrusteeRelationshipService) fills it in once
        // the chain call resolves — stays null if that call fails (tracked separately via
        // BlockchainSyncQueueService), but the record of who/what/when is still worth keeping.
        const eventData = await preparePermissionChangeEventData(
          recordId,
          changedBy,
          [change],
          undefined,
          'trustee_grant'
        );

        const batch = writeBatch(db);
        batch.update(recordRef, {
          owners: arrayRemove(trusteeId),
          administrators: arrayRemove(trusteeId),
          sharers: arrayRemove(trusteeId),
          viewers: arrayRemove(trusteeId),
          [this.roleToArray(role)]: arrayUnion(trusteeId),
        });
        batch.set(historyRef, eventData);
        await batch.commit();

        succeeded.push({ recordId, historyRef });
        console.log(`✅ Updated ${trusteeId} to ${role} on record ${recordId}`);
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: 'trustee', action: 'updateTrusteeAccess', recordId },
        });
        console.error(`⚠️ Failed to update role on record ${recordId}:`, err);
      }
    }

    console.log(`✅ Trustee access update complete: ${succeeded.length} records`);
    return succeeded;
  }
}
