// ── Score scale (shared between record and user credibility, frontend and functions) ──────────
// Single source of truth — functions/ cannot import from src/, so anything both sides need to
// agree on (the neutral prior a record/user starts from, the valid score range) lives here
// instead of being duplicated per side.
// Bayesian BasePrior a record/user's score starts from before any evidence moves it.
export const INITIAL_SCORE = 500;
export const SCORE_BOUNDS = {
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
export function clampScore(score) {
    return Math.max(SCORE_BOUNDS.MIN, Math.min(SCORE_BOUNDS.MAX, Math.round(score)));
}
export const SCORE_TIER_LABELS = {
    poor: 'Poor',
    fair: 'Fair',
    good: 'Good',
    veryGood: 'Very Good',
    excellent: 'Excellent',
};
/**
 * Returns null for a record/user with no score yet — "no data" is deliberately distinct from
 * "Poor" throughout this system (see AvgRecordCredibility/DisputeAccuracy being null, not 0, when
 * empty). Callers should render null as its own neutral state, not fall through to 'poor'.
 */
export function getScoreTier(score) {
    if (score === null || score === undefined)
        return null;
    if (score >= 850)
        return 'excellent';
    if (score >= 700)
        return 'veryGood';
    if (score >= 500)
        return 'good';
    if (score >= 300)
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
 *  BasePrior gets outweighed by real evidence: C=5 means roughly 5 pieces of evidence outweigh
 *  the neutral prior to about half, given weight magnitudes topping out around 100-150. */
export const RECORD_SCORE_C = 5;
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
 * Weights are placeholders, tuning-pending like every other constant in this system (RECORD_SCORE_C,
 * VOUCH_MIXING_WEIGHT, etc.). Only concrete rule is it must be above basePrior
 */
export const RECORD_VERIFICATION_WEIGHTS = {
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
export const RECORD_DISPUTE_SEVERITY_WEIGHTS = {
    0: 0,
    1: 100, // Negligible
    2: 300, // Moderate
    3: 600, // Major
};
/**
 * Replays a record's (single-hash-scoped) scoreEvents into a final Bayesian-average score.
 * Pure — no Firestore access — so both sides fetch their own events and call this identically.
 */
export function aggregateRecordScore(events, c = RECORD_SCORE_C, basePrior = INITIAL_SCORE) {
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
