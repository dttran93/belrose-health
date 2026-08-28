import { BlockchainRef } from './blockchainAddresses';
import { TimestampLike } from './timestamp';

export type VerificationLevelOptions = 1 | 2 | 3;
export type DisputeSeverityOptions = 1 | 2 | 3;
export type DisputeCulpability = 0 | 1 | 2 | 3 | 4 | 5;

export interface EncryptedField {
  encrypted: string;
  iv: string;
}

// ── Score scale (shared between record and user credibility, frontend and functions) ──────────
// Single source of truth — functions/ cannot import from src/, so anything both sides need to
// agree on (the neutral prior a record/user starts from, the valid score range) lives here
// instead of being duplicated per side.

// Bayesian BasePrior a record/user's score starts from before any evidence moves it.
export const INITIAL_SCORE = 500;

export const SCORE_BOUNDS = {
  MIN: 0,
  MAX: 1000,
} as const;

/**
 * Rounds to the nearest whole score and clamps to SCORE_BOUNDS — for a FINAL, stored/displayed
 * score (record credibility, ValidationWeight's record-score-replay). NOT the right function for
 * an in-progress iterative computation: functions/src/credibility/vouchPropagation.ts has its own
 * deliberately non-rounding clamp(), since rounding every power-iteration round would quantize by
 * a whole point per pass and can prevent convergence from ever settling under a sub-1 epsilon.
 */
export function clampScore(score: number): number {
  return Math.max(SCORE_BOUNDS.MIN, Math.min(SCORE_BOUNDS.MAX, Math.round(score)));
}

// ── Score tiers ──────────────────────────────────────────────────────────────────────────────
// One five-band system for both Record and User credibility (0-299 Poor / 300-499 Fair /
// 500-699 Good / 700-849 Very Good / 850-1000 Excellent), so the two don't drift apart. Only the
// numbers live here — packages/shared is dependency-free (no React/Tailwind), so colors/icons are
// a frontend-only concern (src/components/ui/CredibilityTierStyle.tsx).

export type ScoreTier = 'poor' | 'fair' | 'good' | 'veryGood' | 'excellent';

export const SCORE_TIER_LABELS: Record<ScoreTier, string> = {
  poor: 'Poor',
  fair: 'Fair',
  good: 'Good',
  veryGood: 'Very Good',
  excellent: 'Excellent',
};

// Lower bound (inclusive) of each tier, ascending. The single place the 300/500/700/850 boundary
// numbers live — getScoreTier derives from it below, and a UI rendering a tier meter (e.g. a
// segmented band showing where a score sits across all five tiers) can derive segment widths from
// it too instead of re-hardcoding the same boundaries a third time.
export const SCORE_TIER_MIN: Record<ScoreTier, number> = {
  poor: SCORE_BOUNDS.MIN,
  fair: 300,
  good: 500,
  veryGood: 700,
  excellent: 850,
};

/**
 * Returns null for a record/user with no score yet — "no data" is deliberately distinct from
 * "Poor" throughout this system (see AvgRecordCredibility/DisputeAccuracy being null, not 0, when
 * empty). Callers should render null as its own neutral state, not fall through to 'poor'.
 */
export function getScoreTier(score: number | null | undefined): ScoreTier | null {
  if (score === null || score === undefined) return null;
  if (score >= SCORE_TIER_MIN.excellent) return 'excellent';
  if (score >= SCORE_TIER_MIN.veryGood) return 'veryGood';
  if (score >= SCORE_TIER_MIN.good) return 'good';
  if (score >= SCORE_TIER_MIN.fair) return 'fair';
  return 'poor';
}

// ── Record credibility: Bayesian-average aggregation ────────────────────────────────────────
// RecordScore(r) = [C·BasePrior + ΣVerificationContribution(v) − ΣDisputeContribution(d)]
//                  / [C + |verifications| + |disputes|]
// VerificationContribution(v) = VerificationLevel(v) · NormalizedCredibility(verifier)
// DisputeContribution(d)      = DisputeSeverity(d) · NormalizedCredibility(disputer)
// Per the whitepaper, severity alone drives record credibility — culpability is scoped
// exclusively to CulpabilityPenalty(u) in the User Credibility system, not here.
//
// Both src/features/CredibilityRecord/services/credibilityScoreService.ts (client SDK) and
// functions/src/credibility/validationWeightEvaluator.ts (Admin SDK) need to turn a record's
// scoreEvents into an identical final score — aggregateRecordScore is the one shared
// implementation both sides call, so the aggregation algorithm doesn't drift

