// src/features/CredibilityUser/services/userCredibilityService.ts
//
// Read-only: fetches a user's computed UserCredibilityScore (users/{uid}.credibility).
// No write path here — credibility is written server-only, by the (not-yet-built) scheduled
// batch computation, per firestore.rules. Deliberately a small dedicated getDoc rather than
// reusing Users/services/userProfileService.ts's getUserProfile, which curates a narrower,
// cached "public sharing profile" subset that doesn't include credibility today — broadening
// that shared, widely-used function's contract isn't this feature's call to make, and a
// credibility view wants fresher data than that function's 5-minute cache anyway.

import { getFirestore, doc, getDoc } from 'firebase/firestore';
import type { UserCredibilityScore } from '@belrose/shared';

/**
 * Fetch a user's current computed credibility score + EarnedTrust breakdown.
 * Returns null if the user has no profile, or hasn't been scored yet (credibility is only
 * populated once the batch computation has run at least one cycle since the user existed).
 */
export async function getUserCredibility(userId: string): Promise<UserCredibilityScore | null> {
  const db = getFirestore();

  try {
    const snapshot = await getDoc(doc(db, 'users', userId));
    if (!snapshot.exists()) return null;

    const credibility = snapshot.data().credibility as UserCredibilityScore | undefined;
    return credibility ?? null;
  } catch (error) {
    console.error(`Error fetching user credibility for ${userId}:`, error);
    return null;
  }
}
