// functions/test/earnedTrust.test.ts
//
// Pure unit tests for computeEarnedTrust — no Firestore/emulator involved. fetchEarnedTrustInputs
// (the I/O half) is covered indirectly by userCredibilityBatch.test.ts's end-to-end assertions.

import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { computeEarnedTrust } from '../src/credibility/earnedTrust';
import type { EarnedTrustInputs, RecordSummary, UserForCredibility } from '../src/credibility/types';
import type { VerificationDoc, DisputeDoc } from '../src/_shared';

function makeUser(overrides: Partial<UserForCredibility> = {}): UserForCredibility {
  return { uid: 'user-1', credentialFloor: 0, priorScore: null, ...overrides };
}

function makeVerification(overrides: Partial<VerificationDoc> = {}): VerificationDoc {
  return {
    id: 'v1',
    recordIdHash: '0xrecordidhash',
    recordHash: 'hash-current',
    recordId: 'record-1',
    verifierId: 'user-1',
    verifierIdHash: '0xverifier',
    level: 3,
    isActive: true,
    createdAt: Timestamp.now(),
    chainStatus: 'confirmed',
    onChainHistory: [],
    encryptedRecordTitleIv: '',
    ...overrides,
  };
}

function makeDispute(overrides: Partial<DisputeDoc> = {}): DisputeDoc {
  return {
    id: 'd1',
    recordHash: 'hash-current',
    recordId: 'record-1',
    recordIdHash: '0xrecordidhash',
    disputerId: 'user-1',
    disputerIdHash: '0xdisputer',
    severity: 2,
    culpability: 3,
    notesHash: '',
    isActive: true,
    createdAt: Timestamp.now(),
    chainStatus: 'confirmed',
    onChainHistory: [],
    recordScoreAtCreation: 500,
    validationWeight: 0,
    ...overrides,
  };
}

function makeInputs(overrides: Partial<EarnedTrustInputs> = {}): EarnedTrustInputs {
  return {
    users: [makeUser()],
    verifications: [],
    disputes: [],
    records: new Map<string, RecordSummary>(),
    unacceptedFlagCounts: new Map<string, number>(),
    everAnchoredRecordCounts: new Map<string, number>(),
    ...overrides,
  };
}

