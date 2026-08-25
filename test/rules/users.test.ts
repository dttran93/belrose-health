// test/rules/users.test.ts
//
// firestore.rules — users/{userId} — the foundational profile collection every account
// feature reads/writes. No dedicated rules-layer coverage existed for this collection before
// this file, despite it being one of the most heavily-used in the app.
//
// The orchestration suite (test/orchestration/userService.test.ts, registrationCompletion.test.ts)
// runs against permissive.rules and never exercises these rules — this file is what actually
// owns that.

import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const OWNER = 'owner-uid';
const STRANGER = 'stranger-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'belrose-rules-test-users',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(() => testEnv.cleanup());
beforeEach(() => testEnv.clearFirestore());

function userPath(uid: string) {
  return `users/${uid}`;
}

function profilePayload(overrides: Record<string, unknown> = {}) {
  return {
    uid: OWNER,
    email: 'owner@example.com',
    displayName: 'Owner',
    ...overrides,
  };
}

async function seedProfile(uid: string, overrides: Record<string, unknown> = {}) {
  const data = profilePayload({ uid, ...overrides });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc(userPath(uid)).set(data);
  });
  return data;
}

describe('firestore.rules — users — create', () => {
  it('lets the owner create their own profile with no isPlatformAdmin field', async () => {
    await assertSucceeds(
      testEnv.authenticatedContext(OWNER).firestore().doc(userPath(OWNER)).set(profilePayload())
    );
  });

  it('lets the owner explicitly set isPlatformAdmin: false', async () => {
    await assertSucceeds(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(userPath(OWNER))
        .set(profilePayload({ isPlatformAdmin: false }))
    );
  });

  it('denies the owner self-assigning isPlatformAdmin: true', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(userPath(OWNER))
        .set(profilePayload({ isPlatformAdmin: true }))
    );
  });

  it('denies creating a profile for a different uid (impersonation)', async () => {
    await assertFails(
      testEnv.authenticatedContext(STRANGER).firestore().doc(userPath(OWNER)).set(profilePayload())
    );
  });

  it('denies unauthenticated create', async () => {
    await assertFails(
      testEnv.unauthenticatedContext().firestore().doc(userPath(OWNER)).set(profilePayload())
    );
  });
});

describe('firestore.rules — users — credibility / credentialFloor (server-only fields)', () => {
  it('denies the owner self-assigning a credibility score on create', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(userPath(OWNER))
        .set(profilePayload({ credibility: { score: 999, lastUpdated: new Date() } }))
    );
  });

  it('denies the owner self-assigning a credentialFloor on create', async () => {
    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(userPath(OWNER))
        .set(profilePayload({ credentialFloor: 900 }))
    );
  });

  it('denies the owner setting their own credibility via update', async () => {
    await seedProfile(OWNER);
    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(userPath(OWNER))
        .update({ credibility: { score: 999, lastUpdated: new Date() } })
    );
  });

  it('denies the owner setting their own credentialFloor via update', async () => {
    await seedProfile(OWNER);
    await assertFails(
      testEnv.authenticatedContext(OWNER).firestore().doc(userPath(OWNER)).update({ credentialFloor: 900 })
    );
  });

  it('lets the owner update an unrelated field while an existing credibility score is left untouched', async () => {
    await seedProfile(OWNER, { credibility: { score: 700, lastUpdated: new Date() } });
    await assertSucceeds(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(userPath(OWNER))
        .update({ displayName: 'New Name' })
    );
  });
});

describe('firestore.rules — users — read', () => {
  it('lets any authenticated user read any profile', async () => {
    await seedProfile(OWNER);
    await assertSucceeds(
      testEnv.authenticatedContext(STRANGER).firestore().doc(userPath(OWNER)).get()
    );
  });

  it('denies unauthenticated read', async () => {
    await seedProfile(OWNER);
    await assertFails(testEnv.unauthenticatedContext().firestore().doc(userPath(OWNER)).get());
  });
});

describe('firestore.rules — users — update', () => {
  it('lets the owner update an unrelated field when isPlatformAdmin was never set', async () => {
    await seedProfile(OWNER);
    await assertSucceeds(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(userPath(OWNER))
        .update({ displayName: 'New Name' })
    );
  });

  it('lets the owner update an unrelated field while an existing isPlatformAdmin:true is left untouched', async () => {
    await seedProfile(OWNER, { isPlatformAdmin: true });
    await assertSucceeds(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(userPath(OWNER))
        .update({ displayName: 'New Name' })
    );
  });

  it('denies the owner self-escalating isPlatformAdmin from unset to true', async () => {
    await seedProfile(OWNER);
    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(userPath(OWNER))
        .update({ isPlatformAdmin: true })
    );
  });

  it('denies the owner self-revoking an existing isPlatformAdmin:true', async () => {
    await seedProfile(OWNER, { isPlatformAdmin: true });
    await assertFails(
      testEnv
        .authenticatedContext(OWNER)
        .firestore()
        .doc(userPath(OWNER))
        .update({ isPlatformAdmin: false })
    );
  });

  it('denies a stranger updating someone else\'s profile', async () => {
    await seedProfile(OWNER);
    await assertFails(
      testEnv
        .authenticatedContext(STRANGER)
        .firestore()
        .doc(userPath(OWNER))
        .update({ displayName: 'Hijacked' })
    );
  });

  it('denies unauthenticated update', async () => {
    await seedProfile(OWNER);
    await assertFails(
      testEnv
        .unauthenticatedContext()
        .firestore()
        .doc(userPath(OWNER))
        .update({ displayName: 'Hijacked' })
    );
  });
});

describe('firestore.rules — users — delete', () => {
  it('lets the owner delete their own profile', async () => {
    await seedProfile(OWNER);
    await assertSucceeds(
      testEnv.authenticatedContext(OWNER).firestore().doc(userPath(OWNER)).delete()
    );
  });

  it('denies a stranger deleting someone else\'s profile', async () => {
    await seedProfile(OWNER);
    await assertFails(
      testEnv.authenticatedContext(STRANGER).firestore().doc(userPath(OWNER)).delete()
    );
  });

  it('denies unauthenticated delete', async () => {
    await seedProfile(OWNER);
    await assertFails(testEnv.unauthenticatedContext().firestore().doc(userPath(OWNER)).delete());
  });
});
