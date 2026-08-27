// src/features/CredibilityRecord/services/__tests__/disputeService.test.ts
//
// Tier 1 — the pure/config exports of disputeService.ts: getDisputeId and the
// SEVERITY_CONFIG/CULPABILITY_CONFIG lookup tables. Every Firestore-touching export
// (createDispute, retractDispute, modifyDispute, the query/decrypt helpers) is covered by the
// Tier 2 orchestration suite (test/orchestration/disputeService.test.ts).

import { describe, it, expect } from 'vitest';
import {
  getDisputeId,
  getSeverityConfig,
  getCulpabilityConfig,
  SEVERITY_CONFIG,
  CULPABILITY_CONFIG,
  SEVERITY_OPTIONS,
  CULPABILITY_OPTIONS,
} from '../disputeService';

describe('getDisputeId', () => {
  it('joins recordHash and disputerId with an underscore', () => {
    expect(getDisputeId('hash-1', 'user-1')).toBe('hash-1_user-1');
  });
});

describe('SEVERITY_CONFIG / getSeverityConfig', () => {
  it('has an entry for every severity level (1, 2, 3)', () => {
    expect(Object.keys(SEVERITY_CONFIG).sort()).toEqual(['1', '2', '3']);
  });

  it.each([
    [1, 'Negligible'],
    [2, 'Moderate'],
    [3, 'Major'],
  ] as const)('severity %i maps to "%s"', (severity, name) => {
    expect(SEVERITY_CONFIG[severity].name).toBe(name);
  });

  it('getSeverityConfig returns the exact same entry as the lookup table', () => {
    expect(getSeverityConfig(2)).toBe(SEVERITY_CONFIG[2]);
  });

  it('SEVERITY_OPTIONS lists exactly the config values, one per severity', () => {
    expect(SEVERITY_OPTIONS).toHaveLength(3);
    expect(SEVERITY_OPTIONS.map(o => o.value).sort()).toEqual([1, 2, 3]);
  });
});

describe('CULPABILITY_CONFIG / getCulpabilityConfig', () => {
  it('has an entry for every culpability level (0 through 5)', () => {
    expect(Object.keys(CULPABILITY_CONFIG).sort((a, b) => Number(a) - Number(b))).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
  });

  it.each([
    [0, 'Unknown'],
    [1, 'No Fault'],
    [2, 'Systemic'],
    [3, 'Preventable'],
    [4, 'Reckless'],
    [5, 'Intentional'],
  ] as const)('culpability %i maps to "%s"', (culpability, name) => {
    expect(CULPABILITY_CONFIG[culpability].name).toBe(name);
  });

  it('getCulpabilityConfig returns the exact same entry as the lookup table', () => {
    expect(getCulpabilityConfig(3)).toBe(CULPABILITY_CONFIG[3]);
  });

  it('CULPABILITY_OPTIONS lists exactly the config values, one per level', () => {
    expect(CULPABILITY_OPTIONS).toHaveLength(6);
    expect(CULPABILITY_OPTIONS.map(o => o.value).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