/** Placeholder, tuning-pending like every other constant in this system (VOUCH_MIXING_WEIGHT,
 *  UNACCEPTED_RECORDS_PENALTY_CONSTANT, etc.) — not a researched value. Controls how fast
 *  BasePrior gets outweighed by real evidence: at n = C pieces of evidence, evidence and the
 *  prior are weighted exactly 50/50 (evidence's share of the blend is n/(n+C)), so C=2 means a
 *  single reviewer still leaves the prior in the majority (67% prior / 33% evidence) — no one
 *  reviewer can single-handedly define a record — while a realistic "subject + provider + one
 *  more" case (n=3) already tips to 60% evidence, and n=5 reaches 71%. Chosen over C=5 (which
 *  put that same n=3 case at only 38% evidence — a record most records will realistically never
 *  exceed, permanently under-weighted) since most records won't accumulate many more than a
 *  handful of reviewers. */
export const RECORD_SCORE_C = 2;

/**
 * VerificationLevel(v) weights for RECORD scoring, at NormalizedCredibility=1.0. Under the
 * Bayesian-average formula, ΣVerificationContribution is BLENDED against C copies of BasePrior
 * (500), not added to a running total — so a weight has to sit ABOVE BasePrior to raise the
 * score at all; a weight below BasePrior would dilute the average DOWN even for a genuine,
 * positive verification (the same reason a single low-value rating drags down an IMDB-style
 * weighted average).
 *
 * For example: imagine base prior 500, C=2, and a single verification of weight 500. The score would go from
 * 500 (2*500/2) to 500 (2*500 + 500)/3 = 500. No change, despite a verification. So the weights must start above
 * 500 to have a positive effect — true at any value of C, not just this one.
 *
 * Weights are placeholders, tuning-pending like every other constant in this system (RECORD_SCORE_C,
 * VOUCH_MIXING_WEIGHT, etc.). Only concrete rule is it must be above basePrior
 */
export const RECORD_VERIFICATION_WEIGHTS: Record<0 | 1 | 2 | 3, number> = {
  0: 0,
  1: 650, // Provenance
  2: 800, // Content
  3: 950, // Full
};

/**
 * DisputeSeverity(d) weights for RECORD scoring — unlike verifications, disputes are directly
 * SUBTRACTED from the numerator (not blended in as a "vote"), so any positive value already
 * pulls the score below BasePrior once counted — severity's job is to differentiate HOW MUCH,
 * not to clear some above/below-prior threshold the way RECORD_VERIFICATION_WEIGHTS must.
 * Unsigned: the RecordScore formula's is already negative so weights remain unsigned here
 * Deliberately NOT named DISPUTE_SEVERITY_WEIGHTS — functions/src/credibility/constants.ts
 * already exports a DIFFERENT constant under that exact name (EarnedTrust's DisputeAccuracy(u)
 * weights, on a different scale) — the RECORD_ prefix keeps the two from ever being confused or
 * accidentally shadowing one another. Magnitudes are placeholders, tuning-pending.
 */
export const RECORD_DISPUTE_SEVERITY_WEIGHTS: Record<0 | 1 | 2 | 3, number> = {
  0: 0,
  1: 100, // Negligible
  2: 300, // Moderate
  3: 600, // Major
};

export type ScoreEventType =
  | 'verification'
  | 'verification_revoked'
  | 'verification_modified'
  | 'dispute'
  | 'dispute_revoked'
  | 'dispute_modified';

/** Minimal shape aggregateRecordScore needs — not the full ScoreEvent (id, createdBy, createdAt,
 *  metadata stay per-side; only what the math touches is shared). */
export interface ScoreEventContribution {
  eventType: ScoreEventType;
  /** weight(level|severity) × frozen NormalizedCredibility. A positive magnitude on
   *  create/revoke events (the eventType decides the sign); already signed (new − old) on
   *  _modified events. */
  contributionDelta: number;
}

export interface RecordScoreAggregate {
  score: number;
  verificationCount: number;
  disputeCount: number;
  verificationContributionSum: number;
  disputeContributionSum: number;
}

/**
 * Replays a record's (single-hash-scoped) scoreEvents into a final Bayesian-average score.
 * Pure — no Firestore access — so both sides fetch their own events and call this identically.
 */
