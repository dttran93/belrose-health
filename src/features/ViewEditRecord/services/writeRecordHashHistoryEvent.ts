// src/features/ViewEditRecord/services/writeRecordHashHistoryEvent.ts

import { id } from 'ethers';
import { serverTimestamp } from 'firebase/firestore';
import type { RecordHashHistoryAction } from '@belrose/shared';

// Timestamp-prefixed so a raw Firestore console listing (sorted by doc ID by default) reads
// chronologically, plus the hash for a glance without opening the doc. Never key this off the
// hash alone — the random suffix (borrowed from Firestore's own auto-ID shape) is what actually
// guarantees uniqueness; the timestamp is for readability only. Mirrors buildSubjectHistoryDocId.
export function buildRecordHashHistoryDocId(hash: string): string {
  return `${Date.now()}_${hash.slice(0, 10)}_${crypto.randomUUID().slice(0, 8)}`;
}

// Builds the recordHashHistory event payload without writing it. Written unconditionally
// whenever a subject-anchor call fires (batched alongside the subjects[]/subjectHistory
// write — see SubjectService), or only when addRecordHash actually gets called from the
// credibility prepare step (see CredibilityPreparationService.prepare) — either way, this
// records that `hash` was the record's current hash during an anchor-capable action,
// regardless of whether this specific transaction was the one that first set it active
// on-chain. blockchainRef always starts null: the chain call happens after this doc is
// written, and gets filled in via a follow-up updateDoc once it resolves.
export function prepareRecordHashHistoryEventData(
  recordId: string,
  hash: string,
  changedBy: string,
  anchoredVia: 'subject' | 'credibility',
  action: RecordHashHistoryAction = 'anchored'
) {
  return {
    recordId,
    recordIdHash: id(recordId),
    hash,
    action,
    anchoredVia,
    changedBy,
    changedByIdHash: id(changedBy),
    changedAt: serverTimestamp(),
    blockchainRef: null,
  };
}
