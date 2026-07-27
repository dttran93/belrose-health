// e2e/dependents.spec.ts
//
// Guardian creates a dependent through the real UI (real wallet generation + real on-chain
// registration via createDependentAccount CF). The switch-into-dependent / switch-back flow is a
// separate test below, marked test.fail() — see its own header comment for why.
//
// The guardian itself is a reused fixture account (see helpers/fixtures/guardian.ts) rather than a fresh
// registration per run — the guardian's own registration flow (real crypto + real on-chain call +
// email-verification UI) is already covered end-to-end by signup.spec.ts, and duplicating it here
// just doubled this spec's exposure to on-chain/emulator flakiness without testing anything this
// file doesn't already cover elsewhere. bootstrapDependentTrustee (called inside
// createDependentAccount) does require the guardian to be genuinely registered on-chain already,
// though — that's not something a Firestore-only seed could fake on its own. The fixture's
// on-chain state is real (already confirmed on Base Sepolia); only its Firestore/Auth presence
// needs reseeding each run, since the emulator wipes those on every boot.
//
// The deeper guarantee that EncryptionKeyManager.clearSession() actually fires at the right point
// relative to signInWithCustomToken (so no key material bleeds across the switch boundary) is
// unit-tested directly in accountSwitchService.test.ts — the switch test below proves the
// user-visible consequence of that (switching accounts requires re-entering that account's own
// password to unlock, and shows that account's own identity), not the internals.

import { test, expect, type Page } from '@playwright/test';
import { FIXTURE_GUARDIAN } from './helpers/fixtures/guardian';
import { loginAsFixtureUser } from './helpers/loginAsFixtureUser';
import { getBackend } from './helpers/backend';

const backend = getBackend();
// Dependent uids created by whichever test just ran — read by afterEach for cleanup. The guardian
// fixture itself is never in here; it's meant to persist permanently (see fixtures/guardian.ts).
let createdDependentUids: string[] = [];

test.afterEach(async () => {
  if (createdDependentUids.length === 0) return;
  // trusteeRelationships/{dependentUid}_{guardianUid} — the controller relationship
  // createDependentAccount's bootstrapDependentTrustee step writes (see
  // functions/src/handlers/createDependentAccount.ts) — deterministic id, no query needed.
  await backend.cleanup({
    authUids: createdDependentUids,
    docPaths: createdDependentUids.map(uid => `trusteeRelationships/${uid}_${FIXTURE_GUARDIAN.uid}`),
  });
  createdDependentUids = [];
});

async function loginAsFixtureGuardian(page: Page): Promise<void> {
  await loginAsFixtureUser(page, backend, FIXTURE_GUARDIAN);
}

/** Opens the bottom-left account menu and clicks "Switch Account". */
async function openAccountSwitcher(page: Page): Promise<void> {
  // The button showing the active account's name/avatar is the only one in the sidebar whose
  // accessible name is driven by the current user's own displayName — no stable test id exists
  // on it, so this locates it by the ArrowLeftRight-adjacent "Switch Account" menu item instead:
  // click whichever button currently shows a ChevronUp/name combo to open the dropdown first.
  await page.locator('button:has(svg.lucide-chevron-up)').first().click();
  await page.getByRole('button', { name: 'Switch Account' }).click();
}

/**
 * Real wallet generation + on-chain registration happens here too (createDependentAccount CF).
 * firstName/lastName must be distinct per test — both tests in this file share the same fixture
 * guardian and Firestore state within a single emulator session, so two tests both creating a
 * "Little Dependent" would collide (the second test's own dependent-list assertions would match
 * two cards instead of one, failing for an unrelated reason before ever reaching what it's
 * actually testing). Keeping it timestamped is also cheap insurance under the staging backend:
 * if a prior run's afterEach never got to run (process killed mid-test), a leftover dependent
 * from that run won't collide with this one's assertions either.
 *
 * Returns the dependent's uid — captured directly from createDependentAccount's real response
 * ({ uid, walletAddress, smartAccountAddress }, see functions/src/handlers/createDependentAccount.ts)
 * rather than guessed, since the dependent has no email the test ever learns any other way — so
 * callers can pass it to backend.cleanup({ authUids: [...] }) same as signup.spec.ts does by email.
 */
