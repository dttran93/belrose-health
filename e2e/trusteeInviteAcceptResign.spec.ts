// e2e/trusteeInviteAcceptResign.spec.ts
//
// A registered user (FIXTURE_GUARDIAN, owner of the persistent RECORD_ID fixture — see
// helpers/fixtures/record.ts) invites a second registered account (FIXTURE_RECIPIENT) as an
// Observer-level trustee, the recipient accepts, and the record's real viewers[] array is
// confirmed to include them (a trustee relationship fans out record-level access, not just an
// account-level flag). The recipient then resigns, and viewers[] is confirmed to have reverted —
// closing the loop on the strip-vs-downgrade work: this is the "no independent access" case, so
// resigning should strip the role entirely, not downgrade it (see
// TrusteePermissionService.revokeTrusteeAccess for the upgrade/downgrade branch this doesn't
// exercise — that's already covered at the orchestration/contract layers; this spec's job is
// proving the real UI → real chain → real Firestore wiring works end-to-end for the simplest
// case, not re-deriving the permission matrix).
//
// Staging-only, same reason as recordSharingAndPermissions.spec.ts: RECORD_ID's encrypted content
// lives in real Cloud Storage from the real upload pipeline, and both fixtures need real,
// already-confirmed on-chain identities — nothing to invite/accept against the emulator's empty
// chain state.
//
// Guardian and recipient are both persistent fixtures with real on-chain identities (see
// guardian.ts / recipient.ts) — reused across runs rather than registered fresh each time. They
// stay logged in in separate browser contexts for the whole test, matching
// recordSharingAndPermissions.spec.ts's reasoning (the recipient's own page can just reload to
// observe a change the guardian made in their own context).
//
// Grant/accept/resign completion is polled directly off the real trusteeRelationships doc and
// records/{RECORD_ID} doc (see waitForTrusteeStatus / waitForRoleArrayStatus in staging.ts)
// rather than off UI toasts — useTrusteeFlow's confirmInvite/confirmAccept/confirmResign fire
// their TrusteeRelationshipService call without awaiting it, so the dialog's "Transaction
// Submitted" state (and the toast that follows) can render well before the real on-chain
// confirmation + Firestore write it's reporting on has actually finished.
//
// trusteeRelationships is soft-delete-only by design (status flips, the doc itself never gets
// removed by the app) — so unlike the sharing spec (whose revoke flow leaves nothing behind to
// clean up), this DOES need an afterEach to delete the relationship doc a passing run creates,
// mirroring dependents.spec.ts's identical cleanup of the trusteeRelationships docs its own
// bootstrapDependentTrustee calls create.

import { test, expect } from '@playwright/test';
import { getBackend } from './helpers/backend';
import { waitForRoleArrayStatus, waitForTrusteeStatus } from './helpers/backend/staging';
import { FIXTURE_GUARDIAN } from './helpers/fixtures/guardian';
import { FIXTURE_RECIPIENT } from './helpers/fixtures/recipient';
import { RECORD_ID } from './helpers/fixtures/record';
import { loginAsFixtureUser } from './helpers/loginAsFixtureUser';

const backend = getBackend();
const TRUSTEE_RELATIONSHIP_DOC = `trusteeRelationships/${FIXTURE_GUARDIAN.uid}_${FIXTURE_RECIPIENT.uid}`;

test.afterEach(async () => {
  await backend.cleanup({ docPaths: [TRUSTEE_RELATIONSHIP_DOC] });
});

