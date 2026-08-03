// src/features/BackendChainParity/services/trusteeIntegrityService.ts

import type {
  TrusteeRelationship,
  TrustLevel,
  TrusteeStatus,
} from '@/features/Trustee/services/trusteeRelationshipService';
import type { TrusteeHistoryEvent } from '@/features/Trustee/services/writeTrusteeHistoryEvent';
import type { TimestampLike } from '@belrose/shared';
import type { IntegrityStatus } from '../lib/types';
import { getMemberContract } from '../lib/contracts';
import { id } from 'ethers';

const CHAIN_STATUS = { None: 0, Pending: 1, Active: 2, Revoked: 3 } as const;
const CHAIN_LEVEL = { Observer: 0, Custodian: 1, Controller: 2 } as const;

export const CHAIN_STATUS_LABEL: Record<number, string> = {
  0: 'None',
  1: 'Pending',
  2: 'Active',
  3: 'Revoked',
};

export const CHAIN_LEVEL_LABEL: Record<number, string> = {
  0: 'Observer',
  1: 'Custodian',
  2: 'Controller',
};

const TRUST_LEVEL_TO_NUMBER: Record<TrustLevel, number> = {
  observer: CHAIN_LEVEL.Observer,
  custodian: CHAIN_LEVEL.Custodian,
  controller: CHAIN_LEVEL.Controller,
};

export interface TrusteeIntegrityItem {
  id: string;
  trustorId: string;
  trustorIdHash: string;
  trusteeId: string;
  trusteeIdHash: string;
  firestoreStatus: TrusteeStatus;
  firestoreTrustLevel: TrustLevel;
  isDependentRelationship?: boolean;
  trusteeHistory: TrusteeHistoryEvent[];
  createdAt?: TimestampLike;
  respondedAt?: TimestampLike | null;
  revokedAt?: TimestampLike | null;
  onChainStatus?: number;
  onChainLevel?: number;
  integrityStatus: IntegrityStatus;
  mismatchReasons?: string[];
  error?: string;
}

export async function checkTrusteeIntegrity(
  rel: TrusteeRelationship & { id: string },
  trusteeHistory: TrusteeHistoryEvent[]
): Promise<TrusteeIntegrityItem> {
  const trustorIdHash = id(rel.trustorId).toLowerCase();
  const trusteeIdHash = id(rel.trusteeId).toLowerCase();

  const base: Omit<TrusteeIntegrityItem, 'integrityStatus'> = {
    id: rel.id,
    trustorId: rel.trustorId,
    trustorIdHash,
    trusteeId: rel.trusteeId,
    trusteeIdHash,
    firestoreStatus: rel.status,
    firestoreTrustLevel: rel.trustLevel,
    isDependentRelationship: rel.isDependentRelationship,
    trusteeHistory,
    createdAt: rel.createdAt as unknown as TimestampLike,
    respondedAt: rel.respondedAt as unknown as TimestampLike | null,
    revokedAt: rel.revokedAt as unknown as TimestampLike | null,
  };

  // Declined = trustee rejected via UI only; no on-chain acceptance ever happened.
  // The chain retains a stale Pending proposal — that's expected, not a bug.
  if (rel.status === 'declined') {
    return { ...base, integrityStatus: 'not_applicable' };
  }

  try {
    const contract = getMemberContract();
    const [onChainStatusBigInt, onChainLevelBigInt] = await contract.getTrusteeRelationship(
      trustorIdHash,
      trusteeIdHash
    );

    const onChainStatus = Number(onChainStatusBigInt);
    const onChainLevel = Number(onChainLevelBigInt);

    // Check 1: if on-chain has no record at all, the blockchain write never landed
    if (onChainStatus === CHAIN_STATUS.None) {
      return { ...base, onChainStatus, onChainLevel, integrityStatus: 'missing' };
    }

    const mismatchReasons: string[] = [];

    // Check 2: status alignment
    const expectedStatus = (() => {
      switch (rel.status) {
        case 'pending':
          return CHAIN_STATUS.Pending;
        case 'active':
          return CHAIN_STATUS.Active;
        case 'revoked':
          return CHAIN_STATUS.Revoked;
        default:
          return null;
      }
    })();

    if (expectedStatus !== null && onChainStatus !== expectedStatus) {
      mismatchReasons.push(
        `status mismatch — on-chain: ${CHAIN_STATUS_LABEL[onChainStatus] ?? onChainStatus}, expected for firestore "${rel.status}": ${CHAIN_STATUS_LABEL[expectedStatus]}`
      );
    }

    // Check 3: trust level alignment (only meaningful when active on both sides)
    if (rel.status === 'active' && onChainStatus === CHAIN_STATUS.Active) {
      const expectedLevel = TRUST_LEVEL_TO_NUMBER[rel.trustLevel];
      if (onChainLevel !== expectedLevel) {
        mismatchReasons.push(
          `level mismatch — on-chain: ${CHAIN_LEVEL_LABEL[onChainLevel] ?? onChainLevel}, firestore: ${rel.trustLevel}`
        );
      }
    }

    const integrityStatus: IntegrityStatus = mismatchReasons.length > 0 ? 'mismatch' : 'synced';

    return {
      ...base,
      onChainStatus,
      onChainLevel,
      integrityStatus,
      ...(mismatchReasons.length > 0 && { mismatchReasons }),
    };
  } catch (error) {
    return { ...base, integrityStatus: 'failed', error: String(error) };
  }
}
