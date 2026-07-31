// e2e/recordPermissionDemotion.spec.ts
//
// A registered patient (FIXTURE_GUARDIAN, owner of the persistent RECORD_ID fixture — see
// helpers/fixtures/record.ts) grants a second registered account (FIXTURE_RECIPIENT)
// Administrator access directly, demotes them administrator -> sharer -> viewer, then fully
// revokes access — ending with the recipient holding no role at all, on-chain AND in Firestore.
//
// The closing full revocation isn't just "extra cleanup" — it's load-bearing. afterEach only
// cleans up Firestore (arrayRemove + deleting the wrappedKey doc); it has no way to touch the
// real chain. If the spec stopped at "demoted to viewer", the recipient would keep an active
// on-chain viewer role forever, and the NEXT run's fresh grantRole(..., 'administrator') would
// revert with "Target already has a role. Use changeRole() instead" — a silent chain/Firestore
// drift that afterEach's Firestore-only cleanup could never detect or fix.
//
// This exercises the real on-chain `changeRole` contract path (twice) plus a real `revokeRole` —
// distinct from recordSharingAndPermissions.spec.ts, which only ever exercises fresh `grantRole`
// (viewer) and `revokeRole` (full revoke) with no intermediate demotions. Every demotion here
// keeps the encryption key active (only the closing full revoke drops it — see
// PermissionsService.removeAdmin), so wrappedKeys.isActive only ever flips once, at the very end.
//
// Never touches RECORD_ID's `owners` array, so unlike recordOwnerSelfRemoval.spec.ts there's no
// elevated risk to the shared, irreplaceable fixture record — worst case on a mid-test failure is
// a stray administrators/sharers/viewers entry (and a stray on-chain role, which is why
// afterEach's Firestore-only cleanup is a defensive backstop, not the primary mechanism for
// leaving the fixture clean — the in-test full revoke is).
//
// Business-logic permutations (who can demote whom, subject floors, etc.) are already covered
// with blockchain/crypto mocked by test/orchestration/removeAdmin.test.ts — this spec's job is
// proving the real changeRole contract calls + real UI demote flow work end-to-end, not
// re-covering every permission rule.

import { test, expect } from '@playwright/test';
import { getBackend } from './helpers/backend';
import { waitForRoleArrayStatus } from './helpers/backend/staging';
import { FIXTURE_GUARDIAN } from './helpers/fixtures/guardian';
import { FIXTURE_RECIPIENT } from './helpers/fixtures/recipient';
import { RECORD_ID } from './helpers/fixtures/record';
import { loginAsFixtureUser } from './helpers/loginAsFixtureUser';

const backend = getBackend();

// Deliberately no afterEach cleanup. A passing run already leaves both Firestore and the real
// chain clean via the closing full revoke — nothing left to clean up. A blunt Firestore-only
// arrayRemove backstop was tried and removed: on a mid-run failure it would silently wipe
// Firestore's role arrays while the real on-chain role stayed active, making the fixture look
// clean when it wasn't — exactly the drift this file's closing step exists to prevent. If a run
// fails partway, the honest (if messy) state is more useful than a fake-clean one: it surfaces
// the problem instead of hiding it, and the next run's own pre-flight checks (e.g. grantRole's
// "Target already has a role" revert) will say so clearly.

