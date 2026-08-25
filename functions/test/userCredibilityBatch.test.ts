// functions/test/userCredibilityBatch.test.ts
//
// Functions layer — the User Credibility batch cycle end-to-end against the real Firestore
// emulator (Admin SDK, bypassing security rules entirely — same as the real scheduled/admin-
// triggered invocation). Covers what the pure unit tests (vouchPropagation.test.ts,
// earnedTrust.test.ts) can't: real Firestore reads/writes, the scoreEvents replay for
// ValidationWeight, and the write-back shape.

import { beforeEach, describe, it, expect } from 'vitest';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { clearFirestore } from './helpers/testAdmin';
import { runUserCredibilityCycle } from '../src/credibility/userCredibilityBatchService';
import type { ScoreEventType } from '../src/_shared';

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await clearFirestore();
});

async function seedUser(uid: string, overrides: Record<string, unknown> = {}) {
  await admin.firestore().collection('users').doc(uid).set({ uid, ...overrides });
}

async function seedRecord(
  recordId: string,
  recordHash: string,
  credibilityScore: number,
  overrides: Record<string, unknown> = {}
) {
  await admin
    .firestore()
    .collection('records')
    .doc(recordId)
    .set({
      recordHash,
      credibility: { score: credibilityScore, lastUpdated: Timestamp.now() },
      ...overrides,
    });
}

async function seedScoreEvent(
  recordId: string,
  recordHash: string,
  eventType: ScoreEventType,
  contributionDelta: number
) {
  await admin
    .firestore()
    .collection('records')
    .doc(recordId)
    .collection('scoreEvents')
    .doc(`event-${Date.now()}-${Math.random()}`)
    .set({
      recordId,
      recordHash,
      eventType,
      contributionDelta,
      createdBy: 'someone',
      createdAt: Timestamp.now(),
    });
}

async function seedVerification(
  verifierId: string,
  recordId: string,
  recordHash: string,
  overrides: Record<string, unknown> = {}
) {
  await admin
    .firestore()
    .collection('verifications')
    .doc(`${recordHash}_${verifierId}`)
    .set({
      recordId,
      recordHash,
      verifierId,
      level: 3,
      isActive: true,
      createdAt: Timestamp.now(),
      chainStatus: 'confirmed',
      onChainHistory: [],
      ...overrides,
    });
}

async function seedDispute(
  disputerId: string,
  recordId: string,
  recordHash: string,
  recordScoreAtCreation: number,
  createdAt: Timestamp,
  overrides: Record<string, unknown> = {}
) {
  await admin
    .firestore()
    .collection('disputes')
    .doc(`${recordHash}_${disputerId}`)
    .set({
      recordId,
      recordHash,
      disputerId,
      severity: 2,
      culpability: 3,
      isActive: true,
      createdAt,
      chainStatus: 'confirmed',
      onChainHistory: [],
      recordScoreAtCreation,
      validationWeight: 0,
      ...overrides,
    });
}

async function seedUnacceptedFlag(
  subjectId: string,
  recordId: string,
  overrides: Record<string, unknown> = {}
) {
  await admin
    .firestore()
    .collection('unacceptedFlags')
    .doc(`${subjectId}_${recordId}`)
    .set({
      id: `${subjectId}_${recordId}`,
      subjectId,
      recordId,
      recordHash: 'hash-1',
      reporterId: 'reporter-1',
      isActive: true,
      createdAt: Timestamp.now(),
      chainStatus: 'confirmed',
      onChainHistory: [],
      ...overrides,
    });
}

async function seedSubjectHistoryEvent(
  recordId: string,
  subjectId: string,
  action: 'anchored' | 'anchored_as_controller' | 'unanchored',
  overrides: Record<string, unknown> = {}
) {
  await admin
    .firestore()
    .collection('records')
    .doc(recordId)
    .collection('subjectHistory')
    .doc(`${Date.now()}_${subjectId}_${Math.random().toString(36).slice(2, 8)}`)
    .set({
      recordId,
      subjectId,
      action,
      changedBy: subjectId,
      blockchainRef: null,
      ...overrides,
    });
}

