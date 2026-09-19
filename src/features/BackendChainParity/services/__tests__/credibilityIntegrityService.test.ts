// src/features/BackendChainParity/services/__tests__/credibilityIntegrityService.test.ts
//
// Unit tests for checkVerificationIntegrity/checkDisputeIntegrity/checkVouchIntegrity — pure
// orchestration logic over mocked HealthRecordCore/MemberRoleManager contracts, no
// emulator/chain needed (mirrors recordHashIntegrityService.test.ts's pattern).
//
// One real gotcha pinned here: VerificationDoc/DisputeDoc.chainStatus is typed as
// 'pending' | 'confirmed' | 'failed' (lowercase), but VouchDoc.chainStatus is typed as
// 'None' | 'Pending' | 'Active' | 'Retracted' | 'Failed' (capitalized) — two different type
// definitions in packages/shared/src/credibility.ts, not just inconsistent string literals.
// checkVouchIntegrity must not be tested against the lowercase forms, and vice versa.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { id as ethersId } from 'ethers';

const mockContract = {
  getUserVerification: vi.fn(),
  getUserDispute: vi.fn(),
  doesHashExist: vi.fn(),
};

const mockMemberContract = {
  hasVouched: vi.fn(),
};

vi.mock('../../lib/contracts', () => ({
  getHealthContract: () => mockContract,
  getMemberContract: () => mockMemberContract,
}));

import {
  checkVerificationIntegrity,
  checkDisputeIntegrity,
  checkVouchIntegrity,
} from '../credibilityIntegrityService';
import type { VerificationDoc, DisputeDoc, VouchDoc } from '@belrose/shared';

function makeVerification(overrides: Partial<VerificationDoc> = {}): VerificationDoc {
  return {
    id: 'ver-1',
    recordIdHash: '0xRecordIdHash',
    recordHash: '0xRecordHash',
    recordId: 'record-1',
    verifierId: 'verifier-1',
    verifierIdHash: '0xVerifierIdHash',
    level: 3,
    isActive: true,
    createdAt: null as any,
    chainStatus: 'confirmed',
    onChainHistory: [],
    encryptedRecordTitleIv: 'iv',
    normalizedCredibilityAtCreation: 1,
    ...overrides,
  };
}

function makeDispute(overrides: Partial<DisputeDoc> = {}): DisputeDoc {
  return {
    id: 'dispute-1',
    recordHash: '0xRecordHash',
    recordId: 'record-1',
    recordIdHash: '0xRecordIdHash',
    disputerId: 'disputer-1',
    disputerIdHash: '0xDisputerIdHash',
    severity: 1,
    culpability: 1,
    notesHash: '0xNotesHash',
    isActive: true,
    createdAt: null as any,
    chainStatus: 'confirmed',
    onChainHistory: [],
    recordScoreAtCreation: 1,
    validationWeight: 0,
    normalizedCredibilityAtCreation: 1,
    ...overrides,
  };
}

