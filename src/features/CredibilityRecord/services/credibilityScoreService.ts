// src/features/CredibilityRecord/services/credibilityScoreService.ts

/**
 * CredibilityScoreService
 *
 * Manages credibility scores for records via the whitepaper's Bayesian-average formula:
 *
 *   RecordScore(r) = [C·BasePrior + ΣVerificationContribution(v) − ΣDisputeContribution(d)]
 *                    / [C + |verifications| + |disputes|]
 *   VerificationContribution(v) = VerificationLevel(v) · NormalizedCredibility(verifier)
 *   DisputeContribution(d)      = DisputeSeverity(d) · NormalizedCredibility(disputer)
 *
 * Per the whitepaper, severity alone drives record credibility — culpability is scoped
 * exclusively to CulpabilityPenalty(u) in the User Credibility system, not here.
 *
 * ScoreEvents provide the audit trail (records/{recordId}/scoreEvents) and are the source of
 * truth this file replays via the shared aggregateRecordScore — record.credibility is just the
 * cached result. Score events are tagged with the recordHash they apply to, and the cached score
 * is always recomputed scoped to the record's CURRENT recordHash — see updateRecordScore. This
 * means editing a record's content (new recordHash) resets its cached score back to a fresh
 * BasePrior: uploadUtils.ts calls updateRecordScore(recordId, newRecordHash) right after the
 * hash bump, and a hash with no events yet naturally resolves back to INITIAL_SCORE.
 *
 * Score Range: 0-1000
 * - 0-299: Poor
 * - 300-499: Fair
 * - 500-699: Good
 * - 700-849: Very Good
 * - 850-1000: Excellent
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
import {
  BlockchainRef,
  DisputeCulpability,
  ScoreEventType,
  ScoreEventContribution,
  RECORD_VERIFICATION_WEIGHTS,
  RECORD_DISPUTE_SEVERITY_WEIGHTS,
  aggregateRecordScore,
} from '@belrose/shared';
import { getUserCredibility } from '@/features/CredibilityUser/services/userCredibilityService';
import { getAvgUserCredibility } from '@/features/CredibilityUser/services/networkCredibilityStatsService';

// ==================== TYPES ====================

export type { ScoreEventType };

export interface ScoreEvent {
  id?: string;
  recordId: string;
  recordHash: string;

  eventType: ScoreEventType;
  // weight(level|severity) × frozen NormalizedCredibility(actor). Always a positive magnitude
  // on create/revoke events (calculateContributionDelta below decides the sign via eventType);
  // already signed (new − old) on _modified events.
  contributionDelta: number;

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
  // disputeCulpability/previousDisputeCulpability are audit/display-only here — per the
  // whitepaper, culpability drives CulpabilityPenalty(u) in User Credibility, not record
  // scoring, so they no longer factor into contributionDelta. Kept so a record's per-event
  // history still shows what culpability was recorded at that moment, independent of
  // DisputeDoc.culpability (which only reflects the dispute's *current* value).
  disputeCulpability?: DisputeCulpability;
  previousDisputeSeverity?: DisputeSeverity;
  previousDisputeCulpability?: DisputeCulpability;

  // The verifier's/disputer's NormalizedCredibility, frozen at the time of the underlying
  // VerificationDoc/DisputeDoc's true first creation — see that field's doc comment in
  // packages/shared/src/credibility.ts.
  normalizedCredibilityAtCreation?: number;

  // Blockchain reference
  blockchainRef?: BlockchainRef;
}

// ==================== HELPER FUNCTIONS ====================

function getVerificationWeight(level: VerificationLevel): number {
  return RECORD_VERIFICATION_WEIGHTS[level] ?? 0;
}

function getDisputeWeight(severity: DisputeSeverity): number {
  return RECORD_DISPUTE_SEVERITY_WEIGHTS[severity] ?? 0;
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

function calculateContributionDelta(
  eventType: ScoreEventType,
  normalizedCredibilityAtCreation: number,
  metadata?: ScoreEventMetadata
): number {
  switch (eventType) {
    case 'verification':
      return getVerificationWeight(metadata?.verificationLevel ?? 0) * normalizedCredibilityAtCreation;

    case 'verification_revoked':
      return getVerificationWeight(metadata?.previousVerificationLevel ?? 0) * normalizedCredibilityAtCreation;

    case 'verification_modified': {
      const oldWeight = getVerificationWeight(metadata?.previousVerificationLevel ?? 0);
      const newWeight = getVerificationWeight(metadata?.verificationLevel ?? 0);
      return (newWeight - oldWeight) * normalizedCredibilityAtCreation;
    }

    case 'dispute':
      return getDisputeWeight(metadata?.disputeSeverity ?? 0) * normalizedCredibilityAtCreation;

    case 'dispute_revoked':
      return getDisputeWeight(metadata?.previousDisputeSeverity ?? 0) * normalizedCredibilityAtCreation;

    case 'dispute_modified': {
      const oldWeight = getDisputeWeight(metadata?.previousDisputeSeverity ?? 0);
      const newWeight = getDisputeWeight(metadata?.disputeSeverity ?? 0);
      return (newWeight - oldWeight) * normalizedCredibilityAtCreation;
    }

    default:
      return 0;
  }
}

/**
 * NormalizedCredibility(u) = UserCredibility(u) / AvgUserCredibility. Neutral (1.0) whenever
 * either input is missing — the actor hasn't been through a UserCredibility batch cycle yet, or
 * the network doesn't have an AvgUserCredibility yet (e.g. a very early network with no scored
 * users). Matches this codebase's "no data ≠ worst case" convention rather than penalizing an
 * actor for a gap in the data, not their behavior.
 */
