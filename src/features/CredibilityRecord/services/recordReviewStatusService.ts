// src/features/CredibilityRecord/services/recordReviewStatusService.ts

/**
 * Aggregates a user's review activity (verifications, disputes)
 * for a single record, including whether each review is current or stale
 * relative to the record's current content hash.
 *
 * Used by:
 * - recordRefinementService — to inform the AI about review status
 * - Future: record detail UI, health profile views
 *
 * All checks use Firestore (not blockchain) since chainStatus on each
 * document already confirms on-chain status, and Firestore is faster.
 */

import { getVerification } from './verificationService';
import { getDisputesByRecordId } from './disputeService';
import { VerificationLevelOptions } from '../hooks/useCredibilityFlow';
import { DisputeSeverityOptions } from '@belrose/shared';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RecordReviewStatus {
  // ── Verification ────────────────────────────────────────────────────────────
  hasVerification: boolean;
  verificationIsCurrentHash: boolean; // false if verified against an older hash
  verificationLevel?: VerificationLevelOptions;

  // ── Dispute ─────────────────────────────────────────────────────────────────
  hasDispute: boolean;
  disputeIsCurrentHash: boolean; // false if disputed against an older hash
  disputeSeverity?: DisputeSeverityOptions;

  // ── Derived convenience flags ────────────────────────────────────────────────
  hasAnyActiveReview: boolean; // any of the three is active
  hasStaleReview: boolean; // any review exists but against an old hash
  currentHashReviewed: boolean; // at least one review is against current hash
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Fetches the full review status for a specific user on a specific record.
 *
 * @param recordId - Firestore record ID
 * @param currentRecordHash - The record's current hash (from record document)
 * @param userId - The user whose review activity to check
 *
 * Pass currentRecordHash from the record document directly rather than
 * fetching it here — callers already have the record data and this avoids
 * an extra Firestore read.
 */
export async function getRecordReviewStatus(
  recordId: string,
  currentRecordHash: string | undefined,
  userId: string
): Promise<RecordReviewStatus> {
  // ── Default (no-hash) fallback ───────────────────────────────────────────────
  // Older records or virtual files may not have a recordHash yet.
  // Return a safe default rather than throwing.
  if (!currentRecordHash) {
    return {
      hasVerification: false,
      verificationIsCurrentHash: false,
      hasDispute: false,
      disputeIsCurrentHash: false,
      hasAnyActiveReview: false,
      hasStaleReview: false,
      currentHashReviewed: false,
    };
  }

  // ── Fetch verification and all disputes on the record in parallel ─────────────
  const [verification, allDisputes] = await Promise.all([
    getVerification(currentRecordHash, userId).catch(() => null),
    getDisputesByRecordId(recordId).catch(() => []),
  ]);

  // ── Verification ─────────────────────────────────────────────────────────────
  // getVerification is keyed by {recordHash}_{userId} so it only returns
  // a result if the user verified this specific hash. To check if they
  // verified an older hash, we'd need to query all their verifications —
  // but for now we check the current hash and treat absence as "not verified
  // or verified against a stale hash." A future improvement could query
  // previousRecordHash[] to detect stale verifications explicitly.
  const hasVerification = !!verification?.isActive;
  const verificationIsCurrentHash = hasVerification;
  const verificationLevel = verification?.level;

  // ── Dispute ──────────────────────────────────────────────────────────────────
  // The user's dispute for the current hash
  const userDisputeCurrentHash = allDisputes.find(
    d => d.disputerId === userId && d.recordHash === currentRecordHash && d.isActive
  );

  // The user's dispute for any previous hash (stale)
  const userDisputeStaleHash = !userDisputeCurrentHash
    ? allDisputes.find(
        d => d.disputerId === userId && d.recordHash !== currentRecordHash && d.isActive
      )
    : undefined;

  const hasDispute = !!(userDisputeCurrentHash || userDisputeStaleHash);
  const disputeIsCurrentHash = !!userDisputeCurrentHash;
  const disputeSeverity = (userDisputeCurrentHash || userDisputeStaleHash)?.severity;

  // ── Derived flags ─────────────────────────────────────────────────────────────
  const hasAnyActiveReview = hasVerification || hasDispute;

  const hasStaleReview =
    (hasVerification && !verificationIsCurrentHash) || (hasDispute && !disputeIsCurrentHash);

  const currentHashReviewed = verificationIsCurrentHash || disputeIsCurrentHash;

  return {
    hasVerification,
    verificationIsCurrentHash,
    verificationLevel,
    hasDispute,
    disputeIsCurrentHash,
    disputeSeverity,
    hasAnyActiveReview,
    hasStaleReview,
    currentHashReviewed,
  };
}
