// src/features/BackendChainParity/hooks/useSubjectHistory.ts

import { useQuery } from '@tanstack/react-query';
import { collection, getDocs, getFirestore, orderBy, query } from 'firebase/firestore';
import type { SubjectHistoryEvent } from '@belrose/shared';

/**
 * Lazily fetches records/{recordId}/subjectHistory — an append-only audit ledger of
 * anchor/unanchor events for the record's subjects[] array (see writeSubjectHistoryEvent.ts).
 * Loaded on-demand per expanded row, mirroring useSubjectConsentRefs.
 */
export function useSubjectHistory(recordId: string | null) {
  return useQuery<SubjectHistoryEvent[]>({
    queryKey: ['backend-chain-parity', 'subject-history', recordId],
    enabled: !!recordId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const db = getFirestore();
      const snap = await getDocs(
        query(collection(db, 'records', recordId!, 'subjectHistory'), orderBy('changedAt'))
      );
      return snap.docs.map(d => d.data() as SubjectHistoryEvent);
    },
  });
}
