// src/features/Trustee/services/writeTrusteeHistoryEvent.ts

import { id } from 'ethers';
import { serverTimestamp } from 'firebase/firestore';
import { TrusteeHistoryAction } from './trusteeRelationshipService';

// Timestamp-prefixed so a raw Firestore console listing (sorted by doc ID by default) reads
// chronologically, plus the trustee for a glance without opening the doc. Never key this off
// trusteeId alone — the same relationship can be proposed/revoked/re-proposed many times over
// its life, and each has to be its own immutable entry. Mirrors buildSubjectHistoryDocId.
export function buildTrusteeHistoryDocId(trusteeId: string): string {
  return `${Date.now()}_${trusteeId}_${crypto.randomUUID().slice(0, 8)}`;
}

// Builds the trusteeHistory event payload without writing it, so callers doing an atomic write
// (or a plain setDoc/updateDoc alongside it) can batch.set()/setDoc() it themselves.
// blockchainRef always starts null: the chain call happens after the relationship doc's own
// state-transition write commits, and gets filled in via a follow-up updateDoc once it resolves.
export function prepareTrusteeHistoryEventData(
  relationshipId: string,
  trustorId: string,
  trusteeId: string,
  changedBy: string,
  action: TrusteeHistoryAction,
  trustLevel?: string
) {
  return {
    relationshipId,
    trustorId,
    trustorIdHash: id(trustorId),
    trusteeId,
    trusteeIdHash: id(trusteeId),
    action,
    ...(trustLevel ? { trustLevel } : {}),
    changedBy,
    changedByIdHash: id(changedBy),
    changedAt: serverTimestamp(),
    blockchainRef: null,
  };
}
