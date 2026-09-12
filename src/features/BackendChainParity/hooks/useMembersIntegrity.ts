// src/features/BackendChainParity/hooks/useMembersIntegrity.ts

import { useQuery } from '@tanstack/react-query';
import { collection, getDocs, getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { BelroseUserProfile } from '@/types/core';
import { checkMemberIntegrity, MemberIntegrityItem } from '../services/memberIntegrityService';
import { fetchChainOnlyMembers } from './useChainOnlyMembers';

const db = getFirestore(getApp());

// Chain-only member detection (users on-chain but missing from Firebase) used to require
// querying every user on chain directly — unsustainable, since that read would get too large for
// any node to do at once. Now covered by the chain event indexer (functions/src/chainIndexer/)
// instead: a background process watches MemberRegistered/WalletLinked events and caches them in
// Firestore's chainEventCache collection, making the chain→Firebase direction queryable without a
// full on-chain scan — see fetchChainOnlyMembers (useChainOnlyMembers.ts).
async function fetchMembersIntegrity(): Promise<MemberIntegrityItem[]> {
  const snapshot = await getDocs(collection(db, 'users'));
  const users = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }) as BelroseUserProfile);
  const [firestoreItems, chainOnlyItems] = await Promise.all([
    Promise.all(users.map(user => checkMemberIntegrity(user))),
    fetchChainOnlyMembers(),
  ]);
  return [...firestoreItems, ...chainOnlyItems];
}

export function useMembersIntegrity() {
  return useQuery({
    queryKey: ['backend-chain-parity', 'members'],
    queryFn: fetchMembersIntegrity,
    staleTime: 10 * 60 * 1000,
  });
}