function makeVouch(overrides: Partial<VouchDoc> = {}): VouchDoc {
  return {
    id: 'vouch-1',
    voucherId: 'voucher-1',
    voucherIdHash: '0xVoucherIdHash',
    voucheeId: 'vouchee-1',
    voucheeIdHash: '0xVoucheeIdHash',
    chainStatus: 'Active',
    createdAt: null as any,
    onChainHistory: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('checkVerificationIntegrity', () => {
  it('is pending when chainStatus is "pending" (lowercase) — never calls the chain', async () => {
    const ver = makeVerification({ chainStatus: 'pending' });

    const result = await checkVerificationIntegrity(ver);

    expect(result.integrityStatus).toBe('pending');
    expect(mockContract.getUserVerification).not.toHaveBeenCalled();
  });

  it('is failed when chainStatus is "failed" (lowercase) — never calls the chain', async () => {
    const ver = makeVerification({ chainStatus: 'failed' });

    const result = await checkVerificationIntegrity(ver);

    expect(result.integrityStatus).toBe('failed');
    expect(mockContract.getUserVerification).not.toHaveBeenCalled();
  });

  it('is missing when the verification does not exist on-chain', async () => {
    mockContract.getUserVerification.mockResolvedValue([false, '0x0', 0, 0n, false]);
    mockContract.doesHashExist.mockResolvedValue(true);

    const result = await checkVerificationIntegrity(makeVerification());

    expect(result.integrityStatus).toBe('missing');
    expect(result.existsOnChain).toBe(false);
  });

  it('is synced when everything matches on-chain', async () => {
    // recordIdHash is derived from recordId via ethers.id(), not from a stored field — the
    // mocked on-chain value must match that derivation, not an arbitrary placeholder.
    mockContract.getUserVerification.mockResolvedValue([
      true,
      ethersId('record-1'),
      3,
      0n,
      true,
    ]);
    mockContract.doesHashExist.mockResolvedValue(true);

    const result = await checkVerificationIntegrity(
      makeVerification({ recordId: 'record-1', level: 3 })
    );

    expect(result.integrityStatus).toBe('synced');
    expect(result.mismatchReasons).toBeUndefined();
  });

  it('accumulates multiple simultaneous mismatch reasons rather than reporting only the first', async () => {
    // Every one of the 4 independent checks fails at once: hash retracted, recordIdHash
    // mismatch, level mismatch, and retracted on-chain.
    mockContract.getUserVerification.mockResolvedValue([
      true,
      '0xSomeOtherRecordIdHash',
      1,
      0n,
      false,
    ]);
    mockContract.doesHashExist.mockResolvedValue(false);

    const result = await checkVerificationIntegrity(
      makeVerification({ recordId: 'record-1', level: 3 })
    );

    expect(result.integrityStatus).toBe('mismatch');
    expect(result.mismatchReasons).toHaveLength(4);
    expect(result.mismatchReasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('record hash retracted'),
        expect.stringContaining('recordIdHash mismatch'),
        expect.stringContaining('level mismatch'),
        expect.stringContaining('verification retracted'),
      ])
    );
  });

  it('returns failed with the error when the contract call throws unexpectedly', async () => {
    mockContract.getUserVerification.mockRejectedValue(new Error('RPC blew up'));

    const result = await checkVerificationIntegrity(makeVerification());

    expect(result.integrityStatus).toBe('failed');
    expect(result.error).toContain('RPC blew up');
  });
});

describe('checkDisputeIntegrity', () => {
  it('is pending when chainStatus is "pending" (lowercase) — never calls the chain', async () => {
    const dispute = makeDispute({ chainStatus: 'pending' });

    const result = await checkDisputeIntegrity(dispute);

    expect(result.integrityStatus).toBe('pending');
    expect(mockContract.getUserDispute).not.toHaveBeenCalled();
  });

  it('is failed when chainStatus is "failed" (lowercase) — never calls the chain', async () => {
    const dispute = makeDispute({ chainStatus: 'failed' });

    const result = await checkDisputeIntegrity(dispute);

    expect(result.integrityStatus).toBe('failed');
    expect(mockContract.getUserDispute).not.toHaveBeenCalled();
  });

  it('is not_applicable when recordHash is missing, without ever calling the chain', async () => {
    const dispute = makeDispute({ recordHash: undefined as any });

    const result = await checkDisputeIntegrity(dispute);

    expect(result.integrityStatus).toBe('not_applicable');
    expect(mockContract.getUserDispute).not.toHaveBeenCalled();
  });

  it('is not_applicable when disputerIdHash is missing, without ever calling the chain', async () => {
    const dispute = makeDispute({ disputerIdHash: undefined as any });

    const result = await checkDisputeIntegrity(dispute);

    expect(result.integrityStatus).toBe('not_applicable');
    expect(mockContract.getUserDispute).not.toHaveBeenCalled();
  });

  it('is missing when the dispute does not exist on-chain', async () => {
    mockContract.getUserDispute.mockResolvedValue([false, '0x0', 0, 0, 0n, 0n, false]);
    mockContract.doesHashExist.mockResolvedValue(true);

    const result = await checkDisputeIntegrity(makeDispute());

    expect(result.integrityStatus).toBe('missing');
    expect(result.existsOnChain).toBe(false);
  });

  it('is synced when everything matches on-chain', async () => {
    // recordIdHash is derived from recordId via ethers.id(), not from a stored field.
    mockContract.getUserDispute.mockResolvedValue([
      true,
      ethersId('record-1'),
      1,
      1,
      0n,
      0n,
      true,
    ]);
    mockContract.doesHashExist.mockResolvedValue(true);

    const result = await checkDisputeIntegrity(
      makeDispute({ recordId: 'record-1', severity: 1, culpability: 1 })
    );

    expect(result.integrityStatus).toBe('synced');
    expect(result.mismatchReasons).toBeUndefined();
  });

  it('accumulates multiple simultaneous mismatch reasons (hash retracted, recordIdHash, severity, culpability, retracted)', async () => {
    mockContract.getUserDispute.mockResolvedValue([
      true,
      '0xSomeOtherRecordIdHash',
      2,
      2,
      0n,
      0n,
      false,
    ]);
    mockContract.doesHashExist.mockResolvedValue(false);

    const result = await checkDisputeIntegrity(
      makeDispute({ recordId: 'record-1', severity: 1, culpability: 1 })
    );

    expect(result.integrityStatus).toBe('mismatch');
    expect(result.mismatchReasons).toHaveLength(5);
    expect(result.mismatchReasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('record hash retracted'),
        expect.stringContaining('recordIdHash mismatch'),
        expect.stringContaining('severity mismatch'),
        expect.stringContaining('culpability mismatch'),
        expect.stringContaining('dispute retracted'),
      ])
    );
  });

  it('returns failed with the error when the contract call throws unexpectedly', async () => {
    mockContract.getUserDispute.mockRejectedValue(new Error('RPC blew up'));

    const result = await checkDisputeIntegrity(makeDispute());

    expect(result.integrityStatus).toBe('failed');
    expect(result.error).toContain('RPC blew up');
  });
});

