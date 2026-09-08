// src/features/BackendChainParity/services/recordHashIntegrityService.ts

import { id } from 'ethers';
import type { HashComparison, IntegrityStatus } from '../lib/types';
import { getHealthContract } from '../lib/contracts';
import { FileObject } from '@/types/core';

export interface RecordHashIntegrityItem {
  firestoreId: string;
  recordHash: string | null;
  recordIdHash: string;
  backendHashes: string[];
  onChainHashes: string[];
  activeOnChainHashes: string[];
  hashComparisons: HashComparison[];
  integrityStatus: IntegrityStatus;
  hashExistsOnChain?: boolean;
  error?: string;
}

export async function checkRecordHashIntegrity(
  record: FileObject,
  hashesEverAnchored: Set<string> = new Set()
): Promise<RecordHashIntegrityItem> {
  const currentHash = record.recordHash?.toLowerCase();
  const backendHashes: string[] = [
    ...(currentHash ? [currentHash] : []),
    ...(record.previousRecordHash ?? []).map(h => h.toLowerCase()),
  ];

  // Pre-populate backend hashes as missing_from_chain so every early-return
  // path still surfaces them in the UI.
  const initialHashComparisons: HashComparison[] = backendHashes.map(hash => ({
    hash,
    isCurrentHash: hash === currentHash,
    isActiveOnChain: false,
    syncStatus: 'missing_from_chain' as const,
  }));

  const resolvedRecordIdHash = record.recordIdHash ?? id(record.id);

  // A hash only ever gets anchored on-chain as a side effect of a subject anchor
  // (anchorRecord) or a credibility prepare step ahead of a verification/dispute
  // (addRecordHash) — never from a permission grant, and never automatically on
  // version save. hashesEverAnchored (records/{id}/recordHashHistory, unioned with every
  // verification/dispute doc's own recordHash for historical completeness — see
  // useRecordsWithCredibility.ts) is the precise, per-hash record of whether *this exact*
  // hash was ever the target of one of those. If it never was, staying unanchored is the
  // expected, permanent state (deliberate, to minimize on-chain writes), not a sync
  // failure. Mirrors the equivalent not_applicable gate in recordSubjectIntegrityService.
  //
  // One narrow gap: recordHashHistory only exists going forward from when this collection
  // shipped, so a hash whose anchoring attempt failed on-chain *before* that (and thus has
  // no verification/dispute doc either) will read as not_applicable instead of missing —
  // self-resolving as old failed attempts get retried/reconciled.
  const isNotApplicable = !currentHash || !hashesEverAnchored.has(currentHash);

  const base: Omit<RecordHashIntegrityItem, 'integrityStatus'> = {
    firestoreId: record.id,
    recordHash: record.recordHash ?? null,
    recordIdHash: resolvedRecordIdHash,
    backendHashes,
    onChainHashes: [],
    activeOnChainHashes: [],
    hashComparisons: initialHashComparisons,
  };

  // Can't do a chain existence/consistency check without a current record hash.
  if (!record.recordHash) {
    return { ...base, integrityStatus: isNotApplicable ? 'not_applicable' : 'missing' };
  }

  try {
    const contract = getHealthContract();

    // getRecordIdForHash reverts if the hash is not active on-chain.
    let returnedRecordIdHash: string;
    try {
      returnedRecordIdHash = await contract.getRecordIdForHash(record.recordHash);
    } catch {
      // Hash not on-chain. If nothing ever triggered anchoring for this record, that's
      // expected (not_applicable), not a failure.
      return {
        ...base,
        integrityStatus: isNotApplicable ? 'not_applicable' : 'missing',
        hashExistsOnChain: false,
      };
    }

    if (returnedRecordIdHash.toLowerCase() !== resolvedRecordIdHash.toLowerCase()) {
      return { ...base, integrityStatus: 'mismatch', hashExistsOnChain: true };
    }

    const rawOnChainHashes: string[] = await contract.getRecordVersionHistory(resolvedRecordIdHash);
    const onChainHashes = rawOnChainHashes.map(h => h.toLowerCase());

    const hashActiveResults = await Promise.all(
      onChainHashes.map(async hash => ({
        hash,
        isActive: (await contract.doesHashExist(hash)) as boolean,
      }))
    );
    const hashActiveMap = new Map(hashActiveResults.map(r => [r.hash, r.isActive]));
    const activeOnChainHashes = hashActiveResults.filter(r => r.isActive).map(r => r.hash);

    // ── Hash comparisons ─────────────────────────────────────────────────────
    const hashComparisons: HashComparison[] = [];
    const processedHashValues = new Set<string>();

    for (const hash of backendHashes) {
      processedHashValues.add(hash);
      const isActiveOnChain = hashActiveMap.get(hash) ?? false;
      hashComparisons.push({
        hash,
        isCurrentHash: hash === currentHash,
        isActiveOnChain,
        syncStatus: isActiveOnChain ? 'active_sync' : 'missing_from_chain',
      });
    }

    for (const hash of onChainHashes) {
      if (!processedHashValues.has(hash)) {
        const isActiveOnChain = hashActiveMap.get(hash) ?? false;
        hashComparisons.push({
          hash,
          isCurrentHash: false,
          isActiveOnChain,
          syncStatus: isActiveOnChain ? 'missing_from_backend' : 'removed_sync',
        });
      }
    }

    let integrityStatus: IntegrityStatus;
    if (hashComparisons.some(h => h.syncStatus === 'missing_from_backend')) {
      integrityStatus = 'mismatch';
    } else if (hashComparisons.some(h => h.syncStatus === 'missing_from_chain')) {
      integrityStatus = 'missing';
    } else {
      integrityStatus = 'synced';
    }

    return {
      ...base,
      onChainHashes,
      activeOnChainHashes,
      hashComparisons,
      integrityStatus,
      hashExistsOnChain: true,
    };
  } catch (error) {
    return { ...base, integrityStatus: 'failed', error: String(error) };
  }
}