async function seedVouch(voucherId: string, voucheeId: string) {
  await admin
    .firestore()
    .collection('vouches')
    .doc(`${voucherId}_${voucheeId}`)
    .set({
      voucherId,
      voucheeId,
      chainStatus: 'Active',
      createdAt: Timestamp.now(),
      onChainHistory: [],
    });
}

describe('runUserCredibilityCycle — ValidationWeight evaluation', () => {
  it('leaves a dispute pending when its evaluation window has not elapsed', async () => {
    await seedUser('disputer-1');
    await seedRecord('record-1', 'hash-1', 500);
    await seedDispute('disputer-1', 'record-1', 'hash-1', 500, Timestamp.now());

    await runUserCredibilityCycle(admin.firestore());

    const dispute = await admin.firestore().collection('disputes').doc('hash-1_disputer-1').get();
    expect(dispute.data()!.validationWeight).toBe(0);
  });

  it('validates a dispute past its window when the record score declined since filing', async () => {
    await seedUser('disputer-1');
    await seedRecord('record-1', 'hash-1', 500); // cached value unused by the replay itself
    const filedAt = Timestamp.fromMillis(Date.now() - 91 * DAY_MS);
    await seedDispute('disputer-1', 'record-1', 'hash-1', 500, filedAt);
    // Score replay for hash-1 must reflect the CURRENT evidence: a dispute event pulls the
    // Bayesian-average score below the 500 BasePrior baseline recordScoreAtCreation was set at.
    await seedScoreEvent('record-1', 'hash-1', 'dispute', 300);

    await runUserCredibilityCycle(admin.firestore());

    const dispute = await admin.firestore().collection('disputes').doc('hash-1_disputer-1').get();
    expect(dispute.data()!.validationWeight).toBe(1);
  });

  it('unvalidates a dispute past its window when the record score increased since filing', async () => {
    await seedUser('disputer-1');
    await seedRecord('record-1', 'hash-1', 500); // cached value unused by the replay itself
    const filedAt = Timestamp.fromMillis(Date.now() - 91 * DAY_MS);
    await seedDispute('disputer-1', 'record-1', 'hash-1', 500, filedAt);
    // A verification event with a weight above BasePrior raises the Bayesian-average score
    // above the 500 baseline recordScoreAtCreation was set at.
    await seedScoreEvent('record-1', 'hash-1', 'verification', 950);

    await runUserCredibilityCycle(admin.firestore());

    const dispute = await admin.firestore().collection('disputes').doc('hash-1_disputer-1').get();
    expect(dispute.data()!.validationWeight).toBe(-1);
  });

  it('stays pending past its window when the record score has not moved at all (silence is not evidence)', async () => {
    await seedUser('disputer-1');
    await seedRecord('record-1', 'hash-1', 500); // exactly the same as recordScoreAtCreation
    const filedAt = Timestamp.fromMillis(Date.now() - 91 * DAY_MS);
    await seedDispute('disputer-1', 'record-1', 'hash-1', 500, filedAt);
    // No scoreEvents at all — nobody has reviewed this record since the dispute was filed.

    await runUserCredibilityCycle(admin.firestore());

    const dispute = await admin.firestore().collection('disputes').doc('hash-1_disputer-1').get();
    expect(dispute.data()!.validationWeight).toBe(0);
  });
});

describe('runUserCredibilityCycle — EarnedTrust write-back', () => {
  it('excludes a stale-hash verification from AvgRecordCredibility', async () => {
    await seedUser('verifier-1');
    // Record has moved on to hash-2; the verification is still against hash-1.
    await seedRecord('record-1', 'hash-2', 900);
    await seedVerification('verifier-1', 'record-1', 'hash-1');

    await runUserCredibilityCycle(admin.firestore());

    const user = await admin.firestore().collection('users').doc('verifier-1').get();
    expect(user.data()!.credibility.components.avgRecordCredibility).toBeNull();
  });

  it('writes only the credibility field on the user doc', async () => {
    await seedUser('user-1', { displayName: 'Should Not Change' });

    await runUserCredibilityCycle(admin.firestore());

    const user = await admin.firestore().collection('users').doc('user-1').get();
    expect(user.data()!.displayName).toBe('Should Not Change');
    expect(user.data()!.credibility).toBeDefined();
    expect(typeof user.data()!.credibility.score).toBe('number');
  });
});

