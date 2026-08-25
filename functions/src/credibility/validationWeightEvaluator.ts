// functions/src/credibility/validationWeightEvaluator.ts

// User Credibility is given as UserCredibility(u) = (1-w)·EarnedTrust(u) + w·Σ[VouchWeight(u1→u)·UserCredibility(u1)].
//
// where EarnedTrust max(CredentialFloor(u), AvgRecordCredibility(u) + DisputeAccuracy(u) - CulpabilityPenalty(u))
//
// validationWeight factors into DisputeAccuracy and Culpability Penalty. The goal of this is to understand when a user
// disputes a record are they generally correct? And when a user is disputed, how culpable are they (No Fault --> Systemic
// --> Reckless --> Intentional)?
//
// A dispute can be in one of three states:
// - validated (1) if the record's score has declined since filing
// - unvalidated (-1) if the record's score has increased since filing
// - pending (0) if the evaluation window hasn't elapsed yet, OR if it has elapsed but the score
//   is still exactly what it was at filing (no new verifications/disputes at all since). This
//   last case matters a lot in practice: medical records get re-reviewed rarely (a patient might
//   see a handful of providers a year), so "nobody has looked again yet" will be the common case,
//   not the exception. Silence isn't evidence either way, so it deliberately does NOT resolve to
//   validated or unvalidated — it just keeps waiting. Resolving "unchanged" as validated would
//   reward filing disputes against records unlikely to get re-reviewed (and penalize their
//   verifier's CulpabilityPenalty) for free, by design, since doing nothing after filing would
//   already win; resolving it as unvalidated would symmetrically punish disputers for silence
//   that isn't their fault. Only an actual directional move freezes an outcome.
//
// Given that, why still require a minimum EVALUATION_WINDOW_DAYS at all, rather than checking
// validationWeight === 0 on every cycle with no wait? Because the "unchanged" rule above only
// protects against sparsity (no signal yet) — it does nothing against noise (an early, possibly
// transient signal). validationWeight is frozen once set, so resolving off the very first
// score movement would let short-lived fluctuations (a verification that gets retracted a few
// days later, a second unrelated dispute briefly dragging the same record's score down) lock in a
// permanent outcome that was never the real signal. The window is a settling-period buffer against
// exactly that: nothing becomes eligible for a verdict until it's had time to stabilize, so by the
// time we're allowed to look, only persistent movement remains — and it raises the cost of
// gaming a quick "validated" result via a coincidental second dispute on the same record.
//
// If a dispute is validated, the user who filed the dispute is considered to have a higher DisputeAccuracy and the
// user who was disputed is considered to have a higher CulpabilityPenalty. If a dispute is unvalidated, the user who filed
// the dispute is considered to have a lower DisputeAccuracy and the user who was disputed is considered to have a lower
// CulpabilityPenalty. This is how ValidationWeight factors into UserCredibility.

import { Firestore, Timestamp } from 'firebase-admin/firestore';
import type { DisputeDoc, ScoreEventContribution } from '../_shared';
import { aggregateRecordScore } from '../_shared';
import { EVALUATION_WINDOW_DAYS } from './constants';

const BATCH_COMMIT_SIZE = 450; // headroom under Firestore's 500-writes-per-batch limit

/**
 * Reconstructs a record's credibility score as of a SPECIFIC recordHash — not the record's live
 * cached score, which only ever reflects its CURRENT hash. Replays records/{recordId}/scoreEvents
 * filtered to that hash, exactly the audit-trail capability that subcollection was built to
 * support. Returns null if the record doc doesn't exist (e.g. deleted since).
 */
export async function computeRecordScoreForHash(
  db: Firestore,
  recordId: string,
  recordHash: string
): Promise<number | null> {
  const recordSnap = await db.collection('records').doc(recordId).get();
  if (!recordSnap.exists) return null;

  const eventsSnap = await db
    .collection('records')
    .doc(recordId)
    .collection('scoreEvents')
    .where('recordHash', '==', recordHash)
    .get();

  const contributions: ScoreEventContribution[] = eventsSnap.docs.map(eventDoc => {
    const data = eventDoc.data();
    return {
      eventType: data.eventType as ScoreEventContribution['eventType'],
      contributionDelta: (data.contributionDelta as number) ?? 0,
    };
  });

  return aggregateRecordScore(contributions).score;
}

/**
 * Finds disputes still pending (validationWeight === 0) whose evaluation window has elapsed, and
 * freezes an outcome ONLY when the record's score has actually moved since filing: validated (1)
 * on decline, unvalidated (-1) on increase. If the score is unchanged, the dispute is left
 * pending — re-checked again next cycle rather than being forced to a verdict on no evidence
 * (see the file-level comment for why). Idempotent — already-resolved disputes fall out of the
 * query on re-run, so re-running this after a partial failure is safe. A dispute whose record
 * never gets re-reviewed will keep getting re-fetched every cycle indefinitely; fine at current
 * scale, but a candidate for a re-check cap/backoff later if it ever shows up as real cost.
 */
export async function evaluatePendingDisputes(db: Firestore): Promise<{ evaluated: number }> {
  const cutoff = Timestamp.fromMillis(Date.now() - EVALUATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const pendingSnap = await db
    .collection('disputes')
    .where('validationWeight', '==', 0)
    .where('createdAt', '<=', cutoff)
    .get();

  if (pendingSnap.empty) {
    return { evaluated: 0 };
  }

  let evaluated = 0;
  let stillSilent = 0;
  let batch = db.batch();
  let opsInBatch = 0;

  for (const disputeDoc of pendingSnap.docs) {
    const dispute = disputeDoc.data() as DisputeDoc;

    const currentScoreForHash = await computeRecordScoreForHash(
      db,
      dispute.recordId,
      dispute.recordHash
    );
    if (currentScoreForHash === null) {
      console.warn(
        `⚠️ Skipping ValidationWeight evaluation for dispute ${disputeDoc.id} — record ${dispute.recordId} not found`
      );
      continue;
    }

    if (currentScoreForHash === dispute.recordScoreAtCreation) {
      // No movement since filing — leave pending, don't force a verdict on silence.
      stillSilent++;
      continue;
    }

    const validationWeight = currentScoreForHash < dispute.recordScoreAtCreation ? 1 : -1;

    batch.update(disputeDoc.ref, { validationWeight });
    opsInBatch++;
    evaluated++;

    if (opsInBatch >= BATCH_COMMIT_SIZE) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  if (opsInBatch > 0) {
    await batch.commit();
  }

  console.log(
    `📊 ValidationWeight: ${evaluated} dispute(s) resolved, ${stillSilent} left pending (no score movement yet)`
  );
  return { evaluated };
}
