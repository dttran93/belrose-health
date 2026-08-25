// functions/test/aggregateRecordScore.test.ts
//
// Pure unit tests for aggregateRecordScore (packages/shared/src/credibility.ts) — no Firestore/
// emulator involved. This is the shared algorithm both credibilityScoreService.ts (client SDK)
// and validationWeightEvaluator.ts (Admin SDK) call, so correctness here is what keeps the two
// sides from ever independently drifting on the RecordScore math.

import { describe, it, expect } from 'vitest';
import {
  aggregateRecordScore,
  RECORD_SCORE_C,
  INITIAL_SCORE,
  type ScoreEventContribution,
} from '../src/_shared';

describe('aggregateRecordScore', () => {
  it('returns the BasePrior with no events at all', () => {
    const result = aggregateRecordScore([]);
    expect(result.score).toBe(INITIAL_SCORE);
    expect(result.verificationCount).toBe(0);
    expect(result.disputeCount).toBe(0);
  });

  it('a single verification above BasePrior raises the score', () => {
    const events: ScoreEventContribution[] = [{ eventType: 'verification', contributionDelta: 950 }];
    const result = aggregateRecordScore(events);
    // (C*500 + 950) / (C+1)
    const expected = Math.round((RECORD_SCORE_C * INITIAL_SCORE + 950) / (RECORD_SCORE_C + 1));
    expect(result.score).toBe(expected);
    expect(result.score).toBeGreaterThan(INITIAL_SCORE);
    expect(result.verificationCount).toBe(1);
  });

  it('a single dispute pulls the score below BasePrior', () => {
    const events: ScoreEventContribution[] = [{ eventType: 'dispute', contributionDelta: 300 }];
    const result = aggregateRecordScore(events);
    const expected = Math.round((RECORD_SCORE_C * INITIAL_SCORE - 300) / (RECORD_SCORE_C + 1));
    expect(result.score).toBe(expected);
    expect(result.score).toBeLessThan(INITIAL_SCORE);
    expect(result.disputeCount).toBe(1);
  });

  it('a create+revoke pair nets back to exactly zero effect', () => {
    const events: ScoreEventContribution[] = [
      { eventType: 'verification', contributionDelta: 950 },
      { eventType: 'verification_revoked', contributionDelta: 950 },
    ];
    const result = aggregateRecordScore(events);
    expect(result.score).toBe(INITIAL_SCORE);
    expect(result.verificationCount).toBe(0);
    expect(result.verificationContributionSum).toBe(0);
  });

  it('a dispute create+revoke pair also nets back to exactly zero effect', () => {
    const events: ScoreEventContribution[] = [
      { eventType: 'dispute', contributionDelta: 300 },
      { eventType: 'dispute_revoked', contributionDelta: 300 },
    ];
    const result = aggregateRecordScore(events);
    expect(result.score).toBe(INITIAL_SCORE);
    expect(result.disputeCount).toBe(0);
    expect(result.disputeContributionSum).toBe(0);
  });

  it('a _modified event shifts the sum but leaves the count unchanged', () => {
    const events: ScoreEventContribution[] = [
      { eventType: 'verification', contributionDelta: 650 }, // Provenance
      { eventType: 'verification_modified', contributionDelta: 950 - 650 }, // -> Full
    ];
    const result = aggregateRecordScore(events);
    expect(result.verificationCount).toBe(1); // still just one verification, only its level changed
    expect(result.verificationContributionSum).toBe(950);
    const expected = Math.round((RECORD_SCORE_C * INITIAL_SCORE + 950) / (RECORD_SCORE_C + 1));
    expect(result.score).toBe(expected);
  });

  it('a dispute _modified event shifts the sum but leaves the count unchanged', () => {
    const events: ScoreEventContribution[] = [
      { eventType: 'dispute', contributionDelta: 100 }, // Negligible
      { eventType: 'dispute_modified', contributionDelta: 600 - 100 }, // -> Major
    ];
    const result = aggregateRecordScore(events);
    expect(result.disputeCount).toBe(1);
    expect(result.disputeContributionSum).toBe(600);
  });

  it('mixed verification and dispute events combine additively/subtractively', () => {
    const events: ScoreEventContribution[] = [
      { eventType: 'verification', contributionDelta: 950 },
      { eventType: 'dispute', contributionDelta: 300 },
    ];
    const result = aggregateRecordScore(events);
    const expected = Math.round((RECORD_SCORE_C * INITIAL_SCORE + 950 - 300) / (RECORD_SCORE_C + 2));
    expect(result.score).toBe(expected);
    expect(result.verificationCount).toBe(1);
    expect(result.disputeCount).toBe(1);
  });

  it('respects custom c/basePrior overrides', () => {
    const events: ScoreEventContribution[] = [{ eventType: 'verification', contributionDelta: 800 }];
    const result = aggregateRecordScore(events, 2, 400);
    expect(result.score).toBe(Math.round((2 * 400 + 800) / (2 + 1)));
  });

  it('clamps to SCORE_BOUNDS at the extremes', () => {
    const manyDisputes: ScoreEventContribution[] = Array.from({ length: 50 }, () => ({
      eventType: 'dispute' as const,
      contributionDelta: 600,
    }));
    const result = aggregateRecordScore(manyDisputes);
    expect(result.score).toBe(0);
  });
});
