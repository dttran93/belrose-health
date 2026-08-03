// test/rules/trusteeHistory.test.ts
//
// firestore.rules — trusteeRelationships/{relationshipId}/trusteeHistory/{eventId} — the
// audit-trail subcollection TrusteeRelationshipService writes to, parallel to
// records/{id}/permissionHistory and records/{id}/subjectHistory. Unlike those two, read/create
// are checked against the EVENT's OWN embedded trustorId/trusteeId fields rather than a live
// get() on the parent relationship doc — the event is always written in lockstep with the
// parent's own state transition, so embedding avoids an extra read and, unlike the parent's
// live status, never goes stale.

import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const TRUSTOR = 'trustor-uid';
const TRUSTEE = 'trustee-uid';
const STRANGER = 'stranger-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'belrose-rules-test-trustee-history',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(() => testEnv.cleanup());
beforeEach(() => testEnv.clearFirestore());

const relationshipId = `${TRUSTOR}_${TRUSTEE}`;
const eventPath = (eventId: string) => `trusteeRelationships/${relationshipId}/trusteeHistory/${eventId}`;

async function seedRelationship() {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc(`trusteeRelationships/${relationshipId}`).set({
      trustorId: TRUSTOR,
      trusteeId: TRUSTEE,
      trustLevel: 'observer',
      isActive: true,
      status: 'active',
      createdAt: new Date(),
      respondedAt: new Date(),
      revokedAt: null,
      revokedBy: null,
      statusUpdateReason: null,
    });
  });
}

function eventPayload(overrides: Record<string, unknown> = {}) {
  return {
    relationshipId,
    trustorId: TRUSTOR,
    trusteeId: TRUSTEE,
    action: 'revoke',
    changedBy: TRUSTOR,
    changedAt: new Date(),
    blockchainRef: null,
    ...overrides,
  };
}

