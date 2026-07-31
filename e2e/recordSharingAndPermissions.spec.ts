// e2e/recordSharingAndPermissions.spec.ts
//
// A registered patient (FIXTURE_GUARDIAN, owner of the persistent RECORD_ID fixture — see
// helpers/fixtures/record.ts) grants Viewer access to a second registered account
// (FIXTURE_RECIPIENT), the recipient confirms they can decrypt and view the record, the owner
// revokes access, and the recipient confirms it's gone. Unlike recordShareGuestClaim.spec.ts
// (which covers the *unregistered guest* invite path via GuestSharePanel's "Share via Email"),
// this exercises the "share with an existing Belrose user" path — real UserSearch lookup, real
// PermissionsService.grantViewer/removeViewer, real on-chain grantRole/revokeRole, real
// SharingService key wrap/unwrap. Grant/revoke *service wiring* is already covered with
// blockchain/crypto mocked by test/orchestration/grantViewer.test.ts and removeViewer.test.ts —
// this spec's job is proving the real thing works end-to-end, not re-covering every role
// permutation.
//
// Staging-only, same reason as recordShareGuestClaim.spec.ts: RECORD_ID's encrypted content
// lives in real Cloud Storage from the real upload pipeline, nothing to share against the
// emulator's empty Firestore.
//
// Guardian and recipient are both persistent fixtures with real on-chain identities (see
// guardian.ts / recipient.ts) — reused across runs rather than registered fresh each time. They
// stay logged in in separate browser contexts for the whole test, rather than swapping sessions
// on one page, so the recipient's page can just reload to observe an access change the guardian
// made in their own context, without re-authenticating each time.
//
// Grant/revoke completion is polled directly off the real records/{RECORD_ID} doc (see
// waitForViewerStatus in staging.ts) rather than off UI toasts — usePermissionFlow's confirmGrant/
// confirmRevoke fire their PermissionsService call without awaiting it, so the dialog's
// "Transaction Submitted" state (and the toast that follows) can render well before the real
// on-chain confirmation + Firestore write it's reporting on has actually finished.

import { test, expect } from '@playwright/test';
import { getBackend } from './helpers/backend';
import { waitForViewerStatus } from './helpers/backend/staging';
import { FIXTURE_GUARDIAN } from './helpers/fixtures/guardian';
import { FIXTURE_RECIPIENT } from './helpers/fixtures/recipient';
import { RECORD_ID } from './helpers/fixtures/record';
import { loginAsFixtureUser } from './helpers/loginAsFixtureUser';

const backend = getBackend();

// Deliberately no afterEach cleanup. A passing run already leaves both Firestore and the real
// chain clean via the closing revoke — nothing left to clean up. A blunt Firestore-only
// arrayRemove backstop used to live here, but that's actively dangerous: on a mid-run failure
// (e.g. between grant and revoke) it would silently wipe Firestore's viewers array while the
// real on-chain Viewer role stayed active on FIXTURE_RECIPIENT — the fixture would look clean
// but wasn't, with nothing surfacing the mismatch short of checking the chain directly. If a run
// fails partway, the honest (if messy) state is more useful than a fake-clean one: it surfaces
// the problem instead of hiding it, and the next run's own pre-flight checks (e.g. grantRole's
// "Target already has a role" revert) will say so clearly.

