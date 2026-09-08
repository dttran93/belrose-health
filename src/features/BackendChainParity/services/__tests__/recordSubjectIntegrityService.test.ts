// src/features/BackendChainParity/services/__tests__/recordSubjectIntegrityService.test.ts
//
// Unit tests for checkRecordSubjectIntegrity — pure orchestration logic over a mocked
// HealthRecordCore contract, no emulator/chain needed. Mirrors
// recordHashIntegrityService.test.ts's structure, since the two services share the same
// four-status comparison shape (active_sync / missing_from_chain / missing_from_backend /
// removed_sync) and status-derivation priority.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { id as ethersId } from 'ethers';

const mockContract = {
  getRecordSubjects: vi.fn(),
  isActiveSubject: vi.fn(),
};

vi.mock('../../lib/contracts', () => ({
  getHealthContract: () => mockContract,
}));

import { checkRecordSubjectIntegrity } from '../recordSubjectIntegrityService';
import type { FileObject } from '@/types/core';

function makeRecord(overrides: Partial<FileObject> = {}): FileObject {
  return {
    id: 'record-1',
    ...overrides,
  } as unknown as FileObject;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('checkRecordSubjectIntegrity', () => {
  it('is not_applicable when there are no backend subjects and no on-chain subjects', async () => {
    mockContract.getRecordSubjects.mockResolvedValue([]);
    const record = makeRecord({ subjects: [] });

    const result = await checkRecordSubjectIntegrity(record);

    expect(result.integrityStatus).toBe('not_applicable');
    expect(mockContract.isActiveSubject).not.toHaveBeenCalled();
  });

  it('is synced when the only backend subject is active on-chain', async () => {
    const userIdHash = ethersId('alice-uid').toLowerCase();
    mockContract.getRecordSubjects.mockResolvedValue([userIdHash]);
    mockContract.isActiveSubject.mockResolvedValue(true);
    const record = makeRecord({ subjects: ['alice-uid'] });

    const result = await checkRecordSubjectIntegrity(record);

    expect(result.integrityStatus).toBe('synced');
    expect(result.subjectComparisons).toEqual([
      { uid: 'alice-uid', userIdHash, isActiveOnChain: true, syncStatus: 'active_sync' },
    ]);
  });

  it('is missing when a backend subject is not active on-chain', async () => {
    const userIdHash = ethersId('alice-uid').toLowerCase();
    // Subject was never anchored, so getRecordSubjects doesn't even return their hash.
    mockContract.getRecordSubjects.mockResolvedValue([]);
    const record = makeRecord({ subjects: ['alice-uid'] });

    const result = await checkRecordSubjectIntegrity(record);

    expect(result.integrityStatus).toBe('missing');
    expect(result.subjectComparisons).toEqual([
      { uid: 'alice-uid', userIdHash, isActiveOnChain: false, syncStatus: 'missing_from_chain' },
    ]);
  });

  it('is mismatch when an active on-chain subject has no backend counterpart', async () => {
    const chainOnlyHash = ethersId('bob-uid').toLowerCase();
    mockContract.getRecordSubjects.mockResolvedValue([chainOnlyHash]);
    mockContract.isActiveSubject.mockResolvedValue(true);
    const record = makeRecord({ subjects: [] });

    const result = await checkRecordSubjectIntegrity(record);

    expect(result.integrityStatus).toBe('mismatch');
    expect(result.subjectComparisons).toEqual([
      {
        userIdHash: chainOnlyHash,
        isActiveOnChain: true,
        syncStatus: 'missing_from_backend',
      },
    ]);
  });

  it('marks a retired, backend-unreferenced on-chain subject as removed_sync — both sides agree they are gone', async () => {
    const retiredHash = ethersId('carol-uid').toLowerCase();
    mockContract.getRecordSubjects.mockResolvedValue([retiredHash]);
    mockContract.isActiveSubject.mockResolvedValue(false);
    const record = makeRecord({ subjects: [] });

    const result = await checkRecordSubjectIntegrity(record);

    // Not not_applicable — onChainSubjects is non-empty even though it's inactive/retired.
    expect(result.integrityStatus).toBe('synced');
    expect(result.subjectComparisons).toEqual([
      { userIdHash: retiredHash, isActiveOnChain: false, syncStatus: 'removed_sync' },
    ]);
  });

  it('prioritizes mismatch over missing when both a chain-only and a backend-only-inactive subject exist', async () => {
    const chainOnlyHash = ethersId('bob-uid').toLowerCase();
    // alice-uid (backend) never appears on-chain at all -> missing_from_chain
    mockContract.getRecordSubjects.mockResolvedValue([chainOnlyHash]);
    mockContract.isActiveSubject.mockResolvedValue(true);
    const record = makeRecord({ subjects: ['alice-uid'] });

    const result = await checkRecordSubjectIntegrity(record);

    expect(result.integrityStatus).toBe('mismatch');
  });

  it('returns a failed status carrying the error when the contract call throws unexpectedly', async () => {
    mockContract.getRecordSubjects.mockRejectedValue(new Error('RPC blew up'));
    const record = makeRecord({ subjects: ['alice-uid'] });

    const result = await checkRecordSubjectIntegrity(record);

    expect(result.integrityStatus).toBe('failed');
    expect(result.error).toContain('RPC blew up');
    // Pre-populated so the UI still shows the backend subject even on a hard failure.
    expect(result.subjectComparisons).toEqual([
      {
        uid: 'alice-uid',
        userIdHash: ethersId('alice-uid').toLowerCase(),
        isActiveOnChain: false,
        syncStatus: 'missing_from_chain',
      },
    ]);
  });

  it('derives recordIdHash from the Firestore doc id when record.recordIdHash is absent', async () => {
    mockContract.getRecordSubjects.mockResolvedValue([]);
    const record = makeRecord({ id: 'my-record-id', recordIdHash: undefined, subjects: [] });

    const result = await checkRecordSubjectIntegrity(record);

    expect(result.recordIdHash).toBe(ethersId('my-record-id'));
  });
});
