// src/features/BackendChainParity/hooks/useRecordSubjectsIntegrity.ts

import { useQuery } from '@tanstack/react-query';
import { checkRecordSubjectIntegrity } from '../services/recordSubjectIntegrityService';
import type { RecordSubjectIntegrityItem } from '../services/recordSubjectIntegrityService';
import { useRecordsWithCredibility } from './useRecordsWithCredibility';

export function useRecordSubjectsIntegrity() {
  const base = useRecordsWithCredibility();

  return useQuery({
    queryKey: ['backend-chain-parity', 'record-subjects', base.dataUpdatedAt],
    queryFn: (): Promise<RecordSubjectIntegrityItem[]> =>
      Promise.all(base.data!.records.map(record => checkRecordSubjectIntegrity(record))),
    enabled: !!base.data,
    staleTime: 10 * 60 * 1000,
  });
}
