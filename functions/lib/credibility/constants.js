"use strict";
// functions/src/credibility/constants.ts
//
// Tunable constants for the User Credibility batch computation.
// User Credibility consists of two parts: EarnedTrust and Vouches. Vouches represent credibility
// derived from other people's trust in the user. While EarnedTrust is computed from actual activity
// within the network. The proportion of weight between the two is controlled by the constant VOUCH_MIXING_WEIGHT.
// The other constants below are all explicitly placeholders which will be tuned with further research.
// They are all functions-only because nothing in the frontend is required to calculate them. The fronend
// only requires the result of the calculation which are then recorded in the User Document's
// UserCredibilityScore.component. EVALUATION_WINDOW_DAYS is the one that might
// eventually need frontend visibility (e.g. "results pending, ~30 days" messaging) — a one-line
// move to packages/shared later if that UI gets built.
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNACCEPTED_RECORDS_PENALTY_CONSTANT = exports.EVALUATION_WINDOW_DAYS = exports.CULPABILITY_WEIGHTS = exports.DISPUTE_SEVERITY_WEIGHTS = exports.DEFAULT_CREDENTIAL_FLOOR = exports.CONVERGENCE_EPSILON = exports.MAX_POWER_ITERATIONS = exports.VOUCH_MIXING_WEIGHT = void 0;
// =========================================================
// VOUCHED TRUST CONSTANTS
// =========================================================
/** w — how much of UserCredibility comes from vouch propagation vs. EarnedTrust directly. EarnedTrust will take the inverse weight (1 - w) */
exports.VOUCH_MIXING_WEIGHT = 0.2;
/** Safety cap on power-iteration rounds — at VOUCH_MIXING_WEIGHT=0.2 convergence happens well
 *  under this in practice; it's a backstop, not the expected iteration count. */
exports.MAX_POWER_ITERATIONS = 50;
/** Stop iterating once no user's score moves more than this between rounds (0-1000 scale). */
exports.CONVERGENCE_EPSILON = 0.5;
/** CredentialFloor(u) for users with no admin-set floor. */
exports.DEFAULT_CREDENTIAL_FLOOR = 0;
// =========================================================
// EARNED TRUST CONSTANTS
// =========================================================
// EarnedTrust's dispute-facing weights — distinct from record-credibility's
// RECORD_DISPUTE_SEVERITY_WEIGHTS (packages/shared/src/credibility.ts, used by
// src/features/CredibilityRecord's credibilityScoreService.ts). Those move a RECORD's score
// (severity only, per the whitepaper — culpability plays no part there); these move a USER's own
// EarnedTrust via DisputeAccuracy(u)/CulpabilityPenalty(u), on the same 0-1000 scale. Same name
// pattern, same-looking Record<severity/culpability, number> shape, genuinely different
// constants — do not conflate or try to merge them.
exports.DISPUTE_SEVERITY_WEIGHTS = {
    1: 50, // Negligible
    2: 150, // Moderate
    3: 300, // Major
};
exports.CULPABILITY_WEIGHTS = {
    0: 100, // Unknown
    1: 50, // No Fault
    2: 100, // Systemic
    3: 200, // Preventable
    4: 350, // Reckless
    5: 500, // Intentional
};
/** How long a dispute waits before ValidationWeight is automatically evaluated. Set generously —
 *  medical records get re-reviewed rarely (a patient might see a handful of providers a year), so
 *  a short window would mostly just measure "did anyone happen to look again," not accuracy. */
exports.EVALUATION_WINDOW_DAYS = 90;
// =========================================================
// UNACCEPTED RECORDS PENALTY CONSTANTS
// =========================================================
/** Scales the refusal ratio (|U(u)|/|S(u)|) into a 0-1000-scale deduction from EarnedTrust.
 *  Explicit placeholder, same tuning-pending status as every other constant in this file. Set on
 *  the same order of magnitude as CULPABILITY_WEIGHTS' top tier (500, "Intentional") since a high
 *  refusal ratio is a comparably serious signal. */
exports.UNACCEPTED_RECORDS_PENALTY_CONSTANT = 500;
//# sourceMappingURL=constants.js.map