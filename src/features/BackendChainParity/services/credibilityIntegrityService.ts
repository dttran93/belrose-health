// src/features/BackendChainParity/services/credibilityIntegrityService.ts

import type {
  VerificationDoc,
  DisputeDoc,
  VouchDoc,
  BlockchainRef,
  TimestampLike,
  VerificationOnChainEvent,
  DisputeOnChainEvent,
  VouchOnChainEvent,
} from '@belrose/shared';
import type { IntegrityStatus } from '../lib/types';
import { getHealthContract, getMemberContract } from '../lib/contracts';
import { id } from 'ethers';

// ============================================================================
// VERIFICATION INTEGRITY CHECK
// ============================================================================

export interface VerificationIntegrityItem {
  recordId: string;
  recordIdHash: string;
  recordHash: string;
  verifierIdHash: string;
  verifierId: string;
  chainStatus?: string;
  /** Latest tx — derived from the last onChainHistory entry for the Tx column. */
  blockchainRef?: BlockchainRef;
  onChainHistory?: VerificationOnChainEvent[];
  level: number;
  createdAt?: TimestampLike;
  integrityStatus: IntegrityStatus;
  existsOnChain?: boolean;
  isActiveOnChain?: boolean;
  mismatchReasons?: string[];
  error?: string;
}

export async function checkVerificationIntegrity(
  ver: VerificationDoc
): Promise<VerificationIntegrityItem> {
  const expectedRecordIdHash = id(ver.recordId).toLowerCase();
  const latestBlockchainRef = ver.onChainHistory?.at(-1)?.blockchainRef;

  const base: Omit<VerificationIntegrityItem, 'integrityStatus'> = {
    recordId: ver.recordId,
    recordIdHash: expectedRecordIdHash,
    recordHash: ver.recordHash,
    verifierId: ver.verifierId,
    verifierIdHash: ver.verifierIdHash,
    chainStatus: ver.chainStatus,
    blockchainRef: latestBlockchainRef,
    onChainHistory: ver.onChainHistory,
    level: ver.level,
    createdAt: ver.createdAt,
  };

  if (ver.chainStatus === 'pending') return { ...base, integrityStatus: 'pending' };
  if (ver.chainStatus === 'failed') return { ...base, integrityStatus: 'failed' };

  try {
    const contract = getHealthContract();

    const [[exists, onChainRecordIdHash, onChainLevel, , isActive], hashIsActive] =
      await Promise.all([
        contract.getUserVerification(ver.recordHash, ver.verifierIdHash),
        contract.doesHashExist(ver.recordHash),
      ]);

    if (!exists) return { ...base, integrityStatus: 'missing', existsOnChain: false };

    const mismatchReasons: string[] = [];

    if (!hashIsActive) {
      mismatchReasons.push('record hash retracted on-chain');
    }

    const onChainRecordIdHashNorm = (onChainRecordIdHash as string).toLowerCase();
    if (onChainRecordIdHashNorm !== expectedRecordIdHash) {
      mismatchReasons.push(
        `recordIdHash mismatch — on-chain: ${onChainRecordIdHashNorm.slice(0, 12)}…, expected: ${expectedRecordIdHash.slice(0, 12)}…`
      );
    }

    const onChainLevelNum = Number(onChainLevel);
    if (onChainLevelNum !== ver.level) {
      mismatchReasons.push(
        `level mismatch — on-chain: ${onChainLevelNum}, firestore: ${ver.level}`
      );
    }

    if (!isActive) {
      mismatchReasons.push('verification retracted on-chain');
    }

    const integrityStatus: IntegrityStatus = mismatchReasons.length > 0 ? 'mismatch' : 'synced';

    return {
      ...base,
      integrityStatus,
      existsOnChain: true,
      isActiveOnChain: !!isActive,
      ...(mismatchReasons.length > 0 && { mismatchReasons }),
    };
  } catch (error) {
    console.log('Error checking verification integrity:', error);
    return { ...base, integrityStatus: 'failed', error: String(error) };
  }
}

// ============================================================================
// DISPUTE INTEGRITY CHECK
// ============================================================================

export interface DisputeIntegrityItem {
  recordId: string;
  recordIdHash: string;
  recordHash: string;
  disputerIdHash?: string;
  disputerId?: string;
  chainStatus?: string;
  /** Latest tx — derived from the last onChainHistory entry for the Tx column. */
  blockchainRef?: BlockchainRef;
  onChainHistory?: DisputeOnChainEvent[];
  severity: number;
  culpability: number;
  createdAt?: TimestampLike;
  integrityStatus: IntegrityStatus;
  existsOnChain?: boolean;
  isActiveOnChain?: boolean;
  mismatchReasons?: string[];
  error?: string;
}

