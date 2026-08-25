// functions/test/recomputeUserCredibility.test.ts
//
// Thin — just the platformAdmin gate. The actual computation correctness is covered by
// userCredibilityBatch.test.ts (which calls runUserCredibilityCycle directly); this only proves
// the callable wrapper enforces admin-only access before delegating to it.

import { beforeEach, describe, it, expect } from 'vitest';
import { buildRequest } from './helpers/callableRequest';
import { clearFirestore } from './helpers/testAdmin';
import { recomputeUserCredibility } from '../src/handlers/userCredibilityBatch';

beforeEach(async () => {
  await clearFirestore();
});

function buildAdminRequest(): any {
  return { data: {}, auth: { uid: 'admin-1', token: { uid: 'admin-1', platformAdmin: true } }, rawRequest: {} };
}

describe('recomputeUserCredibility — admin gate', () => {
  it('throws permission-denied when there is no authenticated caller', async () => {
    await expect(recomputeUserCredibility.run(buildRequest({}))).rejects.toThrow('Not authorized');
  });

  it('throws permission-denied for an authenticated non-admin caller', async () => {
    await expect(recomputeUserCredibility.run(buildRequest({}, 'regular-user'))).rejects.toThrow(
      'Not authorized'
    );
  });

  it('succeeds for a platform admin and returns cycle counts', async () => {
    const result = await recomputeUserCredibility.run(buildAdminRequest());
    expect(result).toMatchObject({ success: true, disputesEvaluated: 0, usersUpdated: 0 });
  });
});
