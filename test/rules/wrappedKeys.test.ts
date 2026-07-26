// test/rules/wrappedKeys.test.ts
//
// firestore.rules — wrappedKeys/{wrappedKeyId} — the encryption-access collection
// SharingService.grantEncryptionAccess/revokeEncryptionAccess reads and writes.

import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { OWNER, ADMIN, SHARER, VIEWER, baseRecord } from './fixtures/recordPermissionMatrix';

const OTHER_SHARER = 'other-sharer-uid';
const RECEIVER = 'receiver-uid';
const STRANGER = 'stranger-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'belrose-rules-test-wrapped-keys',
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
    await ctx
      .firestore()
      .doc(`records/${recordId}`)
      .set(
        baseRecord({
          owners: [OWNER],
          administrators: [ADMIN],
          sharers: [SHARER, OTHER_SHARER],
          viewers: [VIEWER],
        })
      );
  });
}

async function seedWrappedKey(recordId: string, wrappedKeyId: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc(`wrappedKeys/${wrappedKeyId}`).set({ recordId, ...data });
  });
}

describe('firestore.rules — wrappedKeys — create', () => {
  it('lets a sharer-or-above create a wrapped key for a record they can share', async () => {
    const recordId = 'wk-create-allowed';
    await seedRecord(recordId);

    await assertSucceeds(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`wrappedKeys/${recordId}_${RECEIVER}`)
        .set({ recordId, userId: RECEIVER, grantedBy: SHARER, isActive: true })
    );
  });

  it('denies a viewer (below sharer) from creating a wrapped key', async () => {
    const recordId = 'wk-create-denied-viewer';
    await seedRecord(recordId);

    await assertFails(
      testEnv
        .authenticatedContext(VIEWER)
        .firestore()
        .doc(`wrappedKeys/${recordId}_${RECEIVER}`)
        .set({ recordId, userId: RECEIVER, grantedBy: VIEWER, isActive: true })
    );
  });

  // Bootstrap branch: uploadUtils.createFirestoreRecord and userIdentityService.saveUserIdentityRecord
  // write the records/{recordId} doc and its creator's wrappedKeys doc in a single writeBatch() so an
  // encrypted record can never end up with no wrappedKey. Security rules evaluate get()/exists() against
  // the pre-batch snapshot, so isSharerOrAboveOnRecord's get() on the sibling record can't see it — the
  // record genuinely doesn't exist yet from the rule's point of view during that same-batch write.
  it("lets the caller create their own creator wrappedKey in the same batch as the record's own creation", async () => {
    const recordId = 'wk-create-bootstrap-same-batch';
    const db = testEnv.authenticatedContext('uploader-uid').firestore();

    const batch = writeBatch(db);
    batch.set(doc(db, 'records', recordId), {
      uploadedBy: 'uploader-uid',
      owners: [],
      administrators: ['uploader-uid'],
      isEncrypted: true,
    });
    batch.set(doc(db, 'wrappedKeys', `${recordId}_uploader-uid`), {
      recordId,
      userId: 'uploader-uid',
      wrappedKey: 'fake',
      isCreator: true,
      isActive: true,
    });

    await assertSucceeds(batch.commit());
  });

  it('denies creating an isCreator wrappedKey for someone else on a record that does not exist yet', async () => {
    const recordId = 'wk-create-bootstrap-denies-other-user';

    await assertFails(
      testEnv
        .authenticatedContext(STRANGER)
        .firestore()
        .doc(`wrappedKeys/${recordId}_${RECEIVER}`)
        .set({ recordId, userId: RECEIVER, isCreator: true, isActive: true })
    );
  });

  it('denies the bootstrap branch once the record already exists — falls back to isSharerOrAboveOnRecord', async () => {
    const recordId = 'wk-create-bootstrap-denied-record-exists';
    await seedRecord(recordId);

    // VIEWER holds a role but is below sharer — same as the existing "denies a viewer" case above,
    // this just also pins that an existing record can't be routed through the bootstrap branch.
    await assertFails(
      testEnv
        .authenticatedContext(VIEWER)
        .firestore()
        .doc(`wrappedKeys/${recordId}_${VIEWER}`)
        .set({ recordId, userId: VIEWER, isCreator: true, isActive: true })
    );
  });
});

