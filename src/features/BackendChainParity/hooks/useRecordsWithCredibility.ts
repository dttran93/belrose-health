// src/features/BackendChainParity/hooks/useRecordsWithCredibility.ts

import { useQuery } from '@tanstack/react-query';
import { collection, getDocs, getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { FileObject } from '@/types/core';

const db = getFirestore(getApp());

export interface RecordsWithCredibility {
  records: FileObject[];
  /** Lowercased recordHash values with at least one backend verification or dispute. */
  hashesWithCredibility: Set<string>;
}

async function fetchRecordsWithCredibility(): Promise<RecordsWithCredibility> {
  const [recordsSnap, verSnap, dispSnap] = await Promise.all([
    getDocs(collection(db, 'records')),
    getDocs(collection(db, 'verifications')),
    getDocs(collection(db, 'disputes')),
  ]);

  // Keyed by hash, not recordId — a verification/dispute targets one specific hash
  // version, so a record having *any* credibility activity doesn't mean its *current*
  // hash (which may have since been edited past that version) does. Zero extra
  // per-record queries either way.
  const hashesWithCredibility = new Set<string>();
  for (const doc of [...verSnap.docs, ...dispSnap.docs]) {
    const hash = doc.data().recordHash as string | undefined;
    if (hash) hashesWithCredibility.add(hash.toLowerCase());
  }

  const records = recordsSnap.docs.map(doc => ({
    id: doc.id,
    ...(doc.data() as Omit<FileObject, 'id'>),
  })) as FileObject[];

  return { records, hashesWithCredibility };
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