describe('runUserCredibilityCycle — UnacceptedRecordsPenalty write-back', () => {
  it('computes the ratio from subjectHistory anchor events and active unacceptedFlags end to end', async () => {
    await seedUser('subject-1');
    // S(u): 4 distinct records ever anchored (subjectHistory, not the live records.subjects[]
    // array — this end-to-end test is also what confirms the collectionGroup('subjectHistory')
    // scan needs no new index, per the plan's design rationale).
    await seedSubjectHistoryEvent('record-1', 'subject-1', 'anchored');
    await seedSubjectHistoryEvent('record-2', 'subject-1', 'anchored');
    await seedSubjectHistoryEvent('record-3', 'subject-1', 'anchored_as_controller');
    await seedSubjectHistoryEvent('record-4', 'subject-1', 'anchored');
    // A later unanchor of one of them must NOT shrink the count — still 4 distinct recordIds.
    await seedSubjectHistoryEvent('record-4', 'subject-1', 'unanchored');
    // U(u): 1 active flag.
    await seedUnacceptedFlag('subject-1', 'record-5');

    await runUserCredibilityCycle(admin.firestore());

    const user = await admin.firestore().collection('users').doc('subject-1').get();
    const components = user.data()!.credibility.components;

    // 1/4 * UNACCEPTED_RECORDS_PENALTY_CONSTANT (500) = 125
    expect(components.unacceptedRecordsPenalty).toBeCloseTo(125, 5);
  });

  it('ignores a revoked (isActive: false) flag entirely', async () => {
    await seedUser('subject-1');
    await seedSubjectHistoryEvent('record-1', 'subject-1', 'anchored');
    await seedUnacceptedFlag('subject-1', 'record-2', { isActive: false });

    await runUserCredibilityCycle(admin.firestore());

    const user = await admin.firestore().collection('users').doc('subject-1').get();
    expect(user.data()!.credibility.components.unacceptedRecordsPenalty).toBe(0);
  });
});

describe('runUserCredibilityCycle — AvgUserCredibility write-back', () => {
  it('writes credibilityStats/global as the mean of every scored user', async () => {
    await seedUser('user-1'); // EarnedTrust 0, no evidence
    await seedUser('user-2'); // EarnedTrust 0, no evidence

    await runUserCredibilityCycle(admin.firestore());

    const stats = await admin.firestore().collection('credibilityStats').doc('global').get();
    expect(stats.exists).toBe(true);
    expect(stats.data()!.scoredUserCount).toBe(2);
    // Both users score identically (no evidence, no vouches) — mean == that shared score.
    const user1 = await admin.firestore().collection('users').doc('user-1').get();
    expect(stats.data()!.avgUserCredibility).toBeCloseTo(user1.data()!.credibility.score, 5);
  });

  it('writes a literal 0/0 (not omitted) when there are no users yet', async () => {
    await runUserCredibilityCycle(admin.firestore());

    const stats = await admin.firestore().collection('credibilityStats').doc('global').get();
    expect(stats.exists).toBe(true);
    expect(stats.data()!.avgUserCredibility).toBe(0);
    expect(stats.data()!.scoredUserCount).toBe(0);
  });
});

describe('runUserCredibilityCycle — vouch propagation', () => {
  it('a vouched-for user scores higher than their raw EarnedTrust alone would produce', async () => {
    await seedUser('newcomer'); // EarnedTrust 0 (no track record, no credentialFloor)
    await seedUser('established');
    await seedRecord('record-1', 'hash-1', 900);
    await seedVerification('established', 'record-1', 'hash-1');
    await seedVouch('established', 'newcomer');

    await runUserCredibilityCycle(admin.firestore());

    const newcomer = await admin.firestore().collection('users').doc('newcomer').get();
    const credibility = newcomer.data()!.credibility;

    // EarnedTrust alone is 0 (no verifications/disputes, no floor) — any positive score can only
    // have come from the vouch.
    expect(credibility.earnedTrust).toBe(0);
    expect(credibility.score).toBeGreaterThan(0);
    expect(credibility.vouchPropagated).toBeGreaterThan(0);
  });
});