describe('computeEarnedTrust', () => {
  it('a user with zero verifications and zero disputes has null components and EarnedTrust == CredentialFloor', () => {
    const results = computeEarnedTrust(
      makeInputs({ users: [makeUser({ credentialFloor: 0 })] })
    );
    const result = results.get('user-1')!;

    expect(result.avgRecordCredibility).toBeNull();
    expect(result.disputeAccuracy).toBeNull();
    expect(result.culpabilityPenalty).toBe(0);
    expect(result.unacceptedRecordsPenalty).toBe(0);
    expect(result.earnedTrust).toBe(0);
  });

  it('EarnedTrust never drops below CredentialFloor even with a negative track record', () => {
    const results = computeEarnedTrust(
      makeInputs({
        users: [makeUser({ credentialFloor: 400 })],
        disputes: [makeDispute({ disputerId: 'user-1', severity: 3, validationWeight: -1 })],
      })
    );
    const result = results.get('user-1')!;

    expect(result.disputeAccuracy).toBeLessThan(0);
    expect(result.earnedTrust).toBe(400); // floored, not the (negative) computed sum
  });

  it('AvgRecordCredibility only counts verifications matching the record\'s CURRENT recordHash', () => {
    const records = new Map<string, RecordSummary>([
      ['record-1', { recordHash: 'hash-current', credibilityScore: 800 }],
    ]);
    const results = computeEarnedTrust(
      makeInputs({
        records,
        verifications: [
          makeVerification({ recordId: 'record-1', recordHash: 'hash-stale', verifierId: 'user-1' }),
        ],
      })
    );
    const result = results.get('user-1')!;

    // The verification's hash doesn't match the record's current hash — excluded entirely.
    expect(result.avgRecordCredibility).toBeNull();
  });

  it('AvgRecordCredibility averages current-hash records the user verified', () => {
    const records = new Map<string, RecordSummary>([
      ['record-1', { recordHash: 'hash-a', credibilityScore: 600 }],
      ['record-2', { recordHash: 'hash-b', credibilityScore: 800 }],
    ]);
    const results = computeEarnedTrust(
      makeInputs({
        records,
        verifications: [
          makeVerification({ id: 'v1', recordId: 'record-1', recordHash: 'hash-a', verifierId: 'user-1' }),
          makeVerification({ id: 'v2', recordId: 'record-2', recordHash: 'hash-b', verifierId: 'user-1' }),
        ],
      })
    );
    const result = results.get('user-1')!;

    expect(result.avgRecordCredibility).toBeCloseTo(700, 5);
  });

  it('pending disputes (validationWeight 0) dilute DisputeAccuracy toward 0 without being excluded', () => {
    const results = computeEarnedTrust(
      makeInputs({
        disputes: [
          makeDispute({ id: 'd1', disputerId: 'user-1', severity: 3, validationWeight: 1 }), // e.g. 300
          makeDispute({ id: 'd2', disputerId: 'user-1', severity: 3, validationWeight: 0 }), // pending -> 0
        ],
      })
    );
    const result = results.get('user-1')!;

    // Average of [300, 0] = 150, not 300 (which it would be if the pending dispute were excluded).
    expect(result.disputeAccuracy).toBeCloseTo(150, 5);
  });

  it('CulpabilityPenalty only counts disputes against a recordHash the user actively verified', () => {
    const records = new Map<string, RecordSummary>([
      ['record-1', { recordHash: 'hash-current', credibilityScore: 500 }],
    ]);
    const results = computeEarnedTrust(
      makeInputs({
        records,
        verifications: [
          makeVerification({ recordId: 'record-1', recordHash: 'hash-current', verifierId: 'user-1' }),
        ],
        disputes: [
          // Same hash the user verified — counts.
          makeDispute({
            id: 'd-same-hash',
            disputerId: 'other-user',
            recordHash: 'hash-current',
            culpability: 4,
            validationWeight: 1,
          }),
          // Different hash entirely — does not count.
          makeDispute({
            id: 'd-different-hash',
            disputerId: 'other-user',
            recordHash: 'hash-unrelated',
            culpability: 5,
            validationWeight: 1,
          }),
        ],
      })
    );
    const result = results.get('user-1')!;

    // Only the matching-hash dispute contributes: CULPABILITY_WEIGHTS[4] * 1.
    expect(result.culpabilityPenalty).toBeGreaterThan(0);
    // Sanity: swapping in only the "different hash" dispute (culpability 5, more severe) would
    // give a larger number if it were wrongly included — confirm it's excluded by checking the
    // penalty matches culpability-4's weight, not culpability-5's larger one.
    const onlyCulpability4 = computeEarnedTrust(
      makeInputs({
        records,
        verifications: [
          makeVerification({ recordId: 'record-1', recordHash: 'hash-current', verifierId: 'user-1' }),
        ],
        disputes: [
          makeDispute({
            id: 'd-same-hash',
            disputerId: 'other-user',
            recordHash: 'hash-current',
            culpability: 4,
            validationWeight: 1,
          }),
        ],
      })
    ).get('user-1')!.culpabilityPenalty;

    expect(result.culpabilityPenalty).toBeCloseTo(onlyCulpability4, 5);
  });

  it('EarnedTrust combines AvgRecordCredibility + DisputeAccuracy - CulpabilityPenalty, floored at CredentialFloor', () => {
    const records = new Map<string, RecordSummary>([
      ['record-1', { recordHash: 'hash-current', credibilityScore: 600 }],
    ]);
    const results = computeEarnedTrust(
      makeInputs({
        users: [makeUser({ credentialFloor: 0 })],
        records,
        verifications: [
          makeVerification({ recordId: 'record-1', recordHash: 'hash-current', verifierId: 'user-1' }),
        ],
        disputes: [
          // Filed BY user-1 (D(u), boosts DisputeAccuracy)
          makeDispute({
            id: 'd-by-user',
            disputerId: 'user-1',
            recordHash: 'some-other-hash',
            severity: 1,
            validationWeight: 1,
          }),
        ],
      })
    );
    const result = results.get('user-1')!;

    expect(result.avgRecordCredibility).toBeCloseTo(600, 5);
    expect(result.disputeAccuracy).toBeGreaterThan(0);
    expect(result.culpabilityPenalty).toBe(0);
    expect(result.unacceptedRecordsPenalty).toBe(0);
    expect(result.earnedTrust).toBeCloseTo(
      (result.avgRecordCredibility ?? 0) +
        (result.disputeAccuracy ?? 0) -
        result.culpabilityPenalty -
        result.unacceptedRecordsPenalty,
      5
    );
  });
});

