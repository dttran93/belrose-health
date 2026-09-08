// src/features/BackendChainParity/services/__tests__/recordHashIntegrityService.test.ts
//
// Unit tests for checkRecordHashIntegrity — pure orchestration logic over a mocked
// HealthRecordCore contract, no emulator/chain needed. This function had three separate
// correctness bugs found by hand during manual QA (a dead not_applicable guard, a recordId-
// vs-hash scoping bug, a subject-side approximation) before this suite existed — these tests
// lock in the fixed behavior.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockContract = {
  getRecordIdForHash: vi.fn(),
  getRecordVersionHistory: vi.fn(),
  doesHashExist: vi.fn(),
};

vi.mock('../../lib/contracts', () => ({
  getHealthContract: () => mockContract,
}));

import { checkRecordHashIntegrity } from '../recordHashIntegrityService';
import type { FileObject } from '@/types/core';

function makeRecord(overrides: Partial<FileObject> = {}): FileObject {
  return {
    id: 'record-1',
    recordHash: '0xCurrentHash',
    ...overrides,
  } as unknown as FileObject;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('checkRecordHashIntegrity', () => {
  describe('no recordHash at all', () => {
    it('is always not_applicable — nothing to anchor, regardless of hashesEverAnchored', async () => {
      const record = makeRecord({ recordHash: undefined });

      const result = await checkRecordHashIntegrity(record, new Set(['0xsomethingelse']));

      expect(result.integrityStatus).toBe('not_applicable');
      expect(result.backendHashes).toEqual([]);
      expect(mockContract.getRecordIdForHash).not.toHaveBeenCalled();
    });
  });

  describe('hash not found on chain (getRecordIdForHash reverts)', () => {
    beforeEach(() => {
      mockContract.getRecordIdForHash.mockRejectedValue(new Error('revert'));
    });

    it('is not_applicable when nothing ever attempted to anchor this hash', async () => {
      const record = makeRecord();

      const result = await checkRecordHashIntegrity(record, new Set());

      expect(result.integrityStatus).toBe('not_applicable');
      expect(result.hashExistsOnChain).toBe(false);
    });

    it('is missing when an anchor was attempted for this exact hash but it never landed on chain', async () => {
      const record = makeRecord({ recordHash: '0xCurrentHash' });

      // hashesEverAnchored is lowercased at the source (useRecordsWithCredibility) — the
      // service does its own .toLowerCase() on the lookup key, so this proves case-insensitivity.
      const result = await checkRecordHashIntegrity(record, new Set(['0xcurrenthash']));

      expect(result.integrityStatus).toBe('missing');
      expect(result.hashExistsOnChain).toBe(false);
    });

    it('does not count an anchor attempt against a different (e.g. previous) hash as covering the current one', async () => {
      const record = makeRecord({
        recordHash: '0xCurrentHash',
        previousRecordHash: ['0xOldHash'],
      });

      const result = await checkRecordHashIntegrity(record, new Set(['0xoldhash']));

      expect(result.integrityStatus).toBe('not_applicable');
    });
  });

  describe('recordIdHash mismatch', () => {
    it('is mismatch when the hash resolves to a different record on-chain', async () => {
      mockContract.getRecordIdForHash.mockResolvedValue('0xSomeOtherRecordIdHash');
      const record = makeRecord({ recordIdHash: '0xThisRecordIdHash' });

      const result = await checkRecordHashIntegrity(record, new Set());

      expect(result.integrityStatus).toBe('mismatch');
      expect(result.hashExistsOnChain).toBe(true);
    });
  });

  describe('full comparison path (hash resolves to the correct record)', () => {
    it('is synced when the only backend hash is active on-chain', async () => {
      const record = makeRecord({ recordIdHash: '0xRid', recordHash: '0xHashA' });
      mockContract.getRecordIdForHash.mockResolvedValue('0xRid');
      mockContract.getRecordVersionHistory.mockResolvedValue(['0xHashA']);
      mockContract.doesHashExist.mockResolvedValue(true);

      const result = await checkRecordHashIntegrity(record, new Set());

      expect(result.integrityStatus).toBe('synced');
      expect(result.hashComparisons).toEqual([
        { hash: '0xhasha', isCurrentHash: true, isActiveOnChain: true, syncStatus: 'active_sync' },
      ]);
    });

    it('is missing when a backend hash (e.g. an old previousRecordHash) is not active on-chain', async () => {
      const record = makeRecord({
        recordIdHash: '0xRid',
        recordHash: '0xHashA',
        previousRecordHash: ['0xHashB'],
      });
      mockContract.getRecordIdForHash.mockResolvedValue('0xRid');
      mockContract.getRecordVersionHistory.mockResolvedValue(['0xHashA', '0xHashB']);
      mockContract.doesHashExist.mockImplementation(async (h: string) => h === '0xhasha');

      const result = await checkRecordHashIntegrity(record, new Set());

      expect(result.integrityStatus).toBe('missing');
    });

    it('is mismatch when an on-chain hash has no backend counterpart', async () => {
      const record = makeRecord({ recordIdHash: '0xRid', recordHash: '0xHashA' });
      mockContract.getRecordIdForHash.mockResolvedValue('0xRid');
      mockContract.getRecordVersionHistory.mockResolvedValue(['0xHashA', '0xHashOnChainOnly']);
      mockContract.doesHashExist.mockResolvedValue(true);

      const result = await checkRecordHashIntegrity(record, new Set());

      expect(result.integrityStatus).toBe('mismatch');
      expect(result.hashComparisons.find(c => c.hash === '0xhashonchainonly')).toMatchObject({
        syncStatus: 'missing_from_backend',
      });
    });

    it('prioritizes mismatch over missing when both a chain-only and a backend-only-inactive hash exist', async () => {
      const record = makeRecord({
        recordIdHash: '0xRid',
        recordHash: '0xHashA',
        previousRecordHash: ['0xHashB'], // never appears on-chain -> missing_from_chain
      });
      mockContract.getRecordIdForHash.mockResolvedValue('0xRid');
      mockContract.getRecordVersionHistory.mockResolvedValue(['0xHashA', '0xHashOnChainOnly']);
      mockContract.doesHashExist.mockImplementation(
        async (h: string) => h === '0xhasha' || h === '0xhashonchainonly'
      );

      const result = await checkRecordHashIntegrity(record, new Set());

      expect(result.integrityStatus).toBe('mismatch');
    });

    it('marks a retired, backend-unreferenced on-chain hash as removed_sync — both sides agree it is gone', async () => {
      const record = makeRecord({ recordIdHash: '0xRid', recordHash: '0xHashA' });
      mockContract.getRecordIdForHash.mockResolvedValue('0xRid');
      mockContract.getRecordVersionHistory.mockResolvedValue(['0xHashA', '0xRetiredHash']);
      mockContract.doesHashExist.mockImplementation(async (h: string) => h === '0xhasha');

      const result = await checkRecordHashIntegrity(record, new Set());

      expect(result.hashComparisons.find(c => c.hash === '0xretiredhash')).toMatchObject({
        syncStatus: 'removed_sync',
        isActiveOnChain: false,
      });
      expect(result.integrityStatus).toBe('synced');
    });
  });

  describe('unexpected errors', () => {
    it('returns a failed status carrying the error when a downstream contract call throws unexpectedly', async () => {
      mockContract.getRecordIdForHash.mockResolvedValue('0xRid');
      mockContract.getRecordVersionHistory.mockRejectedValue(new Error('RPC blew up'));
      const record = makeRecord({ recordIdHash: '0xRid' });

      const result = await checkRecordHashIntegrity(record, new Set());

      expect(result.integrityStatus).toBe('failed');
      expect(result.error).toContain('RPC blew up');
    });
  });

  describe('recordIdHash resolution', () => {
    it('derives recordIdHash from the Firestore doc id when record.recordIdHash is absent', async () => {
      mockContract.getRecordIdForHash.mockRejectedValue(new Error('not found'));
      const record = makeRecord({ id: 'my-record-id', recordIdHash: undefined });

      const result = await checkRecordHashIntegrity(record, new Set());

      expect(result.recordIdHash).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });
});