test('trustor invites a registered user as trustee, who accepts and gains record access, then resigns and loses it', async ({
  browser,
}) => {
  test.skip(process.env.E2E_BACKEND !== 'staging', 'Requires the staging-only fixture record');
  // Generous: propose (real on-chain tx), accept (real on-chain tx), and resign/revoke (real
  // on-chain tx) each pay Base Sepolia confirmation latency on top of the tx itself.
  test.setTimeout(600_000);

  const guardianContext = await browser.newContext();
  const recipientContext = await browser.newContext();
  const guardianPage = await guardianContext.newPage();
  const recipientPage = await recipientContext.newPage();

  try {
    await loginAsFixtureUser(guardianPage, backend, FIXTURE_GUARDIAN);
    await loginAsFixtureUser(recipientPage, backend, FIXTURE_RECIPIENT);

    // ── As the guardian (trustor): invite the recipient as an Observer-level trustee ──
    await guardianPage.goto('/app/settings/trustees');

    // The "+" trigger in the Active Trustees header has no accessible name (icon-only button).
    // Scoped by data-testid rather than an icon-class selector: the sidebar's "New chat" button
    // (ChatHistoryList.tsx) renders the same lucide Plus icon and sits earlier in the DOM on
    // every /app/* route, so an unscoped `button:has(svg.lucide-plus)` silently matches that one
    // instead — the invite panel never opens, and the search placeholder fill() below then hangs
    // for the full test timeout waiting on an element that will never appear (caught by actually
    // running this test against staging).
    await guardianPage.getByTestId('invite-trustee-button').click();
    await guardianPage
      .getByPlaceholder('Search by name, email, or user ID...')
      .fill(FIXTURE_RECIPIENT.email);
    await guardianPage.getByRole('button', { name: 'Search' }).click();

    const searchResultCard = guardianPage
      .getByTestId(`user-card-${FIXTURE_RECIPIENT.uid}`)
      .locator('visible=true');
    await searchResultCard.waitFor();
    await searchResultCard.getByRole('button', { name: 'Accept' }).click();

    // Scoped to the dialog (role="alertdialog", per Radix's AlertDialog.Content) rather than the
    // page — several of these button labels ("Accept", and "Resign" as a substring of "Resign as
    // Trustee" below) also appear on the underlying card/menu, which stays mounted (just visually
    // covered) while the dialog is open, so an unscoped getByRole would be ambiguous or match the
    // wrong element.
    const guardianDialog = guardianPage.getByRole('alertdialog');

    // Opens TrusteeActionDialog with operationType="invite", trust level defaulted to
    // 'observer' — no need to touch the level selector, just confirm.
    await guardianDialog.getByRole('button', { name: 'Send Invite' }).click();
    await expect(guardianPage.getByText('Transaction Submitted')).toBeVisible({ timeout: 60_000 });
    await guardianDialog.getByRole('button', { name: 'Got it' }).click();

    await waitForTrusteeStatus(FIXTURE_GUARDIAN.uid, FIXTURE_RECIPIENT.uid, 'pending');
    // Role arrays fan out at invite time, not accept time — grantPendingTrusteeAccess updates
    // records/{id}'s viewers[] immediately (only the wrappedKey's decrypt access is deferred
    // until acceptance). Confirms the invite's Firestore-first write + fan-out both landed.
    await waitForRoleArrayStatus(RECORD_ID, FIXTURE_RECIPIENT.uid, 'viewers', 'present');

    // ── As the recipient (trustee): accept the invite ──
    await recipientPage.goto('/app/settings/trustees?tab=my-trustors');

    const pendingInviteCard = recipientPage
      .getByTestId(`user-card-${FIXTURE_GUARDIAN.uid}`)
      .locator('visible=true');
    await pendingInviteCard.waitFor();
    await pendingInviteCard.getByRole('button', { name: 'Accept' }).click();

    const recipientDialog = recipientPage.getByRole('alertdialog');

    // Opens TrusteeActionDialog with operationType="accept".
    await recipientDialog.getByRole('button', { name: 'Accept' }).click();
    await expect(recipientPage.getByText('Transaction Submitted')).toBeVisible({
      timeout: 60_000,
    });
    await recipientDialog.getByRole('button', { name: 'Got it' }).click();

    await waitForTrusteeStatus(FIXTURE_GUARDIAN.uid, FIXTURE_RECIPIENT.uid, 'active');
    // Still present post-accept — accept only flips the wrappedKey's isActive flag and the
    // relationship's own status, it doesn't touch role arrays again.
    await waitForRoleArrayStatus(RECORD_ID, FIXTURE_RECIPIENT.uid, 'viewers', 'present');

    // ── Still the recipient: resign as trustee ──
    // Reload so the tab's own fetchRelationships (independent of useTrusteeFlow's onSuccess
    // refetch) reflects the just-accepted relationship in the "Accounts I Manage" section.
    await recipientPage.reload();

    const activeTrustorCard = recipientPage
      .getByTestId(`user-card-${FIXTURE_GUARDIAN.uid}`)
      .locator('visible=true');
    await activeTrustorCard.waitFor();
    await activeTrustorCard
      .getByRole('button', { name: 'More options' })
      .locator('visible=true')
      .click();
    await recipientPage.getByRole('button', { name: 'Resign as Trustee' }).click();

    const resignDialog = recipientPage.getByRole('alertdialog');

    // Opens TrusteeActionDialog with operationType="resign". Trust level is Observer, so
    // ConfirmResignContent's canStepDown is false — only the simple Cancel/Resign footer renders
    // (no "Fully Resign" step-down variant). Scoped to the dialog — "Resign" would otherwise
    // ambiguously substring-match the "Resign as Trustee" menu item still mounted underneath.
    await resignDialog.getByRole('button', { name: 'Resign', exact: true }).click();
    await expect(recipientPage.getByText('Transaction Submitted')).toBeVisible({
      timeout: 60_000,
    });
    await resignDialog.getByRole('button', { name: 'Got it' }).click();

    await waitForTrusteeStatus(FIXTURE_GUARDIAN.uid, FIXTURE_RECIPIENT.uid, 'declined');
    // The recipient had no independent access to RECORD_ID before this relationship — previousRole
    // was null, so resigning strips the role entirely rather than downgrading it.
    await waitForRoleArrayStatus(RECORD_ID, FIXTURE_RECIPIENT.uid, 'viewers', 'absent');
  } finally {
    await guardianContext.close();
    await recipientContext.close();
  }
});
