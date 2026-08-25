// functions/src/credibility/userCredibilityBatchService.ts
//
// Orchestrator for the User Credibility batch cycle. Wires the phases together:
//   1. evaluatePendingDisputes — freeze ValidationWeight for disputes past their window
//   2. fetchEarnedTrustInputs + computeEarnedTrust — EarnedTrust(u) per user
//   3. runVouchPropagation — the iterative UserCredibility(u) solve, warm-started from the prior
//      cycle's converged scores
//   4. batched write-back — users/{uid}.credibility, touching only that field per doc

import { Firestore, Timestamp, getFirestore } from 'firebase-admin/firestore';
import type { UserCredibilityScore } from '../_shared';
import { evaluatePendingDisputes } from './validationWeightEvaluator';
import { fetchEarnedTrustInputs, computeEarnedTrust } from './earnedTrust';
import { runVouchPropagation } from './vouchPropagation';
import { VOUCH_MIXING_WEIGHT, MAX_POWER_ITERATIONS, CONVERGENCE_EPSILON } from './constants';
import type { VouchEdge } from './types';

const BATCH_COMMIT_SIZE = 450; // headroom under Firestore's 500-writes-per-batch limit

async function fetchActiveVouchEdges(db: Firestore): Promise<VouchEdge[]> {
  const snap = await db.collection('vouches').where('chainStatus', '==', 'Active').get();
  return snap.docs.map(d => {
    const data = d.data();
    return { voucherId: data.voucherId as string, voucheeId: data.voucheeId as string };
  });
}

export interface UserCredibilityCycleResult {
  disputesEvaluated: number;
  usersUpdated: number;
}

/**
 * Runs one full batch cycle. Takes an optional explicit `db` (defaulting to the ambient default
 * app's Firestore) so tests can point this at an emulator instance without needing a separate
 * wrapper — every real call site just calls runUserCredibilityCycle() with no arguments.
 */
export async function runUserCredibilityCycle(db: Firestore = getFirestore()): Promise<UserCredibilityCycleResult> {
  console.log('🔄 Starting User Credibility batch cycle...');

  const { evaluated: disputesEvaluated } = await evaluatePendingDisputes(db);

  const inputs = await fetchEarnedTrustInputs(db);
  const earnedTrustResults = computeEarnedTrust(inputs);

  const vouchEdges = await fetchActiveVouchEdges(db);

  const earnedTrust = new Map<string, number>();
  const warmStart = new Map<string, number>();
  for (const user of inputs.users) {
    earnedTrust.set(user.uid, earnedTrustResults.get(user.uid)!.earnedTrust);
    if (user.priorScore !== null) {
      warmStart.set(user.uid, user.priorScore);
    }
  }

  const propagationResults = runVouchPropagation({
    earnedTrust,
    vouchEdges,
    warmStart,
    w: VOUCH_MIXING_WEIGHT,
    maxIterations: MAX_POWER_ITERATIONS,
    epsilon: CONVERGENCE_EPSILON,
  });

  const now = Timestamp.now();
  let batch = db.batch();
  let opsInBatch = 0;
  let usersUpdated = 0;

  for (const user of inputs.users) {
    const earnedTrustResult = earnedTrustResults.get(user.uid)!;
    const propagation = propagationResults.get(user.uid)!;

    const credibility: UserCredibilityScore = {
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
      w: VOUCH_MIXING_WEIGHT,
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
  const avgUserCredibility =
    inputs.users.length === 0
      ? 0
      : inputs.users.reduce((sum, user) => sum + propagationResults.get(user.uid)!.score, 0) /
        inputs.users.length;

  await db.collection('credibilityStats').doc('global').set({
    avgUserCredibility,
    scoredUserCount: inputs.users.length,
    lastUpdated: now,
  });

  console.log(
    `✅ User Credibility cycle complete: ${disputesEvaluated} dispute(s) evaluated, ${usersUpdated} user(s) updated, AvgUserCredibility=${avgUserCredibility.toFixed(2)}`
  );

  return { disputesEvaluated, usersUpdated };
}
