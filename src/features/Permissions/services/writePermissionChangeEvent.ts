// src/features/Permissions/services/writePermissionChangeEvent.ts

import { encryptNotificationTitle } from '@/features/Notifications/services/encryptNotificationTitle';
import { removeUndefinedValues } from '@/utils/dataFormattingUtils';
import { PermissionChange } from '@belrose/shared';
import { id } from 'ethers';
import { serverTimestamp } from 'firebase/firestore';

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