export async function computeNormalizedCredibility(userId: string): Promise<number> {
  const [userCredibility, avgUserCredibility] = await Promise.all([
    getUserCredibility(userId),
    getAvgUserCredibility(),
  ]);

  if (userCredibility === null || !avgUserCredibility) return 1.0;
  return userCredibility.score / avgUserCredibility;
}

// ==================== CORE FUNCTIONS ====================

/**
 * Create a score event and update the record's cached score
 */
async function createScoreEvent(
  recordId: string,
  recordHash: string,
  eventType: ScoreEventType,
  normalizedCredibilityAtCreation: number,
  metadata?: Omit<ScoreEventMetadata, 'normalizedCredibilityAtCreation'>
): Promise<string> {
  const db = getFirestore();
  const { userId } = getCurrentUser();

  const contributionDelta = calculateContributionDelta(eventType, normalizedCredibilityAtCreation, metadata);
  const timestamp = Timestamp.now();

  // recordId now comes from the doc path, so the ID just needs to be unique within
  // the subcollection — mirrors buildPermissionHistoryDocId's scheme.
  const eventId = `${timestamp.toMillis()}_${crypto.randomUUID().slice(0, 8)}`;

  // blockchainRef is threaded through as possibly-undefined (score events now fire immediately
  // after the Firestore write, before the best-effort blockchain step resolves — see
  // verificationService.ts/disputeService.ts's Firestore-first pattern) — Firestore rejects an
  // explicit `undefined` field value, so strip any undefined metadata keys rather than writing
  // them. A verification/dispute created while its chain call is still pending simply has no
  // blockchainRef on this score event yet.
  const rawMetadata = { ...metadata, normalizedCredibilityAtCreation };
  const metadataToWrite = Object.fromEntries(
    Object.entries(rawMetadata).filter(([, value]) => value !== undefined)
  ) as ScoreEventMetadata;

  const scoreEvent: Omit<ScoreEvent, 'id'> = {
    recordId,
    recordHash,
    eventType,
    contributionDelta,
    createdBy: userId,
    createdAt: timestamp,
    metadata: metadataToWrite,
  };

  // Use setDoc with explicit ID instead of addDoc
  const eventRef = doc(db, 'records', recordId, 'scoreEvents', eventId);
  await setDoc(eventRef, scoreEvent);

  console.log(
    `📊 Score event created: ${eventType} (${contributionDelta > 0 ? '+' : ''}${contributionDelta.toFixed(2)})`
  );

  // Update the record's cached score
  await updateRecordScore(recordId, recordHash);

  return eventId;
}

/**
 * Recalculate and update a record's credibility score.
 * Scoped to a single recordHash — events made against a previous (now-superseded) hash
 * are excluded, so a record with no events yet for its current hash correctly resolves
 * back to the BasePrior rather than inheriting a prior version's accumulated score.
 *
 * Exported directly (rather than behind a same-shaped wrapper) because callers like
 * uploadUtils.ts's version-bump flow want exactly this: "recompute for this hash" — a new
 * hash with no events yet just resolves to the BasePrior, which is the reset behavior.
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

  const contributions: ScoreEventContribution[] = eventsSnap.docs.map(eventDoc => {
    const event = eventDoc.data() as ScoreEvent;
    return { eventType: event.eventType, contributionDelta: event.contributionDelta };
  });

  const { score } = aggregateRecordScore(contributions);

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
  normalizedCredibilityAtCreation: number,
  blockchainRef?: BlockchainRef
): Promise<void> {
  await createScoreEvent(recordId, recordHash, 'verification', normalizedCredibilityAtCreation, {
    verificationLevel: level,
    blockchainRef,
  });
}

export async function onVerificationRevoked(
  recordId: string,
  recordHash: string,
  previousLevel: VerificationLevel,
  normalizedCredibilityAtCreation: number,
  blockchainRef?: BlockchainRef
): Promise<void> {
  await createScoreEvent(recordId, recordHash, 'verification_revoked', normalizedCredibilityAtCreation, {
    previousVerificationLevel: previousLevel,
    blockchainRef,
  });
}

export async function onVerificationModified(
  recordId: string,
  recordHash: string,
  previousLevel: VerificationLevel,
  newLevel: VerificationLevel,
  normalizedCredibilityAtCreation: number,
  blockchainRef?: BlockchainRef
): Promise<void> {
  await createScoreEvent(recordId, recordHash, 'verification_modified', normalizedCredibilityAtCreation, {
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
  normalizedCredibilityAtCreation: number,
  blockchainRef?: BlockchainRef
): Promise<void> {
  await createScoreEvent(recordId, recordHash, 'dispute', normalizedCredibilityAtCreation, {
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
  normalizedCredibilityAtCreation: number,
  blockchainRef?: BlockchainRef
): Promise<void> {
  await createScoreEvent(recordId, recordHash, 'dispute_revoked', normalizedCredibilityAtCreation, {
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
  normalizedCredibilityAtCreation: number,
  blockchainRef?: BlockchainRef
): Promise<void> {
  await createScoreEvent(recordId, recordHash, 'dispute_modified', normalizedCredibilityAtCreation, {
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
