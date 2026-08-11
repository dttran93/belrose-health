import { BlockchainRef } from './blockchainAddresses';
import { TimestampLike } from './timestamp';

export type VerificationLevelOptions = 1 | 2 | 3;
export type DisputeSeverityOptions = 1 | 2 | 3;
export type DisputeCulpability = 0 | 1 | 2 | 3 | 4 | 5;

export interface EncryptedField {
  encrypted: string;
  iv: string;
}

// ── On-chain history event types ──────────────────────────────────────────────

export interface VerificationOnChainEvent {
  action: 'verified' | 'retracted' | 'modified';
  at: TimestampLike;
  blockchainRef: BlockchainRef;
  fromLevel?: VerificationLevelOptions;
  toLevel?: VerificationLevelOptions;
}

export interface DisputeOnChainEvent {
  action: 'disputed' | 'retracted' | 'modified';
  at: TimestampLike;
  blockchainRef: BlockchainRef;
  fromSeverity?: DisputeSeverityOptions;
  toSeverity?: DisputeSeverityOptions;
  fromCulpability?: DisputeCulpability;
  toCulpability?: DisputeCulpability;
}

export interface VouchOnChainEvent {
  action: 'vouched' | 'retracted' | 're-vouched';
  at: TimestampLike;
  blockchainRef: BlockchainRef;
}

// ── Document types ────────────────────────────────────────────────────────────

export interface VerificationDoc {
  id: string;
  recordIdHash: string;
  recordHash: string;
  recordId: string;
  verifierId: string;
  verifierIdHash: string;
  level: VerificationLevelOptions;
  isActive: boolean;
  createdAt: TimestampLike;
  lastModified?: TimestampLike;
  chainStatus: 'pending' | 'confirmed' | 'failed';
  onChainHistory: VerificationOnChainEvent[];
  encryptedRecordTitle?: string;
  encryptedRecordTitleIv: string;
}

export interface DisputeDoc {
  id: string;
  recordHash: string;
  recordId: string;
  recordIdHash: string;
  disputerId: string;
  disputerIdHash: string;
  severity: DisputeSeverityOptions;
  culpability: DisputeCulpability;
  encryptedNotes?: EncryptedField;
  notesHash: string;
  isActive: boolean;
  createdAt: TimestampLike;
  lastModified?: TimestampLike;
  chainStatus: 'pending' | 'confirmed' | 'failed';
  onChainHistory: DisputeOnChainEvent[];
  encryptedRecordTitle?: string;
  encryptedRecordTitleIv?: string;

  // Snapshot of records/{recordId}.credibility.score at the moment this dispute was filed —
  // the "before" baseline ValidationWeight compares against once the evaluation window elapses.
  recordScoreAtCreation: number;
  // ValidationWeight(d) from the whitepaper: 0 = pending (evaluation window hasn't elapsed yet),
  // 1 = validated (record score declined since filing), -1 = unvalidated (score recovered).
  // Starts at 0 on create; set exactly once, server-side only, once decided — never touched again.
  validationWeight: -1 | 0 | 1;
}

export type VouchChainStatus = 'None' | 'Active' | 'Retracted';

export interface VouchDoc {
  id: string;
  voucherId: string;
  voucherIdHash: string;
  voucheeId: string;
  voucheeIdHash: string;
  chainStatus: VouchChainStatus;
  createdAt: TimestampLike;
  lastModified?: TimestampLike;
  onChainHistory: VouchOnChainEvent[];
}

// ── User Credibility ──────────────────────────────────────────────────────────
//
// UserCredibility(u) = (1-w)·EarnedTrust(u) + w·Σ[VouchWeight(u1→u)·UserCredibility(u1)]
// EarnedTrust(u) = max(CredentialFloor(u), AvgRecordCredibility(u) + DisputeAccuracy(u) - CulpabilityPenalty(u))
//
// Written wholesale by the (not-yet-built) scheduled batch computation — never by a client.
// CredentialFloor itself lives as a separate top-level `credentialFloor` field on the user
// profile (an admin-set input that rarely changes), not nested in here (a fully server-computed
// output overwritten each cycle) — components.credentialFloor below just echoes it for
// transparency about what value fed that cycle's computation.
export interface UserCredibilityScore {
  score: number; // 0-1000, final UserCredibility(u) — the one thing badges/UI show
  lastUpdated: TimestampLike;
  earnedTrust: number; // EarnedTrust(u)
  components: {
    avgRecordCredibility: number | null; // null when R(u) is empty, not 0 — "no data" vs "bad score"
    disputeAccuracy: number | null; // null when D(u) is empty
    culpabilityPenalty: number; // 0 when I(u) is empty
    credentialFloor: number; // echoes the authoritative credentialFloor field for this cycle
  };
  vouchPropagated: number; // the w·Σ[...] term
  w: number; // the mixing weight used for this cycle
}
