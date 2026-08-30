// functions/src/handlers/userCredibilityBatch.ts
//
// Entry points for the User Credibility batch computation — scheduled
// Cloud Function. Both are thin wrappers around the same core function; the admin callable is
// the main way to force a recompute during development/ops without waiting for the schedule.

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { runUserCredibilityCycle } from '../credibility/userCredibilityBatchService';

// Monthly (1st of the month, 03:00 UTC) rather than the whitepaper's assumed daily cadence —
// deliberate cost/activity tradeoff while pre-production: the network is small enough that
// scores barely move day to day, so a daily run mostly just spends Firestore reads/writes to
// reproduce the same numbers. recomputeUserCredibility (below) covers the "I need this refreshed
// now" case in the meantime. Revisit toward daily as real usage grows.
export const runUserCredibilityBatch = onSchedule('0 3 1 * *', async () => {
  await runUserCredibilityCycle();
});

export const recomputeUserCredibility = onCall(async request => {
  if (!request.auth?.token?.platformAdmin) {
    throw new HttpsError('permission-denied', 'Not authorized');
  }

  const result = await runUserCredibilityCycle();
  return { success: true, ...result };
});
