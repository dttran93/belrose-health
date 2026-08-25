// test/rules/versionHistory.test.ts
//
// firestore.rules — records/{recordId}/versionHistory/{versionId} — the version-history
// documents versionControlService reads/writes. Migrated from the former top-level
// recordVersions collection (see migrateRecordVersionsToSubcollection.ts); rule-branch
// coverage carried over unchanged from the old recordVersions.test.ts, restructured onto
// subcollection paths the same way scoreEvents.test.ts does it.

import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { OWNER, ADMIN, VIEWER, baseRecord } from './fixtures/recordPermissionMatrix';

const STRANGER = 'stranger-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'belrose-rules-test-version-history',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(() => testEnv.cleanup());
beforeEach(() => testEnv.clearFirestore());

async function seedRecord(recordId: string, overrides: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx
      .firestore()
      .doc(`records/${recordId}`)
      .set(baseRecord({ owners: [OWNER], administrators: [ADMIN], viewers: [VIEWER], ...overrides }));
  });
}

async function seedVersion(recordId: string, versionId: string, overrides: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx
      .firestore()
      .doc(`records/${recordId}/versionHistory/${versionId}`)
      .set({ recordId, versionNumber: 0, encryptedChanges: null, ...overrides });
  });
}

describe('firestore.rules — versionHistory — create', () => {
  it('lets an admin/owner create the baseline (version 0)', async () => {
    const recordId = 'vh-create-baseline';
    await seedRecord(recordId);

    await assertSucceeds(
      testEnv
        .authenticatedContext(ADMIN)
        .firestore()
        .doc(`records/${recordId}/versionHistory/v0`)
        .set({
          recordId,
          versionNumber: 0,
          encryptedChanges: null,
          commitMessage: 'Original Upload (auto-created baseline)',
        })
    );
  });

  it('lets an admin/owner create a standard edit (version 1+) with editedBy set to themselves', async () => {
    const recordId = 'vh-create-edit';
    await seedRecord(recordId);

    await assertSucceeds(
      testEnv
        .authenticatedContext(ADMIN)
        .firestore()
        .doc(`records/${recordId}/versionHistory/v1`)
        .set({ recordId, versionNumber: 1, editedBy: ADMIN, encryptedChanges: { some: 'diff' } })
    );
  });

  it('denies a viewer (not admin/owner) from creating a version', async () => {
    const recordId = 'vh-create-denied-viewer';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(VIEWER)
        .firestore()
        .doc(`records/${recordId}/versionHistory/v1`)
        .set({ recordId, versionNumber: 1, editedBy: VIEWER, encryptedChanges: { some: 'diff' } })
    );
  });

  it("denies editedBy not matching the caller on a version 1+ edit (can't attribute someone else's edit to yourself)", async () => {
    const recordId = 'vh-create-editedby-mismatch';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(ADMIN)
        .firestore()
        .doc(`records/${recordId}/versionHistory/v1`)
        .set({ recordId, versionNumber: 1, editedBy: OWNER, encryptedChanges: { some: 'diff' } })
    );
  });
});

describe('firestore.rules — versionHistory — read', () => {
  it('lets anyone with a role on the record read its versions', async () => {
    const recordId = 'vh-read-role-holder';
    await seedRecord(recordId);
    await seedVersion(recordId, 'v0');

    await assertSucceeds(
      testEnv.authenticatedContext(VIEWER).firestore().doc(`records/${recordId}/versionHistory/v0`).get()
    );
  });

  it('denies a stranger with no role on the record', async () => {
    const recordId = 'vh-read-stranger-denied';
    await seedRecord(recordId);
    await seedVersion(recordId, 'v0');

    await assertFails(
      testEnv.authenticatedContext(STRANGER).firestore().doc(`records/${recordId}/versionHistory/v0`).get()
    );
  });
});

describe('firestore.rules — versionHistory — update', () => {
  it('denies any update — versions are immutable', async () => {
    const recordId = 'vh-update-denied';
    await seedRecord(recordId);
    await seedVersion(recordId, 'v0');

    await assertFails(
      testEnv
        .authenticatedContext(ADMIN)
        .firestore()
        .doc(`records/${recordId}/versionHistory/v0`)
        .update({ versionNumber: 99 })
    );
  });
});

describe('firestore.rules — versionHistory — delete', () => {
  it('lets an admin/owner delete a version while the record still exists', async () => {
    const recordId = 'vh-delete-admin-owner';
    await seedRecord(recordId);
    await seedVersion(recordId, 'v0');

    await assertSucceeds(
      testEnv.authenticatedContext(ADMIN).firestore().doc(`records/${recordId}/versionHistory/v0`).delete()
    );
  });

  it('denies a viewer (not admin/owner) from deleting a version while the record still exists', async () => {
    const recordId = 'vh-delete-denied-viewer';
    await seedRecord(recordId);
    await seedVersion(recordId, 'v0');

    await assertFails(
      testEnv.authenticatedContext(VIEWER).firestore().doc(`records/${recordId}/versionHistory/v0`).delete()
    );
  });

  // Regression: version docs are deleted before the record itself in
  // RecordDeletionService.deleteRecord (isAdminOrOwnerOfRecord needs the record to still exist),
  // so an orphan can only arise from a partial failure elsewhere. A version 0 baseline has no
  // per-doc owner field (editedBy is only ever set on version 1+ edits) — once its record is
  // gone there's no meaningful identity left to check, so any authenticated user may clean it
  // up rather than it being permanently stuck. Note the parent records/{recordId} doc is never
  // created here — Firestore subcollection document paths don't require their parent document
  // to exist, so this still exercises the true "record gone" branch of the delete rule.
  it('lets any authenticated user delete an orphaned version once its record no longer exists', async () => {
    const recordId = 'vh-delete-orphan-allowed';
    await seedVersion(recordId, 'v0');

    await assertSucceeds(
      testEnv.authenticatedContext(STRANGER).firestore().doc(`records/${recordId}/versionHistory/v0`).delete()
    );
  });
});