describe('firestore.rules — wrappedKeys — update', () => {
  it('lets an admin/owner of the record update any wrapped key', async () => {
    const recordId = 'wk-update-admin-owner';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: SHARER, isActive: true });

    await assertSucceeds(
      testEnv.authenticatedContext(OWNER).firestore().doc('wrappedKeys/key-1').update({ isActive: false })
    );
  });

  it("lets the key's own receiver update it", async () => {
    const recordId = 'wk-update-receiver-self';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: SHARER, isActive: true });

    await assertSucceeds(
      testEnv.authenticatedContext(RECEIVER).firestore().doc('wrappedKeys/key-1').update({ isActive: false })
    );
  });

  it('lets the sharer who personally granted it update their own grant', async () => {
    const recordId = 'wk-update-granter-self';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: SHARER, isActive: true });

    await assertSucceeds(
      testEnv.authenticatedContext(SHARER).firestore().doc('wrappedKeys/key-1').update({ isActive: false })
    );
  });

  it('denies a different sharer who did not personally grant it', async () => {
    const recordId = 'wk-update-different-sharer-denied';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: SHARER, isActive: true });

    await assertFails(
      testEnv.authenticatedContext(OTHER_SHARER).firestore().doc('wrappedKeys/key-1').update({ isActive: false })
    );
  });
});

describe('firestore.rules — wrappedKeys — delete', () => {
  it('denies a stranger with no relationship to the record or key', async () => {
    const recordId = 'wk-delete-stranger-denied';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: SHARER, isActive: true });

    await assertFails(testEnv.authenticatedContext(STRANGER).firestore().doc('wrappedKeys/key-1').delete());
  });

  it('lets an admin/owner delete', async () => {
    const recordId = 'wk-delete-admin-owner';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: SHARER, isActive: true });

    await assertSucceeds(testEnv.authenticatedContext(ADMIN).firestore().doc('wrappedKeys/key-1').delete());
  });

  // Regression: the record's own delete happens after its wrappedKeys are cleaned up (their
  // delete rules require the record to still exist to check admin/owner status), so a wrappedKey
  // orphaned by its parent record already being gone should still be cleanable — otherwise a
  // record delete that failed on its very last step (or any other historical partial failure)
  // leaves it permanently undeletable by anyone, forever.
  it("lets the key's own holder delete it once its parent record no longer exists", async () => {
    await seedWrappedKey('deleted-record-id', 'key-orphan-holder', {
      userId: RECEIVER,
      grantedBy: SHARER,
      isActive: true,
    });

    await assertSucceeds(
      testEnv.authenticatedContext(RECEIVER).firestore().doc('wrappedKeys/key-orphan-holder').delete()
    );
  });

  it('lets whoever granted an orphaned wrapped key delete it once its parent record no longer exists', async () => {
    await seedWrappedKey('deleted-record-id', 'key-orphan-granter', {
      userId: RECEIVER,
      grantedBy: SHARER,
      isActive: true,
    });

    await assertSucceeds(
      testEnv.authenticatedContext(SHARER).firestore().doc('wrappedKeys/key-orphan-granter').delete()
    );
  });

  it('still denies a stranger from deleting an orphaned wrapped key they have no relationship to', async () => {
    await seedWrappedKey('deleted-record-id', 'key-orphan-stranger', {
      userId: RECEIVER,
      grantedBy: SHARER,
      isActive: true,
    });

    await assertFails(
      testEnv.authenticatedContext(STRANGER).firestore().doc('wrappedKeys/key-orphan-stranger').delete()
    );
  });
});

