// test/rules/credibilityStats.test.ts
//
// firestore.rules — credibilityStats/{statId} — the first non-per-resource-ID doc in this
// schema (always exactly one doc, id 'global'), holding AvgUserCredibility for
// NormalizedCredibility(u) = UserCredibility(u) / AvgUserCredibility. Written wholesale by the
// UserCredibility batch cycle (Admin SDK, bypasses rules entirely) — the write branch here is
// defense-in-depth only, mirroring unacceptedFlags.test.ts's shape: what's actually testable via
// the client SDK is that any authenticated user can read, and a normal authenticated user is
// always denied a write.

import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const SOME_USER = 'some-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'belrose-rules-test-credibility-stats',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(() => testEnv.cleanup());
beforeEach(() => testEnv.clearFirestore());

function validStats(overrides: Record<string, unknown> = {}) {
  return {
    avgUserCredibility: 512.3,
    scoredUserCount: 7,
    lastUpdated: new Date(),
    ...overrides,
  };
}

async function seedStats(overrides: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc('credibilityStats/global').set(validStats(overrides));
  });
}

describe('firestore.rules — credibilityStats — read', () => {
  it('lets any authenticated user read the global doc', async () => {
    await seedStats();

    await assertSucceeds(
      testEnv.authenticatedContext(SOME_USER).firestore().doc('credibilityStats/global').get()
    );
  });

  it('denies unauthenticated read', async () => {
    await seedStats();

    await assertFails(
      testEnv.unauthenticatedContext().firestore().doc('credibilityStats/global').get()
    );
  });
});

describe('firestore.rules — credibilityStats — write (client-side always denied)', () => {
  it('denies a normal authenticated user creating the doc directly', async () => {
    await assertFails(
      testEnv.authenticatedContext(SOME_USER).firestore().doc('credibilityStats/global').set(validStats())
    );
  });

  it('denies a normal authenticated user updating the doc', async () => {
    await seedStats();

    await assertFails(
      testEnv
        .authenticatedContext(SOME_USER)
        .firestore()
        .doc('credibilityStats/global')
        .update({ avgUserCredibility: 999 })
    );
  });

  it('denies a normal authenticated user deleting the doc', async () => {
    await seedStats();

    await assertFails(
      testEnv.authenticatedContext(SOME_USER).firestore().doc('credibilityStats/global').delete()
    );
  });
});
