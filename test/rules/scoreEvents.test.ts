// test/rules/scoreEvents.test.ts
//
// firestore.rules — records/{recordId}/scoreEvents/{eventId} — the append-only credibility
// audit-trail subcollection credibilityScoreService writes to for verification/dispute events.
// Parallel to permissionHistory.test.ts / subjectHistory.test.ts, but immutable end-to-end
// (no deferred-blockchainRef update path — update is always denied).

import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { OWNER, SHARER, baseRecord } from './fixtures/recordPermissionMatrix';

const STRANGER = 'stranger-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'belrose-rules-test-score-events',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(() => testEnv.cleanup());
beforeEach(() => testEnv.clearFirestore());

async function seedRecord(recordId: string) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc(`records/${recordId}`).set(baseRecord({ owners: [OWNER], sharers: [SHARER] }));
  });
}

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    recordId: 'placeholder', // callers should override to match the seeded recordId
    recordHash: '0xhash',
    eventType: 'verification',
    contributionDelta: 50,
    createdBy: SHARER,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('firestore.rules — scoreEvents subcollection', () => {
  it('lets a role holder create an event where createdBy matches themselves', async () => {
    const recordId = 'score-events-create-allowed';
    await seedRecord(recordId);

    await assertSucceeds(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`records/${recordId}/scoreEvents/event-1`)
        .set(validEvent({ recordId, createdBy: SHARER }))
    );
  });

  it('denies create from a user with no role on the parent record', async () => {
    const recordId = 'score-events-create-no-role-denied';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(STRANGER)
        .firestore()
        .doc(`records/${recordId}/scoreEvents/event-1`)
        .set(validEvent({ recordId, createdBy: STRANGER }))
    );
  });

  it('denies create when createdBy does not match the caller', async () => {
    const recordId = 'score-events-create-createdby-mismatch-denied';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`records/${recordId}/scoreEvents/event-1`)
        .set(validEvent({ recordId, createdBy: OWNER }))
    );
  });

  it('denies create with an eventType outside the allowed set', async () => {
    const recordId = 'score-events-create-bad-eventtype-denied';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`records/${recordId}/scoreEvents/event-1`)
        .set(validEvent({ recordId, createdBy: SHARER, eventType: 'not_a_real_type' }))
    );
  });

  it('denies create with a non-numeric contributionDelta', async () => {
    const recordId = 'score-events-create-bad-contributiondelta-denied';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`records/${recordId}/scoreEvents/event-1`)
        .set(validEvent({ recordId, createdBy: SHARER, contributionDelta: 'fifty' }))
    );
  });

  it('denies create with a missing recordHash', async () => {
    const recordId = 'score-events-create-missing-recordhash-denied';
    await seedRecord(recordId);

    const { recordHash, ...withoutRecordHash } = validEvent({ recordId, createdBy: SHARER });

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`records/${recordId}/scoreEvents/event-1`)
        .set(withoutRecordHash)
    );
  });

  it('lets a role holder read events, but denies a stranger', async () => {
    const recordId = 'score-events-read';
    await seedRecord(recordId);
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx
        .firestore()
        .doc(`records/${recordId}/scoreEvents/event-1`)
        .set(validEvent({ recordId, createdBy: SHARER }));
    });

    await assertSucceeds(
      testEnv.authenticatedContext(OWNER).firestore().doc(`records/${recordId}/scoreEvents/event-1`).get()
    );
    await assertFails(
      testEnv.authenticatedContext(STRANGER).firestore().doc(`records/${recordId}/scoreEvents/event-1`).get()
    );
  });

  it('never allows delete — immutable audit log', async () => {
    const recordId = 'score-events-immutable-delete';
    await seedRecord(recordId);
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx
        .firestore()
        .doc(`records/${recordId}/scoreEvents/event-1`)
        .set(validEvent({ recordId, createdBy: SHARER }));
    });

    await assertFails(
      testEnv.authenticatedContext(OWNER).firestore().doc(`records/${recordId}/scoreEvents/event-1`).delete()
    );
  });

  it('never allows update — unlike permissionHistory/subjectHistory there is no deferred field to fill in', async () => {
    const recordId = 'score-events-immutable-update';
    await seedRecord(recordId);
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx
        .firestore()
        .doc(`records/${recordId}/scoreEvents/event-1`)
        .set(validEvent({ recordId, createdBy: SHARER }));
    });

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`records/${recordId}/scoreEvents/event-1`)
        .update({ contributionDelta: 999 })
    );
  });
});
