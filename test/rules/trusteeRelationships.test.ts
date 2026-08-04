// test/rules/trusteeRelationships.test.ts
//
// firestore.rules — trusteeRelationships/{relationshipId} — the lifecycle document
// TrusteeRelationshipService reads/writes (invite/accept/decline/revoke/editLevel/stepDown/resign).
// Doc id is always `${trustorId}_${trusteeId}` (see getTrusteeRelationshipId).
//
// The orchestration suite (test/orchestration/trusteeRelationshipService.test.ts) runs against
// permissive.rules and never exercises these rules — this file is what actually owns that.

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
const OTHER_USER = 'other-user-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'belrose-rules-test-trustee-relationships',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(() => testEnv.cleanup());
beforeEach(() => testEnv.clearFirestore());

const relPath = (trustorId: string, trusteeId: string) => `trusteeRelationships/${trustorId}_${trusteeId}`;

function invitePayload(overrides: Record<string, unknown> = {}) {
  return {
    trustorId: TRUSTOR,
    trusteeId: TRUSTEE,
    trustLevel: 'observer',
    isActive: false,
    status: 'pending',
    createdAt: new Date(),
    respondedAt: null,
    revokedAt: null,
    revokedBy: null,
    statusUpdateReason: null,
    onChainEvents: [],
    ...overrides,
  };
}

async function seedRelationship(overrides: Record<string, unknown> = {}) {
  const data = invitePayload(overrides);
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc(relPath(data.trustorId as string, data.trusteeId as string)).set(data);
  });
  return data;
}

describe('firestore.rules — trusteeRelationships — create', () => {
  it('lets the trustor create a valid pending invite', async () => {
    await assertSucceeds(
      testEnv.authenticatedContext(TRUSTOR).firestore().doc(relPath(TRUSTOR, TRUSTEE)).set(invitePayload())
    );
  });

  it('denies create when the caller is not the trustorId in the payload (impersonation)', async () => {
    await assertFails(
      testEnv.authenticatedContext(STRANGER).firestore().doc(relPath(TRUSTOR, TRUSTEE)).set(invitePayload())
    );
  });

  it('denies self-invite (trustorId == trusteeId)', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTOR)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTOR))
        .set(invitePayload({ trustorId: TRUSTOR, trusteeId: TRUSTOR }))
    );
  });

  it('denies create with a status other than pending', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTOR)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .set(invitePayload({ status: 'active' }))
    );
  });

  it('denies create with isActive true', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTOR)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .set(invitePayload({ isActive: true }))
    );
  });

  it('denies create with a trustLevel outside the enum', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTOR)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .set(invitePayload({ trustLevel: 'admin' }))
    );
  });

  it('denies create with a non-timestamp createdAt', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTOR)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .set(invitePayload({ createdAt: 'not-a-timestamp' }))
    );
  });

  it('denies create with a null trusteeId', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTOR)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .set(invitePayload({ trusteeId: null }))
    );
  });
});

describe('firestore.rules — trusteeRelationships — update — BRANCH 1 (trustor)', () => {
  // Branch 1 only pins trustorId/trusteeId immutable — otherwise unrestricted, since the
  // trustor is trusted to drive revoke/editLevel themselves (mirrors the app-level services,
  // which gate all the real business rules — status transitions, wallet checks, blockchain
  // success — before ever reaching this write). Documents that wide grant rather than assuming it.

  it('lets the trustor revoke an active relationship directly', async () => {
    await seedRelationship({ status: 'active', isActive: true });
    await assertSucceeds(
      testEnv
        .authenticatedContext(TRUSTOR)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ status: 'revoked', isActive: false, revokedAt: new Date(), revokedBy: TRUSTOR, statusUpdateReason: 'trustor_revoked' })
    );
  });

  it('lets the trustor change trustLevel on an active relationship directly', async () => {
    await seedRelationship({ status: 'active', isActive: true, trustLevel: 'observer' });
    await assertSucceeds(
      testEnv
        .authenticatedContext(TRUSTOR)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ trustLevel: 'controller', statusUpdateReason: 'trust_level_upgrade' })
    );
  });

  it('lets the trustor force status/isActive straight to active — documents current (wide) trustor grant, not a bug fix', async () => {
    await seedRelationship({ status: 'pending', isActive: false });
    await assertSucceeds(
      testEnv
        .authenticatedContext(TRUSTOR)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ status: 'active', isActive: true })
    );
  });

  it('denies the trustor changing trustorId', async () => {
    await seedRelationship({ status: 'active', isActive: true });
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTOR)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ trustorId: OTHER_USER })
    );
  });

  it('denies the trustor reassigning trusteeId to someone else', async () => {
    await seedRelationship({ status: 'active', isActive: true });
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTOR)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ trusteeId: OTHER_USER })
    );
  });

  it('denies a non-participant stranger from updating at all', async () => {
    await seedRelationship({ status: 'active', isActive: true });
    await assertFails(
      testEnv
        .authenticatedContext(STRANGER)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ status: 'revoked', isActive: false })
    );
  });
});

