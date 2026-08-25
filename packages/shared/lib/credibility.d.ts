import { BlockchainRef } from './blockchainAddresses';
import { TimestampLike } from './timestamp';
export type VerificationLevelOptions = 1 | 2 | 3;
export type DisputeSeverityOptions = 1 | 2 | 3;
export type DisputeCulpability = 0 | 1 | 2 | 3 | 4 | 5;
export interface EncryptedField {
    encrypted: string;
    iv: string;
}
export declare const INITIAL_SCORE = 500;
export declare const SCORE_BOUNDS: {
    readonly MIN: 0;
    readonly MAX: 1000;
};
/**
 * Rounds to the nearest whole score and clamps to SCORE_BOUNDS — for a FINAL, stored/displayed
 * score (record credibility, ValidationWeight's record-score-replay). NOT the right function for
 * an in-progress iterative computation: functions/src/credibility/vouchPropagation.ts has its own
 * deliberately non-rounding clamp(), since rounding every power-iteration round would quantize by
 * a whole point per pass and can prevent convergence from ever settling under a sub-1 epsilon.
 */
export declare function clampScore(score: number): number;
/** Placeholder, tuning-pending like every other constant in this system (VOUCH_MIXING_WEIGHT,
 *  UNACCEPTED_RECORDS_PENALTY_CONSTANT, etc.) — not a researched value. Controls how fast
 *  BasePrior gets outweighed by real evidence: C=5 means roughly 5 pieces of evidence outweigh
 *  the neutral prior to about half, given weight magnitudes topping out around 100-150. */
export declare const RECORD_SCORE_C = 5;
/**
 * VerificationLevel(v) weights for RECORD scoring, at NormalizedCredibility=1.0. Under the
 * Bayesian-average formula, ΣVerificationContribution is BLENDED against C copies of BasePrior
 * (500), not added to a running total — so a weight has to sit ABOVE BasePrior to raise the
 * score at all; a weight below BasePrior would dilute the average DOWN even for a genuine,
 * positive verification (the same reason a single low-value rating drags down an IMDB-style
 * weighted average).
 *
 * For example: imagine base prior 500, C=5, and a single verification of weight 500. The score would go from
 * 500 (5*500/5) to 500 (5*500 + 500)/6 = 500. No change, despite a verification. So the weights must start above
 * 500 to have a positive effect.
 *
 * Magnitudes are placeholders, tuning-pending like every other constant in this system (RECORD_SCORE_C,
 * VOUCH_MIXING_WEIGHT, etc.) — only the ABOVE-BasePrior ordering is load-bearing, not these
 * exact numbers.
 */
export declare const RECORD_VERIFICATION_WEIGHTS: Record<0 | 1 | 2 | 3, number>;
/**
 * DisputeSeverity(d) weights for RECORD scoring — unlike verifications, disputes are directly
 * SUBTRACTED from the numerator (not blended in as a "vote"), so any positive value already
 * pulls the score below BasePrior once counted — severity's job is to differentiate HOW MUCH,
 * not to clear some above/below-prior threshold the way RECORD_VERIFICATION_WEIGHTS must.
 * Unsigned: the RecordScore formula's own subtraction handles sign, not a pre-negated constant.
 * Deliberately NOT named DISPUTE_SEVERITY_WEIGHTS — functions/src/credibility/constants.ts
 * already exports a DIFFERENT constant under that exact name (EarnedTrust's DisputeAccuracy(u)
 * weights, on a different scale) — the RECORD_ prefix keeps the two from ever being confused or
 * accidentally shadowing one another. Magnitudes are placeholders, tuning-pending.
 */
export declare const RECORD_DISPUTE_SEVERITY_WEIGHTS: Record<0 | 1 | 2 | 3, number>;
export type ScoreEventType = 'verification' | 'verification_revoked' | 'verification_modified' | 'dispute' | 'dispute_revoked' | 'dispute_modified';
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
export declare function aggregateRecordScore(events: ScoreEventContribution[], c?: number, basePrior?: number): RecordScoreAggregate;
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
    recordScoreAtCreation: number;
    validationWeight: -1 | 0 | 1;
    normalizedCredibilityAtCreation: number;
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
export interface UnacceptedFlagOnChainEvent {
    action: 'flagged' | 'revoked';
    at: TimestampLike;
    blockchainRef: BlockchainRef;
}
export interface UnacceptedFlagDoc {
    id: string;
    subjectId: string;
    subjectIdHash: string;
    recordId: string;
    recordIdHash: string;
    recordHash: string;
    reporterId: string;
    reporterIdHash: string;
    isActive: boolean;
    createdAt: TimestampLike;
    lastModified?: TimestampLike;
    chainStatus: 'pending' | 'confirmed' | 'failed';
    onChainHistory: UnacceptedFlagOnChainEvent[];
}
export interface UserCredibilityScore {
    score: number;
    lastUpdated: TimestampLike;
    earnedTrust: number;
    components: {
        avgRecordCredibility: number | null;
        disputeAccuracy: number | null;
        culpabilityPenalty: number;
        unacceptedRecordsPenalty: number;
        credentialFloor: number;
    };
    vouchPropagated: number;
    w: number;
}
export interface CredibilityStatsDoc {
    avgUserCredibility: number;
    scoredUserCount: number;
    lastUpdated: TimestampLike;
}
//# sourceMappingURL=credibility.d.ts.map