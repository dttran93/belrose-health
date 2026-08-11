// src/features/Credibility/services/credibilityScoreService.ts

/**
 * CredibilityScoreService (MVP)
 *
 * Manages credibility scores for records.
 * Creates ScoreEvents for audit trail and updates the cached score on records.
 *
 * MVP Scope:
 * - Verifications and disputes affect the record's score
 * - ScoreEvents provide audit trail
 * - Record.credibility is the cached score shown to users
 *
 * Score Range: 0-1000
 * - 0-299: Poor
 * - 300-499: Fair
 * - 500-699: Good
 * - 700-849: Very Good
 * - 850-1000: Excellent
 *
 * Score events are tagged with the recordHash they apply to, and the cached score is
 * always recomputed scoped to the record's CURRENT recordHash — see updateRecordScore.
 * This means editing a record's content (new recordHash) resets its cached score back
 * to INITIAL_SCORE: uploadUtils.ts calls updateRecordScore(recordId, newRecordHash) right
 * after the hash bump, and a hash with no events yet naturally resolves to INITIAL_SCORE.
 */

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import type { VerificationLevel } from './verificationService';
import type { DisputeSeverity } from './disputeService';
import { BlockchainRef, DisputeCulpability } from '@belrose/shared';

// ==================== TYPES ====================

export type ScoreEventType =
  | 'verification'
  | 'verification_revoked'
  | 'verification_modified'
  | 'dispute'
  | 'dispute_revoked'
  | 'dispute_modified';

export interface ScoreEvent {
  id?: string;
  recordId: string;
  recordHash: string;

  eventType: ScoreEventType;
  scoreDelta: number;

  createdBy: string;
  createdAt: Timestamp;

  metadata?: ScoreEventMetadata;
}

export interface ScoreEventMetadata {
  // Verification context
  verificationLevel?: VerificationLevel;
  previousVerificationLevel?: VerificationLevel;

  // Dispute context
  disputeSeverity?: DisputeSeverity;
  disputeCulpability?: DisputeCulpability;
  previousDisputeSeverity?: DisputeSeverity;
  previousDisputeCulpability?: DisputeCulpability;

  // Blockchain reference
  blockchainRef?: BlockchainRef;
}

// ==================== CONSTANTS ====================

export const VERIFICATION_DELTAS: Record<VerificationLevel, number> = {
  0: 0, // None
  1: 50, // Provenance
  2: 75, // Content
  3: 100, // Full
};

export const DISPUTE_SEVERITY_PENALTIES: Record<DisputeSeverity, number> = {
  0: 0, // None
  1: -25, // Negligible
  2: -75, // Moderate
  3: -150, // Major
};

export const CULPABILITY_MULTIPLIERS: Record<DisputeCulpability, number> = {
  0: 1.0, // None/Unknown
  1: 0.5, // No Fault
  2: 0.75, // Systemic
  3: 1.0, // Preventable
  4: 1.5, // Reckless
  5: 2.0, // Intentional
};

export const INITIAL_SCORE = 500;

export const SCORE_BOUNDS = {
  MIN: 0,
  MAX: 1000,
} as const;

// ==================== HELPER FUNCTIONS ====================

function clampScore(score: number): number {
  return Math.max(SCORE_BOUNDS.MIN, Math.min(SCORE_BOUNDS.MAX, Math.round(score)));
}

function getVerificationDelta(level: VerificationLevel): number {
  return VERIFICATION_DELTAS[level] ?? 0;
}

function getDisputeDelta(severity: DisputeSeverity, culpability: DisputeCulpability): number {
  const basePenalty = DISPUTE_SEVERITY_PENALTIES[severity] ?? 0;
  const multiplier = CULPABILITY_MULTIPLIERS[culpability] ?? 1;
  return Math.round(basePenalty * multiplier);
}

function getCurrentUser(): { userId: string; displayName: string } {
  const auth = getAuth();
  const user = auth.currentUser;

  if (!user) {
    throw new Error('User not authenticated');
  }

  return {
    userId: user.uid,
    displayName: user.displayName || user.email || 'Unknown User',
  };
}

