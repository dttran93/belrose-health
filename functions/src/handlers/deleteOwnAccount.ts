// functions/src/handlers/deleteOwnAccount.ts
//
// Final step of self-service account deletion (AccountDeletionService.deleteMyAccount).
// By the time this is called, the client has already cleaned up records, trustee
// relationships, and the caller's own pending subject requests, and deleted the
// `users/{uid}` doc. This function does the two things only the Admin SDK can do:
//
//   1. Sweep any pending subjectConsentRequests/subjectRemovalRequests where the
//      caller is the target `subjectId` (not the requester) — Firestore rules don't
//      let a subject delete those directly, only the requester or a record admin/owner.
//      But needs to be deleted because there's no user anymore.
//   2. Delete the Firebase Auth user — done server-side rather than via the client
//      SDK's `user.delete()` to avoid its "requires recent login" failure mode after
//      a long async cleanup sequence.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';

export const deleteOwnAccount = onCall({}, async (request): Promise<{ success: boolean }> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be authenticated');

  const uid = request.auth.uid;
  const db = getFirestore();

  for (const collectionName of ['subjectConsentRequests', 'subjectRemovalRequests']) {
    const snapshot = await db
      .collection(collectionName)
      .where('subjectId', '==', uid)
      .where('status', '==', 'pending')
      .get();

    await Promise.all(snapshot.docs.map(d => d.ref.delete()));
  }

  try {
    await admin.auth().deleteUser(uid);
  } catch (err) {
    console.warn(`Could not delete Auth user ${uid}:`, err);
  }

  console.log(`✅ Account fully deleted: ${uid}`);

  return { success: true };
});
