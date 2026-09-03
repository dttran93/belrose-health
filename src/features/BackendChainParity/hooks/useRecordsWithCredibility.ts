// src/features/BackendChainParity/hooks/useRecordsWithCredibility.ts

import { useQuery } from '@tanstack/react-query';
import { collection, getDocs, getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { FileObject } from '@/types/core';

const db = getFirestore(getApp());

export interface RecordsWithCredibility {
  records: FileObject[];
  recordIdsWithCredibility: Set<string>;
}

async function fetchRecordsWithCredibility(): Promise<RecordsWithCredibility> {
  const [recordsSnap, verSnap, dispSnap] = await Promise.all([
    getDocs(collection(db, 'records')),
    getDocs(collection(db, 'verifications')),
    getDocs(collection(db, 'disputes')),
  ]);

  // Build a set of recordIds that have at least one backend V or D — zero extra per-record queries.
  const recordIdsWithCredibility = new Set<string>();
  for (const doc of [...verSnap.docs, ...dispSnap.docs]) {
    const rid = doc.data().recordId as string | undefined;
    if (rid) recordIdsWithCredibility.add(rid);
  }

  const records = recordsSnap.docs.map(doc => ({
    id: doc.id,
    ...(doc.data() as Omit<FileObject, 'id'>),
  })) as FileObject[];

  return { records, recordIdsWithCredibility };
}

/**
 * Shared base fetch for records + verifications + disputes, consumed by both
 * useRecordSubjectsIntegrity and useRecordHashesIntegrity so the same 3
 * Firestore collections aren't fetched twice.
 */
export function useRecordsWithCredibility() {
  return useQuery({
    queryKey: ['backend-chain-parity', 'records-with-credibility'],
    queryFn: fetchRecordsWithCredibility,
    staleTime: 10 * 60 * 1000,
  });
}
