// functions/scripts/migrateScoreEventsToBayesianModel.ts
//
// One-off migration for the Bayesian-average RecordScore rewrite (NormalizedCredibility /
// AvgUserCredibility). Every scoreEvents doc and cached records/{id}.credibility.score in
// Firestore was written under the OLD simple-additive model (flat scoreDelta, no credibility
// weighting). This script moves existing data onto the new shape in three passes:
//
//   1. Backfill normalizedCredibilityAtCreation = 1.0 (neutral) on every VerificationDoc/
//      DisputeDoc missing the field — there is no way to reconstruct what a verifier's/
//      disputer's true historical NormalizedCredibility was at the time they acted, so all
//      pre-migration history is treated as neutral-credibility, per the settled decision to
//      migrate to a single homogeneous event shape rather than have the aggregator support two
//      shapes forever.
//   2. Rewrite every scoreEvents doc: drop scoreDelta, add contributionDelta computed from the
//      event's own stored metadata (verificationLevel/disputeSeverity, or the before/after pair
//      for _modified events) via RECORD_VERIFICATION_WEIGHTS/RECORD_DISPUTE_SEVERITY_WEIGHTS at
//      a flat normalizedCredibilityAtCreation = 1.0. Also stamps
//      metadata.normalizedCredibilityAtCreation = 1.0 for consistency with new-format events.
//   3. Recompute every records/{recordId}.credibility.score: for each record's CURRENT hash, run
//      its now-migrated scoreEvents through aggregateRecordScore and write the result — cached
//      scores under the old additive model are wrong under the new formula's semantics, not just
//      differently scaled, so this can't be skipped.
//
// This is a VISIBLE one-time score shift on live records: any record verified/disputed under the
// old model by a user whose real credibility differed meaningfully from average will move once
// this runs (the old model had no credibility weighting at all). Run with --dry-run FIRST and
// review the before/after score-diff report before trusting --execute against real data.
//
// Usage:
//   cd functions
//   npx tsx scripts/migrateScoreEventsToBayesianModel.ts             # dry run — no writes
//   npx tsx scripts/migrateScoreEventsToBayesianModel.ts --execute   # live run

import * as admin from 'firebase-admin';
import * as path from 'path';
import 'dotenv/config';
import {
  RECORD_VERIFICATION_WEIGHTS,
  RECORD_DISPUTE_SEVERITY_WEIGHTS,
  aggregateRecordScore,
  type ScoreEventContribution,
  type ScoreEventType,
} from '../src/_shared';

