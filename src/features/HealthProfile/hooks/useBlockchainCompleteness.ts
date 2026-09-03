// src/features/HealthProfile/hooks/useBlockchainCompleteness.ts

/**
 * useBlockchainCompleteness
 *
 * Compares Firestore records against what the subject has anchored on-chain.
 * Answers two questions, deliberately kept separate:
 *
 * 1. ACCESS COMPLETENESS — does the viewer have access to all the records
 *    the subject has anchored on-chain? (`anchoredCount` / `accessibleCount` /
 *    `privateCount`). This is the only "completeness" signal this hook produces.
 *
 * 2. HASH-CHAIN TRACEABILITY (per record, `RecordCompletenessResult.status`) —
 *    does the record's current (or a previous) hash match what's on-chain, i.e.
 *    has its content drifted from what was anchored? This is a fidelity signal,
 *    not a trust signal.
 *
 * What this hook does NOT do: judge whether a record's content is credible.
 * That's the credibility scoring system (see docs/Credibility.md) —
 * `record.credibility.score`, shown via `CredibilityBadge` — driven by
 * verifications/disputes weighted by verifier credibility. This hook used to
 * approximate that with on-chain verification/dispute presence checks; that
 * logic has been removed in favor of the real score.
 *
 */

import { useEffect, useMemo, useState } from 'react';
import { id as hashId } from 'ethers';
import { FileObject } from '@/types/core';
import { blockchainHealthRecordService } from '@/features/CredibilityRecord/services/blockchainHealthRecordService';
import { BlockchainRoleManagerService } from '@/features/Permissions/services/blockchainRoleManagerService';

// ============================================================================
// TYPES
// ============================================================================

export type RecordBlockchainStatus =
  | 'anchored_match' // ✅ Current hash found on-chain
  | 'anchored_previous_version' // 🔵 A previous hash found on-chain — edited since anchoring
  | 'anchored_mismatch' // ⚠️ On-chain but no version matches — broken chain
  | 'not_anchored' // ⬜ Not found in subject's on-chain medical history
  | 'no_hash'; // ℹ️ No hash available to compare

export interface RecordCompletenessResult {
  record: FileObject;
  status: RecordBlockchainStatus;
  /** All hashes stored on-chain for this recordId (empty if not anchored) */
  onChainHashes: string[];
  /**
   * True if the matched hash is the last entry in onChainHashes.
   * The contract appends new hashes, so last = most recent anchored version.
   */
  isLatestHash: boolean;
  /**
   * For 'anchored_previous_version': the specific previous hash that matched on-chain.
   */
  matchedPreviousHash?: string;
}

export interface UseBlockchainCompletenessReturn {
  results: RecordCompletenessResult[];
  /** Total records the subject has anchored on-chain (accessible + private) */
  anchoredCount: number;
  /** Of those anchored records, how many the viewer can access */
  accessibleCount: number;
  /** Anchored records the viewer cannot access (anchoredCount - accessibleCount) */
  privateCount: number;
  /**
   * Firestore record IDs (raw, not hashed) of accessible records confirmed anchored
   * on-chain. Necessarily scoped to accessible records — the contract only ever stores
   * keccak256(recordId), never the plaintext ID, so there's no way to know which Firestore
   * record a *private* on-chain hash corresponds to.
   */
  anchoredRecordIds: Set<string>;
  isLoading: boolean;
  error: Error | null;
}

// ============================================================================
// HELPER
// ============================================================================

export function resolveHashStatus(
  currentHash: string | null | undefined,
  previousHashes: string[] | null | undefined,
  recordId: string | undefined,
  anchoredRecordIds: Set<string>,
  versionHistoryMap: Map<string, string[]>
): Pick<
  RecordCompletenessResult,
  'status' | 'onChainHashes' | 'isLatestHash' | 'matchedPreviousHash'
