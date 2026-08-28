"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECORD_DISPUTE_SEVERITY_WEIGHTS = exports.RECORD_VERIFICATION_WEIGHTS = exports.RECORD_SCORE_C = exports.SCORE_TIER_MIN = exports.SCORE_TIER_LABELS = exports.SCORE_BOUNDS = exports.INITIAL_SCORE = void 0;
exports.clampScore = clampScore;
exports.getScoreTier = getScoreTier;
exports.aggregateRecordScore = aggregateRecordScore;
// ── Score scale (shared between record and user credibility, frontend and functions) ──────────
// Single source of truth — functions/ cannot import from src/, so anything both sides need to
// agree on (the neutral prior a record/user starts from, the valid score range) lives here
// instead of being duplicated per side.
// Bayesian BasePrior a record/user's score starts from before any evidence moves it.
exports.INITIAL_SCORE = 500;
exports.SCORE_BOUNDS = {
    MIN: 0,
    MAX: 1000,
};
/**
 * Rounds to the nearest whole score and clamps to SCORE_BOUNDS — for a FINAL, stored/displayed
 * score (record credibility, ValidationWeight's record-score-replay). NOT the right function for
 * an in-progress iterative computation: functions/src/credibility/vouchPropagation.ts has its own
 * deliberately non-rounding clamp(), since rounding every power-iteration round would quantize by
 * a whole point per pass and can prevent convergence from ever settling under a sub-1 epsilon.
 */
function clampScore(score) {
    return Math.max(exports.SCORE_BOUNDS.MIN, Math.min(exports.SCORE_BOUNDS.MAX, Math.round(score)));
}
exports.SCORE_TIER_LABELS = {
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
exports.SCORE_TIER_MIN = {
    poor: exports.SCORE_BOUNDS.MIN,
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
function getScoreTier(score) {
    if (score === null || score === undefined)
        return null;
    if (score >= exports.SCORE_TIER_MIN.excellent)
        return 'excellent';
    if (score >= exports.SCORE_TIER_MIN.veryGood)
        return 'veryGood';
    if (score >= exports.SCORE_TIER_MIN.good)
        return 'good';
    if (score >= exports.SCORE_TIER_MIN.fair)
        return 'fair';
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
exports.RECORD_SCORE_C = 2;
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
exports.RECORD_VERIFICATION_WEIGHTS = {
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
exports.RECORD_DISPUTE_SEVERITY_WEIGHTS = {
    0: 0,
    1: 100, // Negligible
    2: 300, // Moderate
    3: 600, // Major
};
/**
 * Replays a record's (single-hash-scoped) scoreEvents into a final Bayesian-average score.
 * Pure — no Firestore access — so both sides fetch their own events and call this identically.
 */
function aggregateRecordScore(events, c = exports.RECORD_SCORE_C, basePrior = exports.INITIAL_SCORE) {
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
//# sourceMappingURL=credibility.js.map