describe('computeEarnedTrust — UnacceptedRecordsPenalty', () => {
  it('zero flags -> no penalty', () => {
    const results = computeEarnedTrust(
      makeInputs({ everAnchoredRecordCounts: new Map([['user-1', 4]]) })
    );
    expect(results.get('user-1')!.unacceptedRecordsPenalty).toBe(0);
  });

  it('S(u) = 0 (no anchor history) -> no penalty, even with active flags', () => {
    // Locks in the settled edge-case decision: "no data" is not "worst possible data."
    const results = computeEarnedTrust(
      makeInputs({ unacceptedFlagCounts: new Map([['user-1', 2]]) })
    );
    expect(results.get('user-1')!.unacceptedRecordsPenalty).toBe(0);
  });

  it('computes the exact ratio: (|U(u)|/|S(u)|) * UNACCEPTED_RECORDS_PENALTY_CONSTANT', () => {
    const results = computeEarnedTrust(
      makeInputs({
        unacceptedFlagCounts: new Map([['user-1', 1]]),
        everAnchoredRecordCounts: new Map([['user-1', 4]]),
      })
    );
    // 1/4 * UNACCEPTED_RECORDS_PENALTY_CONSTANT (500) = 125
    expect(results.get('user-1')!.unacceptedRecordsPenalty).toBeCloseTo(125, 5);
  });

  it('subtracts alongside CulpabilityPenalty in the same EarnedTrust computation', () => {
    const records = new Map<string, RecordSummary>([
      ['record-1', { recordHash: 'hash-current', credibilityScore: 500 }],
    ]);
    const results = computeEarnedTrust(
      makeInputs({
        records,
        verifications: [
          makeVerification({ recordId: 'record-1', recordHash: 'hash-current', verifierId: 'user-1' }),
        ],
        disputes: [
          makeDispute({
            id: 'd1',
            disputerId: 'other-user',
            recordHash: 'hash-current',
            culpability: 3,
            validationWeight: 1,
          }),
        ],
        unacceptedFlagCounts: new Map([['user-1', 1]]),
        everAnchoredRecordCounts: new Map([['user-1', 2]]),
      })
    );
    const result = results.get('user-1')!;

    expect(result.culpabilityPenalty).toBeGreaterThan(0);
    expect(result.unacceptedRecordsPenalty).toBeGreaterThan(0);
    expect(result.earnedTrust).toBeCloseTo(
      (result.avgRecordCredibility ?? 0) +
        (result.disputeAccuracy ?? 0) -
        result.culpabilityPenalty -
        result.unacceptedRecordsPenalty,
      5
    );
  });

  it('a large enough penalty is floored at CredentialFloor, same as other subtractive terms', () => {
    const results = computeEarnedTrust(
      makeInputs({
        users: [makeUser({ credentialFloor: 100 })],
        unacceptedFlagCounts: new Map([['user-1', 4]]),
        everAnchoredRecordCounts: new Map([['user-1', 4]]), // ratio 1.0 -> full constant deducted
      })
    );
    const result = results.get('user-1')!;

    expect(result.unacceptedRecordsPenalty).toBeCloseTo(500, 5); // the full constant
    expect(result.earnedTrust).toBe(100); // floored, not the negative raw sum
  });
});