> {
  if (!currentHash) {
    return { status: 'no_hash', onChainHashes: [], isLatestHash: false };
  }

  const isAnchored = recordId ? anchoredRecordIds.has(recordId) : false;

  if (!isAnchored) {
    return { status: 'not_anchored', onChainHashes: [], isLatestHash: false };
  }

  const onChainHashes = recordId ? (versionHistoryMap.get(recordId) ?? []) : [];

  // Current hash on-chain?
  const currentIndex = onChainHashes.indexOf(currentHash);
  if (currentIndex !== -1) {
    return {
      status: 'anchored_match',
      onChainHashes,
      isLatestHash: currentIndex === onChainHashes.length - 1,
    };
  }

  // Fall back to previous hashes, newest first — first on-chain match wins.
  const prevHashes = (previousHashes ?? []).filter((h): h is string => !!h);
  for (const prevHash of [...prevHashes].reverse()) {
    const prevIndex = onChainHashes.indexOf(prevHash);
    if (prevIndex !== -1) {
      return {
        status: 'anchored_previous_version',
        onChainHashes,
        isLatestHash: prevIndex === onChainHashes.length - 1,
        matchedPreviousHash: prevHash,
      };
    }
  }

  // Anchored but nothing on file matches on-chain — broken chain.
  return { status: 'anchored_mismatch', onChainHashes, isLatestHash: false };
}

// ============================================================================
// HOOK
// ============================================================================

export function useBlockchainCompleteness(
  subjectFirebaseUid: string,
  records: FileObject[]
): UseBlockchainCompletenessReturn {
  const [anchoredRecordIds, setAnchoredRecordIds] = useState<Set<string>>(new Set());
  const [versionHistoryMap, setVersionHistoryMap] = useState<Map<string, string[]>>(new Map());
  const [accessibleCount, setAccessibleCount] = useState(0);
  const [privateCount, setPrivateCount] = useState(0);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // =========================================================================
  // INITIAL LOAD
  // =========================================================================

  useEffect(() => {
    if (!subjectFirebaseUid || records.length === 0) {
      setIsLoading(false);
      return;
    }

    const fetchChainData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        console.log(`⛓️ Fetching on-chain data for ${subjectFirebaseUid.slice(0, 8)}...`);

        const wallets = await BlockchainRoleManagerService.getWalletsForUser(subjectFirebaseUid);
        console.log(`🔑 ${wallets.length} registered wallet(s) for user`);

        // On-chain, a subject's medical history is a list of recordIdHashes
        // (keccak256(recordId)) — the contract never learns the plaintext Firestore ID.
        // So the only way to tell whether a *specific* Firestore record is anchored is
        // to hash that record's own ID and check it against this set, not to compare
        // raw IDs against the on-chain values directly.
        const onChainHashes: string[] =
          await blockchainHealthRecordService.getActiveSubjectMedicalHistory(subjectFirebaseUid);
        const onChainHashSet = new Set(onChainHashes);

        console.log(`📋 ${onChainHashes.length} anchored records on-chain`);

        const anchoredIds = records
          .filter(r => r.id && onChainHashSet.has(hashId(r.id)))
          .map(r => r.id!);

        setAnchoredRecordIds(new Set(anchoredIds));
        setAccessibleCount(anchoredIds.length);
        setPrivateCount(onChainHashes.length - anchoredIds.length);

        // Fetch version history for accessible anchored records, keyed by raw Firestore
        // ID (getRecordVersionHistory hashes it internally) so resolveHashStatus can look
        // it up the same way.
        const historyEntries = await Promise.all(
          anchoredIds.map(async recordId => {
            const hashes = await blockchainHealthRecordService.getRecordVersionHistory(recordId);
            return [recordId, hashes] as [string, string[]];
          })
        );
        setVersionHistoryMap(new Map(historyEntries));
      } catch (err) {
        console.error('❌ Chain fetch failed:', err);
        setError(err instanceof Error ? err : new Error('Failed to fetch blockchain data'));
      } finally {
        setIsLoading(false);
      }
    };

    fetchChainData();
  }, [subjectFirebaseUid, records.length]);

  // =========================================================================
  // RESULTS
  // =========================================================================

  const results = useMemo<RecordCompletenessResult[]>(() => {
    return records.map(record => {
      const resolved = resolveHashStatus(
        record.recordHash,
        record.previousRecordHash,
        record.id,
        anchoredRecordIds,
        versionHistoryMap
      );

      return { record, ...resolved };
    });
  }, [records, anchoredRecordIds, versionHistoryMap]);

  return {
    results,
    anchoredCount: anchoredRecordIds.size,
    accessibleCount,
    privateCount,
    anchoredRecordIds,
    isLoading,
    error,
  };
}

export default useBlockchainCompleteness;
