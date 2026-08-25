// test/rules/disputes.test.ts
//
// firestore.rules — disputes/{disputeId} — top-level collection, doc ID `{recordHash}_{disputerId}`.
// No dedicated rules-layer coverage existed for this collection before this file. Focused
// specifically on the recordScoreAtCreation/validationWeight fields added for the whitepaper's
// ValidationWeight(d) (DisputeAccuracy/CulpabilityPenalty inputs) — validationWeight must be
// creatable only as pending (0), the disputer can never set it to validated/unvalidated
// themselves, and it can only move off pending via a branch a normal authenticated client can
// never satisfy (isServerWrite()).

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
    projectId: 'belrose-rules-test-disputes',
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

function disputeId(recordHash: string, disputerId: string) {
  return `${recordHash}_${disputerId}`;
}

function validDispute(recordId: string, overrides: Record<string, unknown> = {}) {
  return {
    recordId,
    recordHash: RECORD_HASH,
    disputerId: SHARER,
    disputerIdHash: '0xdisputer',
    severity: 2,
    culpability: 1,
    notesHash: '',
    isActive: true,
    createdAt: new Date(),
    chainStatus: 'confirmed',
    onChainHistory: [],
    recordScoreAtCreation: 500,
    validationWeight: 0,
    normalizedCredibilityAtCreation: 1.0,
    ...overrides,
  };
}

describe('firestore.rules — disputes — create', () => {
  it('lets a role holder create a dispute as pending with a numeric score baseline', async () => {
    const recordId = 'disputes-create-allowed';
    await seedRecord(recordId);

    await assertSucceeds(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .set(validDispute(recordId))
    );
  });

  it('denies create from a user with no role on the record', async () => {
    const recordId = 'disputes-create-no-role-denied';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(STRANGER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, STRANGER)}`)
        .set(validDispute(recordId, { disputerId: STRANGER }))
    );
  });

  it('denies create when disputerId does not match the caller', async () => {
    const recordId = 'disputes-create-disputerid-mismatch-denied';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .set(validDispute(recordId, { disputerId: OWNER }))
    );
  });

  it('denies create with a non-numeric recordScoreAtCreation', async () => {
    const recordId = 'disputes-create-bad-score-baseline-denied';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .set(validDispute(recordId, { recordScoreAtCreation: 'five-hundred' }))
    );
  });

  it('denies create with a non-numeric normalizedCredibilityAtCreation', async () => {
    const recordId = 'disputes-create-bad-normalized-credibility-denied';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .set(validDispute(recordId, { normalizedCredibilityAtCreation: 'one-point-oh' }))
    );
  });

  it('denies create with validationWeight other than 0 (pending) — a dispute cannot be born already decided', async () => {
    const recordId = 'disputes-create-not-pending-denied';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .set(validDispute(recordId, { validationWeight: 1 }))
    );
  });
});

describe('firestore.rules — disputes — modify (disputer changes severity/culpability)', () => {
  async function seedDispute(recordId: string, overrides: Record<string, unknown> = {}) {
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .set(validDispute(recordId, overrides));
    });
  }

  it('lets the disputer change severity/culpability while leaving validation fields untouched', async () => {
    const recordId = 'disputes-modify-allowed';
    await seedRecord(recordId);
    await seedDispute(recordId);

    await assertSucceeds(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .update({ severity: 3, culpability: 4 })
    );
  });

  it('denies the disputer setting validationWeight to validated (1) themselves', async () => {
    const recordId = 'disputes-modify-fake-validated-denied';
    await seedRecord(recordId);
    await seedDispute(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .update({ validationWeight: 1 })
    );
  });

  it('denies the disputer setting validationWeight to unvalidated (-1) themselves', async () => {
    const recordId = 'disputes-modify-fake-unvalidated-denied';
    await seedRecord(recordId);
    await seedDispute(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .update({ validationWeight: -1 })
    );
  });

  it('denies the disputer rewriting recordScoreAtCreation on a plain modify', async () => {
    const recordId = 'disputes-modify-fake-baseline-denied';
    await seedRecord(recordId);
    await seedDispute(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .update({ recordScoreAtCreation: 999 })
    );
  });

  it('lets the disputer reactivate a retracted dispute while leaving the baseline/validation untouched', async () => {
    const recordId = 'disputes-reactivate-allowed';
    await seedRecord(recordId);
    await seedDispute(recordId, { isActive: false });

    await assertSucceeds(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .update({ isActive: true })
    );
  });

  it('denies reactivation that also tries to reset recordScoreAtCreation to a fresh baseline', async () => {
    // The exact gaming vector this immutability guards against: a disputer picking a favorable
    // comparison baseline by choosing *when* to reactivate.
    const recordId = 'disputes-reactivate-fresh-baseline-denied';
    await seedRecord(recordId);
    await seedDispute(recordId, { isActive: false });

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .update({ isActive: true, recordScoreAtCreation: 620 })
    );
  });

  it('denies the disputer rewriting normalizedCredibilityAtCreation on a plain modify', async () => {
    const recordId = 'disputes-modify-fake-normalized-credibility-denied';
    await seedRecord(recordId);
    await seedDispute(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .update({ normalizedCredibilityAtCreation: 5.0 })
    );
  });

  it('denies reactivation that also tries to reset normalizedCredibilityAtCreation — same timing-gaming vector as recordScoreAtCreation', async () => {
    const recordId = 'disputes-reactivate-fresh-normalized-credibility-denied';
    await seedRecord(recordId);
    await seedDispute(recordId, { isActive: false });

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .update({ isActive: true, normalizedCredibilityAtCreation: 5.0 })
    );
  });

  it('denies a different user modifying someone else\'s dispute', async () => {
    const recordId = 'disputes-modify-wrong-user-denied';
    await seedRecord(recordId);
    await seedDispute(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .update({ severity: 3 })
    );
  });
});

describe('firestore.rules — disputes — server-only validationWeight evaluation', () => {
  async function seedDispute(recordId: string, overrides: Record<string, unknown> = {}) {
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .set(validDispute(recordId, overrides));
    });
  }

  it('denies a normal authenticated user from evaluating validationWeight even matching the server-only shape', async () => {
    // isServerWrite() requires request.auth with no 'token' key — a normal client SDK auth
    // context always carries one, so this branch is unreachable for any authenticatedContext().
    const recordId = 'disputes-validation-eval-client-denied';
    await seedRecord(recordId);
    await seedDispute(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .update({ validationWeight: 1 })
    );
  });
});

describe('firestore.rules — disputes — read', () => {
  it('lets the disputer and a role holder read; denies a stranger', async () => {
    const recordId = 'disputes-read';
    await seedRecord(recordId);
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx.firestore().doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`).set(validDispute(recordId));
    });

    await assertSucceeds(
      testEnv.authenticatedContext(SHARER).firestore().doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`).get()
    );
    await assertSucceeds(
      testEnv.authenticatedContext(OWNER).firestore().doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`).get()
    );
    await assertFails(
      testEnv
        .authenticatedContext(STRANGER)
        .firestore()
        .doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`)
        .get()
    );
  });
});

describe('firestore.rules — disputes — delete', () => {
  it('never allows delete — use isActive instead', async () => {
    const recordId = 'disputes-immutable-delete';
    await seedRecord(recordId);
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx.firestore().doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`).set(validDispute(recordId));
    });

    await assertFails(
      testEnv.authenticatedContext(SHARER).firestore().doc(`disputes/${disputeId(RECORD_HASH, SHARER)}`).delete()
    );
  });
});