describe('firestore.rules — wrappedKeys — read (sharer+ management, or your own key while you hold a role)', () => {
  // Previously `allow read: if request.auth != null` — any authenticated user could read any
  // wrappedKey regardless of relationship to the record. RSA-wrapping makes that harmless for
  // OTHER people's keys (you can't unwrap without their private key), but it meant a
  // fully-revoked user (stripped from every role array) could still fetch — and re-fetch,
  // forever — their OWN wrappedKey directly from Firestore, bypassing the app's isActive check
  // in RecordDecryptionService. Current rule:
  //   allow read: if request.auth != null && (
  //     isSharerOrAboveOnRecord(resource.data.recordId) ||
  //     (resource.data.userId == request.auth.uid && hasRoleOnRecord(resource.data.recordId))
  //   );
  // hasRoleOnRecord already existed (used by the records/{recordId} read rule) and checks
  // uploadedBy/owners/administrators/sharers/viewers/subjects against request.auth.uid — no new
  // helper needed since the self-read clause only ever evaluates it for the caller's own uid.
  //
  // seedRecord always seeds: owners:[OWNER], administrators:[ADMIN], sharers:[SHARER,OTHER_SHARER],
  // viewers:[VIEWER]. RECEIVER holds no role on it at all — standing in for "never added yet"
  // (mid-grant, before the role-array update) and "fully revoked" (after it), which look
  // identical from the rule's point of view: no entry in any role array.

  // Regression: SharingService.grantEncryptionAccess's very first operation is a get() on the
  // wrappedKey it's about to grant, to check for an existing one — for a brand-new grant (first
  // time this record has ever been shared with this recipient) that document doesn't exist yet.
  // Without a !exists() guard, the rule dereferences resource.data.recordId on a null resource
  // and throws a rule-evaluation error (not a clean deny), blocking the grant outright for even
  // a legitimate owner. Caught in production: an observer-level trustee invite's per-record
  // fan-out silently failed on exactly one record out of several — the one record that had never
  // been shared with that trustee before, so no wrappedKey doc existed for it yet.
  it('lets an owner read a wrappedKey that does not exist yet (first-time grant check)', async () => {
    const recordId = 'wk-read-nonexistent-key-owner';
    await seedRecord(recordId);

    await assertSucceeds(
      testEnv.authenticatedContext(OWNER).firestore().doc(`wrappedKeys/${recordId}_${RECEIVER}`).get()
    );
  });

  it('lets anyone authenticated read a wrappedKey that does not exist yet (vacuously true, nothing to leak)', async () => {
    const recordId = 'wk-read-nonexistent-key-stranger';
    await seedRecord(recordId);

    await assertSucceeds(
      testEnv.authenticatedContext(STRANGER).firestore().doc(`wrappedKeys/${recordId}_${RECEIVER}`).get()
    );
  });

  it('denies a stranger with no role at all from reading someone else\'s key', async () => {
    const recordId = 'wk-read-stranger-denied';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: VIEWER, grantedBy: SHARER, isActive: true });

    await assertFails(testEnv.authenticatedContext(STRANGER).firestore().doc('wrappedKeys/key-1').get());
  });

  it('denies a plain viewer (has a role, but not sharer+) from reading someone else\'s key', async () => {
    const recordId = 'wk-read-viewer-cannot-read-others';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: SHARER, isActive: true });

    await assertFails(testEnv.authenticatedContext(VIEWER).firestore().doc('wrappedKeys/key-1').get());
  });

  it('denies a user from reading their own key once they no longer hold any role on the record (revoked)', async () => {
    const recordId = 'wk-read-self-revoked-denied';
    await seedRecord(recordId);
    // RECEIVER has no role here — simulates the state AFTER a full revoke completes (role-array
    // removal is always the last step in removeViewer/removeAdmin/etc, so by the time a
    // standalone re-fetch happens, the user is already stripped from every array).
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: SHARER, isActive: false });

    await assertFails(testEnv.authenticatedContext(RECEIVER).firestore().doc('wrappedKeys/key-1').get());
  });

  it('lets a sharer read any key on a record they can manage', async () => {
    const recordId = 'wk-read-sharer-management';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: SHARER, isActive: true });

    await assertSucceeds(testEnv.authenticatedContext(SHARER).firestore().doc('wrappedKeys/key-1').get());
  });

  it('lets an admin read a key with no active role yet — the mid-grant reactivation check', async () => {
    const recordId = 'wk-read-admin-reactivation';
    // RECEIVER has no role on this record — simulates the moment mid-grant where
    // SharingService.grantEncryptionAccess reads a target's existing key BEFORE the record's
    // role arrays are updated (grantViewer only adds to viewers[] in its last step).
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: ADMIN, isActive: false });

    await assertSucceeds(testEnv.authenticatedContext(ADMIN).firestore().doc('wrappedKeys/key-1').get());
  });

  it('lets a user read their own key while they still hold a role on the record', async () => {
    const recordId = 'wk-read-self-active-participant';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: VIEWER, grantedBy: SHARER, isActive: true });

    await assertSucceeds(testEnv.authenticatedContext(VIEWER).firestore().doc('wrappedKeys/key-1').get());
  });

  it('lets a user read their own PENDING key even while inactive, as long as they already hold a role (trustee accept-flow)', async () => {
    const recordId = 'wk-read-self-pending-trustee';
    // Trustees are added to the record's role arrays at grant time, before they've accepted —
    // wrappedKey stays isActive:false until TrusteePermissionService.activatePendingTrusteeAccess
    // flips it. "Participant" and "wrappedKey active" are independent signals in this schema,
    // which is exactly what makes gating on participant-status safe for this flow.
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: VIEWER, grantedBy: SHARER, isActive: false });

    await assertSucceeds(testEnv.authenticatedContext(VIEWER).firestore().doc('wrappedKeys/key-1').get());
  });
});

