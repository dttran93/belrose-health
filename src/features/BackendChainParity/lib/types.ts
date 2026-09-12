// src/features/BackendChainParity/lib/types.ts

import type { onChainIdentityStatus, LinkedWalletRecord } from '@/types/core';
import type { ChainEventCacheDoc, ChainEventReconciliationStatus } from '@belrose/shared';

export type { onChainIdentityStatus, LinkedWalletRecord };
// Event-level classification from the chain event indexer — a different axis from
// IntegrityStatus/SubjectSyncStatus below (which classify an *entity's* sync state, not one
// specific on-chain log). See packages/shared/src/chainEventCache.ts for what each value means.
export type { ChainEventCacheDoc, ChainEventReconciliationStatus };

export type IntegrityStatus =
  | 'synced' // Everything matches on chain and on firebase
  | 'mismatch' // Data is in both firebase or on chain, but things don't match (recordhash associated with ID, verification level, dispute culpability etc.)
  | 'missing' // Data is in firebase but not on chain
  | 'chain_only' // Data is on chain but not in firebase
  | 'pending' // Data is not on chain but isn't supposed to be yet (e.g. guest access)
  | 'not_applicable' // Data is not on chain and isn't supposed to be at all (record without any chain activity)
  | 'failed'; // couldn't check

// ============================================================================
// INTEGRITY RESULT TYPES (Firestore data + chain check outcome)
// ============================================================================

export type SubjectSyncStatus =
  | 'active_sync' // in backend + active on-chain
  | 'missing_from_backend' // active on-chain but not in backend
  | 'missing_from_chain' // in backend but not active on-chain
  | 'removed_sync'; // not in backend + not active on-chain (both agree it's removed)

export interface SubjectComparison {
  uid?: string; // Firebase UID — undefined when only known from chain
  userIdHash: string; // keccak256(uid) or raw chain hash if uid unknown
  isActiveOnChain: boolean;
  syncStatus: SubjectSyncStatus;
}

// Re-uses the same 4-status matrix as subjects
export type HashSyncStatus = SubjectSyncStatus;

export interface HashComparison {
  hash: string;
  isCurrentHash: boolean; // true if this is record.recordHash (vs a previousRecordHash)
  isActiveOnChain: boolean;
  syncStatus: HashSyncStatus;
}

// ============================================================================
// SUMMARY STATS
// ============================================================================

export interface ParitySummary {
  total: number;
  synced: number;
  mismatch: number;
  missing: number;
  chainOnly: number;
  pending: number;
  notApplicable: number;
  failed: number;
}

export function computeSummary(items: { integrityStatus: IntegrityStatus }[]): ParitySummary {
  const summary: ParitySummary = {
    total: items.length,
    synced: 0,
    mismatch: 0,
    missing: 0,
    chainOnly: 0,
    pending: 0,
    notApplicable: 0,
    failed: 0,
  };
  for (const item of items) {
    switch (item.integrityStatus) {
      case 'synced':
        summary.synced++;
        break;
      case 'mismatch':
        summary.mismatch++;
        break;
      case 'missing':
        summary.missing++;
        break;
      case 'chain_only':
        summary.chainOnly++;
        break;
      case 'pending':
        summary.pending++;
        break;
      case 'not_applicable':
        summary.notApplicable++;
        break;
      case 'failed':
        summary.failed++;
        break;
    }
  }
  return summary;
}