test('owner shares a record with a registered user, who views it, then access is revoked', async ({
  browser,
}) => {
  test.skip(process.env.E2E_BACKEND !== 'staging', 'Requires the staging-only fixture record');
  // Generous: a first-ever grant on this record pays a one-time real initializeRecord on-chain
  // call (~15s alone, observed on a dry run) before the grant's own on-chain tx, and revoke pays
  // a second real on-chain tx — plus Base Sepolia confirmation latency on top of each.
  test.setTimeout(600_000);

  const guardianContext = await browser.newContext();
  const recipientContext = await browser.newContext();
  const guardianPage = await guardianContext.newPage();
  const recipientPage = await recipientContext.newPage();

  try {
    await loginAsFixtureUser(guardianPage, backend, FIXTURE_GUARDIAN);
    await loginAsFixtureUser(recipientPage, backend, FIXTURE_RECIPIENT);

    // ── Capture the record's real title as the guardian, before sharing — proves the recipient
    // decrypts the *same* real content below, without this spec needing to know the fixture
    // record's actual content up front. ──
    // The title renders in two places on this page (RecordFull.tsx's header banner and
    // BelroseRecord.tsx's fields summary) — both always mirror the same belroseFields.title, so
    // .first() is safe rather than a real ambiguity.
    await guardianPage.goto(`/app/records/${RECORD_ID}`);
    const recordTitle = await guardianPage.getByRole('heading', { level: 1 }).first().textContent();
    expect(recordTitle).toBeTruthy();

    // ── Grant the recipient Viewer access via UserSearch (the "share with an existing Belrose
    // user" path — distinct from GuestSharePanel's "Share via Email" guest-invite path) ──
    await guardianPage.getByRole('button', { name: 'More options' }).click();
    await guardianPage.getByRole('button', { name: 'Manage Access' }).click();
    await expect(guardianPage.getByText('Failed to load access data')).not.toBeVisible();

    await guardianPage.getByRole('button', { name: 'Grant Access' }).click(); // header "+"
    await guardianPage
      .getByPlaceholder('Search by name, email, or user ID...')
      .fill(FIXTURE_RECIPIENT.email);
    await guardianPage.getByRole('button', { name: 'Search' }).click();

    // Search result card — UserCard is rendered twice (mobile/desktop layouts), so scope to the
    // visible one via the data-testid on its root, same pattern used below for the access-list
    // card.
    const searchResultCard = guardianPage
      .getByTestId(`user-card-${FIXTURE_RECIPIENT.uid}`)
      .locator('visible=true');
    await searchResultCard.waitFor();
    await searchResultCard.getByRole('button', { name: 'Accept' }).click();

    // Opens PermissionActionDialog with grantVariant="select-role", defaulted to 'viewer' role
    // (see EncryptionAccessView.handleGrantAccess) — no role change needed, just confirm.
    await guardianPage.getByRole('button', { name: 'Select Role & Grant Access' }).click();
    await guardianPage.getByRole('button', { name: 'Grant Access' }).click();

    // "Transaction Submitted" just means the dialog closed to the tray optimistically — per
    // usePermissionFlow's confirmGrant, PermissionsService.grantViewer (real on-chain grantRole,
    // awaited to confirmation, THEN the real Firestore wrappedKeys/viewers write) is fired
    // without being awaited by the dialog. A Sonner success toast looked like the completion
    // signal to wait on, but it auto-dismisses ~4s after showing, so it can already be gone
    // before this assertion starts polling — poll the real Firestore doc directly instead (see
    // waitForViewerStatus's own comment in staging.ts).
    await expect(guardianPage.getByText('Transaction Submitted')).toBeVisible({ timeout: 60_000 });
    await guardianPage.getByRole('button', { name: 'Got it' }).click();
    await waitForViewerStatus(RECORD_ID, FIXTURE_RECIPIENT.uid, 'present');

    // The OnChainActivityTray entry for this grant stays on screen (bottom-right, fixed
    // position) until manually dismissed — it doesn't auto-clear on confirmation. Left open, it
    // overlaps and intercepts clicks on the "Remove User" dropdown below, since that dropdown's
    // portal also renders near the bottom of the page.
    await guardianPage.getByRole('button', { name: 'Dismiss' }).click();

    // ── As the recipient: reload and confirm the record is visible and decrypts for real ──
    await recipientPage.goto(`/app/records/${RECORD_ID}`);
    await expect(recipientPage.getByRole('heading', { level: 1 }).first()).toHaveText(
      recordTitle!,
      { timeout: 30_000 }
    );

    // ── Back as the guardian: revoke the recipient's access ──
    const accessListCard = guardianPage
      .getByTestId(`user-card-${FIXTURE_RECIPIENT.uid}`)
      .locator('visible=true');
    await accessListCard.getByRole('button', { name: 'More options' }).locator('visible=true').click();
    await guardianPage.getByRole('button', { name: 'Remove User' }).click();
    await guardianPage.getByRole('button', { name: 'Full Revocation' }).click();
    await expect(guardianPage.getByText('Transaction Submitted')).toBeVisible({ timeout: 60_000 });
    await guardianPage.getByRole('button', { name: 'Got it' }).click();
    await waitForViewerStatus(RECORD_ID, FIXTURE_RECIPIENT.uid, 'absent');

    // ── As the recipient: reload and confirm access is gone ──
    await recipientPage.reload();
    await expect(recipientPage.getByText('Missing or insufficient permissions.')).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await guardianContext.close();
    await recipientContext.close();
  }
});