const serviceAccount = require(path.join(__dirname, '..', '..', '.firebaseServiceAccountKey.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const DRY_RUN = !process.argv.includes('--execute');
const BATCH_COMMIT_SIZE = 450; // headroom under Firestore's 500-writes-per-batch limit

// ── Batched writer helper ────────────────────────────────────────────────────────────────────

class BatchWriter {
  private batch = db.batch();
  private ops = 0;
  private totalOps = 0;

  set(ref: admin.firestore.DocumentReference, data: admin.firestore.UpdateData<any>) {
    this.batch.update(ref, data);
    this.ops++;
    this.totalOps++;
  }

  async flushIfNeeded() {
    if (this.ops >= BATCH_COMMIT_SIZE) {
      if (!DRY_RUN) await this.batch.commit();
      this.batch = db.batch();
      this.ops = 0;
    }
  }

  async finalFlush() {
    if (this.ops > 0 && !DRY_RUN) await this.batch.commit();
  }

  get count() {
    return this.totalOps;
  }
}

// ── Pass 1: backfill normalizedCredibilityAtCreation on Verification/DisputeDocs ────────────────

async function backfillActorDocs(): Promise<{ verifications: number; disputes: number }> {
  const writer = new BatchWriter();

  const verificationsSnap = await db.collection('verifications').get();
  let verifications = 0;
  for (const docSnap of verificationsSnap.docs) {
    if (docSnap.data().normalizedCredibilityAtCreation === undefined) {
      writer.set(docSnap.ref, { normalizedCredibilityAtCreation: 1.0 });
      verifications++;
      await writer.flushIfNeeded();
    }
  }

  const disputesSnap = await db.collection('disputes').get();
  let disputes = 0;
  for (const docSnap of disputesSnap.docs) {
    if (docSnap.data().normalizedCredibilityAtCreation === undefined) {
      writer.set(docSnap.ref, { normalizedCredibilityAtCreation: 1.0 });
      disputes++;
      await writer.flushIfNeeded();
    }
  }

  await writer.finalFlush();
  return { verifications, disputes };
}

// ── Pass 2: rewrite scoreEvents (scoreDelta -> contributionDelta) ───────────────────────────────

/** Old-shape event metadata this script reads — a superset of the new ScoreEventMetadata that
 *  still includes the (now-scoring-irrelevant, but still audit-relevant) culpability fields. */
interface LegacyScoreEventMetadata {
  verificationLevel?: 0 | 1 | 2 | 3;
  previousVerificationLevel?: 0 | 1 | 2 | 3;
  disputeSeverity?: 0 | 1 | 2 | 3;
  previousDisputeSeverity?: 0 | 1 | 2 | 3;
}

function computeLegacyContributionDelta(
  eventType: ScoreEventType,
  metadata: LegacyScoreEventMetadata | undefined
): number {
  const vWeight = (level: 0 | 1 | 2 | 3 | undefined) => RECORD_VERIFICATION_WEIGHTS[level ?? 0] ?? 0;
  const dWeight = (severity: 0 | 1 | 2 | 3 | undefined) => RECORD_DISPUTE_SEVERITY_WEIGHTS[severity ?? 0] ?? 0;

  switch (eventType) {
    case 'verification':
      return vWeight(metadata?.verificationLevel);
    case 'verification_revoked':
      return vWeight(metadata?.previousVerificationLevel);
    case 'verification_modified':
      return vWeight(metadata?.verificationLevel) - vWeight(metadata?.previousVerificationLevel);
    case 'dispute':
      return dWeight(metadata?.disputeSeverity);
    case 'dispute_revoked':
      return dWeight(metadata?.previousDisputeSeverity);
    case 'dispute_modified':
      return dWeight(metadata?.disputeSeverity) - dWeight(metadata?.previousDisputeSeverity);
    default:
      return 0;
  }
}

async function rewriteScoreEvents(): Promise<{ recordsTouched: number; eventsRewritten: number }> {
  const writer = new BatchWriter();
  const recordsSnap = await db.collection('records').get();

  let recordsTouched = 0;
  let eventsRewritten = 0;

  for (const recordDoc of recordsSnap.docs) {
    const eventsSnap = await recordDoc.ref.collection('scoreEvents').get();
    if (eventsSnap.empty) continue;

    let touchedThisRecord = false;
    for (const eventDoc of eventsSnap.docs) {
      const data = eventDoc.data();
      if (data.contributionDelta !== undefined) continue; // already migrated

      const contributionDelta = computeLegacyContributionDelta(
        data.eventType as ScoreEventType,
        data.metadata as LegacyScoreEventMetadata | undefined
      );

      writer.set(eventDoc.ref, {
        contributionDelta,
        scoreDelta: admin.firestore.FieldValue.delete(),
        'metadata.normalizedCredibilityAtCreation': 1.0,
      });
      eventsRewritten++;
      touchedThisRecord = true;
      await writer.flushIfNeeded();
    }
    if (touchedThisRecord) recordsTouched++;
  }

  await writer.finalFlush();
  return { recordsTouched, eventsRewritten };
}

// ── Pass 3: recompute records/{recordId}.credibility.score ──────────────────────────────────────

async function recomputeRecordScores(): Promise<{ recordsUpdated: number; diffs: Array<{ id: string; before: number | null; after: number }> }> {
  const writer = new BatchWriter();
  const recordsSnap = await db.collection('records').get();

  let recordsUpdated = 0;
  const diffs: Array<{ id: string; before: number | null; after: number }> = [];

  for (const recordDoc of recordsSnap.docs) {
    const record = recordDoc.data();
    const currentHash = record.recordHash as string | undefined;
    if (!currentHash) continue;

    const eventsSnap = await recordDoc.ref
      .collection('scoreEvents')
      .where('recordHash', '==', currentHash)
      .get();

    const contributions: ScoreEventContribution[] = eventsSnap.docs.map(d => ({
      eventType: d.data().eventType as ScoreEventType,
      contributionDelta: (d.data().contributionDelta as number) ?? 0,
    }));

    const { score: after } = aggregateRecordScore(contributions);
    const before: number | null = record.credibility?.score ?? null;

    if (before !== after) {
      diffs.push({ id: recordDoc.id, before, after });
      writer.set(recordDoc.ref, {
        credibility: { score: after, lastUpdated: admin.firestore.Timestamp.now() },
      });
      recordsUpdated++;
      await writer.flushIfNeeded();
    }
  }

  await writer.finalFlush();
  return { recordsUpdated, diffs };
}

// ── Main ──────────────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Belrose: Migrate scoreEvents to Bayesian RecordScore     ');
  console.log(`   Mode: ${DRY_RUN ? '🧪 DRY RUN (pass --execute to write)' : '🚀 LIVE'}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('▶ Pass 1: backfill normalizedCredibilityAtCreation on Verification/DisputeDocs...');
  const backfill = await backfillActorDocs();
  console.log(
    `   ${DRY_RUN ? 'Would backfill' : 'Backfilled'} ${backfill.verifications} verification(s), ${backfill.disputes} dispute(s)\n`
  );

  console.log('▶ Pass 2: rewrite scoreEvents (scoreDelta -> contributionDelta)...');
  const rewrite = await rewriteScoreEvents();
  console.log(
    `   ${DRY_RUN ? 'Would rewrite' : 'Rewrote'} ${rewrite.eventsRewritten} event(s) across ${rewrite.recordsTouched} record(s)\n`
  );

  console.log('▶ Pass 3: recompute records/{recordId}.credibility.score...');
  const recompute = await recomputeRecordScores();
  console.log(
    `   ${DRY_RUN ? 'Would update' : 'Updated'} ${recompute.recordsUpdated} record score(s)\n`
  );

  if (recompute.diffs.length > 0) {
    console.log('   Score diff report:');
    for (const diff of recompute.diffs) {
      console.log(`     ${diff.id}: ${diff.before ?? '(none)'} -> ${diff.after}`);
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   ✅ Done. ${DRY_RUN ? 'Re-run with --execute to apply.' : 'Migration applied.'}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
