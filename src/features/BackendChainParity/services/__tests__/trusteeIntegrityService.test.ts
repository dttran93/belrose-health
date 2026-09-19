// src/features/BackendChainParity/services/__tests__/trusteeIntegrityService.test.ts
//
// Unit tests for checkTrusteeIntegrity — pure orchestration logic over a mocked
// MemberRoleManager contract, no emulator/chain needed (mirrors
// recordHashIntegrityService.test.ts's pattern).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockContract = {
  getTrusteeRelationship: vi.fn(),
};

vi.mock('../../lib/contracts', () => ({
  getMemberContract: () => mockContract,
}));

import { checkTrusteeIntegrity } from '../trusteeIntegrityService';
import type { TrusteeRelationship } from '@/features/Trustee/services/trusteeRelationshipService';

function makeRelationship(
  overrides: Partial<TrusteeRelationship> = {}
): TrusteeRelationship & { id: string } {
  return {
    id: 'trustor-1_trustee-1',
    trustorId: 'trustor-1',
    trusteeId: 'trustee-1',
    trustLevel: 'observer',
    isActive: true,
    status: 'active',
    createdAt: null as any,
    respondedAt: null,
    revokedAt: null,
    revokedBy: null,
    statusUpdateReason: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('checkTrusteeIntegrity', () => {
  it('is not_applicable when the relationship was declined — the chain keeps a stale Pending proposal, expected not a bug', async () => {
    const rel = makeRelationship({ status: 'declined' });

    const result = await checkTrusteeIntegrity(rel, []);

    expect(result.integrityStatus).toBe('not_applicable');
    expect(mockContract.getTrusteeRelationship).not.toHaveBeenCalled();
  });

  it('is missing when on-chain status is None — the blockchain write never landed', async () => {
    mockContract.getTrusteeRelationship.mockResolvedValue([0n, 0n]); // None, Observer

    const result = await checkTrusteeIntegrity(makeRelationship({ status: 'pending' }), []);

    expect(result.integrityStatus).toBe('missing');
    expect(result.onChainStatus).toBe(0);
  });

  it('is synced when status and level both match on-chain', async () => {
    mockContract.getTrusteeRelationship.mockResolvedValue([2n, 2n]); // Active, Controller

    const result = await checkTrusteeIntegrity(
      makeRelationship({ status: 'active', trustLevel: 'controller' }),
      []
    );

    expect(result.integrityStatus).toBe('synced');
    expect(result.mismatchReasons).toBeUndefined();
  });

  it('is mismatch when the on-chain status does not match the expected status for the Firestore status', async () => {
    mockContract.getTrusteeRelationship.mockResolvedValue([1n, 0n]); // Pending, Observer

    const result = await checkTrusteeIntegrity(makeRelationship({ status: 'active' }), []);

    expect(result.integrityStatus).toBe('mismatch');
    expect(result.mismatchReasons).toEqual([
      expect.stringContaining('status mismatch'),
    ]);
  });

  it('is mismatch when trust level differs while both sides report active', async () => {
    mockContract.getTrusteeRelationship.mockResolvedValue([2n, 0n]); // Active, Observer

    const result = await checkTrusteeIntegrity(
      makeRelationship({ status: 'active', trustLevel: 'controller' }),
      []
    );

    expect(result.integrityStatus).toBe('mismatch');
    expect(result.mismatchReasons).toEqual([expect.stringContaining('level mismatch')]);
  });

  it('does not check trust level when the relationship is not active on both sides', async () => {
    // Revoked on both sides — level mismatch would otherwise fire here too, but the level check
    // is gated on status === 'active' on both sides, so it must be skipped entirely.
    mockContract.getTrusteeRelationship.mockResolvedValue([3n, 0n]); // Revoked, Observer

    const result = await checkTrusteeIntegrity(
      makeRelationship({ status: 'revoked', trustLevel: 'controller' }),
      []
    );

    expect(result.integrityStatus).toBe('synced');
  });

  it('carries the passed-in trusteeHistory through unchanged', async () => {
    mockContract.getTrusteeRelationship.mockResolvedValue([2n, 0n]);
    const history = [{ action: 'propose' } as any];

    const result = await checkTrusteeIntegrity(
      makeRelationship({ status: 'active', trustLevel: 'observer' }),
      history
    );

    expect(result.trusteeHistory).toBe(history);
  });

  it('returns failed with the error when the contract call throws unexpectedly', async () => {
    mockContract.getTrusteeRelationship.mockRejectedValue(new Error('RPC blew up'));

    const result = await checkTrusteeIntegrity(makeRelationship(), []);

    expect(result.integrityStatus).toBe('failed');
    expect(result.error).toContain('RPC blew up');
  });
});