export function aggregateRecordScore(
  events: ScoreEventContribution[],
  c: number = RECORD_SCORE_C,
  basePrior: number = INITIAL_SCORE
): RecordScoreAggregate {
  let verificationCount = 0;
  let disputeCount = 0;
  let verificationContributionSum = 0;
  let disputeContributionSum = 0;

  for (const event of events) {
    switch (event.eventType) {
      case 'verification':
        verificationCount += 1;
        verificationContributionSum += event.contributionDelta;
        break;
      case 'verification_revoked':
        verificationCount -= 1;
        verificationContributionSum -= event.contributionDelta;
        break;
      case 'verification_modified':
        verificationContributionSum += event.contributionDelta;
        break;
      case 'dispute':
        disputeCount += 1;
        disputeContributionSum += event.contributionDelta;
        break;
      case 'dispute_revoked':
        disputeCount -= 1;
        disputeContributionSum -= event.contributionDelta;
        break;
      case 'dispute_modified':
        disputeContributionSum += event.contributionDelta;
        break;
    }
  }

  const denominator = c + verificationCount + disputeCount;
  const numerator = c * basePrior + verificationContributionSum - disputeContributionSum;
  // denominator <= 0 is defensive only — c is always a positive constant in practice.
  const rawScore = denominator > 0 ? numerator / denominator : basePrior;

  return {
    score: clampScore(rawScore),
    verificationCount,
    disputeCount,
    verificationContributionSum,
    disputeContributionSum,
  };
}

// ── On-chain history event types ──────────────────────────────────────────────

export interface VerificationOnChainEvent {
  action: 'verified' | 'retracted' | 'modified';
  at: TimestampLike;
  blockchainRef: BlockchainRef;
  fromLevel?: VerificationLevelOptions;
  toLevel?: VerificationLevelOptions;
}

export interface DisputeOnChainEvent {
  action: 'disputed' | 'retracted' | 'modified';
  at: TimestampLike;
  blockchainRef: BlockchainRef;
  fromSeverity?: DisputeSeverityOptions;
  toSeverity?: DisputeSeverityOptions;
  fromCulpability?: DisputeCulpability;
  toCulpability?: DisputeCulpability;
}

export interface VouchOnChainEvent {
  action: 'vouched' | 'retracted' | 're-vouched';
  at: TimestampLike;
  blockchainRef: BlockchainRef;
}

// ── Document types ────────────────────────────────────────────────────────────

export interface VerificationDoc {
  id: string;
  recordIdHash: string;
  recordHash: string;
  recordId: string;
  verifierId: string;
  verifierIdHash: string;
  level: VerificationLevelOptions;
  isActive: boolean;
  createdAt: TimestampLike;
  lastModified?: TimestampLike;
  chainStatus: 'pending' | 'confirmed' | 'failed';
  onChainHistory: VerificationOnChainEvent[];
  encryptedRecordTitle?: string;
  encryptedRecordTitleIv: string;

  // NormalizedCredibility(verifier) frozen at TRUE first creation only — never recomputed on
  // reactivate or modify. Same gaming-prevention rationale as DisputeDoc.recordScoreAtCreation
  // below: the verifier's own UserCredibility drifts every batch cycle, so re-fetching on
  // reactivate/modify would let them time it opportunistically. Absent on pre-Bayesian-rewrite
  // docs (backfilled to 1.0, neutral, by the one-off migration).
  normalizedCredibilityAtCreation: number;
}

export interface DisputeDoc {
  id: string;
  recordHash: string;
  recordId: string;
  recordIdHash: string;
  disputerId: string;
  disputerIdHash: string;
  severity: DisputeSeverityOptions;
  culpability: DisputeCulpability;
  encryptedNotes?: EncryptedField;
  notesHash: string;
  isActive: boolean;
  createdAt: TimestampLike;
  lastModified?: TimestampLike;
  chainStatus: 'pending' | 'confirmed' | 'failed';
  onChainHistory: DisputeOnChainEvent[];
  encryptedRecordTitle?: string;
  encryptedRecordTitleIv?: string;

  // Snapshot of records/{recordId}.credibility.score at the moment this dispute was filed —
  // the "before" baseline ValidationWeight compares against once the evaluation window elapses.
  recordScoreAtCreation: number;
  // ValidationWeight(d) from the whitepaper: 0 = pending (evaluation window hasn't elapsed yet),
  // 1 = validated (record score declined since filing), -1 = unvalidated (score recovered).
  // Starts at 0 on create; set exactly once, server-side only, once decided — never touched again.
  validationWeight: -1 | 0 | 1;

  // NormalizedCredibility(disputer) frozen at TRUE first creation only — same rationale and
  // never-reactivated/never-modified immutability as recordScoreAtCreation/validationWeight.
  normalizedCredibilityAtCreation: number;
}