describe('firestore.rules — wrappedKeys — read via list query (list ≠ get)', () => {
  // Regression: TrusteePermissionService.revokeTrusteeAccess queries
  //   where('userId','==',trusteeId).where('grantedBy','==',trustorId).where('isActive','==',true)
  // as the trustor, to find every key they granted a given trustee. A single-doc get() by an
  // owner/sharer would pass fine via isSharerOrAboveOnRecord — but Firestore requires a list
  // request's rule to be provable for the WHOLE possible result set using only the query's own
  // equality filters, before it'll run the query at all. recordId isn't one of this query's
  // filters, so isSharerOrAboveOnRecord's get() can never satisfy that requirement, and userId
  // is pinned to the trustee (not the caller), so the self-read branch can't either — the entire
  // query was rejected with permission-denied regardless of whether anything matched. Caught in
  // production during dependent-account deletion (AccountDeletionService → resignAsTrustee),
  // where the on-chain revoke succeeded but this query blocked the Firestore side from ever
  // running. The bare `grantedBy == request.auth.uid` branch fixes it because grantedBy IS one
  // of the query's filters, so Firestore can prove it holds without any get().
  it('lets the granter list keys they granted, filtered by grantedBy — recordId is not part of the query', async () => {
    const recordId = 'wk-list-grantedby-allowed';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: OWNER, isActive: true });

    const db = testEnv.authenticatedContext(OWNER).firestore();
    const q = query(
      collection(db, 'wrappedKeys'),
      where('userId', '==', RECEIVER),
      where('grantedBy', '==', OWNER),
      where('isActive', '==', true)
    );

    await assertSucceeds(getDocs(q));
  });

  it('still denies listing keys filtered by someone else\'s grantedBy', async () => {
    const recordId = 'wk-list-grantedby-denied';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: SHARER, isActive: true });

    const db = testEnv.authenticatedContext(STRANGER).firestore();
    const q = query(
      collection(db, 'wrappedKeys'),
      where('userId', '==', RECEIVER),
      where('grantedBy', '==', SHARER),
      where('isActive', '==', true)
    );

    await assertFails(getDocs(q));
  });

  // Regression: the mirror-image bug on the trustee's own side. TrusteePermissionService.
  // activateTrusteeAccess (called right after accepting a trustee invite) and
  // updateTrusteeAccess's self-downgrade path both query
  //   where('userId','==',trusteeId).where('grantedBy','==',trustorId).where('isActive','==',...)
  // as the TRUSTEE — same unprovable-list-query shape as above, just with userId pinned to the
  // caller instead of grantedBy. Caught in production: accepting a trustee invite succeeded
  // on-chain but activateTrusteeAccess's query threw permission-denied, leaving every wrappedKey
  // stuck inactive despite the accepted relationship. The fix is a bare
  // `userId == request.auth.uid && revokedAt is absent` branch — revokedAt is a plain field on
  // the same document (no get()), so it's always provable, and its absence reliably means
  // "pending or active, never revoked" since every revoke path in the app sets it.
  it('lets a user list their own pending (isActive:false, never revoked) keys, filtered by userId', async () => {
    const recordId = 'wk-list-userid-pending-allowed';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: OWNER, isActive: false });

    const db = testEnv.authenticatedContext(RECEIVER).firestore();
    const q = query(
      collection(db, 'wrappedKeys'),
      where('userId', '==', RECEIVER),
      where('grantedBy', '==', OWNER),
      where('isActive', '==', false)
    );

    await assertSucceeds(getDocs(q));
  });

  it('lets a user list their own active (never revoked) keys, filtered by userId', async () => {
    const recordId = 'wk-list-userid-active-allowed';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: OWNER, isActive: true });

    const db = testEnv.authenticatedContext(RECEIVER).firestore();
    const q = query(
      collection(db, 'wrappedKeys'),
      where('userId', '==', RECEIVER),
      where('grantedBy', '==', OWNER),
      where('isActive', '==', true)
    );

    await assertSucceeds(getDocs(q));
  });

  it('still denies listing keys filtered by someone else\'s userId', async () => {
    const recordId = 'wk-list-userid-denied';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: OWNER, isActive: false });

    const db = testEnv.authenticatedContext(STRANGER).firestore();
    const q = query(
      collection(db, 'wrappedKeys'),
      where('userId', '==', RECEIVER),
      where('grantedBy', '==', OWNER),
      where('isActive', '==', false)
    );

    await assertFails(getDocs(q));
  });

  // Documents a real, deliberate limitation rather than a gap: Firestore's list-query rule
  // evaluation can't be made to exclude a revoked key here (see the `allow list` comment in
  // firestore.rules) — a plain-field condition like "revokedAt is absent" gets ignored per
  // document once userId==me is provable from the query's own filters, so a revoked key that
  // matches the filters IS included. (grantEncryptionAccess's own re-grant path doesn't reliably
  // clear a stale revokedAt either, so the field wouldn't be a trustworthy signal even if list
  // enforcement did work.) Neither activateTrusteeAccess nor updateTrusteeAccess currently need
  // to distinguish revoked from pending/active in their own result handling, but this pins the
  // actual behavior so it doesn't get "fixed" into a false sense of security again.
  it('includes an already-revoked key in list results when it matches the query filters (documented limitation)', async () => {
    const recordId = 'wk-list-userid-revoked-included';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', {
      userId: RECEIVER,
      grantedBy: OWNER,
      isActive: false,
      revokedAt: new Date(),
      revokedBy: OWNER,
    });

    const db = testEnv.authenticatedContext(RECEIVER).firestore();
    const q = query(
      collection(db, 'wrappedKeys'),
      where('userId', '==', RECEIVER),
      where('grantedBy', '==', OWNER),
      where('isActive', '==', false)
    );

    const snap = await getDocs(q);
    expect(snap.docs).toHaveLength(1);
  });

  // Regression: EncryptionAccessView.fetchEncryptionAccess() queries
  //   where('recordId', '==', record.id)
  // to show a record's full access list. Unlike the two grantedBy/userId regressions above,
  // recordId IS one of this query's own filters, so Firestore CAN prove
  // hasRoleOnRecord(resource.data.recordId) holds for the whole result set without running the
  // query first — recordId is pinned by the filter, so the get() path it builds is fixed too.
  // Caught via e2e (recordShareGuestClaim.spec.ts): "Manage Access" is reachable by anyone with
  // any role on a record — RecordFull/RecordMenu never gate it to owners/administrators, since
  // readOnly is never passed by any caller — but every non-owner/administrator (viewers,
  // subjects) saw "Failed to load access data" because the old rule only covered grantedBy/userId
  // on the CALLER's own entries, not "can this caller see the whole list for a record they have
  // any role on." hasRoleOnRecord (not the narrower isSharerOrAboveOnRecord, which would still
  // deny viewers/subjects) matches who the UI actually lets reach this query.
  it('lets a viewer list all wrappedKeys for a record they have a role on, filtered by recordId', async () => {
    const recordId = 'wk-list-recordid-viewer-allowed';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: OWNER, isActive: true });

    const db = testEnv.authenticatedContext(VIEWER).firestore();
    const q = query(collection(db, 'wrappedKeys'), where('recordId', '==', recordId));

    await assertSucceeds(getDocs(q));
  });

  it('lets an admin/owner list all wrappedKeys for a record they manage, filtered by recordId', async () => {
    const recordId = 'wk-list-recordid-admin-allowed';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: OWNER, isActive: true });

    const db = testEnv.authenticatedContext(ADMIN).firestore();
    const q = query(collection(db, 'wrappedKeys'), where('recordId', '==', recordId));

    await assertSucceeds(getDocs(q));
  });

  it('still denies listing by recordId for a stranger with no role on the record', async () => {
    const recordId = 'wk-list-recordid-stranger-denied';
    await seedRecord(recordId);
    await seedWrappedKey(recordId, 'key-1', { userId: RECEIVER, grantedBy: OWNER, isActive: true });

    const db = testEnv.authenticatedContext(STRANGER).firestore();
    const q = query(collection(db, 'wrappedKeys'), where('recordId', '==', recordId));

    await assertFails(getDocs(q));
  });
});
