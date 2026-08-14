// functions/src/credibility/types.ts
//
// Internal intermediate types for the User Credibility batch computation. Not shared with the
// frontend — these describe in-memory shapes the computation itself uses, not persisted documents
// (those live in ../_shared/credibility.ts).

import type { VerificationDoc, DisputeDoc } from '../_shared';

/** A user's inputs to EarnedTrust(u), already normalized/defaulted. */
export interface UserForCredibility {
  uid: string;
  credentialFloor: number;
  /** Prior cycle's users/{uid}.credibility.score, if any — Phase 3's warm-start source. */
  priorScore: number | null;
}

/** Just enough about a record to feed AvgRecordCredibility(u)'s current-hash join. */
export interface RecordSummary {
  recordHash: string;
  credibilityScore: number;
}

export interface EarnedTrustInputs {
  users: UserForCredibility[];
  /** Active verifications only — isActive filter already applied at fetch time. */
  verifications: VerificationDoc[];
  /** ALL disputes, unfiltered — the whitepaper's D(u)/I(u) both draw from the full set. */
  disputes: DisputeDoc[];
  /** recordId -> summary, for just the records referenced by `verifications`. */
  records: Map<string, RecordSummary>;
  /** subjectId -> count of active unacceptedFlags docs against them (|U(u)|). */
  unacceptedFlagCounts: Map<string, number>;
  /** subjectId -> count of distinct records EVER anchored to them, reconstructed from
   *  subjectHistory (|S(u)|) — the contract's own never-pruned definition of "anchored," not just
   *  currently-active subjects (see earnedTrust.ts for why). */
  everAnchoredRecordCounts: Map<string, number>;
}

export interface EarnedTrustResult {
  earnedTrust: number;
  avgRecordCredibility: number | null;
  disputeAccuracy: number | null;
  culpabilityPenalty: number;
  unacceptedRecordsPenalty: number;
  credentialFloor: number;
}

export interface VouchEdge {
  voucherId: string;
  voucheeId: string;
}

export interface VouchPropagationResult {
  score: number;
  vouchPropagated: number;
}
