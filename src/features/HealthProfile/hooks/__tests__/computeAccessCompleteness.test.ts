// src/features/HealthProfile/hooks/__tests__/computeAccessCompleteness.test.ts
//
// Tier 1 — computeAccessCompleteness is useBlockchainCompleteness's pure access-matching
// function. Regression coverage for a real bug: on-chain, a subject's medical history is a
// list of recordIdHashes (keccak256(recordId)) — never the plaintext Firestore ID — so
// matching accessible records against it requires hashing each record's own ID first.
// Comparing raw Firestore IDs directly against the on-chain hashes (as an earlier version
// of this function did) silently matches nothing, no matter how many records are actually
// anchored and accessible.

import { describe, it, expect } from 'vitest';
import { id as hashId } from 'ethers';
import { computeAccessCompleteness } from '../useBlockchainCompleteness';
import { FileObject } from '@/types/core';

function record(id: string): FileObject {
  return { id } as FileObject;
}

describe('computeAccessCompleteness', () => {
  it('matches an accessible record whose hashed ID is on-chain', () => {
    const records = [record('recordA')];
    const onChainHashes = [hashId('recordA')];

    const result = computeAccessCompleteness(records, onChainHashes);

    expect(result.anchoredIds).toEqual(['recordA']);
    expect(result.accessibleCount).toBe(1);
    expect(result.anchoredCount).toBe(1);
    expect(result.privateCount).toBe(0);
  });

  it('never matches a raw Firestore ID directly against an on-chain hash (regression)', () => {
    // Firestore-style short IDs vs. real on-chain keccak256 hashes — structurally
    // nothing alike, so a raw-string comparison would always fail to match, even
    // though the record really is anchored (its *hash* is on-chain below).
    const records = [record('W2zTJR6ImuJdCQX46ktS')];
    const onChainHashes = [hashId('W2zTJR6ImuJdCQX46ktS')];

    const result = computeAccessCompleteness(records, onChainHashes);

    expect(result.anchoredIds).toEqual(['W2zTJR6ImuJdCQX46ktS']);
    expect(result.accessibleCount).toBe(1);
  });

  it('does not match a record whose hash is not on-chain', () => {
    const records = [record('recordA')];
    const onChainHashes = [hashId('someOtherRecord')];

    const result = computeAccessCompleteness(records, onChainHashes);

    expect(result.anchoredIds).toEqual([]);
    expect(result.accessibleCount).toBe(0);
    expect(result.anchoredCount).toBe(1);
    expect(result.privateCount).toBe(1);
  });

  it('counts on-chain hashes with no matching accessible record as private', () => {
    // Subject anchored 3 records; the viewer only has Firestore access to 1 of them.
    const records = [record('recordA')];
    const onChainHashes = [hashId('recordA'), hashId('recordB'), hashId('recordC')];

    const result = computeAccessCompleteness(records, onChainHashes);

    expect(result.anchoredIds).toEqual(['recordA']);
    expect(result.anchoredCount).toBe(3);
    expect(result.accessibleCount).toBe(1);
    expect(result.privateCount).toBe(2);
  });

  it('reports full access when every on-chain hash matches an accessible record', () => {
    const records = [record('recordA'), record('recordB')];
    const onChainHashes = [hashId('recordA'), hashId('recordB')];

    const result = computeAccessCompleteness(records, onChainHashes);

    expect(result.accessibleCount).toBe(2);
    expect(result.anchoredCount).toBe(2);
    expect(result.privateCount).toBe(0);
  });

  it('returns all zeros when nothing is anchored on-chain', () => {
    const records = [record('recordA'), record('recordB')];

    const result = computeAccessCompleteness(records, []);

    expect(result.anchoredIds).toEqual([]);
    expect(result.anchoredCount).toBe(0);
    expect(result.accessibleCount).toBe(0);
    expect(result.privateCount).toBe(0);
  });

  it('ignores accessible records with no id rather than throwing', () => {
    const records = [{ id: '' } as FileObject, record('recordA')];
    const onChainHashes = [hashId('recordA')];

    const result = computeAccessCompleteness(records, onChainHashes);

    expect(result.anchoredIds).toEqual(['recordA']);
    expect(result.accessibleCount).toBe(1);
  });

  it('ignores unrelated accessible records that are not anchored at all', () => {
    const records = [record('recordA'), record('recordB')];
    const onChainHashes = [hashId('recordA')];

    const result = computeAccessCompleteness(records, onChainHashes);

    expect(result.anchoredIds).toEqual(['recordA']);
    expect(result.accessibleCount).toBe(1);
    expect(result.anchoredCount).toBe(1);
    expect(result.privateCount).toBe(0);
  });
});
