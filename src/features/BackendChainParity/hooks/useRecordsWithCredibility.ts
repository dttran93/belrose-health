// src/features/BackendChainParity/hooks/useRecordsWithCredibility.ts

import { useQuery } from '@tanstack/react-query';
import { collection, collectionGroup, getDocs, getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { FileObject } from '@/types/core';

const db = getFirestore(getApp());

export interface RecordsWithCredibility {
  records: FileObject[];
  /**
   * Lowercased hash values with at least one anchor-capable action ever attempted against
   * them — sourced from records/{id}/recordHashHistory (the precise, per-hash, going-forward
   * signal written at every subject-anchor and credibility-prepare call site) unioned with
   * every verification/dispute doc's own recordHash field (a historical-completeness
   * fallback for hashes anchored before recordHashHistory existed).
   */
  hashesEverAnchored: Set<string>;
}

export async function fetchRecordsWithCredibility(): Promise<RecordsWithCredibility> {
  const [recordsSnap, verSnap, dispSnap, hashHistorySnap] = await Promise.all([
    getDocs(collection(db, 'records')),
    getDocs(collection(db, 'verifications')),
    getDocs(collection(db, 'disputes')),
    getDocs(collectionGroup(db, 'recordHashHistory')),
  ]);

  // Keyed by hash, not recordId — an anchor-capable action targets one specific hash
  // version, so a record having *any* activity doesn't mean its *current* hash (which may
  // have since been edited past that version) does. Zero extra per-record queries either way.
  const hashesEverAnchored = new Set<string>();
  for (const doc of [...verSnap.docs, ...dispSnap.docs]) {
    const hash = doc.data().recordHash as string | undefined;
    if (hash) hashesEverAnchored.add(hash.toLowerCase());
  }
  for (const doc of hashHistorySnap.docs) {
    const hash = doc.data().hash as string | undefined;
    if (hash) hashesEverAnchored.add(hash.toLowerCase());
  }

  const records = recordsSnap.docs.map(doc => ({
    id: doc.id,
    ...(doc.data() as Omit<FileObject, 'id'>),
  })) as FileObject[];

  return { records, hashesEverAnchored };
}

/**
 * Shared base fetch for records + verifications + disputes + recordHashHistory, consumed by
 * both useRecordSubjectsIntegrity and useRecordHashesIntegrity so the same collections aren't
 * fetched twice.
 */
export function useRecordsWithCredibility() {
  return useQuery({
    queryKey: ['backend-chain-parity', 'records-with-credibility'],
    queryFn: fetchRecordsWithCredibility,
    staleTime: 10 * 60 * 1000,
  });
}