// 'Pending'/'Failed' are off-chain-only transient states for the Firestore-first write pattern
// (see vouchService.ts) — they never come from the chain itself, only 'None'/'Active'/'Retracted'
// do. Mirrors VerificationDoc/DisputeDoc.chainStatus's 'pending'/'confirmed'/'failed' lifecycle.
export type VouchChainStatus = 'None' | 'Pending' | 'Active' | 'Retracted' | 'Failed';

export interface VouchDoc {
  id: string;
  voucherId: string;
  voucherIdHash: string;
  voucheeId: string;
  voucheeIdHash: string;
  chainStatus: VouchChainStatus;
  createdAt: TimestampLike;
  lastModified?: TimestampLike;
  onChainHistory: VouchOnChainEvent[];
}

// ── Unaccepted record flags ───────────────────────────────────────────────────
//
// Off-chain mirror of HealthRecordCore.sol's UnacceptedFlag: a provider created/verified a
// record, the intended subject was asked to anchor themselves, and refused. Reserved for the
// Belrose admin wallet — not the reporting provider directly — given the unresolved GDPR/HIPAA
// tension a signal like this sits in. Deliberately does NOT carry the record's content or title
// (unlike DisputeDoc/VerificationDoc) — the whole point is "a flag exists," not exposing what's
// in the record.
export interface UnacceptedFlagOnChainEvent {
  action: 'flagged' | 'revoked';
  at: TimestampLike;
  blockchainRef: BlockchainRef;
}

export interface UnacceptedFlagDoc {
  id: string; // `${subjectId}_${recordId}`
  subjectId: string;
  subjectIdHash: string;
  recordId: string;
  recordIdHash: string;
  recordHash: string; // record's content hash at time of flag, server-fetched (not client-trusted)
  reporterId: string; // the provider credited with the flag
  reporterIdHash: string;
  isActive: boolean;
  createdAt: TimestampLike;
  lastModified?: TimestampLike;
  chainStatus: 'pending' | 'confirmed' | 'failed';
  onChainHistory: UnacceptedFlagOnChainEvent[];
}

// ── User Credibility ──────────────────────────────────────────────────────────
//
// UserCredibility(u) = (1-w)·EarnedTrust(u) + w·Σ[VouchWeight(u1→u)·UserCredibility(u1)]
// EarnedTrust(u) = max(CredentialFloor(u),
//   AvgRecordCredibility(u) + DisputeAccuracy(u) - CulpabilityPenalty(u) - UnacceptedRecordsPenalty(u))
//
// Written wholesale by the scheduled batch computation (functions/src/credibility/) — never by a
// client, see firestore.rules' isServerWrite() gate on users/{uid}.credibility.
// CredentialFloor itself lives as a separate top-level `credentialFloor` field on the user
// profile (an admin-set input that rarely changes), not nested in here (a fully server-computed
// output overwritten each cycle) — components.credentialFloor below just echoes it for
// transparency about what value fed that cycle's computation.
export interface UserCredibilityScore {
  score: number; // 0-1000, final UserCredibility(u) — the one thing badges/UI show
  lastUpdated: TimestampLike;
  earnedTrust: number; // EarnedTrust(u)
  components: {
    avgRecordCredibility: number | null; // null when R(u) is empty, not 0 — "no data" vs "bad score"
    disputeAccuracy: number | null; // null when D(u) is empty
    culpabilityPenalty: number; // 0 when I(u) is empty
    unacceptedRecordsPenalty: number; // 0 when the user has no records ever anchored (no baseline)
    credentialFloor: number; // echoes the authoritative credentialFloor field for this cycle
  };
  vouchPropagated: number; // the w·Σ[...] term
  w: number; // the mixing weight used for this cycle
}

// ── Network-wide credibility stats ────────────────────────────────────────────
//
// AvgUserCredibility = mean UserCredibility(u) across all users at recompute time. The
// denominator of NormalizedCredibility(u) = UserCredibility(u) / AvgUserCredibility — computed
// and written once per batch cycle (functions/src/credibility/userCredibilityBatchService.ts),
// read by credibilityScoreService.ts whenever a new verification/dispute needs to freeze its
// NormalizedCredibility. First non-per-resource-ID Firestore doc in this schema — always exactly
// one doc, id 'global', always present (avgUserCredibility/scoredUserCount both written as 0 on
// a network with no scored users yet, never omitted, so readers never need an !exists() branch).
export interface CredibilityStatsDoc {
  avgUserCredibility: number;
  scoredUserCount: number;
  lastUpdated: TimestampLike;
}
