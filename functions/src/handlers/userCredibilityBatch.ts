// functions/src/handlers/userCredibilityBatch.ts
//
// Entry points for the User Credibility batch computation — scheduled
// Cloud Function. Both are thin wrappers around the same core function; the admin callable is
// the main way to force a recompute during development/ops without waiting for the schedule.

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { runUserCredibilityCycle } from '../credibility/userCredibilityBatchService';

export const runUserCredibilityBatch = onSchedule('0 3 * * *', async () => {
  await runUserCredibilityCycle();
});

export const recomputeUserCredibility = onCall(async request => {
  if (!request.auth?.token?.platformAdmin) {
    throw new HttpsError('permission-denied', 'Not authorized');
  }

  const result = await runUserCredibilityCycle();
  return { success: true, ...result };
});
