// e2e/guestAccessGating.spec.ts
//
// Guests have no blockchain wallet (see fulfillRequestService.ts's fulfillAsGuest doc comment),
// so every on-chain-write surface must show the GuestFeatureGate upsell instead of the real
// manager UI when the caller is a guest. This is the regression coverage for that: before this
// fix, PermissionManager/SubjectManager had no guest gate at all, and a guest with viewer access
// on a shared record could navigate straight to ?view=permissions or ?view=subject and open a
// grant/anchor dialog that would throw deep inside PermissionsService (no wallet.address to sign
// with). Settings (including Vouches) is gated as a whole page — see pages/Settings.tsx — since
// every section is either meaningless or actively wrong for a passwordless guest account.
//
// Setup mirrors recordShareGuestClaim.spec.ts (share the fixture record with a fresh guest,
// redeem the invite) but stops short of claiming — the whole point here is to exercise the
// still-a-guest state, not the post-claim state that spec covers.

import { test, expect } from '@playwright/test';
import { getBackend } from './helpers/backend';
import { findGuestInvite } from './helpers/backend/staging';
import { FIXTURE_GUARDIAN } from './helpers/fixtures/guardian';
import { RECORD_ID } from './helpers/fixtures/record';
import { loginAsFixtureUser } from './helpers/loginAsFixtureUser';

const backend = getBackend();
let cleanupState: { guestUid: string; guestInviteDocPath?: string } | undefined;

test.afterEach(async () => {
  if (!cleanupState) return;
  const { guestUid, guestInviteDocPath } = cleanupState;
  await backend.cleanup({
    authUids: [guestUid],
    docPaths: [
      ...(guestInviteDocPath ? [guestInviteDocPath] : []),
      `wrappedKeys/${RECORD_ID}_${guestUid}`,
    ],
    arrayRemovals: [{ path: `records/${RECORD_ID}`, field: 'viewers', value: guestUid }],
  });
  cleanupState = undefined;
});

test('a guest with viewer access sees upsell gates instead of on-chain-write UI', async ({
  page,
}) => {
  test.skip(process.env.E2E_BACKEND !== 'staging', 'Requires the staging-only fixture record');
  test.setTimeout(180_000);

  const stamp = Date.now();
  const guestEmail = `e2e-guest-gating-${stamp}@example.com`;

  await loginAsFixtureUser(page, backend, FIXTURE_GUARDIAN);

  // ── Share the fixture record with a fresh guest email ──────────────────────────────────
  await page.goto(`/app/records/${RECORD_ID}`);
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Manage Access' }).click();
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
  cleanupState = { guestUid };

  const { inviteCode, docPath: guestInviteDocPath } = await findGuestInvite(guestUid);
  cleanupState = { guestUid, guestInviteDocPath };

  // ── Redeem the invite as the guest — stop here, do NOT claim ───────────────────────────
  await page.goto(`/invite?code=${inviteCode}#${guestPrivateKeyBase64}`);
  await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible({
    timeout: 60_000,
  });

  // ── Permissions: gated ──────────────────────────────────────────────────────────────────
  await page.goto(`/app/records/${RECORD_ID}?view=permissions`);
  await expect(
    page.getByText('Create an account to manage sharing permissions')
  ).toBeVisible();

  // ── Subject: gated ──────────────────────────────────────────────────────────────────────
  await page.goto(`/app/records/${RECORD_ID}?view=subject`);
  await expect(page.getByText('Create an account to manage record subjects')).toBeVisible();

  // ── Follow-ups: only "Relate to a request" is ever reachable, never "Verify this record" ──
  await page.goto(`/app/records/${RECORD_ID}?view=follow-up`);
  await expect(page.getByText('Verify this record')).not.toBeVisible();
  await expect(page.getByText('Tag a subject')).not.toBeVisible();

  // ── Settings: gated as a whole (name/email/trustees/dependents/vouches/billing are all
  // either meaningless or actively wrong for a passwordless, wallet-less guest) ──────────────
  await page.goto('/app/settings/vouches');
  await expect(page.getByText('Create an account to access account settings')).toBeVisible();
});
