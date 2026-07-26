// e2e/helpers/guestAuthUser.ts
//
// Creates a Firebase Auth user with a caller-chosen uid directly via the Auth emulator's
// Admin-scoped REST surface — the same `Authorization: Bearer owner` privileged path
// firebase-admin's `auth().createUser({ uid, ... })` itself goes through when pointed at the
// emulator. Real guest accounts are created this way too (createOrRetrieveGuestAccount calls
// admin.auth().createUser server-side) — this just lets e2e tests seed that same end state
// without needing a real invite email round trip.

const AUTH_EMULATOR_HOST = 'localhost:9099';

export interface CreateAuthUserParams {
  uid: string;
  email: string;
  password?: string;
  emailVerified?: boolean;
  displayName?: string;
}

export async function createAuthUser(projectId: string, params: CreateAuthUserParams): Promise<void> {
  const res = await fetch(
    `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({
        localId: params.uid,
        email: params.email,
        password: params.password,
        emailVerified: params.emailVerified ?? false,
        displayName: params.displayName ?? params.email,
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    // Idempotent by design: the Auth emulator's state persists across every test in the same
    // emulators:exec session (only wiped on the next fresh boot), not just across separate runs —
    // so a fixed-uid fixture (see helpers/fixtures/guardian.ts) legitimately gets re-seeded once per test in
    // a multi-test file. DUPLICATE_LOCAL_ID means the user is already there in the exact state we
    // want, which is success, not failure — mirrors real createOrRetrieveGuestAccount's own
    // getUserByEmail-then-createUser fallback in functions/src/utils/guestAccountUtils.ts.
    if (body.includes('DUPLICATE_LOCAL_ID') || body.includes('EMAIL_EXISTS')) {
      return;
    }
    throw new Error(`Failed to create auth user ${params.uid}: ${res.status} ${body}`);
  }
}

export async function createGuestAuthUser(
  projectId: string,
  uid: string,
  email: string
): Promise<void> {
  await createAuthUser(projectId, { uid, email, emailVerified: true, displayName: email });
}
