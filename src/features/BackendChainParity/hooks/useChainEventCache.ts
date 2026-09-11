// src/features/BackendChainParity/hooks/useChainEventCache.ts

import { useQuery } from '@tanstack/react-query';
import { collection, getDocs, getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { ChainEventCacheDoc } from '../lib/types';

const db = getFirestore(getApp());

export type ChainEventCacheRecord = ChainEventCacheDoc & { id: string };

// Fetches the whole chainEventCache collection — like useMembersIntegrity.ts's fetch of `users`,
// filtering (by reconciliationStatus) happens client-side in ChainEventsTable so an admin can
// still inspect 'matched'/'legitimate_chain_only' rows for context, not just the two actionable
// statuses this tab exists to surface.
async function fetchChainEventCache(): Promise<ChainEventCacheRecord[]> {
  const snapshot = await getDocs(collection(db, 'chainEventCache'));
  const items = snapshot.docs.map(
    doc => ({ id: doc.id, ...(doc.data() as ChainEventCacheDoc) }) as ChainEventCacheRecord
  );
  return items.sort((a, b) => (b.indexedAt?.toMillis() ?? 0) - (a.indexedAt?.toMillis() ?? 0));
}

export function useChainEventCache() {
  return useQuery({
    queryKey: ['backend-chain-parity', 'chain-events'],
    queryFn: fetchChainEventCache,
    staleTime: 5 * 60 * 1000,
  });
}
