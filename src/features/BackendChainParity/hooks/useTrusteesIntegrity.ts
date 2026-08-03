// src/features/BackendChainParity/hooks/useTrusteesIntegrity.ts

import { useQuery } from '@tanstack/react-query';
import { collection, getDocs, getFirestore, orderBy, query } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { TrusteeRelationship } from '@/features/Trustee/services/trusteeRelationshipService';
import {
  checkTrusteeIntegrity,
  type TrusteeIntegrityItem,
} from '../services/trusteeIntegrityService';
import { TrusteeHistoryEvent } from '@/features/Trustee/services/writeTrusteeHistoryEvent';

const db = getFirestore(getApp());

async function fetchTrusteesIntegrity(): Promise<TrusteeIntegrityItem[]> {
  const snapshot = await getDocs(collection(db, 'trusteeRelationships'));
  const items = snapshot.docs.map(doc => ({
    id: doc.id,
    ...(doc.data() as TrusteeRelationship),
  })) as (TrusteeRelationship & { id: string })[];

  return Promise.all(
    items.map(async item => {
      const historySnapshot = await getDocs(
        query(
          collection(db, 'trusteeRelationships', item.id, 'trusteeHistory'),
          orderBy('changedAt')
        )
      );
      const trusteeHistory = historySnapshot.docs.map(d => d.data() as TrusteeHistoryEvent);
      return checkTrusteeIntegrity(item, trusteeHistory);
    })
  );
}

export function useTrusteesIntegrity() {
  return useQuery({
    queryKey: ['backend-chain-parity', 'trustees'],
    queryFn: fetchTrusteesIntegrity,
    staleTime: 10 * 60 * 1000,
  });
}
