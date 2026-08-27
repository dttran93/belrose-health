// test/rules/vouches.test.ts
//
// firestore.rules — vouches/{vouchId} — top-level collection, doc ID `{voucherId}_{voucheeId}`.
// Unlike verifications/disputes, vouches don't need a record role — just two distinct
// authenticated users. Firestore-first (see vouchService.ts): a create always starts
// chainStatus:'Pending', onChainHistory:[], then a later update flips chainStatus to
// 'Active'/'Retracted'/'Failed' and (on confirm) appends one onChainHistory event.
//
// This file specifically locks in a real bug found and fixed alongside it: the old rules
// hardcoded the pre-Firestore-first shape (chainStatus=='Active' + onChainHistory.size()==1 at
// create; update only allowing 'Active'/'Retracted'), which would have rejected every real
// vouch create/retract against production security rules. The "update" describe block below is
// what would have caught it.

import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { OWNER, SHARER } from './fixtures/recordPermissionMatrix';

const STRANGER = 'stranger-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'belrose-rules-test-vouches',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(() => testEnv.cleanup());
beforeEach(() => testEnv.clearFirestore());

function vouchId(voucherId: string, voucheeId: string) {
  return `${voucherId}_${voucheeId}`;
}

function validVouch(overrides: Record<string, unknown> = {}) {
  return {
    voucherId: OWNER,
    voucherIdHash: '0xvoucher',
    voucheeId: SHARER,
    voucheeIdHash: '0xvouchee',
    chainStatus: 'Pending',
    createdAt: new Date(),
    onChainHistory: [],
    ...overrides,
  };
}

async function seedVouch(overrides: Record<string, unknown> = {}) {
  const data = validVouch(overrides);
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx
      .firestore()
      .doc(`vouches/${vouchId(data.voucherId as string, data.voucheeId as string)}`)
      .set(data);
  });
}

describe('firestore.rules — vouches — create', () => {
  it('lets the voucher create a Pending vouch with empty onChainHistory', async () => {
    await assertSucceeds(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, SHARER)}`)
        .set(validVouch())
    );
  });

  it('allows create with chainStatus Active too (rule permits it even though the client always starts Pending)', async () => {
    await assertSucceeds(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, SHARER)}`)
        .set(validVouch({ chainStatus: 'Active' }))
    );
  });

  it('denies create where voucherId does not match the caller', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(STRANGER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, SHARER)}`)
        .set(validVouch())
    );
  });

  it('denies self-vouch', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, OWNER)}`)
        .set(validVouch({ voucheeId: OWNER }))
    );
  });

  it('denies create where the doc id does not match {voucherId}_{voucheeId}', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`vouches/mismatched-doc-id`)
        .set(validVouch())
    );
  });

  it('denies create with a chainStatus outside [Pending, Active]', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, SHARER)}`)
        .set(validVouch({ chainStatus: 'Retracted' }))
    );
  });

  it('denies create with a non-empty onChainHistory', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, SHARER)}`)
        .set(validVouch({ onChainHistory: [{ action: 'vouched', at: new Date(), blockchainRef: {} }] }))
    );
  });

  it('denies create where onChainHistory is not a list', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, SHARER)}`)
        .set(validVouch({ onChainHistory: 'not-a-list' }))
    );
  });

  it('denies create where createdAt is not a timestamp', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, SHARER)}`)
        .set(validVouch({ createdAt: 'not-a-timestamp' }))
    );
  });

  it('denies create from an unauthenticated context', async () => {
    await assertFails(
      testEnv.unauthenticatedContext().firestore().doc(`vouches/${vouchId(OWNER, SHARER)}`).set(validVouch())
    );
  });
});

describe('firestore.rules — vouches — update (chainStatus transitions)', () => {
  // Each of these mirrors a real transition vouchService.ts performs. Before the fix, only
  // 'Active'/'Retracted' were allowed on update — every case below except the second
  // ('Pending'→'Active') would have failed against the old rules.

  it('allows the voucher confirming a create: Pending → Active with an appended event', async () => {
    await seedVouch({ chainStatus: 'Pending' });

    await assertSucceeds(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, SHARER)}`)
        .update({
          chainStatus: 'Active',
          onChainHistory: [{ action: 'vouched', at: new Date(), blockchainRef: { txHash: '0xabc', blockNumber: 1 } }],
        })
    );
  });

  it('allows the voucher recording a failed blockchain confirmation: Pending → Failed', async () => {
    await seedVouch({ chainStatus: 'Pending' });

    await assertSucceeds(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, SHARER)}`)
        .update({ chainStatus: 'Failed' })
    );
  });

  it('allows the voucher starting a retraction: Active → Pending', async () => {
    await seedVouch({ chainStatus: 'Active' });

    await assertSucceeds(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, SHARER)}`)
        .update({ chainStatus: 'Pending' })
    );
  });

  it('allows the voucher confirming a retraction: Pending → Retracted', async () => {
    await seedVouch({ chainStatus: 'Pending' });

    await assertSucceeds(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, SHARER)}`)
        .update({
          chainStatus: 'Retracted',
          onChainHistory: [{ action: 'retracted', at: new Date(), blockchainRef: { txHash: '0xdef', blockNumber: 2 } }],
        })
    );
  });

  it('allows the voucher re-vouching after a retraction: Retracted → Pending', async () => {
    await seedVouch({ chainStatus: 'Retracted' });

    await assertSucceeds(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, SHARER)}`)
        .update({ chainStatus: 'Pending' })
    );
  });

  it('denies update from anyone other than the original voucher', async () => {
    await seedVouch({ chainStatus: 'Pending' });

    await assertFails(
      testEnv
        .authenticatedContext(SHARER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, SHARER)}`)
        .update({ chainStatus: 'Active' })
    );
  });

  it('denies changing identity fields on update', async () => {
    await seedVouch({ chainStatus: 'Pending' });

    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, SHARER)}`)
        .update({ voucheeId: STRANGER })
    );

    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, SHARER)}`)
        .update({ createdAt: new Date() })
    );
  });

  it('denies an out-of-set chainStatus value on update', async () => {
    await seedVouch({ chainStatus: 'Pending' });

    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(`vouches/${vouchId(OWNER, SHARER)}`)
        .update({ chainStatus: 'None' })
    );
  });
});

describe('firestore.rules — vouches — read', () => {
  it('lets any authenticated user read a vouch — public trust signal', async () => {
    await seedVouch({ chainStatus: 'Active' });

    await assertSucceeds(
      testEnv.authenticatedContext(OWNER).firestore().doc(`vouches/${vouchId(OWNER, SHARER)}`).get()
    );
    await assertSucceeds(
      testEnv.authenticatedContext(STRANGER).firestore().doc(`vouches/${vouchId(OWNER, SHARER)}`).get()
    );
  });

  it('denies an unauthenticated read', async () => {
    await seedVouch({ chainStatus: 'Active' });

    await assertFails(
      testEnv.unauthenticatedContext().firestore().doc(`vouches/${vouchId(OWNER, SHARER)}`).get()
    );
  });
});

describe('firestore.rules — vouches — delete', () => {
  it('never allows delete — permanent audit trail', async () => {
    await seedVouch({ chainStatus: 'Active' });

    await assertFails(
      testEnv.authenticatedContext(OWNER).firestore().doc(`vouches/${vouchId(OWNER, SHARER)}`).delete()
    );
  });
});
