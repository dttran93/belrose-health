// src/features/Permissions/services/permissionsService.ts

import { encryptNotificationTitle } from '@/features/Notifications/services/encryptNotificationTitle';
import { removeUndefinedValues } from '@/utils/dataFormattingUtils';
import { BlockchainRef, PermissionChange } from '@belrose/shared';
import { id } from 'ethers';
import { addDoc, collection, getFirestore, serverTimestamp } from 'firebase/firestore';

// Timestamp-prefixed so a raw Firestore console listing (sorted by doc ID by default) reads
// chronologically, plus the target user for a glance without opening the doc. Never key this off
// targetUserId alone — the same user can be granted/removed/upgraded on the same record many
// times over its life, and each has to be its own immutable entry, not overwrite the last. The
// random suffix (borrowed from Firestore's own auto-ID shape) is what actually guarantees
// uniqueness; the timestamp is for readability only.
export function buildPermissionHistoryDocId(targetUserId: string): string {
  return `${Date.now()}_${targetUserId}_${crypto.randomUUID().slice(0, 8)}`;
}

// Builds the permissionHistory event payload without writing it, so callers doing an atomic
// writeBatch (record arrays + history event together — see PermissionsService.grantAdmin) can
// batch.set() it themselves. blockchainRef always starts null here: the chain call happens after
// the Firestore batch commits, and gets filled in via a follow-up updateDoc once it resolves.
export async function preparePermissionChangeEventData(
  recordId: string,
  changedBy: string,
  changes: PermissionChange[],
  recordTitle?: string,
  context?: 'trustee_grant' | 'trustee_revoke' | 'direct',
  batchId?: string
) {
  const titleData = recordTitle ? await encryptNotificationTitle(recordTitle, recordId) : null;
  const affectedUserIds = changes.map(c => c.userId);

  return removeUndefinedValues({
    recordId,
    recordIdHash: id(recordId),
    changedBy,
    changedByIdHash: id(changedBy),
    changedAt: serverTimestamp(),
    changes,
    blockchainRef: null,
    affectedUserIds,
    ...(titleData ?? {}),
    context,
    batchId,
  });
}

async function writePermissionChangeEvent(
  recordId: string,
  changedBy: string,
  changes: PermissionChange[],
  // blockchainRef is null when there's no new on-chain transaction to cite (e.g. the chain call
  // failed) — the record of who changed what and when is still worth keeping even without a tx
  // to point to.
  blockchainRef: BlockchainRef | null,
  recordTitle?: string,
  context?: 'trustee_grant' | 'trustee_revoke' | 'direct',
  batchId?: string
): Promise<void> {
  try {
    const db = getFirestore();

    const titleData = recordTitle ? await encryptNotificationTitle(recordTitle, recordId) : null;
    const affectedUserIds = changes.map(c => c.userId);

    await addDoc(
      collection(db, 'records', recordId, 'permissionHistory'),
      removeUndefinedValues({
        recordId,
        recordIdHash: id(recordId),
        changedBy,
        changedByIdHash: id(changedBy),
        changedAt: serverTimestamp(),
        changes,
        blockchainRef,
        affectedUserIds,
        ...(titleData ?? {}),
        context,
        batchId,
      })
    );
  } catch (error) {
    // Non-fatal — don't block the permission change if logging fails
    console.warn('⚠️ Failed to write permission change event:', error);
  }
}

export default writePermissionChangeEvent;