describe('checkVouchIntegrity', () => {
  it('is pending when chainStatus is "Pending" (capitalized) — never calls the chain', async () => {
    const vouch = makeVouch({ chainStatus: 'Pending' });

    const result = await checkVouchIntegrity(vouch);

    expect(result.integrityStatus).toBe('pending');
    expect(mockMemberContract.hasVouched).not.toHaveBeenCalled();
  });

  it('is failed when chainStatus is "Failed" (capitalized) — never calls the chain', async () => {
    const vouch = makeVouch({ chainStatus: 'Failed' });

    const result = await checkVouchIntegrity(vouch);

    expect(result.integrityStatus).toBe('failed');
    expect(mockMemberContract.hasVouched).not.toHaveBeenCalled();
  });

  it('is synced when Firestore Active matches an on-chain vouch', async () => {
    mockMemberContract.hasVouched.mockResolvedValue(true);

    const result = await checkVouchIntegrity(makeVouch({ chainStatus: 'Active' }));

    expect(result.integrityStatus).toBe('synced');
    expect(result.isActiveOnChain).toBe(true);
  });

  it('is synced when Firestore Retracted matches no on-chain vouch', async () => {
    mockMemberContract.hasVouched.mockResolvedValue(false);

    const result = await checkVouchIntegrity(makeVouch({ chainStatus: 'Retracted' }));

    expect(result.integrityStatus).toBe('synced');
    expect(result.isActiveOnChain).toBe(false);
  });

  it('is mismatch when Firestore shows Active but the chain shows not vouched', async () => {
    mockMemberContract.hasVouched.mockResolvedValue(false);

    const result = await checkVouchIntegrity(makeVouch({ chainStatus: 'Active' }));

    expect(result.integrityStatus).toBe('mismatch');
    expect(result.mismatchReasons).toEqual([
      'Firestore shows Active but not vouched on-chain',
    ]);
  });

  it('is mismatch when Firestore shows Retracted but the chain still shows vouched', async () => {
    mockMemberContract.hasVouched.mockResolvedValue(true);

    const result = await checkVouchIntegrity(makeVouch({ chainStatus: 'Retracted' }));

    expect(result.integrityStatus).toBe('mismatch');
    expect(result.mismatchReasons).toEqual([
      'Firestore shows Retracted but still vouched on-chain',
    ]);
  });

  it('returns failed with the error when the contract call throws unexpectedly', async () => {
    mockMemberContract.hasVouched.mockRejectedValue(new Error('RPC blew up'));

    const result = await checkVouchIntegrity(makeVouch());

    expect(result.integrityStatus).toBe('failed');
    expect(result.error).toContain('RPC blew up');
  });
});
