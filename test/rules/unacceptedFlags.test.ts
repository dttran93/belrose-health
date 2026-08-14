// test/rules/unacceptedFlags.test.ts
//
// firestore.rules — unacceptedFlags/{flagId} — top-level collection, doc ID
// `{subjectId}_{recordId}`. Reads are open to any authenticated user (same "public trust signal"
// precedent as vouches); writes are Admin-SDK-only in practice (flagUnacceptedUpdate/
// revokeUnacceptedFlag use the platform's admin wallet + Admin SDK, which bypasses rules
// entirely) — the create/update branches here are defense-in-depth only, so what's actually
// testable via the client SDK is that a normal authenticated user is always denied.

import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const SUBJECT = 'subject-uid';
const OTHER_USER = 'other-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'belrose-rules-test-unaccepted-flags',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(() => testEnv.cleanup());
beforeEach(() => testEnv.clearFirestore());

function validFlag(overrides: Record<string, unknown> = {}) {
  return {
    subjectId: SUBJECT,
    recordId: 'record-1',
    reporterId: 'reporter-1',
    recordHash: '0xhash',
    isActive: true,
    createdAt: new Date(),
    chainStatus: 'confirmed',
    onChainHistory: [],
    ...overrides,
  };
}

async function seedFlag(flagId: string, overrides: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc(`unacceptedFlags/${flagId}`).set(validFlag(overrides));
  });
}

describe('firestore.rules — unacceptedFlags — read', () => {
  it('lets any authenticated user read a flag, including one about someone else', async () => {
    await seedFlag('subject-uid_record-1');

    await assertSucceeds(
      testEnv.authenticatedContext(OTHER_USER).firestore().doc('unacceptedFlags/subject-uid_record-1').get()
    );
  });

  it('denies unauthenticated read', async () => {
    await seedFlag('subject-uid_record-1');

    await assertFails(
      testEnv.unauthenticatedContext().firestore().doc('unacceptedFlags/subject-uid_record-1').get()
    );
  });
});

describe('firestore.rules — unacceptedFlags — write (client-side always denied)', () => {
  it('denies a normal authenticated user creating a flag directly', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(SUBJECT)
        .firestore()
        .doc('unacceptedFlags/subject-uid_record-1')
        .set(validFlag())
    );
  });

  it('denies a normal authenticated user creating a flag about someone else', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(OTHER_USER)
        .firestore()
        .doc('unacceptedFlags/subject-uid_record-1')
        .set(validFlag())
    );
  });

  it('denies a normal authenticated user updating an existing flag (e.g. self-revoking)', async () => {
    await seedFlag('subject-uid_record-1');

    await assertFails(
      testEnv
        .authenticatedContext(SUBJECT)
        .firestore()
        .doc('unacceptedFlags/subject-uid_record-1')
        .update({ isActive: false })
    );
  });

  it('never allows delete — permanent audit trail', async () => {
    await seedFlag('subject-uid_record-1');

    await assertFails(
      testEnv
        .authenticatedContext(SUBJECT)
        .firestore()
        .doc('unacceptedFlags/subject-uid_record-1')
        .delete()
    );
  });
});
