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
}

export type VouchChainStatus = 'None' | 'Active' | 'Retracted';

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