function calculateScoreDelta(eventType: ScoreEventType, metadata?: ScoreEventMetadata): number {
  switch (eventType) {
    case 'verification':
      return getVerificationDelta(metadata?.verificationLevel ?? 0);

    case 'verification_revoked':
      return -getVerificationDelta(metadata?.previousVerificationLevel ?? 0);

    case 'verification_modified': {
      const oldDelta = getVerificationDelta(metadata?.previousVerificationLevel ?? 0);
      const newDelta = getVerificationDelta(metadata?.verificationLevel ?? 0);
      return newDelta - oldDelta;
    }

    case 'dispute':
      return getDisputeDelta(metadata?.disputeSeverity ?? 0, metadata?.disputeCulpability ?? 0);

    case 'dispute_revoked':
      return -getDisputeDelta(
        metadata?.previousDisputeSeverity ?? 0,
        metadata?.previousDisputeCulpability ?? 0
      );

    case 'dispute_modified': {
      const oldPenalty = getDisputeDelta(
        metadata?.previousDisputeSeverity ?? 0,
        metadata?.previousDisputeCulpability ?? 0
      );
      const newPenalty = getDisputeDelta(
        metadata?.disputeSeverity ?? 0,
        metadata?.disputeCulpability ?? 0
      );
      return newPenalty - oldPenalty;
    }

    default:
      return 0;
  }
}

// ==================== CORE FUNCTIONS ====================

/**
 * Create a score event and update the record's cached score
 */
async function createScoreEvent(
  recordId: string,
  recordHash: string,
  eventType: ScoreEventType,
  metadata?: ScoreEventMetadata
): Promise<string> {
  const db = getFirestore();
  const { userId, displayName } = getCurrentUser();

  const scoreDelta = calculateScoreDelta(eventType, metadata);
  const timestamp = Timestamp.now();

  // recordId now comes from the doc path, so the ID just needs to be unique within
  // the subcollection — mirrors buildPermissionHistoryDocId's scheme.
  const eventId = `${timestamp.toMillis()}_${crypto.randomUUID().slice(0, 8)}`;

  const scoreEvent: Omit<ScoreEvent, 'id'> = {
    recordId,
    recordHash,
    eventType,
    scoreDelta,
    createdBy: userId,
    createdAt: timestamp,
    metadata,
  };

  // Use setDoc with explicit ID instead of addDoc
  const eventRef = doc(db, 'records', recordId, 'scoreEvents', eventId);
  await setDoc(eventRef, scoreEvent);

  console.log(`📊 Score event created: ${eventType} (${scoreDelta > 0 ? '+' : ''}${scoreDelta})`);

  // Update the record's cached score
  await updateRecordScore(recordId, recordHash);

  return eventId;
}

/**
 * Recalculate and update a record's credibility score.
 * Scoped to a single recordHash — events made against a previous (now-superseded) hash
 * are excluded, so a record with no events yet for its current hash correctly resolves
 * back to INITIAL_SCORE rather than inheriting a prior version's accumulated score.
 *
 * Exported directly (rather than behind a same-shaped wrapper) because callers like
 * uploadUtils.ts's version-bump flow want exactly this: "recompute for this hash" — a new
 * hash with no events yet just resolves to INITIAL_SCORE, which is the reset behavior.
 */
export async function updateRecordScore(recordId: string, recordHash: string): Promise<number> {
  const db = getFirestore();

  // Get all score events for this record's current hash
  const eventsQuery = query(
    collection(db, 'records', recordId, 'scoreEvents'),
    where('recordHash', '==', recordHash),
    orderBy('createdAt', 'asc')
  );
  const eventsSnap = await getDocs(eventsQuery);

  // Sum all deltas starting from initial score
  let score = INITIAL_SCORE;
  eventsSnap.docs.forEach(eventDoc => {
    const event = eventDoc.data() as ScoreEvent;
    score += event.scoreDelta;
  });

  score = clampScore(score);

  // Update the record document
  await updateDoc(doc(db, 'records', recordId), {
    credibility: {
      score,
      lastUpdated: Timestamp.now(),
    },
  });

  console.log(`📊 Updated record ${recordId} score: ${score}`);

  return score;
}

