// e2e/recordShareGuestClaim.spec.ts
//
// A guest claims their account after having a record shared with them (guestContext="sharing"),
// as opposed to requestFlowGuestClaim.spec.ts's guestContext="record_request". The two aren't
// interchangeable: "record_request" specifically skips GuestClaimAccountModal's Step 1a (the
// wrappedKeys rewrap) — see that file's header — so this is the only spec that exercises it.
//
// Staging-only. Unlike every other fixture, the record here (see helpers/fixtures/record.ts)
// can't be seeded via Admin SDK — its encrypted content lives in real Cloud Storage, created
// through the real upload pipeline, which is out of scope for this account-creation-focused
// suite (that's a job for a future records-focused e2e suite). findGuestInviteCode (from
// helpers/backend/staging directly, not the TestBackend interface — see its own comment) is
// staging-only for the same reason: no fixture record means nothing to share on the emulator.
//
// Flow: sign in as the fixture guardian (Johnny Hopkins) → open the fixture record → Manage
// Access → Share via Email with a fresh guest address (real createGuestInvite CF call — mints
// the guest's keypair, wraps the record's file key with it) → capture guestUid +
// guestPrivateKeyBase64 from the response, and inviteCode by querying Firestore (the response
// doesn't include it — only the real invite email does) → visit /invite as the guest (real
// redeemGuestInvite CF call, signs in, lands on a records/health-profile view) → click "Create
// Account" on GuestBanner (guestContext fetched from the real guestInvites doc) → claim for real.

import { test, expect } from '@playwright/test';
import { getBackend } from './helpers/backend';
import { findGuestInviteCode } from './helpers/backend/staging';
import { FIXTURE_GUARDIAN } from './helpers/fixtures/guardian';
import { RECORD_ID } from './helpers/fixtures/record';
import { loginAsFixtureUser } from './helpers/loginAsFixtureUser';
import { driveGuestClaimFlow } from './helpers/driveGuestClaimFlow';

const backend = getBackend();
let createdGuestUid: string | undefined;

test.afterEach(async () => {
  if (!createdGuestUid) return;
  // Deactivates on-chain + deletes the Auth user + Firestore users/{uid} doc (see staging.ts).
  // Known gap: this doesn't remove the guestInvites doc, the wrappedKeys/{RECORD_ID}_{guestUid}
  // doc, or the guestUid this run added to the fixture record's `viewers` array — all minor,
  // slowly-accumulating cruft on the persistent fixture record, left for a follow-up pass
  // (same shape as the dependents.spec.ts cleanup work) rather than blocking this spec.
  await backend.cleanup({ authUids: [createdGuestUid] });
  createdGuestUid = undefined;
});

test('guest claims their account after a record is shared with them', async ({ page }) => {
  // RECORD_ID only exists on real staging Firestore (see fixtures/record.ts) — nothing to share
  // against the emulator's empty, per-run-wiped Firestore.
  test.skip(process.env.E2E_BACKEND !== 'staging', 'Requires the staging-only fixture record');
  test.setTimeout(300_000);

  const stamp = Date.now();
  const guestEmail = `e2e-guest-${stamp}@example.com`;
  const claimPassword = 'GuestSecure!2026Pw';

  await loginAsFixtureUser(page, backend, FIXTURE_GUARDIAN);

  // ── Share the fixture record with a fresh guest email ──────────────────────────────────
  await page.goto(`/app/records/${RECORD_ID}`);
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Manage Access' }).click();

  // Regression guard for the wrappedKeys `list` rule fix (firestore.rules) — this used to fail
  // with "Failed to load access data..." because the rule only covered grantedBy/userId, not a
  // query filtered by recordId.
  await expect(page.getByText('Failed to load access data')).not.toBeVisible();

  await page.getByRole('button', { name: 'Share via Email' }).click();
  await page.getByPlaceholder('doctor@clinic.com').fill(guestEmail);

  const createGuestInviteResponse = page.waitForResponse(
    res => res.request().method() === 'POST' && res.url().includes('createGuestInvite')
  );
  await page.getByRole('button', { name: 'Send Invite' }).click();

  const responseBody = await (await createGuestInviteResponse).json();
  const guestUid: string | undefined = responseBody.result?.guestUid;
  const guestPrivateKeyBase64: string | undefined = responseBody.result?.guestPrivateKeyBase64;
  if (!guestUid || !guestPrivateKeyBase64) {
    throw new Error(
      `createGuestInvite response missing guestUid/guestPrivateKeyBase64 — got ${JSON.stringify(responseBody)}`
    );
  }
  createdGuestUid = guestUid;

  // Not in the response (functions/src/handlers/createGuestInvite.ts only ever sends it in the
  // real invite email) — the guestInvites doc ID is server-generated, so this has to be a query.
  const inviteCode = await findGuestInviteCode(guestUid);

  // ── Visit the invite link as the guest (real redeemGuestInvite CF call + sign-in) ──────────
  // Full navigation (not an in-app route change), so this cleanly replaces Johnny's session
  // rather than running alongside it — GuestInvitePage signs in fresh via custom token.
  await page.goto(`/invite?code=${inviteCode}#${guestPrivateKeyBase64}`);

  // GuestInvitePage runs through loading → bridging → redirecting, landing on either
  // /app/health-profile/<subjectId> or /app/all-records (our fixture record has no `subjects`,
  // so it's the latter) — wait for GuestBanner instead of a specific URL, since either is fine.
  await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Create Account' }).click();

  // ── GuestClaimAccountModal opens with guestContext="sharing" (useGuestContext reads it off
  // the real guestInvites doc), so Step 1a's wrappedKeys rewrap runs for real here ──
  await driveGuestClaimFlow(page, { firstName: 'E2E', lastName: 'Sharer', password: claimPassword });

  // ── Claimed: banner is gone since isGuest flipped to false and AuthContext refreshed ──
  await expect(page.getByText(/temporary guest/)).not.toBeVisible();
});
