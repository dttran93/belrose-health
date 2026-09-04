// src/features/BackendChainParity/hooks/useRecordHashesIntegrity.ts

import { useQuery } from '@tanstack/react-query';
import { checkRecordHashIntegrity } from '../services/recordHashIntegrityService';
import type { RecordHashIntegrityItem } from '../services/recordHashIntegrityService';
import { useRecordsWithCredibility } from './useRecordsWithCredibility';

export function useRecordHashesIntegrity() {
  const base = useRecordsWithCredibility();

  return useQuery({
    queryKey: ['backend-chain-parity', 'record-hashes', base.dataUpdatedAt],
    queryFn: (): Promise<RecordHashIntegrityItem[]> =>
      Promise.all(
        base.data!.records.map(record =>
          checkRecordHashIntegrity(record, base.data!.hashesWithCredibility)
        )
      ),
    enabled: !!base.data,
    staleTime: 10 * 60 * 1000,
  });
}
