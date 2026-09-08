// test/rules/recordHashHistory.test.ts
//
// firestore.rules — records/{recordId}/recordHashHistory/{eventId} — the audit-trail
// subcollection SubjectService and CredibilityPreparationService write to whenever a
// record's content hash gets anchored on-chain. Parallel to subjectHistory.test.ts/
// permissionHistory.test.ts for create/update/delete, but read is admin-only and split
// across two rule blocks: a direct-path get() (covered by the nested match under
// records/{recordId}) and a collectionGroup() scan (covered by a separate top-level
// `match /{path=**}/recordHashHistory/{eventId}` rule — nested matches don't extend to
// collectionGroup queries, so this needs its own test coverage; see the second `describe`
// below for the regression this guards against).

import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collectionGroup, getDocs } from 'firebase/firestore';
import { OWNER, SHARER, baseRecord } from './fixtures/recordPermissionMatrix';

const STRANGER = 'stranger-uid';
const PLATFORM_ADMIN = 'platform-admin-uid';
const HASH = '0xhash1';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'belrose-rules-test-record-hash-history',
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

describe('firestore.rules — recordHashHistory subcollection', () => {
  it('lets a role holder create an event where changedBy matches themselves (subject-anchor flow)', async () => {
    const recordId = 'hash-history-create-allowed-subject';
    await seedRecord(recordId);

    await assertSucceeds(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`records/${recordId}/recordHashHistory/event-1`)
        .set({ changedBy: SHARER, hash: HASH, action: 'anchored', anchoredVia: 'subject', blockchainRef: null })
    );
  });

  it('lets a role holder create an event for the credibility-prepare flow', async () => {
    const recordId = 'hash-history-create-allowed-credibility';
    await seedRecord(recordId);

    await assertSucceeds(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`records/${recordId}/recordHashHistory/event-1`)
        .set({ changedBy: OWNER, hash: HASH, action: 'anchored', anchoredVia: 'credibility', blockchainRef: null })
    );
  });

  it('denies create from a user with no role on the parent record', async () => {
    const recordId = 'hash-history-create-no-role-denied';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(STRANGER)
        .firestore()
        .doc(`records/${recordId}/recordHashHistory/event-1`)
        .set({ changedBy: STRANGER, hash: HASH, action: 'anchored', anchoredVia: 'subject', blockchainRef: null })
    );
  });

  it('denies create when changedBy does not match the caller', async () => {
    const recordId = 'hash-history-create-changedby-mismatch-denied';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`records/${recordId}/recordHashHistory/event-1`)
        .set({ changedBy: OWNER, hash: HASH, action: 'anchored', anchoredVia: 'subject', blockchainRef: null })
    );
  });

  describe('read — direct-path get()', () => {
    it('denies read to a role holder without the platformAdmin claim — unlike subjectHistory/permissionHistory, this collection is admin-only to read', async () => {
      const recordId = 'hash-history-read-role-holder-denied';
      await seedRecord(recordId);
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx
          .firestore()
          .doc(`records/${recordId}/recordHashHistory/event-1`)
          .set({ changedBy: SHARER, hash: HASH, action: 'anchored', anchoredVia: 'subject', blockchainRef: null });
      });

      await assertFails(
        testEnv.authenticatedContext(OWNER).firestore().doc(`records/${recordId}/recordHashHistory/event-1`).get()
      );
      await assertFails(
        testEnv.authenticatedContext(STRANGER).firestore().doc(`records/${recordId}/recordHashHistory/event-1`).get()
      );
    });

    it('lets a platform admin read a specific event directly', async () => {
      const recordId = 'hash-history-read-platform-admin';
      await seedRecord(recordId);
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx
          .firestore()
          .doc(`records/${recordId}/recordHashHistory/event-1`)
          .set({ changedBy: SHARER, hash: HASH, action: 'anchored', anchoredVia: 'subject', blockchainRef: null });
      });

      await assertSucceeds(
        testEnv
          .authenticatedContext(PLATFORM_ADMIN, { platformAdmin: true })
          .firestore()
          .doc(`records/${recordId}/recordHashHistory/event-1`)
          .get()
      );
    });
  });

  describe('read — collectionGroup query (BackendChainParity\'s actual usage)', () => {
    // Regression guard: a nested match block (records/{recordId}/recordHashHistory above)
    // does NOT extend to a collectionGroup() query — confirmed by hitting exactly this bug.
    // Without the separate top-level `match /{path=**}/recordHashHistory/{eventId}` rule,
    // Firestore denies the query outright ("No matching allow statements"), not merely a
    // false condition — so this needs its own test distinct from the direct-get() cases above,
    // which exercise a different code path and would not have caught the regression.
    it('lets a platform admin scan recordHashHistory across every record at once', async () => {
      const recordId = 'hash-history-cg-platform-admin';
      await seedRecord(recordId);
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx
          .firestore()
          .doc(`records/${recordId}/recordHashHistory/event-1`)
          .set({ changedBy: SHARER, hash: HASH, action: 'anchored', anchoredVia: 'subject', blockchainRef: null });
      });

      const adminFirestore = testEnv
        .authenticatedContext(PLATFORM_ADMIN, { platformAdmin: true })
        .firestore();
      await assertSucceeds(getDocs(collectionGroup(adminFirestore, 'recordHashHistory')));
    });

    it('denies the same collectionGroup scan to a non-admin, even a role holder on that record', async () => {
      const recordId = 'hash-history-cg-non-admin-denied';
      await seedRecord(recordId);
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx
          .firestore()
          .doc(`records/${recordId}/recordHashHistory/event-1`)
          .set({ changedBy: SHARER, hash: HASH, action: 'anchored', anchoredVia: 'subject', blockchainRef: null });
      });

      const ownerFirestore = testEnv.authenticatedContext(OWNER).firestore();
      await assertFails(getDocs(collectionGroup(ownerFirestore, 'recordHashHistory')));
    });
  });

  it('never allows delete — immutable audit log', async () => {
    const recordId = 'hash-history-immutable-delete';
    await seedRecord(recordId);
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx
        .firestore()
        .doc(`records/${recordId}/recordHashHistory/event-1`)
        .set({ changedBy: SHARER, hash: HASH, action: 'anchored', anchoredVia: 'subject', blockchainRef: null });
    });

    await assertFails(
      testEnv.authenticatedContext(OWNER).firestore().doc(`records/${recordId}/recordHashHistory/event-1`).delete()
    );
  });

  it('never allows updating anything other than blockchainRef — the rest of the event stays immutable', async () => {
    const recordId = 'hash-history-immutable-fields';
    await seedRecord(recordId);
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx
        .firestore()
        .doc(`records/${recordId}/recordHashHistory/event-1`)
        .set({ changedBy: SHARER, hash: HASH, action: 'anchored', anchoredVia: 'subject', blockchainRef: null });
    });

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`records/${recordId}/recordHashHistory/event-1`)
        .update({ anchoredVia: 'credibility' })
    );
  });

  describe('completing a deferred blockchainRef (Firestore-first anchor flows)', () => {
    it('lets the original changedBy fill in blockchainRef while it is still null', async () => {
      const recordId = 'hash-history-blockchainref-fill-in';
      await seedRecord(recordId);
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx
          .firestore()
          .doc(`records/${recordId}/recordHashHistory/event-1`)
          .set({ changedBy: SHARER, hash: HASH, action: 'anchored', anchoredVia: 'subject', blockchainRef: null });
      });

      await assertSucceeds(
        testEnv
          .authenticatedContext(SHARER)
          .firestore()
          .doc(`records/${recordId}/recordHashHistory/event-1`)
          .update({ blockchainRef: { txHash: '0xabc', chainId: 84532, blockNumber: 1, contractAddress: '0x1' } })
      );
    });

    it('denies a different user from filling in blockchainRef, even one with a role on the record', async () => {
      const recordId = 'hash-history-blockchainref-fill-in-wrong-user';
      await seedRecord(recordId);
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx
          .firestore()
          .doc(`records/${recordId}/recordHashHistory/event-1`)
          .set({ changedBy: SHARER, hash: HASH, action: 'anchored', anchoredVia: 'subject', blockchainRef: null });
      });

      await assertFails(
        testEnv
          .authenticatedContext(OWNER)
          .firestore()
          .doc(`records/${recordId}/recordHashHistory/event-1`)
          .update({ blockchainRef: { txHash: '0xabc', chainId: 84532, blockNumber: 1, contractAddress: '0x1' } })
      );
    });

    it('denies overwriting an already-set blockchainRef', async () => {
      const recordId = 'hash-history-blockchainref-already-set';
      await seedRecord(recordId);
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx
          .firestore()
          .doc(`records/${recordId}/recordHashHistory/event-1`)
          .set({
            changedBy: SHARER,
            hash: HASH,
            action: 'anchored',
            anchoredVia: 'subject',
            blockchainRef: { txHash: '0xoriginal', chainId: 84532, blockNumber: 1, contractAddress: '0x1' },
          });
      });

      await assertFails(
        testEnv
          .authenticatedContext(SHARER)
          .firestore()
          .doc(`records/${recordId}/recordHashHistory/event-1`)
          .update({ blockchainRef: { txHash: '0xreplaced', chainId: 84532, blockNumber: 2, contractAddress: '0x1' } })
      );
    });

    it('denies sneaking a change to another field into the same update as blockchainRef', async () => {
      const recordId = 'hash-history-blockchainref-sneak-other-field';
      await seedRecord(recordId);
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx
          .firestore()
          .doc(`records/${recordId}/recordHashHistory/event-1`)
          .set({ changedBy: SHARER, hash: HASH, action: 'anchored', anchoredVia: 'subject', blockchainRef: null });
      });

      await assertFails(
        testEnv
          .authenticatedContext(SHARER)
          .firestore()
          .doc(`records/${recordId}/recordHashHistory/event-1`)
          .update({
            blockchainRef: { txHash: '0xabc', chainId: 84532, blockNumber: 1, contractAddress: '0x1' },
            anchoredVia: 'credibility',
          })
      );
    });
  });
});
