// e2e/helpers/backend/emulator.ts
//
// Delegates to the existing emulator-only REST helpers unchanged — this is exactly what the
// four specs did directly before the TestBackend seam was introduced. cleanup() is a no-op:
// `firebase emulators:exec` wipes Firestore/Auth on every boot, so there's nothing to tear down.

import type { TestBackend, CreateAuthUserParams, CleanupRefs } from './types';
import { seedInvite } from '../seedInvite';
import { seedFirestoreDoc } from '../firestoreRest';
import {
  createAuthUser as createAuthUserEmulator,
  createGuestAuthUser as createGuestAuthUserEmulator,
} from '../guestAuthUser';
import { getLatestOobCode, applyOobCode } from '../authEmulator';

function projectId(): string {
  const id = process.env.VITE_FIREBASE_PROJECT_ID;
  if (!id) {
    throw new Error(
      'VITE_FIREBASE_PROJECT_ID must be set in the environment (same value the app itself ' +
        'uses) so the emulator REST helpers target the right project namespace.'
    );
  }
  return id;
}

export const emulatorBackend: TestBackend = {
  async seedInvite(email) {
    await seedInvite(projectId(), email);
  },

  async seedDoc(path, data) {
    await seedFirestoreDoc(projectId(), path, data);
  },

  async createAuthUser(params: CreateAuthUserParams) {
    await createAuthUserEmulator(projectId(), params);
  },

  async createGuestAuthUser(uid, email) {
    await createGuestAuthUserEmulator(projectId(), uid, email);
  },

  async verifyEmail(email) {
    const oobCode = await getLatestOobCode(projectId(), email, 'VERIFY_EMAIL');
    await applyOobCode(oobCode);
  },

  async cleanup(_refs: CleanupRefs) {
    // Intentional no-op — see file header.
  },
};
