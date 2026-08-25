// src/features/CredibilityUser/services/networkCredibilityStatsService.ts
//
// Read-only: fetches the network-wide credibilityStats/global doc (AvgUserCredibility), the
// denominator of NormalizedCredibility(u) = UserCredibility(u) / AvgUserCredibility. Written
// server-only, once per UserCredibility batch cycle — see CredibilityStatsDoc's doc comment in
// packages/shared/src/credibility.ts. Parallel in shape to userCredibilityService.ts's
// getUserCredibility: a small dedicated getDoc, no caching, null on missing/error.

import { getFirestore, doc, getDoc } from 'firebase/firestore';
import type { CredibilityStatsDoc } from '@belrose/shared';

/**
 * Fetch the network's current AvgUserCredibility. Returns null if the stats doc doesn't exist
 * yet (no batch cycle has ever run) or on a fetch error — callers should treat null the same as
 * a zero/undefined average, i.e. fall back to a neutral NormalizedCredibility of 1.0.
 */
export async function getAvgUserCredibility(): Promise<number | null> {
  const db = getFirestore();

  try {
    const snapshot = await getDoc(doc(db, 'credibilityStats', 'global'));
    if (!snapshot.exists()) return null;

    const stats = snapshot.data() as CredibilityStatsDoc;
    return stats.avgUserCredibility ?? null;
  } catch (error) {
    console.error('Error fetching AvgUserCredibility:', error);
    return null;
  }
}
