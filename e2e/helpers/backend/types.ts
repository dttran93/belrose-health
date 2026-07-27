// e2e/helpers/backend/types.ts
//
// Central type file for 2 e2e backend testing suites (emulated and staging).
// having a single file makes sure the testing suites stay consistent and interchangeable.

export interface CreateAuthUserParams {
  uid: string;
  email: string;
  password?: string;
  emailVerified?: boolean;
  displayName?: string;
}

export interface ArrayRemoval {
  path: string;
  field: string;
  value: unknown;
}

export interface CleanupRefs {
  /** Doc paths to delete outright — for docs a spec seeded directly (invites/, recordRequests/, guestInvites/). */
  docPaths?: string[];
  /** Deletes the Auth user AND its users/{uid} Firestore doc — every registered user has both. */
  authUids?: string[];
  /** Same as authUids, but resolved to a uid via getUserByEmail first (for uids the test never learns). */
  authEmails?: string[];
  /** For fields on a doc that must persist (e.g. a fixture record's `viewers` array) — removes just one array entry rather than deleting the whole doc. */
  arrayRemovals?: ArrayRemoval[];
}

export interface TestBackend {
  seedInvite(email: string): Promise<void>;
  seedDoc(path: string, data: Record<string, unknown>): Promise<void>;
  createAuthUser(params: CreateAuthUserParams): Promise<void>;
  createGuestAuthUser(uid: string, email: string): Promise<void>;
  /** Marks the given account's email as verified — no real inbox required either way. */
  verifyEmail(email: string): Promise<void>;
  /** No-op under the emulator backend, since that state resets on the next boot anyway. */
  cleanup(refs: CleanupRefs): Promise<void>;
}
