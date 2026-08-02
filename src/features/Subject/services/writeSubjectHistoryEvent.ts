// src/features/Subject/services/writeSubjectHistoryEvent.ts

import { removeUndefinedValues } from '@/utils/dataFormattingUtils';
import { SubjectHistoryAction } from '@belrose/shared';
import { id } from 'ethers';
import { serverTimestamp } from 'firebase/firestore';

// Timestamp-prefixed so a raw Firestore console listing (sorted by doc ID by default) reads
// chronologically, plus the subject for a glance without opening the doc. Never key this off
// subjectId alone — the same user can be anchored/unanchored/re-anchored many times over a
// record's life, and each has to be its own immutable entry, not overwrite the last. The
// random suffix (borrowed from Firestore's own auto-ID shape) is what actually guarantees
// uniqueness; the timestamp is for readability only. Mirrors buildPermissionHistoryDocId.
export function buildSubjectHistoryDocId(subjectId: string): string {
  return `${Date.now()}_${subjectId}_${crypto.randomUUID().slice(0, 8)}`;
}

// Builds the subjectHistory event payload without writing it, so callers doing an atomic
// writeBatch (subjects array + history event together — see SubjectService.rejectSubjectStatus)
// can batch.set() it themselves. blockchainRef always starts null here: the chain call happens
// after the Firestore batch commits, and gets filled in via a follow-up updateDoc once it
// resolves.
export function prepareSubjectHistoryEventData(
  recordId: string,
  changedBy: string,
  subjectId: string,
  action: SubjectHistoryAction,
  options?: { viaConsent?: boolean }
) {
  return removeUndefinedValues({
    recordId,
    recordIdHash: id(recordId),
    subjectId,
    subjectIdHash: id(subjectId),
    action,
    changedBy,
    changedByIdHash: id(changedBy),
    changedAt: serverTimestamp(),
    blockchainRef: null,
    viaConsent: options?.viaConsent,
  });
}
