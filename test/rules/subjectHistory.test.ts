// test/rules/subjectHistory.test.ts
//
// firestore.rules — records/{recordId}/subjectHistory/{eventId} — the audit-trail
// subcollection SubjectService writes to for subject anchor/unanchor state changes. Parallel
// to permissionHistory.test.ts, but for the orthogonal subjects[] membership axis rather than
// the owner/administrator/sharer/viewer role ladder.

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
    projectId: 'belrose-rules-test-subject-history',
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

describe('firestore.rules — subjectHistory subcollection', () => {
  it('lets a role holder create an event where changedBy matches themselves', async () => {
    const recordId = 'subject-history-create-allowed';
    await seedRecord(recordId);

    await assertSucceeds(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`records/${recordId}/subjectHistory/event-1`)
        .set({ changedBy: SHARER, subjectId: SHARER, action: 'anchored', blockchainRef: null })
    );
  });

  it('denies create from a user with no role on the parent record', async () => {
    const recordId = 'subject-history-create-no-role-denied';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(STRANGER)
        .firestore()
        .doc(`records/${recordId}/subjectHistory/event-1`)
        .set({ changedBy: STRANGER, subjectId: STRANGER, action: 'anchored', blockchainRef: null })
    );
  });

  it('denies create when changedBy does not match the caller', async () => {
    const recordId = 'subject-history-create-changedby-mismatch-denied';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`records/${recordId}/subjectHistory/event-1`)
        .set({ changedBy: OWNER, subjectId: SHARER, action: 'anchored', blockchainRef: null })
    );
  });

  it('lets a controller create an event where subjectId is the trustor, not the caller', async () => {
    // anchorSubjectAsController: changedBy is the controller (an owner/admin of this record,
    // per BRANCH 7), subjectId is the trustor being anchored — they differ, and that's fine.
    const recordId = 'subject-history-controller-anchor-allowed';
    await seedRecord(recordId);
    const TRUSTOR = 'trustor-uid';

    await assertSucceeds(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`records/${recordId}/subjectHistory/event-1`)
        .set({ changedBy: OWNER, subjectId: TRUSTOR, action: 'anchored_as_controller', blockchainRef: null })
    );
  });

  it('lets a role holder read events, but denies a stranger', async () => {
    const recordId = 'subject-history-read';
    await seedRecord(recordId);
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx
        .firestore()
        .doc(`records/${recordId}/subjectHistory/event-1`)
        .set({ changedBy: SHARER, subjectId: SHARER, action: 'anchored', blockchainRef: null });
    });

    await assertSucceeds(
      testEnv.authenticatedContext(OWNER).firestore().doc(`records/${recordId}/subjectHistory/event-1`).get()
    );
    await assertFails(
      testEnv.authenticatedContext(STRANGER).firestore().doc(`records/${recordId}/subjectHistory/event-1`).get()
    );
  });

  it('never allows delete — immutable audit log', async () => {
    const recordId = 'subject-history-immutable-delete';
    await seedRecord(recordId);
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx
        .firestore()
        .doc(`records/${recordId}/subjectHistory/event-1`)
        .set({ changedBy: SHARER, subjectId: SHARER, action: 'anchored', blockchainRef: null });
    });

    await assertFails(
      testEnv.authenticatedContext(OWNER).firestore().doc(`records/${recordId}/subjectHistory/event-1`).delete()
    );
  });

  it('never allows updating anything other than blockchainRef — the rest of the event stays immutable', async () => {
    const recordId = 'subject-history-immutable-fields';
    await seedRecord(recordId);
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx
        .firestore()
        .doc(`records/${recordId}/subjectHistory/event-1`)
        .set({ changedBy: SHARER, subjectId: SHARER, action: 'anchored', blockchainRef: null });
    });

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`records/${recordId}/subjectHistory/event-1`)
        .update({ action: 'unanchored' })
    );
  });

  describe('completing a deferred blockchainRef (Firestore-first anchor/unanchor flows)', () => {
    it('lets the original changedBy fill in blockchainRef while it is still null', async () => {
      const recordId = 'subject-history-blockchainref-fill-in';
      await seedRecord(recordId);
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx
          .firestore()
          .doc(`records/${recordId}/subjectHistory/event-1`)
          .set({ changedBy: SHARER, subjectId: SHARER, action: 'anchored', blockchainRef: null });
      });

      await assertSucceeds(
        testEnv
          .authenticatedContext(SHARER)
          .firestore()
          .doc(`records/${recordId}/subjectHistory/event-1`)
          .update({ blockchainRef: { txHash: '0xabc', chainId: 84532, blockNumber: 1, contractAddress: '0x1' } })
      );
    });

    it('still lets changedBy complete it even after that same event stripped their own subject status (self-unanchor)', async () => {
      // The exact scenario that drove this design: rejectSubjectStatus writes the subjectHistory
      // event and the subjects[] removal in the same atomic batch, so by the time the deferred
      // blockchainRef update runs, the caller may no longer hasRoleOnRecord() at all.
      const recordId = 'subject-history-blockchainref-fill-in-after-self-removal';
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx.firestore().doc(`records/${recordId}`).set(baseRecord({ owners: [OWNER] })); // SHARER has no role
        await ctx
          .firestore()
          .doc(`records/${recordId}/subjectHistory/event-1`)
          .set({ changedBy: SHARER, subjectId: SHARER, action: 'unanchored', blockchainRef: null });
      });

      await assertSucceeds(
        testEnv
          .authenticatedContext(SHARER)
          .firestore()
          .doc(`records/${recordId}/subjectHistory/event-1`)
          .update({ blockchainRef: { txHash: '0xabc', chainId: 84532, blockNumber: 1, contractAddress: '0x1' } })
      );
    });

    it('denies a different user from filling in blockchainRef, even one with a role on the record', async () => {
      const recordId = 'subject-history-blockchainref-fill-in-wrong-user';
      await seedRecord(recordId);
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx
          .firestore()
          .doc(`records/${recordId}/subjectHistory/event-1`)
          .set({ changedBy: SHARER, subjectId: SHARER, action: 'anchored', blockchainRef: null });
      });

      await assertFails(
        testEnv
          .authenticatedContext(OWNER)
          .firestore()
          .doc(`records/${recordId}/subjectHistory/event-1`)
          .update({ blockchainRef: { txHash: '0xabc', chainId: 84532, blockNumber: 1, contractAddress: '0x1' } })
      );
    });

    it('denies overwriting an already-set blockchainRef', async () => {
      const recordId = 'subject-history-blockchainref-already-set';
      await seedRecord(recordId);
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx
          .firestore()
          .doc(`records/${recordId}/subjectHistory/event-1`)
          .set({
            changedBy: SHARER,
            subjectId: SHARER,
            action: 'anchored',
            blockchainRef: { txHash: '0xoriginal', chainId: 84532, blockNumber: 1, contractAddress: '0x1' },
          });
      });

      await assertFails(
        testEnv
          .authenticatedContext(SHARER)
          .firestore()
          .doc(`records/${recordId}/subjectHistory/event-1`)
          .update({ blockchainRef: { txHash: '0xreplaced', chainId: 84532, blockNumber: 2, contractAddress: '0x1' } })
      );
    });

    it('denies sneaking a change to another field into the same update as blockchainRef', async () => {
      const recordId = 'subject-history-blockchainref-sneak-other-field';
      await seedRecord(recordId);
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx
          .firestore()
          .doc(`records/${recordId}/subjectHistory/event-1`)
          .set({ changedBy: SHARER, subjectId: SHARER, action: 'anchored', blockchainRef: null });
      });

      await assertFails(
        testEnv
          .authenticatedContext(SHARER)
          .firestore()
          .doc(`records/${recordId}/subjectHistory/event-1`)
          .update({
            blockchainRef: { txHash: '0xabc', chainId: 84532, blockNumber: 1, contractAddress: '0x1' },
            action: 'unanchored',
          })
      );
    });
  });
});
