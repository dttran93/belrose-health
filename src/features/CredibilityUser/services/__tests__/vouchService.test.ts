// src/features/CredibilityUser/services/__tests__/vouchService.test.ts
//
// Tier 1 — the one pure helper vouchService.ts exports: getVouchId. Every Firestore-touching
// export (createVouch, retractVouch, the query helpers) is covered by the Tier 2 orchestration
// suite (test/orchestration/vouchService.test.ts).

import { describe, it, expect } from 'vitest';
import { getVouchId } from '../vouchService';

describe('getVouchId', () => {
  it('joins voucherId and voucheeId with an underscore', () => {
    expect(getVouchId('user-1', 'user-2')).toBe('user-1_user-2');
  });
});
