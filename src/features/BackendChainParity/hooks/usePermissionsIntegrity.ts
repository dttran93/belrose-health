// src/features/BackendChainParity/hooks/usePermissionsIntegrity.ts

import { useQuery } from '@tanstack/react-query';
import { collection, getDocs, getFirestore } from 'firebase/firestore';
import type { FileObject } from '@/types/core';
import {
  checkRecordPermissionsIntegrity,
  type RecordPermissionIntegrityItem,
} from '../services/recordPermissionIntegrityService';

export async function fetchPermissionsIntegrity(): Promise<RecordPermissionIntegrityItem[]> {
  const db = getFirestore();
  const snap = await getDocs(collection(db, 'records'));
  const records = snap.docs.map(d => ({ id: d.id, ...d.data() } as FileObject));

  const results = await Promise.allSettled(records.map(r => checkRecordPermissionsIntegrity(r)));

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      recordId: records[i]!.id,
      recordIdHash: '',
      firestoreMemberCount: 0,
      onChainMemberCount: 0,
      memberComparisons: [],
      recentHistory: [],
      integrityStatus: 'failed' as const,
      error: String(r.reason),
    };
  });
}

export function usePermissionsIntegrity() {
  return useQuery<RecordPermissionIntegrityItem[]>({
    queryKey: ['backend-chain-parity', 'permissions'],
    queryFn: fetchPermissionsIntegrity,
    staleTime: 10 * 60 * 1000,
  });
}
