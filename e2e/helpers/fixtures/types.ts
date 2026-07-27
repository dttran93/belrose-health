// e2e/helpers/fixtures/types.ts
//
// A fixture is a real, pre-existing account reused across e2e runs instead of registering fresh
// through the UI every time — see guardian.ts for why FIXTURE_GUARDIAN specifically needs this.
// `doc` is the exact real Firestore users/{uid} snapshot for the account (only obtainable by
// actually running the real registration flow once and capturing the result — see guardian.ts's
// header for the constraints that come with that).

export interface FixtureUser {
  uid: string;
  email: string;
  password: string;
  displayName: string;
  doc: Record<string, unknown>;
}
