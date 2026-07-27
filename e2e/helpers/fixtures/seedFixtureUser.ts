// e2e/helpers/fixtures/seedFixtureUser.ts
//
// Backend-agnostic — seeding a fixture is just "create this auth user" + "write this Firestore
// doc," both of which are already generic TestBackend methods. No emulator/staging-specific code
// needed here at all; getBackend() (../backend/) already picked the right implementation of
// createAuthUser/seedDoc before this runs.

import type { TestBackend } from '../backend/types';
import type { FixtureUser } from './types';

export async function seedFixtureUser(backend: TestBackend, fixture: FixtureUser): Promise<void> {
  await backend.createAuthUser({
    uid: fixture.uid,
    email: fixture.email,
    password: fixture.password,
    emailVerified: true,
    displayName: fixture.displayName,
  });

  await backend.seedDoc(`users/${fixture.uid}`, fixture.doc);
}
