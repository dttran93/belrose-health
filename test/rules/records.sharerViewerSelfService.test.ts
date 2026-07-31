// test/rules/records.sharerViewerSelfService.test.ts
//
// firestore.rules — records/{recordId} allow update — BRANCH 5 (sharer granting viewer),
// BRANCH 6 (viewer self-removal), BRANCH 6b (sharer self-removal).
//
// The last case here (sharer-demotes-self-to-viewer-denied) is a permanent regression test
// for a real bug found this session: PermissionsService.removeSharer's JS-level check allowed
// a plain sharer to demote themselves to viewer, but firestore.rules never permitted it —
// self-service can only fully leave a role, not renegotiate to a lesser tier.

import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { OWNER, SHARER, VIEWER, NEW_USER, sharerViewerSelfServiceCases } from './fixtures/recordPermissionMatrix';
import { runRecordUpdateCases } from './helpers/recordUpdateHarness';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'belrose-rules-test-sharer-viewer-self',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(() => testEnv.cleanup());
beforeEach(() => testEnv.clearFirestore());

describe('firestore.rules — records/{recordId} — sharer/viewer self-service', () => {
  runRecordUpdateCases(() => testEnv, sharerViewerSelfServiceCases);

  // Permanent regression test for a real bug found live in staging: BRANCH 5/6/6b read
  // resource.data.subjects via bare field access instead of .get('subjects', []). Records that
  // predate the `subjects` field being added to the schema have no such key at all — a bare
  // access on a missing key is a rules EVALUATION ERROR (fails closed), not a clean false, so
  // every sharer grant/self-removal on those older records was silently denied with "Missing or
  // insufficient permissions" regardless of the caller's actual role. baseRecord() always
  // includes subjects: [], which is exactly why the cases above never caught this — these seed
  // a doc with no subjects key at all, matching the real broken record.
  describe('records with no subjects field at all (predates the schema field)', () => {
    async function seedWithoutSubjects(recordId: string, data: Record<string, unknown>) {
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx.firestore().doc(`records/${recordId}`).set(data);
      });
    }

    it('lets a sharer grant viewer access', async () => {
      const recordId = 'no-subjects-sharer-grants-viewer';
      await seedWithoutSubjects(recordId, {
        owners: [OWNER],
        administrators: [],
        sharers: [SHARER],
        viewers: [],
      });

      await assertSucceeds(
        testEnv
          .authenticatedContext(SHARER)
          .firestore()
          .doc(`records/${recordId}`)
          .update({ viewers: [NEW_USER] })
      );
    });

    it('lets a viewer remove themselves', async () => {
      const recordId = 'no-subjects-viewer-self-removes';
      await seedWithoutSubjects(recordId, {
        owners: [OWNER],
        administrators: [],
        sharers: [],
        viewers: [VIEWER],
      });

      await assertSucceeds(
        testEnv
          .authenticatedContext(VIEWER)
          .firestore()
          .doc(`records/${recordId}`)
          .update({ viewers: [] })
      );
    });

    it('lets a sharer remove themselves', async () => {
      const recordId = 'no-subjects-sharer-self-removes';
      await seedWithoutSubjects(recordId, {
        owners: [OWNER],
        administrators: [],
        sharers: [SHARER],
        viewers: [],
      });

      await assertSucceeds(
        testEnv
          .authenticatedContext(SHARER)
          .firestore()
          .doc(`records/${recordId}`)
          .update({ sharers: [] })
      );
    });
  });
});