describe('firestore.rules — trusteeRelationships — update — BRANCH 2 (trustee accept/decline)', () => {
  it('lets the trustee accept a pending invite', async () => {
    await seedRelationship({ status: 'pending', isActive: false });
    await assertSucceeds(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ status: 'active', isActive: true, respondedAt: new Date(), onChainEvents: [{ action: 'accept' }] })
    );
  });

  it('lets the trustee decline a pending invite', async () => {
    await seedRelationship({ status: 'pending', isActive: false });
    await assertSucceeds(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ status: 'declined', isActive: false, revokedBy: TRUSTEE, onChainEvents: [{ action: 'decline' }] })
    );
  });

  // Regression: TrusteeRelationshipService.declineInvite's real Step 1 write includes
  // recordIdsGranted: [] in the same atomic batch as the status transition — same rationale as
  // the equivalent BRANCH 3 (resign) test above.
  it('lets the trustee decline while also clearing recordIdsGranted in the same write', async () => {
    await seedRelationship({
      status: 'pending',
      isActive: false,
      recordIdsGranted: [{ recordId: 'record-a', previousRole: null }],
    });
    await assertSucceeds(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({
          status: 'declined',
          isActive: false,
          revokedBy: TRUSTEE,
          recordIdsGranted: [],
        })
    );
  });

  it('denies the trustee "re-accepting" a relationship that is already active', async () => {
    await seedRelationship({ status: 'active', isActive: true });
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ status: 'active', isActive: true, respondedAt: new Date() })
    );
  });

  it('denies the trustee setting a target status outside [active, declined]', async () => {
    await seedRelationship({ status: 'pending', isActive: false });
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ status: 'revoked', isActive: false })
    );
  });

  it('denies the trustee sneaking a trustLevel change into the accept', async () => {
    await seedRelationship({ status: 'pending', isActive: false, trustLevel: 'observer' });
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ status: 'active', isActive: true, trustLevel: 'controller' })
    );
  });
});

describe('firestore.rules — trusteeRelationships — update — BRANCH 3 (trustee resign)', () => {
  it('lets the trustee resign from an active relationship', async () => {
    await seedRelationship({ status: 'active', isActive: true });
    await assertSucceeds(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({
          status: 'declined',
          isActive: false,
          revokedAt: new Date(),
          revokedBy: TRUSTEE,
          statusUpdateReason: 'trustee_resigned',
        })
    );
  });

  // Regression: TrusteeRelationshipService.resignAsTrustee's real Step 1 write includes
  // recordIdsGranted: [] in the same atomic batch as the status transition (clearing the
  // trustee's granted-record list has to land atomically with resign — a separate follow-up
  // write after status has already changed to 'declined' wouldn't be permitted by any branch).
  it('lets the trustee resign while also clearing recordIdsGranted in the same write', async () => {
    await seedRelationship({
      status: 'active',
      isActive: true,
      recordIdsGranted: [{ recordId: 'record-a', previousRole: null }],
    });
    await assertSucceeds(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({
          status: 'declined',
          isActive: false,
          revokedAt: new Date(),
          revokedBy: TRUSTEE,
          statusUpdateReason: 'trustee_resigned',
          recordIdsGranted: [],
        })
    );
  });

  it('denies a resign-shaped update when the relationship is still pending (not active yet)', async () => {
    // Distinct from branch 2's pending decline: this touches revokedAt/statusUpdateReason,
    // which aren't in branch 2's allowed key set, so it can't fall through to that branch either.
    await seedRelationship({ status: 'pending', isActive: false });
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({
          status: 'declined',
          isActive: false,
          revokedAt: new Date(),
          revokedBy: TRUSTEE,
          statusUpdateReason: 'trustee_resigned',
        })
    );
  });

  it('denies the trustee resigning to a status other than declined', async () => {
    await seedRelationship({ status: 'active', isActive: true });
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ status: 'revoked', isActive: false, revokedAt: new Date(), revokedBy: TRUSTEE })
    );
  });

  it('denies the trustee sneaking a trustLevel change into the resign', async () => {
    await seedRelationship({ status: 'active', isActive: true, trustLevel: 'custodian' });
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({
          status: 'declined',
          isActive: false,
          revokedAt: new Date(),
          revokedBy: TRUSTEE,
          trustLevel: 'observer',
        })
    );
  });
});

