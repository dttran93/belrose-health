// src/features/BackendChainParity/hooks/useSyncQueue.ts

import { useQuery } from '@tanstack/react-query';
import { collection, getDocs, orderBy, query, getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { SyncQueueRecord } from '@/features/BlockchainWallet/services/blockchainSyncQueueService';

const db = getFirestore(getApp());

async function fetchSyncQueue(): Promise<SyncQueueRecord[]> {
  const q = query(collection(db, 'blockchainSyncQueue'), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...(doc.data() as Omit<SyncQueueRecord, 'id'>),
  }));
}

/**
 * Every blockchainSyncQueue entry — pending, confirmed, and failed alike — ordered newest
 * first. This is the full log of every blockchain write attempted across the app (client- or
 * function-orchestrated, see blockchainSyncQueueService.ts's header for that split), not just
 * failures; SyncQueueTable applies its own local status filter on top of this.
 */
export function useSyncQueue() {
  return useQuery({
    queryKey: ['backend-chain-parity', 'sync-queue'],
    queryFn: fetchSyncQueue,
    staleTime: 5 * 60 * 1000,
  });
}
