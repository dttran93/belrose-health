// src/features/HealthProfile/hooks/useBlockchainCompleteness.ts

/**
 * useBlockchainCompleteness
 *
 * Compares Firestore records against what the subject has anchored on-chain.
 *
 * TWO MODES:
 *
 * 1. Fast mode (default, runs automatically on load)
 *    Uses record.recordHash from Firestore. Quick, no compute.
 *    Catches accidental drift and server-side tampering where the hash
 *    field wasn't also updated. Sufficient for most use cases.
 *
 * 2. Verified mode (triggered by the user via recompute())
 *    Recomputes SHA-256 from live record content using RecordHashService.
 *    Provides full cryptographic guarantee — even a compromised server
 *    that updated both content AND the stored hash field will be caught.
 *    Sets lastVerifiedAt timestamp so the UI can show "Verified 2 mins ago".
 *
 * SUMMARY CATEGORIES:
 *   currentVerified  ✅  Current hash on-chain AND has an active verification
 *   traceable        🔵  A previous hash on-chain AND that hash has a verification
 *   flagged          ⚠️  Broken chain (mismatch) OR has an active dispute
 *   selfReported     ⬜  Never anchored, no hash, or anchored but no verification/dispute
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileObject } from '@/types/core';
import { blockchainHealthRecordService } from '@/features/CredibilityRecord/services/blockchainHealthRecordService';
import { RecordHashService } from '@/features/ViewEditRecord/services/generateRecordHash';
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
  /** True if the hash that matched on-chain has at least one active verification */
  hasVerification: boolean;
  /** True if the hash that matched on-chain has at least one active dispute */
  hasDispute: boolean;
}

export interface BlockchainCompletenessSummary {
  total: number;
  /** Current hash is on-chain AND has an active verification */
  currentVerified: number;
  /** A previous hash (not current) is on-chain AND has an active verification */
  traceable: number;
  /** Broken chain (mismatch) OR has an active dispute */
  flagged: number;
  /** Never anchored, no hash, or anchored but no verification or dispute */
  selfReported: number;
}

export interface PrivateRecordsSummary {
  total: number;
  verified: number;
  disputed: number;
  selfReported: number;
}

export interface UseBlockchainCompletenessReturn {
  results: RecordCompletenessResult[];
  summary: BlockchainCompletenessSummary;
  privateRecordsSummary: PrivateRecordsSummary;
  anchoredRecordIds: Set<string>;
  isLoading: boolean;
  isRecomputing: boolean;
  error: Error | null;
  isVerified: boolean;
  lastVerifiedAt: Date | null;
  recompute: () => Promise<void>;
}

// ============================================================================
// HELPER
// ============================================================================

export function resolveStatus(
  currentHash: string | null | undefined,
  previousHashes: string[] | null | undefined,
  recordId: string | undefined,
  anchoredRecordIds: Set<string>,
  versionHistoryMap: Map<string, string[]>,
  verificationStatsMap: Map<string, number>,
  disputeStatsMap: Map<string, number>
): Pick<
  RecordCompletenessResult,
  | 'status'
  | 'onChainHashes'
  | 'isLatestHash'
  | 'matchedPreviousHash'
  | 'hasVerification'
  | 'hasDispute'
