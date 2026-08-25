// test/rules/verifications.test.ts
//
// firestore.rules — verifications/{verificationId} — top-level collection, doc ID
// `{recordHash}_{verifierId}`. Focused specifically on normalizedCredibilityAtCreation, the
// Bayesian-average rewrite's frozen-at-creation NormalizedCredibility(verifier) field — same
// immutability shape and same anti-gaming rationale as disputes.test.ts's
// recordScoreAtCreation/validationWeight coverage: the verifier can never rewrite it on a plain
// modify, and reactivating a retracted verification must not reset it to a fresh value either.

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
const RECORD_HASH = 'hash-v1';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'belrose-rules-test-verifications',
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

function verificationId(recordHash: string, verifierId: string) {
  return `${recordHash}_${verifierId}`;
}

function validVerification(recordId: string, overrides: Record<string, unknown> = {}) {
  return {
    recordId,
    recordHash: RECORD_HASH,
    verifierId: SHARER,
    verifierIdHash: '0xverifier',
    level: 2,
    isActive: true,
    createdAt: new Date(),
    chainStatus: 'confirmed',
    onChainHistory: [],
    encryptedRecordTitleIv: '',
    normalizedCredibilityAtCreation: 1.0,
    ...overrides,
  };
}

describe('firestore.rules — verifications — create', () => {
  it('lets a role holder create a verification with a numeric normalizedCredibilityAtCreation', async () => {
    const recordId = 'verifications-create-allowed';
    await seedRecord(recordId);

    await assertSucceeds(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`verifications/${verificationId(RECORD_HASH, SHARER)}`)
        .set(validVerification(recordId))
    );
  });

  it('denies create from a user with no role on the record', async () => {
    const recordId = 'verifications-create-no-role-denied';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(STRANGER)
        .firestore()
        .doc(`verifications/${verificationId(RECORD_HASH, STRANGER)}`)
        .set(validVerification(recordId, { verifierId: STRANGER }))
    );
  });

  it('denies create when verifierId does not match the caller', async () => {
    const recordId = 'verifications-create-verifierid-mismatch-denied';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`verifications/${verificationId(RECORD_HASH, SHARER)}`)
        .set(validVerification(recordId, { verifierId: OWNER }))
    );
  });

  it('denies create with a non-numeric normalizedCredibilityAtCreation', async () => {
    const recordId = 'verifications-create-bad-normalized-credibility-denied';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`verifications/${verificationId(RECORD_HASH, SHARER)}`)
        .set(validVerification(recordId, { normalizedCredibilityAtCreation: 'one-point-oh' }))
    );
  });
});

describe('firestore.rules — verifications — modify/reactivate', () => {
  async function seedVerification(recordId: string, overrides: Record<string, unknown> = {}) {
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx
        .firestore()
        .doc(`verifications/${verificationId(RECORD_HASH, SHARER)}`)
        .set(validVerification(recordId, overrides));
    });
  }

  it('lets the verifier change level while leaving normalizedCredibilityAtCreation untouched', async () => {
    const recordId = 'verifications-modify-allowed';
    await seedRecord(recordId);
    await seedVerification(recordId);

    await assertSucceeds(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`verifications/${verificationId(RECORD_HASH, SHARER)}`)
        .update({ level: 3 })
    );
  });

  it('denies the verifier rewriting normalizedCredibilityAtCreation on a plain modify', async () => {
    const recordId = 'verifications-modify-fake-normalized-credibility-denied';
    await seedRecord(recordId);
    await seedVerification(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`verifications/${verificationId(RECORD_HASH, SHARER)}`)
        .update({ normalizedCredibilityAtCreation: 5.0 })
    );
  });

  it('lets the verifier reactivate a retracted verification while leaving normalizedCredibilityAtCreation untouched', async () => {
    const recordId = 'verifications-reactivate-allowed';
    await seedRecord(recordId);
    await seedVerification(recordId, { isActive: false });

    await assertSucceeds(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`verifications/${verificationId(RECORD_HASH, SHARER)}`)
        .update({ isActive: true })
    );
  });

  it('denies reactivation that also tries to reset normalizedCredibilityAtCreation to a fresh value', async () => {
    // Same timing-gaming vector disputes.test.ts guards against: a verifier picking a more
    // favorable weighting by choosing when to reactivate.
    const recordId = 'verifications-reactivate-fresh-normalized-credibility-denied';
    await seedRecord(recordId);
    await seedVerification(recordId, { isActive: false });

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`verifications/${verificationId(RECORD_HASH, SHARER)}`)
        .update({ isActive: true, normalizedCredibilityAtCreation: 5.0 })
    );
  });

  it('denies a different user modifying someone else\'s verification', async () => {
    const recordId = 'verifications-modify-wrong-user-denied';
    await seedRecord(recordId);
    await seedVerification(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`verifications/${verificationId(RECORD_HASH, SHARER)}`)
        .update({ level: 3 })
    );
  });
});

describe('firestore.rules — verifications — read', () => {
  it('lets the verifier and a role holder read; denies a stranger', async () => {
    const recordId = 'verifications-read';
    await seedRecord(recordId);
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx.firestore().doc(`verifications/${verificationId(RECORD_HASH, SHARER)}`).set(validVerification(recordId));
    });

    await assertSucceeds(
      testEnv.authenticatedContext(SHARER).firestore().doc(`verifications/${verificationId(RECORD_HASH, SHARER)}`).get()
    );
    await assertSucceeds(
      testEnv.authenticatedContext(OWNER).firestore().doc(`verifications/${verificationId(RECORD_HASH, SHARER)}`).get()
    );
    await assertFails(
      testEnv
        .authenticatedContext(STRANGER)
        .firestore()
        .doc(`verifications/${verificationId(RECORD_HASH, SHARER)}`)
        .get()
    );
  });
});

describe('firestore.rules — verifications — delete', () => {
  it('never allows delete — use isActive instead', async () => {
    const recordId = 'verifications-immutable-delete';
    await seedRecord(recordId);
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx.firestore().doc(`verifications/${verificationId(RECORD_HASH, SHARER)}`).set(validVerification(recordId));
    });

    await assertFails(
      testEnv.authenticatedContext(SHARER).firestore().doc(`verifications/${verificationId(RECORD_HASH, SHARER)}`).delete()
    );
  });
});
