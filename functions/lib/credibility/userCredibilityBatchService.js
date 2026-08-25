"use strict";
// functions/src/credibility/userCredibilityBatchService.ts
//
// Orchestrator for the User Credibility batch cycle. Wires the phases together:
//   1. evaluatePendingDisputes — freeze ValidationWeight for disputes past their window
//   2. fetchEarnedTrustInputs + computeEarnedTrust — EarnedTrust(u) per user
//   3. runVouchPropagation — the iterative UserCredibility(u) solve, warm-started from the prior
//      cycle's converged scores
//   4. batched write-back — users/{uid}.credibility, touching only that field per doc
Object.defineProperty(exports, "__esModule", { value: true });
exports.runUserCredibilityCycle = runUserCredibilityCycle;
const firestore_1 = require("firebase-admin/firestore");
const validationWeightEvaluator_1 = require("./validationWeightEvaluator");
const earnedTrust_1 = require("./earnedTrust");
const vouchPropagation_1 = require("./vouchPropagation");
const constants_1 = require("./constants");
const BATCH_COMMIT_SIZE = 450; // headroom under Firestore's 500-writes-per-batch limit
async function fetchActiveVouchEdges(db) {
    const snap = await db.collection('vouches').where('chainStatus', '==', 'Active').get();
    return snap.docs.map(d => {
        const data = d.data();
        return { voucherId: data.voucherId, voucheeId: data.voucheeId };
    });
}
/**
 * Runs one full batch cycle. Takes an optional explicit `db` (defaulting to the ambient default
 * app's Firestore) so tests can point this at an emulator instance without needing a separate
 * wrapper — every real call site just calls runUserCredibilityCycle() with no arguments.
 */
async function runUserCredibilityCycle(db = (0, firestore_1.getFirestore)()) {
    console.log('🔄 Starting User Credibility batch cycle...');
    const { evaluated: disputesEvaluated } = await (0, validationWeightEvaluator_1.evaluatePendingDisputes)(db);
    const inputs = await (0, earnedTrust_1.fetchEarnedTrustInputs)(db);
    const earnedTrustResults = (0, earnedTrust_1.computeEarnedTrust)(inputs);
    const vouchEdges = await fetchActiveVouchEdges(db);
    const earnedTrust = new Map();
    const warmStart = new Map();
    for (const user of inputs.users) {
        earnedTrust.set(user.uid, earnedTrustResults.get(user.uid).earnedTrust);
        if (user.priorScore !== null) {
            warmStart.set(user.uid, user.priorScore);
        }
    }
    const propagationResults = (0, vouchPropagation_1.runVouchPropagation)({
        earnedTrust,
        vouchEdges,
        warmStart,
        w: constants_1.VOUCH_MIXING_WEIGHT,
        maxIterations: constants_1.MAX_POWER_ITERATIONS,
        epsilon: constants_1.CONVERGENCE_EPSILON,
    });
    const now = firestore_1.Timestamp.now();
    let batch = db.batch();
    let opsInBatch = 0;
    let usersUpdated = 0;
    for (const user of inputs.users) {
        const earnedTrustResult = earnedTrustResults.get(user.uid);
        const propagation = propagationResults.get(user.uid);
        const credibility = {
            score: propagation.score,
            lastUpdated: now,
            earnedTrust: earnedTrustResult.earnedTrust,
            components: {
                avgRecordCredibility: earnedTrustResult.avgRecordCredibility,
                disputeAccuracy: earnedTrustResult.disputeAccuracy,
                culpabilityPenalty: earnedTrustResult.culpabilityPenalty,
                unacceptedRecordsPenalty: earnedTrustResult.unacceptedRecordsPenalty,
                credentialFloor: earnedTrustResult.credentialFloor,
            },
            vouchPropagated: propagation.vouchPropagated,
            w: constants_1.VOUCH_MIXING_WEIGHT,
        };
        batch.update(db.collection('users').doc(user.uid), { credibility });
        opsInBatch++;
        usersUpdated++;
        if (opsInBatch >= BATCH_COMMIT_SIZE) {
            await batch.commit();
            batch = db.batch();
            opsInBatch = 0;
        }
    }
    if (opsInBatch > 0) {
        await batch.commit();
    }
    // AvgUserCredibility — the denominator of NormalizedCredibility(u), computed once per cycle
    // over the same inputs.users set fetchEarnedTrustInputs already scoped "all users" to (no
    // activity/suspension concept exists elsewhere in this codebase to narrow "active" further).
    // Written as a literal 0/0 rather than omitted when there are no users yet, so readers never
    // need an !exists() branch — see CredibilityStatsDoc's doc comment.
    const avgUserCredibility = inputs.users.length === 0
        ? 0
        : inputs.users.reduce((sum, user) => sum + propagationResults.get(user.uid).score, 0) /
            inputs.users.length;
    await db.collection('credibilityStats').doc('global').set({
        avgUserCredibility,
        scoredUserCount: inputs.users.length,
        lastUpdated: now,
    });
    console.log(`✅ User Credibility cycle complete: ${disputesEvaluated} dispute(s) evaluated, ${usersUpdated} user(s) updated, AvgUserCredibility=${avgUserCredibility.toFixed(2)}`);
    return { disputesEvaluated, usersUpdated };
}
//# sourceMappingURL=userCredibilityBatchService.js.map