async function createDependent(
  page: Page,
  firstName: string,
  lastName: string,
  dependentPassword: string
): Promise<string> {
  await page.goto('/app/dependents/create');

  await page.locator('input[placeholder="Jane"]').fill(firstName);
  await page.locator('input[placeholder="Smith"]').fill(lastName);
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.locator('input[placeholder="At least 8 characters"]').fill(dependentPassword);
  await page.locator('input[placeholder="Repeat the password"]').fill(dependentPassword);

  const createDependentResponse = page.waitForResponse(
    res => res.request().method() === 'POST' && res.url().includes('createDependentAccount')
  );
  await page.getByRole('button', { name: 'Create Account' }).click();
  const responseBody = await (await createDependentResponse).json();
  const dependentUid: string | undefined = responseBody.result?.uid;
  if (!dependentUid) {
    throw new Error(
      `createDependentAccount response had no result.uid — got ${JSON.stringify(responseBody)}`
    );
  }

  await expect(page.getByText(new RegExp(`Save ${firstName}'s recovery key`))).toBeVisible({
    timeout: 60_000,
  });
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'Complete Registration' }).click();

  await expect(page.getByRole('heading', { name: 'Account Created' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Dependents' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/dependents/);
  // UserCard (DependentsSettingsPage's list item) renders BOTH a mobile and a desktop layout
  // simultaneously in the DOM (Tailwind `sm:hidden` / `hidden sm:flex`, CSS-only toggling) — a
  // bare getByText match resolves to both spans and hits Playwright's strict-mode violation.
  // `:visible` narrows to whichever one the current viewport actually shows.
  await expect(
    page.locator('span:visible', { hasText: `${firstName} ${lastName}` })
  ).toBeVisible();

  return dependentUid;
}

/**
 * Real on-chain trustee revoke for the dependent-guardian relationship bootstrapDependentTrustee
 * created. MemberRoleManager.revokeTrustee is onlyActiveMember and requires the caller to BE the
 * trustor or trustee — deliberately not admin-callable (see bootstrapDependentTrustee's own doc
 * comment in MemberRoleManager.sol: "Revocation flows through the normal onlyActiveMember
 * revokeTrustee path — no admin involvement after creation"). So the only way to actually revoke
 * it is a real signed transaction from one of their own live sessions — this drives the guardian
 * through the real "Delete account" UI (DependentsSettingsPage → SwitchAndDeleteDialog), which
 * switches into the dependent's own session (unlocked with the password the guardian set for them
 * at creation) and runs AccountDeletionService.deleteMyAccount() as the dependent — Step 2 of
 * that service calls TrusteeRelationshipService.revokeTrustee(guardianUid), a genuine on-chain tx.
 *
 * Ends fully signed out (deleteMyAccount signs out) — nothing to switch back to afterward, since
 * every other test in this file starts its own fresh loginAsFixtureGuardian() anyway.
 *
 * Two things this does NOT do, both still needed from the Admin-SDK cleanup path afterward:
 * deleteOwnAccount (the CF this calls) never touches on-chain MEMBER status (still "Active",
 * needs deactivateOnChain), and revokeTrustee only soft-updates trusteeRelationships to
 * status:'revoked' (see trusteeRelationshipService.ts) rather than deleting the doc.
 */
async function deleteDependentViaRealFlow(
  page: Page,
  dependentUid: string,
  dependentPassword: string
): Promise<void> {
  // Scope to this dependent's card by uid, not displayName — DependentsSettingsPage's list
  // currently renders every card as "Unknown User" regardless of the underlying account's real
  // name (a separate, apparently pre-existing display bug — the uid text next to it does render
  // correctly, and is what UserCard's copy-to-clipboard row shows either way). .last() picks the
  // innermost div matching both conditions (Playwright locators resolve in document order,
  // outermost-to-innermost for nested matches), then :visible narrows to whichever of UserCard's
  // mobile/desktop layouts the current viewport actually renders (see createDependent's own
  // comment on that same CSS-toggle pattern).
  const card = page
    .locator('div', { hasText: dependentUid })
    .filter({ has: page.locator('button[title="More options"]') })
    .last();
  // Explicit scroll before interacting — with many cards on the page (this guardian
  // accumulates them across runs), Playwright's own auto-scroll-into-view doesn't reliably
  // reach a card near the bottom of the list before opening its dropdown, leaving the dropdown
  // itself positioned outside the viewport ("element is outside of the viewport", never resolves
  // even after 150s of retries).
  await card.scrollIntoViewIfNeeded();
  await card.locator('button[title="More options"]:visible').click();
  const deleteAccountItem = page.getByRole('button', { name: 'Delete account' });
  await deleteAccountItem.scrollIntoViewIfNeeded();
  await deleteAccountItem.click();

  await expect(page.getByRole('heading', { name: 'Delete Dependent Account' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Switching clears the encryption session — same pattern as the account-switch test below.
  await expect(page.getByText('Unlock Account')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Password').fill(dependentPassword);
  await page.getByRole('button', { name: 'Unlock' }).click();

  // Lands on /app/settings/account?action=delete-account, which auto-opens DeleteAccountDialog.
  await expect(page.getByRole('heading', { name: 'Delete Account' })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByPlaceholder('DELETE').fill('DELETE');

  // Chains records/trustees(real on-chain revoke)/subject-requests/profile/account phases —
  // the on-chain revoke is the slow part, same order of magnitude as the other on-chain waits
  // elsewhere in this suite.
  await page.getByRole('button', { name: 'Delete Account' }).click();
  await expect(page).not.toHaveURL(/\/app/, { timeout: 60_000 });
}

test('guardian creates a dependent', async ({ page }) => {
  test.setTimeout(150_000);

  await loginAsFixtureGuardian(page);
  const firstName = 'Little';
  const lastName = `Dependent${Date.now()}`;
  const dependentPassword = 'DepSecure!2026Pw';
  const uid = await createDependent(page, firstName, lastName, dependentPassword);
  createdDependentUids.push(uid);

  await deleteDependentViaRealFlow(page, uid, dependentPassword);
});

test('guardian switches into a dependent account and back', async ({ page }) => {
  test.setTimeout(120_000);

  // KNOWN BROKEN — local Functions emulator only, not our application code.
  //
  // switchToDependent/switchToGuardian are firebase-functions v2 onCall handlers that complete
  // in single-digit milliseconds server-side (confirmed via Functions emulator logs, and via real
  // production Cloud Function logs where this exact function works correctly). Against the LOCAL
  // Functions emulator specifically, the client's httpsCallable() promise for these calls never
  // resolves — reproduced identically against both `firebase emulators:exec` and a persistent
  // `firebase emulators:start` instance, so it isn't an artifact of either wrapper's process
  // lifecycle.
  //
  // Root cause (from reading firebase-tools' own functionsRuntimeWorker.js): the emulator's
  // response-proxying logic marks a request "Finished" on whichever of three stream events fires
  // first, including a `pause` event on the worker's response stream — not only on the piped
  // response to the browser actually completing:
  //   _resp.on("pause", () => finishReq("pause"));
  //   _resp.on("close", () => finishReq("close"));
  //   const piped = _resp.pipe(resp); piped.on("finish", () => finishReq("finish"));
  // For a handler this fast, "pause" appears to fire before the response body actually reaches
  // the browser, so the emulator considers the request done (and frees the worker) while the
  // client is left waiting on a response that never arrives. The SDK's automatic retry sometimes
  // fires a second attempt that also completes server-side — the client's original promise still
  // never resolves.
  //
  // Filed upstream: <link once the firebase-tools issue is opened>.
  // Remove test.fail() and this comment once that's fixed (or we find a workaround) — this test
  // is written as if the bug didn't exist, so it'll go green on its own.
  test.fail();

  const dependentPassword = 'DepSecure!2026Pw';
  const lastName = `Testerson${Date.now()}`;

  await loginAsFixtureGuardian(page);
  const uid = await createDependent(page, 'Switchy', lastName, dependentPassword);
  createdDependentUids.push(uid);
  // Unlike the "creates a dependent" test above, this one doesn't also drive
  // deleteDependentViaRealFlow — it's already switching accounts as the actual thing under test,
  // and is expected to fail partway through (test.fail(), see above). Its on-chain trustee
  // relationship is accepted residue rather than adding a second, conflicting switch-and-delete
  // flow to an already-fragile test; the Firestore side still gets fully cleaned up below.

  // ── Switch into the dependent's account ───────────────────────────────────
  await openAccountSwitcher(page);
  await expect(page.getByText('Managed accounts')).toBeVisible();
  // AccountSwitcherModal's AccountRow is a <button> (unlike UserCard's plain <div>), so scoping
  // to role=button also sidesteps the background settings page's duplicate-layout spans.
  await page.getByRole('button', { name: /Switchy Testerson/ }).click();

  // Switching clears the encryption session — the dependent's own password unlocks it fresh.
  await expect(page.getByText('Unlock Account')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Password').fill(dependentPassword);
  await page.getByRole('button', { name: 'Unlock' }).click();

  // Now operating as the dependent: sidebar reflects the switched identity.
  await expect(page.getByText('Dependent account')).toBeVisible({ timeout: 15_000 });

  // ── Switch back to the guardian ───────────────────────────────────────────
  await openAccountSwitcher(page);
  await expect(page.getByText('Switch to')).toBeVisible();
  await page.getByText(FIXTURE_GUARDIAN.displayName).click();

  await expect(page.getByText('Unlock Account')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Password').fill(FIXTURE_GUARDIAN.password);
  await page.getByRole('button', { name: 'Unlock' }).click();

  // Back to the guardian: the dependent-only label is gone again.
  await expect(page.getByText('Dependent account')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(FIXTURE_GUARDIAN.email)).toBeVisible();
});