export async function checkDisputeIntegrity(dispute: DisputeDoc): Promise<DisputeIntegrityItem> {
  const expectedRecordIdHash = id(dispute.recordId).toLowerCase();
  const latestBlockchainRef = dispute.onChainHistory?.at(-1)?.blockchainRef;

  const base: Omit<DisputeIntegrityItem, 'integrityStatus'> = {
    recordId: dispute.recordId,
    recordIdHash: expectedRecordIdHash,
    recordHash: dispute.recordHash,
    disputerIdHash: dispute.disputerIdHash,
    disputerId: dispute.disputerId,
    chainStatus: dispute.chainStatus,
    blockchainRef: latestBlockchainRef,
    onChainHistory: dispute.onChainHistory,
    severity: dispute.severity,
    culpability: dispute.culpability,
    createdAt: dispute.createdAt,
  };

  if (dispute.chainStatus === 'pending') return { ...base, integrityStatus: 'pending' };
  if (dispute.chainStatus === 'failed') return { ...base, integrityStatus: 'failed' };
  if (!dispute.recordHash || !dispute.disputerIdHash)
    return { ...base, integrityStatus: 'not_applicable' };

  try {
    const contract = getHealthContract();

    const [
      [exists, onChainRecordIdHash, onChainSeverity, onChainCulpability, , , isActive],
      hashIsActive,
    ] = await Promise.all([
      contract.getUserDispute(dispute.recordHash, dispute.disputerIdHash),
      contract.doesHashExist(dispute.recordHash),
    ]);

    if (!exists) return { ...base, integrityStatus: 'missing', existsOnChain: false };

    const mismatchReasons: string[] = [];

    if (!hashIsActive) {
      mismatchReasons.push('record hash retracted on-chain');
    }

    const onChainRecordIdHashNorm = (onChainRecordIdHash as string).toLowerCase();
    if (onChainRecordIdHashNorm !== expectedRecordIdHash) {
      mismatchReasons.push(
        `recordIdHash mismatch — on-chain: ${onChainRecordIdHashNorm.slice(0, 12)}…, expected: ${expectedRecordIdHash.slice(0, 12)}…`
      );
    }

    const onChainSeverityNum = Number(onChainSeverity);
    if (onChainSeverityNum !== dispute.severity) {
      mismatchReasons.push(
        `severity mismatch — on-chain: ${onChainSeverityNum}, firestore: ${dispute.severity}`
      );
    }

    const onChainCulpabilityNum = Number(onChainCulpability);
    if (onChainCulpabilityNum !== dispute.culpability) {
      mismatchReasons.push(
        `culpability mismatch — on-chain: ${onChainCulpabilityNum}, firestore: ${dispute.culpability}`
      );
    }

    if (!isActive) {
      mismatchReasons.push('dispute retracted on-chain');
    }

    const integrityStatus: IntegrityStatus = mismatchReasons.length > 0 ? 'mismatch' : 'synced';

    return {
      ...base,
      integrityStatus,
      existsOnChain: true,
      isActiveOnChain: !!isActive,
      ...(mismatchReasons.length > 0 && { mismatchReasons }),
    };
  } catch (error) {
    return { ...base, integrityStatus: 'failed', error: String(error) };
  }
}

// ============================================================================
// VOUCH INTEGRITY CHECK
// ============================================================================

export interface VouchIntegrityItem {
  vouchId: string;
  voucherId: string;
  voucherIdHash: string;
  voucheeId: string;
  voucheeIdHash: string;
  chainStatus: string;
  onChainHistory?: VouchOnChainEvent[];
  createdAt?: TimestampLike;
  integrityStatus: IntegrityStatus;
  existsOnChain?: boolean;
  isActiveOnChain?: boolean;
  mismatchReasons?: string[];
  error?: string;
}

export async function checkVouchIntegrity(vouch: VouchDoc): Promise<VouchIntegrityItem> {
  const base: Omit<VouchIntegrityItem, 'integrityStatus'> = {
    vouchId: vouch.id,
    voucherId: vouch.voucherId,
    voucherIdHash: vouch.voucherIdHash,
    voucheeId: vouch.voucheeId,
    voucheeIdHash: vouch.voucheeIdHash,
    chainStatus: vouch.chainStatus,
    onChainHistory: vouch.onChainHistory,
    createdAt: vouch.createdAt,
  };

  if (vouch.chainStatus === 'Pending') return { ...base, integrityStatus: 'pending' };
  if (vouch.chainStatus === 'Failed') return { ...base, integrityStatus: 'failed' };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isVouchedOnChain = (await (getMemberContract() as any).hasVouched(
      vouch.voucherIdHash,
      vouch.voucheeIdHash
    )) as boolean;

    const firestoreIsActive = vouch.chainStatus === 'Active';

    if (firestoreIsActive !== isVouchedOnChain) {
      return {
        ...base,
        integrityStatus: 'mismatch',
        existsOnChain: isVouchedOnChain,
        isActiveOnChain: isVouchedOnChain,
        mismatchReasons: [
          firestoreIsActive
            ? 'Firestore shows Active but not vouched on-chain'
            : 'Firestore shows Retracted but still vouched on-chain',
        ],
      };
    }

    return {
      ...base,
      integrityStatus: 'synced',
      existsOnChain: isVouchedOnChain,
      isActiveOnChain: isVouchedOnChain,
    };
  } catch (error) {
    return { ...base, integrityStatus: 'failed', error: String(error) };
  }
}