describe('firestore.rules — trusteeRelationships — update — BRANCH 4 (trustee self-downgrade)', () => {
  it('lets the trustee step down from controller to custodian', async () => {
    await seedRelationship({ status: 'active', isActive: true, trustLevel: 'controller' });
    await assertSucceeds(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ trustLevel: 'custodian', statusUpdateReason: 'trust_level_downgrade' })
    );
  });

  it('lets the trustee step down from controller straight to observer', async () => {
    await seedRelationship({ status: 'active', isActive: true, trustLevel: 'controller' });
    await assertSucceeds(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ trustLevel: 'observer', statusUpdateReason: 'trust_level_downgrade' })
    );
  });

  it('lets the trustee step down from custodian to observer', async () => {
    await seedRelationship({ status: 'active', isActive: true, trustLevel: 'custodian' });
    await assertSucceeds(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ trustLevel: 'observer', statusUpdateReason: 'trust_level_downgrade' })
    );
  });

  it('denies the trustee stepping "up" from custodian to controller', async () => {
    await seedRelationship({ status: 'active', isActive: true, trustLevel: 'custodian' });
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ trustLevel: 'controller' })
    );
  });

  it('denies the trustee self-changing trustLevel while already at observer (nothing lower to go to)', async () => {
    await seedRelationship({ status: 'active', isActive: true, trustLevel: 'observer' });
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ trustLevel: 'custodian' })
    );
  });

  it('denies a same-level no-op "downgrade"', async () => {
    await seedRelationship({ status: 'active', isActive: true, trustLevel: 'custodian' });
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ trustLevel: 'custodian' })
    );
  });

  it('denies a downgrade attempt while the relationship is only pending', async () => {
    await seedRelationship({ status: 'pending', isActive: false, trustLevel: 'controller' });
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ trustLevel: 'observer' })
    );
  });

  it('denies sneaking an unrelated field (isActive) into the downgrade', async () => {
    await seedRelationship({ status: 'active', isActive: true, trustLevel: 'controller' });
    await assertFails(
      testEnv
        .authenticatedContext(TRUSTEE)
        .firestore()
        .doc(relPath(TRUSTOR, TRUSTEE))
        .update({ trustLevel: 'observer', isActive: false })
    );
  });
});

describe('firestore.rules — trusteeRelationships — delete', () => {
  it('denies delete for the trustor, the trustee, and a stranger alike — soft delete only', async () => {
    await seedRelationship({ status: 'revoked', isActive: false });

    await assertFails(testEnv.authenticatedContext(TRUSTOR).firestore().doc(relPath(TRUSTOR, TRUSTEE)).delete());
    await assertFails(testEnv.authenticatedContext(TRUSTEE).firestore().doc(relPath(TRUSTOR, TRUSTEE)).delete());
    await assertFails(testEnv.authenticatedContext(STRANGER).firestore().doc(relPath(TRUSTOR, TRUSTEE)).delete());
  });
});

describe('firestore.rules — trusteeRelationships — read', () => {
  it('lets any authenticated user read a relationship, including a stranger — no sensitive data on this doc', async () => {
    await seedRelationship({ status: 'active', isActive: true });

    await assertSucceeds(testEnv.authenticatedContext(TRUSTOR).firestore().doc(relPath(TRUSTOR, TRUSTEE)).get());
    await assertSucceeds(testEnv.authenticatedContext(TRUSTEE).firestore().doc(relPath(TRUSTOR, TRUSTEE)).get());
    await assertSucceeds(testEnv.authenticatedContext(STRANGER).firestore().doc(relPath(TRUSTOR, TRUSTEE)).get());
  });

  it('denies an unauthenticated read', async () => {
    await seedRelationship({ status: 'active', isActive: true });
    await assertFails(testEnv.unauthenticatedContext().firestore().doc(relPath(TRUSTOR, TRUSTEE)).get());
  });
});
