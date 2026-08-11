// src/features/RequestRecord/services/linkRecordService.ts

/**
 * linkRecordService
 *
 * Fulfils a record request by linking an existing record. Split into two awaitable steps so
 * the caller can block the UI on the first (fast, local setup) and fire-and-forget the second
 * (the actual blockchain write, tracked via OnChainActivityTray instead of a blocking spinner —
 * see useLinkRecord.submitAddRecords):
 *
 *   1. prepareRecordsForLinking — smart account + per-record blockchain initialization.
 *   2. addRecordsToRequest      — grant the requester a role on all records in a single
 *      blockchain tx via grantRoleBatch (blockchain role registration + RSA-wrapping the
 *      record DEK for the requester + updating the Firestore role arrays), then mark the
 *      linked record IDs on the request document.
 *
 *   Also: markRequestComplete (called by the provider when done adding records) and
 *   denyRequest (flips status to denied with reason + optional note).
 */

import { getFirestore, doc, updateDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { PermissionsService, Role } from '@/features/Permissions/services/permissionsService';
import { DenyReasonValue } from './fulfillRequestService';
import { PermissionPreparationService } from '@/features/Permissions/services/permissionPreparationService';
import { RecordRequest } from '@belrose/shared';

// ── prepare ───────────────────────────────────────────────────────────────────

/**
 * Prepare all selected records (smart account + per-record blockchain initialization) so
 * addRecordsToRequest's grant can go straight to the chain. Sequential per-record internally
 * (avoids nonce conflicts on the admin wallet used by initializeRoleOnChain) — this is the part
 * of the flow worth blocking the UI on, since it's local/fast setup rather than the transaction
 * itself.
 */
export async function prepareRecordsForLinking(recordIds: string[]): Promise<void> {
  if (recordIds.length === 0) throw new Error('No records selected');

  console.log(`🔄 Preparing ${recordIds.length} record(s) for linking…`);
  await PermissionPreparationService.prepareBatch(recordIds);
  console.log('✅ All records prepared');
}

// ── addRecords ────────────────────────────────────────────────────────────────

export interface AddRecordsResult {
  success: true;
  recordIds: string[];
}

/**
 * Grant the requester a role across all selected records in a single blockchain transaction.
 * Assumes prepareRecordsForLinking has already run for these ids — callers fire this without
 * awaiting it and track progress via OnChainActivityTray (see useLinkRecord.submitAddRecords),
 * same fire-and-forget pattern as usePermissionFlow's confirmGrant.
 */
export async function addRecordsToRequest(
  recordIds: string[],
  request: RecordRequest,
  role: Role
): Promise<AddRecordsResult> {
  if (recordIds.length === 0) throw new Error('No records selected');

  // Grant role — single blockchain tx, parallel encryption + Firestore
  const succeededIds = await PermissionsService.grantRoleBatch(
    recordIds,
    request.requesterId,
    recordIds.map(() => role)
  );
  console.log(`✅ Role '${role}' granted on ${succeededIds.length} record(s)`);

  // Register linked record IDs on the request document — only the ones that actually succeeded
  // on-chain, not every id that was requested (a partial grantRoleBatch failure must not be
  // reported to the requester as fulfilled).
  const db = getFirestore();
  await updateDoc(doc(db, 'recordRequests', request.inviteCode), {
    fulfilledRecordIds: arrayUnion(...succeededIds),
  });
  console.log('✅ fulfilledRecordIds updated:', request.inviteCode);

  return { success: true, recordIds: succeededIds };
}

// ── markComplete ──────────────────────────────────────────────────────────────

export async function markRequestComplete(request: RecordRequest): Promise<void> {
  const db = getFirestore();
  await updateDoc(doc(db, 'recordRequests', request.inviteCode), {
    status: 'fulfilled',
    fulfilledAt: serverTimestamp(),
  });
  console.log('✅ Request marked fulfilled:', request.inviteCode);
}

// ── denyRequest ───────────────────────────────────────────────────────────────

export interface DenyRequestParams {
  request: RecordRequest;
  reason: DenyReasonValue;
  note?: string;
}

export async function denyRequest({ request, reason, note }: DenyRequestParams): Promise<void> {
  const db = getFirestore();
  await updateDoc(doc(db, 'recordRequests', request.inviteCode), {
    status: 'denied',
    deniedAt: serverTimestamp(),
    deniedReason: reason,
    ...(note?.trim() ? { deniedNote: note.trim() } : {}),
  });
  console.log('✅ Request denied:', request.inviteCode, reason);
}
