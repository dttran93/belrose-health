// test/rules/records.readDelete.test.ts
//
// firestore.rules — records/{recordId} — the `read` rule (any role holder can read;
// a stranger cannot) and the `delete` rule (sole owner, or sole admin when no owners exist,
// and no other subjects remain anchored). This must mirror
// RecordDeletionService.checkDeletionPermissions exactly — the client's UI pre-flight checks
// are only as good as the actual security boundary behind them.

import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { OWNER, OWNER_2, ADMIN, ADMIN_2, SHARER, VIEWER, baseRecord } from './fixtures/recordPermissionMatrix';

const STRANGER = 'stranger-uid';
const UPLOADER = 'uploader-uid';
const SUBJECT = 'subject-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'belrose-rules-test-read-delete',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(() => testEnv.cleanup());
beforeEach(() => testEnv.clearFirestore());

async function seed(recordId: string, data: object) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc(`records/${recordId}`).set(data);
  });
}

describe('firestore.rules — records/{recordId} — read', () => {
  it('lets the owner, admin, sharer, viewer, and subject all read', async () => {
    const recordId = 'read-role-holders';
    await seed(recordId, {
      ...baseRecord({ owners: [OWNER], administrators: [ADMIN], sharers: [SHARER], viewers: [VIEWER], subjects: [SUBJECT] }),
      uploadedBy: UPLOADER,
    });

    for (const uid of [OWNER, ADMIN, SHARER, VIEWER, SUBJECT]) {
      await assertSucceeds(testEnv.authenticatedContext(uid).firestore().doc(`records/${recordId}`).get());
    }
  });

  it('denies a stranger with no role on the record', async () => {
    const recordId = 'read-stranger-denied';
    await seed(recordId, { ...baseRecord({ owners: [OWNER] }), uploadedBy: UPLOADER });

    await assertFails(testEnv.authenticatedContext(STRANGER).firestore().doc(`records/${recordId}`).get());
  });

  it('denies the original uploader once they hold no role arrays (e.g. removed as admin)', async () => {
    const recordId = 'read-former-uploader-denied';
    await seed(recordId, { ...baseRecord({ owners: [OWNER] }), uploadedBy: UPLOADER });

    await assertFails(testEnv.authenticatedContext(UPLOADER).firestore().doc(`records/${recordId}`).get());
  });
});

describe('firestore.rules — records/{recordId} — delete', () => {
  it('lets an owner delete', async () => {
    const recordId = 'delete-owner-allowed';
    await seed(recordId, baseRecord({ owners: [OWNER] }));

    await assertSucceeds(testEnv.authenticatedContext(OWNER).firestore().doc(`records/${recordId}`).delete());
  });

  it('blocks an admin from deleting while an owner exists', async () => {
    const recordId = 'delete-admin-blocked-with-owner';
    await seed(recordId, baseRecord({ owners: [OWNER], administrators: [ADMIN] }));

    await assertFails(testEnv.authenticatedContext(ADMIN).firestore().doc(`records/${recordId}`).delete());
  });

  it('lets an admin delete when no owner exists', async () => {
    const recordId = 'delete-admin-allowed-no-owner';
    await seed(recordId, baseRecord({ owners: [], administrators: [ADMIN] }));

    await assertSucceeds(testEnv.authenticatedContext(ADMIN).firestore().doc(`records/${recordId}`).delete());
  });

  it('blocks a sharer or viewer from deleting', async () => {
    const recordId = 'delete-sharer-viewer-blocked';
    await seed(recordId, baseRecord({ owners: [OWNER], sharers: [SHARER], viewers: [VIEWER] }));

    await assertFails(testEnv.authenticatedContext(SHARER).firestore().doc(`records/${recordId}`).delete());
    await assertFails(testEnv.authenticatedContext(VIEWER).firestore().doc(`records/${recordId}`).delete());
  });

  it('blocks an owner from deleting while another owner exists', async () => {
    const recordId = 'delete-owner-blocked-with-other-owner';
    await seed(recordId, baseRecord({ owners: [OWNER, OWNER_2] }));

    await assertFails(testEnv.authenticatedContext(OWNER).firestore().doc(`records/${recordId}`).delete());
    await assertFails(testEnv.authenticatedContext(OWNER_2).firestore().doc(`records/${recordId}`).delete());
  });

  it('lets a sole owner delete despite other admins, sharers, and viewers present', async () => {
    const recordId = 'delete-sole-owner-allowed-with-other-roles';
    await seed(recordId, baseRecord({ owners: [OWNER], administrators: [ADMIN], sharers: [SHARER], viewers: [VIEWER] }));

    await assertSucceeds(testEnv.authenticatedContext(OWNER).firestore().doc(`records/${recordId}`).delete());
  });

  it('blocks an admin from deleting while another admin exists and no owner', async () => {
    const recordId = 'delete-admin-blocked-with-other-admin';
    await seed(recordId, baseRecord({ owners: [], administrators: [ADMIN, ADMIN_2] }));

    await assertFails(testEnv.authenticatedContext(ADMIN).firestore().doc(`records/${recordId}`).delete());
    await assertFails(testEnv.authenticatedContext(ADMIN_2).firestore().doc(`records/${recordId}`).delete());
  });

  it('lets a sole admin delete despite other sharers/viewers present when no owner exists', async () => {
    const recordId = 'delete-sole-admin-allowed-with-other-roles';
    await seed(recordId, baseRecord({ owners: [], administrators: [ADMIN], sharers: [SHARER], viewers: [VIEWER] }));

    await assertSucceeds(testEnv.authenticatedContext(ADMIN).firestore().doc(`records/${recordId}`).delete());
  });

  it('blocks deletion when another subject remains anchored, even for a sole owner', async () => {
    const recordId = 'delete-blocked-other-subject-remains';
    await seed(recordId, baseRecord({ owners: [OWNER], subjects: [SUBJECT] }));

    await assertFails(testEnv.authenticatedContext(OWNER).firestore().doc(`records/${recordId}`).delete());
  });

  it('lets a sole owner delete when they are also the sole remaining subject', async () => {
    const recordId = 'delete-allowed-caller-is-sole-subject';
    await seed(recordId, baseRecord({ owners: [OWNER], subjects: [OWNER] }));

    await assertSucceeds(testEnv.authenticatedContext(OWNER).firestore().doc(`records/${recordId}`).delete());
  });

  it('lets a sole owner delete a record with no subjects field at all (real uploads never set one)', async () => {
    // Regression test: uploadUtils.ts never writes a `subjects` field on record creation, so a
    // plain uploaded record that has never had a subject added has no `subjects` key whatsoever
    // — not even an empty array. The delete rule used to read resource.data.subjects bare
    // (no .get() fallback), which throws on a missing map key and denies the whole expression,
    // so every such record could never be deleted by its own sole owner.
    const recordId = 'delete-allowed-no-subjects-field';
    const { subjects, ...recordWithoutSubjectsField } = baseRecord({ owners: [OWNER] });
    await seed(recordId, recordWithoutSubjectsField);

    await assertSucceeds(testEnv.authenticatedContext(OWNER).firestore().doc(`records/${recordId}`).delete());
  });
});
