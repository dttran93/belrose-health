// src/features/CredibilityRecord/services/__tests__/verificationService.test.ts
//
// Tier 1 — the pure/config exports of verificationService.ts: getVerificationId and the
// VERIFICATION_LEVEL_CONFIG lookup table. Every Firestore-touching export (createVerification,
// retractVerification, modifyVerificationLevel, recordSelfVerification, the query helpers) is
// covered by the Tier 2 orchestration suite (test/orchestration/verificationService.test.ts).

import { describe, it, expect } from 'vitest';
import {
  getVerificationId,
  getVerificationConfig,
  VERIFICATION_LEVEL_CONFIG,
  VERIFICATION_OPTIONS,
} from '../verificationService';

describe('getVerificationId', () => {
  it('joins recordHash and verifierId with an underscore', () => {
    expect(getVerificationId('hash-1', 'user-1')).toBe('hash-1_user-1');
  });
});

describe('VERIFICATION_LEVEL_CONFIG / getVerificationConfig', () => {
  it('has an entry for every verification level (1, 2, 3)', () => {
    expect(Object.keys(VERIFICATION_LEVEL_CONFIG).sort()).toEqual(['1', '2', '3']);
  });

  it.each([
    [1, 'Provenance'],
    [2, 'Content'],
    [3, 'Full'],
  ] as const)('level %i maps to "%s"', (level, name) => {
    expect(VERIFICATION_LEVEL_CONFIG[level].name).toBe(name);
  });

  it('getVerificationConfig returns the exact same entry as the lookup table', () => {
    expect(getVerificationConfig(2)).toBe(VERIFICATION_LEVEL_CONFIG[2]);
  });

  it('each config entry carries a matching value/name/icon/description/declarative', () => {
    for (const [key, config] of Object.entries(VERIFICATION_LEVEL_CONFIG)) {
      expect(config.value).toBe(Number(key));
      expect(config.name).toBeTruthy();
      expect(config.icon).toBeTruthy();
      expect(config.description).toBeTruthy();
      expect(config.declarative).toBeTruthy();
    }
  });

  it('VERIFICATION_OPTIONS lists exactly the config values, one per level', () => {
    expect(VERIFICATION_OPTIONS).toHaveLength(3);
    expect(VERIFICATION_OPTIONS.map(o => o.value).sort()).toEqual([1, 2, 3]);
  });
});
