// src/features/BackendChainParity/hooks/useRecordHashHistory.ts

import { useQuery } from '@tanstack/react-query';
import { collection, getDocs, getFirestore, orderBy, query } from 'firebase/firestore';
import type { RecordHashHistoryEvent } from '@belrose/shared';

/**
 * Lazily fetches records/{recordId}/recordHashHistory — an append-only audit ledger of when
 * this record's content hash gets anchored on-chain, written from either a subject's first
 * anchor or a credibility prepare step (see writeRecordHashHistoryEvent.ts). Loaded on-demand
 * per expanded row, mirroring useSubjectHistory.
 */
export function useRecordHashHistory(recordId: string | null) {
  return useQuery<RecordHashHistoryEvent[]>({
    queryKey: ['backend-chain-parity', 'record-hash-history', recordId],
    enabled: !!recordId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const db = getFirestore();
      const snap = await getDocs(
        query(collection(db, 'records', recordId!, 'recordHashHistory'), orderBy('changedAt'))
      );
      return snap.docs.map(d => d.data() as RecordHashHistoryEvent);
    },
  });
}