> {
  if (!currentHash) {
    return {
      status: 'no_hash',
      onChainHashes: [],
      isLatestHash: false,
      hasVerification: false,
      hasDispute: false,
    };
  }

  const hash: string = currentHash;
  const isAnchored = recordId ? anchoredRecordIds.has(recordId) : false;

  if (!isAnchored) {
    return {
      status: 'not_anchored',
      onChainHashes: [],
      isLatestHash: false,
      hasVerification: false,
      hasDispute: false,
    };
  }

  const onChainHashes = recordId ? (versionHistoryMap.get(recordId) ?? []) : [];

  // Check current hash against chain
  const currentIndex = onChainHashes.indexOf(hash);
  const currentIsOnChain = currentIndex !== -1;
  const currentHasVerification = currentIsOnChain && (verificationStatsMap.get(hash) ?? 0) > 0;
  const currentHasDispute = currentIsOnChain && (disputeStatsMap.get(hash) ?? 0) > 0;

  // Check previous hashes against chain — newest first
  const prevHashes = (previousHashes ?? []).filter((h): h is string => !!h);
  let matchedPrevHash: string | undefined;
  let matchedPrevIndex = -1;
  let matchedPrevVerified = false;

  for (const prevHash of [...prevHashes].reverse()) {
    const prevIndex = onChainHashes.indexOf(prevHash);
    if (prevIndex !== -1) {
      const hasVer = (verificationStatsMap.get(prevHash) ?? 0) > 0;
      // Always take the first on-chain match, but upgrade if we find a verified one
      if (matchedPrevHash === undefined || (!matchedPrevVerified && hasVer)) {
        matchedPrevHash = prevHash;
        matchedPrevIndex = prevIndex;
        matchedPrevVerified = hasVer;
      }
      if (matchedPrevVerified) break;
    }
  }

  const prevHasVerification =
    matchedPrevHash !== undefined && (verificationStatsMap.get(matchedPrevHash) ?? 0) > 0;
  const prevHasDispute =
    matchedPrevHash !== undefined && (disputeStatsMap.get(matchedPrevHash) ?? 0) > 0;

  // Now decide status based on the full picture:

  // Current hash is on-chain and verified → currentVerified in summary
  if (currentIsOnChain && currentHasVerification) {
    return {
      status: 'anchored_match',
      onChainHashes,
      isLatestHash: currentIndex === onChainHashes.length - 1,
      hasVerification: true,
      hasDispute: currentHasDispute,
    };
  }

  // A previous hash is on-chain and verified → traceable in summary
  // (regardless of whether current hash is on-chain or not)
  if (prevHasVerification) {
    return {
      status: 'anchored_previous_version',
      onChainHashes,
      isLatestHash: matchedPrevIndex === onChainHashes.length - 1,
      matchedPreviousHash: matchedPrevHash,
      hasVerification: true,
      hasDispute: prevHasDispute,
    };
  }

  // Current hash is on-chain but unverified → selfReported in summary
  if (currentIsOnChain) {
    return {
      status: 'anchored_match',
      onChainHashes,
      isLatestHash: currentIndex === onChainHashes.length - 1,
      hasVerification: false,
      hasDispute: currentHasDispute,
    };
  }

  // A previous hash is on-chain but unverified → also selfReported in summary
  if (matchedPrevHash !== undefined) {
    return {
      status: 'anchored_previous_version',
      onChainHashes,
      isLatestHash: matchedPrevIndex === onChainHashes.length - 1,
      matchedPreviousHash: matchedPrevHash,
      hasVerification: false,
      hasDispute: prevHasDispute,
    };
  }

  // Anchored but nothing matches — broken chain → flagged in summary
  return {
    status: 'anchored_mismatch',
    onChainHashes,
    isLatestHash: false,
    hasVerification: false,
    hasDispute: false,
  };
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
  const [verificationStatsMap, setVerificationStatsMap] = useState<Map<string, number>>(new Map());
  const [disputeStatsMap, setDisputeStatsMap] = useState<Map<string, number>>(new Map());
  const [computedHashMap, setComputedHashMap] = useState<Map<string, string>>(new Map());

  const [isLoading, setIsLoading] = useState(true);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<Date | null>(null);
  const [privateRecordsSummary, setPrivateRecordsSummary] = useState<PrivateRecordsSummary>({
    total: 0,
    verified: 0,
    disputed: 0,
    selfReported: 0,
  });

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
      setIsVerified(false);
      setComputedHashMap(new Map());
      setVerificationStatsMap(new Map());
      setDisputeStatsMap(new Map());

      try {
        console.log(`⛓️ Fetching on-chain data for ${subjectFirebaseUid.slice(0, 8)}...`);

        const wallets = await BlockchainRoleManagerService.getWalletsForUser(subjectFirebaseUid);
        console.log('🔑 Registered wallets for user:', wallets);

        const onChainRecordIds: string[] =
          await blockchainHealthRecordService.getActiveSubjectMedicalHistory(subjectFirebaseUid);

        console.log(`📋 ${onChainRecordIds.length} anchored records on-chain`);
        setAnchoredRecordIds(new Set(onChainRecordIds));

        const firestoreIds = new Set(records.map(r => r.id).filter(Boolean) as string[]);
        const overlap = onChainRecordIds.filter(id => firestoreIds.has(id));

        // Fetch version history for all accessible anchored records
        const historyEntries = await Promise.all(
          overlap.map(async recordId => {
            const hashes = await blockchainHealthRecordService.getRecordVersionHistory(recordId);
            return [recordId, hashes] as [string, string[]];
          })
        );
        const newVersionHistoryMap = new Map(historyEntries);
        setVersionHistoryMap(newVersionHistoryMap);

        // Batch-fetch verification + dispute stats for every known hash in parallel
        const allHashes = [...newVersionHistoryMap.values()].flat();
        const [verificationEntries, disputeEntries] = await Promise.all([
          Promise.all(
            allHashes.map(async hash => {
              const stats = await blockchainHealthRecordService.getVerificationStats(hash);
              return [hash, stats.active] as [string, number];
            })
          ),
          Promise.all(
            allHashes.map(async hash => {
              const stats = await blockchainHealthRecordService.getDisputeStats(hash);
              return [hash, stats.active] as [string, number];
            })
          ),
        ]);
        setVerificationStatsMap(new Map(verificationEntries));
        setDisputeStatsMap(new Map(disputeEntries));

        console.log(`✅ Fetched credibility stats for ${allHashes.length} hashes`);

        // Private records = on-chain but not in viewer's accessible records
        const privateIds = onChainRecordIds.filter(id => !firestoreIds.has(id));

        if (privateIds.length > 0) {
          const privateStatsResults = await Promise.all(
            privateIds.map(async recordId => {
              const hashes = await blockchainHealthRecordService.getRecordVersionHistory(recordId);
              const currentHash = hashes[hashes.length - 1];
              if (!currentHash) return { verified: false, disputed: false };

              const [verStats, dispStats] = await Promise.all([
                blockchainHealthRecordService.getVerificationStats(currentHash),
                blockchainHealthRecordService.getDisputeStats(currentHash),
              ]);

              return { verified: verStats.active > 0, disputed: dispStats.active > 0 };
            })
          );

          setPrivateRecordsSummary({
            total: privateIds.length,
            verified: privateStatsResults.filter(r => r.verified).length,
            disputed: privateStatsResults.filter(r => r.disputed).length,
            selfReported: privateStatsResults.filter(r => !r.verified && !r.disputed).length,
          });
        } else {
          setPrivateRecordsSummary({ total: 0, verified: 0, disputed: 0, selfReported: 0 });
        }
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
  // RECOMPUTE
  // =========================================================================

  const recompute = useCallback(async () => {
    if (isRecomputing || records.length === 0) return;

    setIsRecomputing(true);
    setError(null);

    try {
      console.log(`🔐 Recomputing hashes for ${records.length} records...`);

      const hashEntries = await Promise.all(
        records
          .filter(r => r.id && !r.isEncrypted)
          .map(async record => {
            const hash = await RecordHashService.generateRecordHash(record);
            return [record.id!, hash] as [string, string];
          })
      );

      setComputedHashMap(new Map(hashEntries));
      setIsVerified(true);
      setLastVerifiedAt(new Date());
      console.log(`✅ Recomputed ${hashEntries.length} hashes`);
    } catch (err) {
      console.error('❌ Hash recomputation failed:', err);
      setError(err instanceof Error ? err : new Error('Failed to recompute hashes'));
    } finally {
      setIsRecomputing(false);
    }
  }, [records, isRecomputing]);

  // =========================================================================
  // RESULTS
  // =========================================================================

  const results = useMemo<RecordCompletenessResult[]>(() => {
    return records.map(record => {
      const hash: string | null | undefined =
        isVerified && record.id ? (computedHashMap.get(record.id) ?? null) : record.recordHash;

      const resolved = resolveStatus(
        hash,
        record.previousRecordHash,
        record.id,
        anchoredRecordIds,
        versionHistoryMap,
        verificationStatsMap,
        disputeStatsMap
      );

      return { record, ...resolved };
    });
  }, [
    records,
    isVerified,
    computedHashMap,
    anchoredRecordIds,
    versionHistoryMap,
    verificationStatsMap,
    disputeStatsMap,
  ]);

  // =========================================================================
  // SUMMARY
  // =========================================================================

  const summary = useMemo<BlockchainCompletenessSummary>(
    () => ({
      total: results.length,
      // Current hash on-chain AND verified — best case
      currentVerified: results.filter(
        r => r.status === 'anchored_match' && r.hasVerification && !r.hasDispute
      ).length,
      // A previous hash on-chain AND verified — edited since anchoring
      traceable: results.filter(
        r => r.status === 'anchored_previous_version' && r.hasVerification && !r.hasDispute
      ).length,
      // Broken chain OR has an active dispute (dispute takes priority over verification)
      flagged: results.filter(r => r.status === 'anchored_mismatch' || r.hasDispute).length,
      // Never anchored, no hash, or anchored but unverified
      selfReported: results.filter(
        r =>
          r.status === 'not_anchored' ||
          r.status === 'no_hash' ||
          (r.status === 'anchored_match' && !r.hasVerification && !r.hasDispute) ||
          (r.status === 'anchored_previous_version' && !r.hasVerification && !r.hasDispute)
      ).length,
    }),
    [results]
  );

  return {
    results,
    summary,
    privateRecordsSummary,
    anchoredRecordIds,
    isLoading,
    isRecomputing,
    error,
    isVerified,
    lastVerifiedAt,
    recompute,
  };
}

export default useBlockchainCompleteness;