test('owner grants administrator access directly, demotes administrator -> sharer -> viewer, then fully revokes', async ({
  browser,
}) => {
  test.skip(process.env.E2E_BACKEND !== 'staging', 'Requires the staging-only fixture record');
  // Four real on-chain transactions in sequence (grantRole, changeRole x2, revokeRole), each
  // with Base Sepolia confirmation latency on top.
  test.setTimeout(600_000);

  const guardianContext = await browser.newContext();
  const guardianPage = await guardianContext.newPage();

  try {
    await loginAsFixtureUser(guardianPage, backend, FIXTURE_GUARDIAN);

    await guardianPage.goto(`/app/records/${RECORD_ID}`);
    await guardianPage.getByRole('button', { name: 'More options' }).click();
    await guardianPage.getByRole('button', { name: 'Manage Access' }).click();
    await expect(guardianPage.getByText('Failed to load access data')).not.toBeVisible();

    // ── Grant Administrator access directly (not the default Viewer role) ──
    await guardianPage.getByRole('button', { name: 'Grant Access' }).click(); // header "+"
    await guardianPage
      .getByPlaceholder('Search by name, email, or user ID...')
      .fill(FIXTURE_RECIPIENT.email);
    await guardianPage.getByRole('button', { name: 'Search' }).click();

    const searchResultCard = guardianPage
      .getByTestId(`user-card-${FIXTURE_RECIPIENT.uid}`)
      .locator('visible=true');
    await searchResultCard.waitFor();
    await searchResultCard.getByRole('button', { name: 'Accept' }).click();

    // Dialog opens defaulted to Viewer (see EncryptionAccessView.handleGrantAccess) — pick
    // Administrator before confirming.
    await guardianPage.getByRole('button', { name: 'Select Role & Grant Access' }).click();
    await guardianPage.locator('input[type="radio"][value="administrator"]').check();
    await guardianPage.getByRole('button', { name: 'Grant Access' }).click();

    await expect(guardianPage.getByText('Transaction Submitted')).toBeVisible({ timeout: 60_000 });
    await guardianPage.getByRole('button', { name: 'Got it' }).click();
    await waitForRoleArrayStatus(RECORD_ID, FIXTURE_RECIPIENT.uid, 'administrators', 'present');

    // Tray entry blocks clicks on the dropdown below (same reason as recordSharingAndPermissions
    // .spec.ts) — dismiss before continuing.
    await guardianPage.getByRole('button', { name: 'Dismiss' }).click();

    // ── Demote administrator -> sharer (real changeRole) ──
    const accessListCard = guardianPage
      .getByTestId(`user-card-${FIXTURE_RECIPIENT.uid}`)
      .locator('visible=true');
    await accessListCard.getByRole('button', { name: 'More options' }).locator('visible=true').click();
    await guardianPage.getByRole('button', { name: 'Remove User' }).click();
    await guardianPage.getByRole('button', { name: 'Demote to Sharer' }).click();
    await expect(guardianPage.getByText('Transaction Submitted')).toBeVisible({ timeout: 60_000 });
    await guardianPage.getByRole('button', { name: 'Got it' }).click();
    await waitForRoleArrayStatus(RECORD_ID, FIXTURE_RECIPIENT.uid, 'sharers', 'present');
    await waitForRoleArrayStatus(RECORD_ID, FIXTURE_RECIPIENT.uid, 'administrators', 'absent');
    await guardianPage.getByRole('button', { name: 'Dismiss' }).click();

    // ── Demote sharer -> viewer (real changeRole again) ──
    await accessListCard.getByRole('button', { name: 'More options' }).locator('visible=true').click();
    await guardianPage.getByRole('button', { name: 'Remove User' }).click();
    await guardianPage.getByRole('button', { name: 'Demote to Viewer' }).click();
    await expect(guardianPage.getByText('Transaction Submitted')).toBeVisible({ timeout: 60_000 });
    await guardianPage.getByRole('button', { name: 'Got it' }).click();
    await waitForRoleArrayStatus(RECORD_ID, FIXTURE_RECIPIENT.uid, 'viewers', 'present');
    await waitForRoleArrayStatus(RECORD_ID, FIXTURE_RECIPIENT.uid, 'sharers', 'absent');
    await guardianPage.getByRole('button', { name: 'Dismiss' }).click();

    // ── Full revocation — closes the loop with a real revokeRole call. afterEach only cleans
    // up Firestore; without this step the recipient would keep an active on-chain viewer role
    // forever, and the next run's fresh grantRole to administrator would revert with "Target
    // already has a role. Use changeRole() instead" since the chain and Firestore would have
    // silently drifted apart. ──
    await accessListCard.getByRole('button', { name: 'More options' }).locator('visible=true').click();
    await guardianPage.getByRole('button', { name: 'Remove User' }).click();
    await guardianPage.getByRole('button', { name: 'Full Revocation' }).click();
    await expect(guardianPage.getByText('Transaction Submitted')).toBeVisible({ timeout: 60_000 });
    await guardianPage.getByRole('button', { name: 'Got it' }).click();
    await waitForRoleArrayStatus(RECORD_ID, FIXTURE_RECIPIENT.uid, 'viewers', 'absent');
  } finally {
    await guardianContext.close();
  }
});