describe('firestore.rules — trusteeHistory subcollection', () => {
  it('lets the trustor create an event where changedBy matches themselves', async () => {
    await seedRelationship();

    await assertSucceeds(
      testEnv
        .authenticatedContext(TRUSTOR)
        .firestore()
        .doc(eventPath('event-1'))
        .set(eventPayload({ changedBy: TRUSTOR }))
    );
  });

  it('lets the trustee create an event where changedBy matches themselves', async () => {
    await seedRelationship();

    await assertSucceeds(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(eventPath('event-1'))
        .set(eventPayload({ action: 'accept', changedBy: TRUSTEE }))
    );
  });

  it('denies create from a user who is not a party to the relationship named on the event', async () => {
    await seedRelationship();

    await assertFails(
      testEnv
        .authenticatedContext(STRANGER)
        .firestore()
        .doc(eventPath('event-1'))
        .set(eventPayload({ changedBy: STRANGER }))
    );
  });

  it('denies create when changedBy does not match the caller', async () => {
    await seedRelationship();

    await assertFails(
      testEnv
        .authenticatedContext(TRUSTOR)
        .firestore()
        .doc(eventPath('event-1'))
        .set(eventPayload({ changedBy: TRUSTEE }))
    );
  });

  it('lets a party read events, but denies a stranger', async () => {
    await seedRelationship();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx.firestore().doc(eventPath('event-1')).set(eventPayload());
    });

    await assertSucceeds(
      testEnv.authenticatedContext(TRUSTEE).firestore().doc(eventPath('event-1')).get()
    );
    await assertFails(
      testEnv.authenticatedContext(STRANGER).firestore().doc(eventPath('event-1')).get()
    );
  });

  it('never allows delete — immutable audit log', async () => {
    await seedRelationship();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx.firestore().doc(eventPath('event-1')).set(eventPayload());
    });

    await assertFails(
      testEnv.authenticatedContext(TRUSTOR).firestore().doc(eventPath('event-1')).delete()
    );
  });

  it('never allows updating anything other than blockchainRef — the rest of the event stays immutable', async () => {
    await seedRelationship();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx.firestore().doc(eventPath('event-1')).set(eventPayload());
    });

    await assertFails(
      testEnv
        .authenticatedContext(TRUSTOR)
        .firestore()
        .doc(eventPath('event-1'))
        .update({ action: 'accept' })
    );
  });

  describe('completing a deferred blockchainRef (Firestore-first relationship lifecycle flows)', () => {
    it('lets the original changedBy fill in blockchainRef while it is still null', async () => {
      await seedRelationship();
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx.firestore().doc(eventPath('event-1')).set(eventPayload({ changedBy: TRUSTOR }));
      });

      await assertSucceeds(
        testEnv
          .authenticatedContext(TRUSTOR)
          .firestore()
          .doc(eventPath('event-1'))
          .update({ blockchainRef: { txHash: '0xabc', chainId: 84532, blockNumber: 1, contractAddress: '0x1' } })
      );
    });

    it('still lets changedBy complete it even after the parent relationship ended (resign/decline) — update never re-checks live relationship state', async () => {
      // The event embeds trustorId/trusteeId directly rather than re-checking the parent doc,
      // so this passes regardless of the parent's current status — the exact property that
      // avoids the self-removal edge case permissionHistory/subjectHistory had to special-case.
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx.firestore().doc(`trusteeRelationships/${relationshipId}`).set({
          trustorId: TRUSTOR,
          trusteeId: TRUSTEE,
          trustLevel: 'observer',
          isActive: false,
          status: 'declined',
          createdAt: new Date(),
          respondedAt: new Date(),
          revokedAt: new Date(),
          revokedBy: TRUSTEE,
          statusUpdateReason: null,
        });
        await ctx
          .firestore()
          .doc(eventPath('event-1'))
          .set(eventPayload({ action: 'revoke', changedBy: TRUSTEE }));
      });

      await assertSucceeds(
        testEnv
          .authenticatedContext(TRUSTEE)
          .firestore()
          .doc(eventPath('event-1'))
          .update({ blockchainRef: { txHash: '0xabc', chainId: 84532, blockNumber: 1, contractAddress: '0x1' } })
      );
    });

    it('denies a different user from filling in blockchainRef, even the other party to the relationship', async () => {
      await seedRelationship();
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx.firestore().doc(eventPath('event-1')).set(eventPayload({ changedBy: TRUSTOR }));
      });

      await assertFails(
        testEnv
          .authenticatedContext(TRUSTEE)
          .firestore()
          .doc(eventPath('event-1'))
          .update({ blockchainRef: { txHash: '0xabc', chainId: 84532, blockNumber: 1, contractAddress: '0x1' } })
      );
    });

    it('denies overwriting an already-set blockchainRef', async () => {
      await seedRelationship();
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx.firestore().doc(eventPath('event-1')).set(
          eventPayload({
            changedBy: TRUSTOR,
            blockchainRef: { txHash: '0xoriginal', chainId: 84532, blockNumber: 1, contractAddress: '0x1' },
          })
        );
      });

      await assertFails(
        testEnv
          .authenticatedContext(TRUSTOR)
          .firestore()
          .doc(eventPath('event-1'))
          .update({ blockchainRef: { txHash: '0xreplaced', chainId: 84532, blockNumber: 2, contractAddress: '0x1' } })
      );
    });

    it('denies sneaking a change to another field into the same update as blockchainRef', async () => {
      await seedRelationship();
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await ctx.firestore().doc(eventPath('event-1')).set(eventPayload({ changedBy: TRUSTOR }));
      });

      await assertFails(
        testEnv
          .authenticatedContext(TRUSTOR)
          .firestore()
          .doc(eventPath('event-1'))
          .update({
            blockchainRef: { txHash: '0xabc', chainId: 84532, blockNumber: 1, contractAddress: '0x1' },
            action: 'accept',
          })
      );
    });
  });
});
