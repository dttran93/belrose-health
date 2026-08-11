// functions/src/handlers/setCredentialFloor.ts
//
// Admin-only: sets a user's CredentialFloor — the whitepaper's pre-trusted-set input to
// EarnedTrust(u) = max(CredentialFloor(u), AvgRecordCredibility(u) + DisputeAccuracy(u) - CulpabilityPenalty(u)).
// Mirrors setAdminClaim.ts's gated-callable pattern exactly, minus the custom Auth claim —
// credentialFloor isn't used for rules-gated authorization, it's purely a data input read
// server-side by the (not-yet-built) UserCredibility batch computation.
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

export const setCredentialFloor = onCall(async request => {
  // Gate: only platform admins can set this
  if (!request.auth?.token?.platformAdmin) {
    throw new HttpsError('permission-denied', 'Not authorized');
  }

  const { uid, credentialFloor } = request.data;
  if (!uid || typeof uid !== 'string') {
    throw new HttpsError('invalid-argument', 'A valid uid is required');
  }
  if (typeof credentialFloor !== 'number' || credentialFloor < 0 || credentialFloor > 1000) {
    throw new HttpsError('invalid-argument', 'credentialFloor must be a number between 0 and 1000');
  }

  await admin.firestore().collection('users').doc(uid).update({ credentialFloor });
  return { success: true };
});
