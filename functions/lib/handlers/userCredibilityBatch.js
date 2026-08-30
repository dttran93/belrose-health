"use strict";
// functions/src/handlers/userCredibilityBatch.ts
//
// Entry points for the User Credibility batch computation — scheduled
// Cloud Function. Both are thin wrappers around the same core function; the admin callable is
// the main way to force a recompute during development/ops without waiting for the schedule.
Object.defineProperty(exports, "__esModule", { value: true });
exports.recomputeUserCredibility = exports.runUserCredibilityBatch = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const userCredibilityBatchService_1 = require("../credibility/userCredibilityBatchService");
// Monthly (1st of the month, 03:00 UTC) rather than the whitepaper's assumed daily cadence —
// deliberate cost/activity tradeoff while pre-production: the network is small enough that
// scores barely move day to day, so a daily run mostly just spends Firestore reads/writes to
// reproduce the same numbers. recomputeUserCredibility (below) covers the "I need this refreshed
// now" case in the meantime. Revisit toward daily as real usage grows.
exports.runUserCredibilityBatch = (0, scheduler_1.onSchedule)('0 3 1 * *', async () => {
    await (0, userCredibilityBatchService_1.runUserCredibilityCycle)();
});
exports.recomputeUserCredibility = (0, https_1.onCall)(async (request) => {
    if (!request.auth?.token?.platformAdmin) {
        throw new https_1.HttpsError('permission-denied', 'Not authorized');
    }
    const result = await (0, userCredibilityBatchService_1.runUserCredibilityCycle)();
    return { success: true, ...result };
});
//# sourceMappingURL=userCredibilityBatch.js.map