// ==================== PUBLIC API - VERIFICATION EVENTS ====================

export async function onVerificationCreated(
  recordId: string,
  recordHash: string,
  level: VerificationLevel,
  blockchainRef?: BlockchainRef
): Promise<void> {
  await createScoreEvent(recordId, recordHash, 'verification', {
    verificationLevel: level,
    blockchainRef,
  });
}

export async function onVerificationRevoked(
  recordId: string,
  recordHash: string,
  previousLevel: VerificationLevel,
  blockchainRef?: BlockchainRef
): Promise<void> {
  await createScoreEvent(recordId, recordHash, 'verification_revoked', {
    previousVerificationLevel: previousLevel,
    blockchainRef,
  });
}

export async function onVerificationModified(
  recordId: string,
  recordHash: string,
  previousLevel: VerificationLevel,
  newLevel: VerificationLevel,
  blockchainRef?: BlockchainRef
): Promise<void> {
  await createScoreEvent(recordId, recordHash, 'verification_modified', {
    previousVerificationLevel: previousLevel,
    verificationLevel: newLevel,
    blockchainRef,
  });
}

// ==================== PUBLIC API - DISPUTE EVENTS ====================

export async function onDisputeCreated(
  recordId: string,
  recordHash: string,
  severity: DisputeSeverity,
  culpability: DisputeCulpability,
  blockchainRef?: BlockchainRef
): Promise<void> {
  await createScoreEvent(recordId, recordHash, 'dispute', {
    disputeSeverity: severity,
    disputeCulpability: culpability,
    blockchainRef,
  });
}

export async function onDisputeRevoked(
  recordId: string,
  recordHash: string,
  previousSeverity: DisputeSeverity,
  previousCulpability: DisputeCulpability,
  blockchainRef?: BlockchainRef
): Promise<void> {
  await createScoreEvent(recordId, recordHash, 'dispute_revoked', {
    previousDisputeSeverity: previousSeverity,
    previousDisputeCulpability: previousCulpability,
    blockchainRef,
  });
}

export async function onDisputeModified(
  recordId: string,
  recordHash: string,
  previousSeverity: DisputeSeverity,
  previousCulpability: DisputeCulpability,
  newSeverity: DisputeSeverity,
  newCulpability: DisputeCulpability,
  blockchainRef?: BlockchainRef
): Promise<void> {
  await createScoreEvent(recordId, recordHash, 'dispute_modified', {
    previousDisputeSeverity: previousSeverity,
    previousDisputeCulpability: previousCulpability,
    disputeSeverity: newSeverity,
    disputeCulpability: newCulpability,
    blockchainRef,
  });
}

// ==================== QUERY FUNCTIONS ====================

/**
 * Get all score events for a record
 */
export async function getScoreEventsForRecord(recordId: string): Promise<ScoreEvent[]> {
  const db = getFirestore();

  const eventsQuery = query(
    collection(db, 'records', recordId, 'scoreEvents'),
    orderBy('createdAt', 'desc')
  );

  const snapshot = await getDocs(eventsQuery);

  return snapshot.docs.map(eventDoc => ({
    id: eventDoc.id,
    ...eventDoc.data(),
  })) as ScoreEvent[];
}

/**
 * Get score events for a specific hash within a record (useful for viewing
 * the history behind one content version).
 */
export async function getScoreEventsForHash(
  recordId: string,
  recordHash: string
): Promise<ScoreEvent[]> {
  const db = getFirestore();

  const eventsQuery = query(
    collection(db, 'records', recordId, 'scoreEvents'),
    where('recordHash', '==', recordHash),
    orderBy('createdAt', 'desc')
  );

  const snapshot = await getDocs(eventsQuery);

  return snapshot.docs.map(eventDoc => ({
    id: eventDoc.id,
    ...eventDoc.data(),
  })) as ScoreEvent[];
}
