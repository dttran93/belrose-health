// src/features/HealthProfile/hooks/__tests__/resolveStatus.test.ts
//
// Tier 1 — resolveHashStatus is useBlockchainCompleteness's pure hash-matching state
// machine (exported specifically to test in isolation). It only ever answers "does this
// record's hash match what's on-chain" — verification/dispute standing is out of scope
// (that lives in the credibility scoring system, see docs/Credibility.md). Covers every
// status outcome, the isLatestHash index check, and the newest-first previous-hash search.

import { describe, it, expect } from 'vitest';
import { resolveHashStatus } from '../useBlockchainCompleteness';

const RECORD_ID = 'record-1';

function run(
  currentHash: string | null | undefined,
  previousHashes: string[] | null | undefined,
  opts: {
    anchored?: boolean;
    onChainHashes?: string[];
  } = {}
) {
  const anchoredRecordIds = new Set(opts.anchored === false ? [] : [RECORD_ID]);
  const versionHistoryMap = new Map([[RECORD_ID, opts.onChainHashes ?? []]]);

  return resolveHashStatus(
    currentHash,
    previousHashes,
    RECORD_ID,
    anchoredRecordIds,
    versionHistoryMap
  );
}

describe('resolveHashStatus', () => {
  it('returns no_hash when there is no current hash', () => {
    expect(run(null, [])).toMatchObject({ status: 'no_hash', onChainHashes: [] });
    expect(run(undefined, [])).toMatchObject({ status: 'no_hash' });
  });

  it('returns not_anchored when the record is not in anchoredRecordIds', () => {
    const result = run('0xabc', [], { anchored: false });
    expect(result).toMatchObject({ status: 'not_anchored', onChainHashes: [] });
  });

  it('returns anchored_match when the current hash is found on-chain', () => {
    const result = run('0xabc', [], { onChainHashes: ['0xabc'] });
    expect(result).toMatchObject({ status: 'anchored_match', isLatestHash: true });
  });

  it('returns anchored_previous_version when the current hash is stale but an old one is on-chain', () => {
    const result = run('0xnew', ['0xold'], { onChainHashes: ['0xold'] });
    expect(result).toMatchObject({
      status: 'anchored_previous_version',
      matchedPreviousHash: '0xold',
    });
  });

  it('prefers the current hash over any on-chain previous hash', () => {
    const result = run('0xnew', ['0xold'], { onChainHashes: ['0xold', '0xnew'] });
    expect(result.status).toBe('anchored_match');
  });

  it('searches previous hashes newest-first and matches the most recent one found on-chain', () => {
    // previousRecordHash is chronological oldest->newest: ['0xA' (oldest), '0xB' (newer)].
    // Reversed iteration hits '0xB' first — it should win even though '0xA' is also on-chain.
    const result = run('0xcurrent-not-onchain', ['0xA', '0xB'], {
      onChainHashes: ['0xA', '0xB'],
    });
    expect(result).toMatchObject({ matchedPreviousHash: '0xB' });
  });

  it('falls back to an older previous hash when the newer one is not on-chain', () => {
    const result = run('0xcurrent-not-onchain', ['0xA', '0xB'], {
      onChainHashes: ['0xA'],
    });
    expect(result).toMatchObject({ matchedPreviousHash: '0xA' });
  });

  it('returns anchored_mismatch when the record is anchored but nothing on file matches on-chain', () => {
    const result = run('0xcurrent', ['0xold'], { onChainHashes: ['0xsomethingelse'] });
    expect(result).toMatchObject({ status: 'anchored_mismatch' });
  });

  it('sets isLatestHash based on position in onChainHashes (chain-append order)', () => {
    const latest = run('0xabc', [], { onChainHashes: ['0xold', '0xabc'] });
    expect(latest.isLatestHash).toBe(true);

    const notLatest = run('0xabc', [], { onChainHashes: ['0xabc', '0xnewer'] });
    expect(notLatest.isLatestHash).toBe(false);
  });

  it('filters out falsy entries from previousHashes before searching', () => {
    const result = run('0xcurrent-not-onchain', ['0xreal', null as any, undefined as any], {
      onChainHashes: ['0xreal'],
    });
    expect(result.matchedPreviousHash).toBe('0xreal');
  });
});
