// src/features/BackendChainParity/lib/__tests__/types.test.ts
//
// Unit tests for computeSummary — pure tally logic, no mocking needed.

import { describe, it, expect } from 'vitest';
import { computeSummary } from '../types';
import type { IntegrityStatus } from '../types';

function items(...statuses: IntegrityStatus[]) {
  return statuses.map(integrityStatus => ({ integrityStatus }));
}

describe('computeSummary', () => {
  it('returns all zeros for an empty array', () => {
    expect(computeSummary([])).toEqual({
      total: 0,
      synced: 0,
      mismatch: 0,
      missing: 0,
      chainOnly: 0,
      pending: 0,
      notApplicable: 0,
      failed: 0,
    });
  });

  it('tallies one of every status correctly', () => {
    const result = computeSummary(
      items('synced', 'mismatch', 'missing', 'chain_only', 'pending', 'not_applicable', 'failed')
    );

    expect(result).toEqual({
      total: 7,
      synced: 1,
      mismatch: 1,
      missing: 1,
      chainOnly: 1,
      pending: 1,
      notApplicable: 1,
      failed: 1,
    });
  });

  it('counts total from array length even when statuses repeat', () => {
    const result = computeSummary(items('synced', 'synced', 'synced'));

    expect(result.total).toBe(3);
    expect(result.synced).toBe(3);
  });

  it('silently ignores an unrecognized integrityStatus — no default case in the switch', () => {
    // Documents current behavior: total still reflects array length, but nothing else
    // increments for a status outside the known IntegrityStatus union.
    const result = computeSummary(items('synced' as IntegrityStatus, 'bogus' as IntegrityStatus));

    expect(result.total).toBe(2);
    expect(result.synced).toBe(1);
    expect(result.mismatch + result.missing + result.chainOnly + result.pending + result.notApplicable + result.failed).toBe(0);
  });
});
