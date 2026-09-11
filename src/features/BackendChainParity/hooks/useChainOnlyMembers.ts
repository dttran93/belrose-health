// src/features/BackendChainParity/hooks/useChainOnlyMembers.ts
//
// The chain→Firebase direction useMembersIntegrity.ts's header comment named as the missing
// piece: reads the chain event indexer's cache for MemberRegistered/WalletLinked events already
// classified 'legitimate_chain_only' (a real on-chain identity/wallet link with no Firestore
// basis — see reconciliationService.ts on the functions side for how that's decided), and builds
// a MemberIntegrityItem per distinct userIdHash via the existing (previously uncalled)
// buildChainOnlyItem(). Merged into useMembersIntegrity.ts's result — see that hook.

import { collection, getDocs, getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { buildChainOnlyItem, type MemberIntegrityItem } from '../services/memberIntegrityService';
import type { ChainEventCacheDoc } from '../lib/types';

const db = getFirestore(getApp());

// Single-field query (contract only) — the rest is filtered client-side to avoid needing a
// Firestore composite index for a small, admin-only, low-volume collection.
export async function fetchChainOnlyMembers(): Promise<MemberIntegrityItem[]> {
  const snapshot = await getDocs(collection(db, 'chainEventCache'));
  const userIdHashes = new Set<string>();

  for (const doc of snapshot.docs) {
    const data = doc.data() as ChainEventCacheDoc;
    if (
      data.contract === 'MemberRoleManager' &&
      (data.eventName === 'MemberRegistered' || data.eventName === 'WalletLinked') &&
      data.reconciliationStatus === 'legitimate_chain_only'
    ) {
      const userIdHash = (data.args as { userIdHash?: string }).userIdHash;
      if (userIdHash) userIdHashes.add(userIdHash);
    }
  }

  return Promise.all([...userIdHashes].map(buildChainOnlyItem));
}
