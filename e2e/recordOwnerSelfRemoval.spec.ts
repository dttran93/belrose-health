// e2e/recordOwnerSelfRemoval.spec.ts
//
// A registered patient (FIXTURE_GUARDIAN, owner of the persistent RECORD_ID fixture — see
// helpers/fixtures/record.ts) grants a second registered account (FIXTURE_RECIPIENT) co-owner
// access. The recipient — acting on their own access-list card, in their own browser context —
// self-demotes owner -> sharer, then fully removes themselves.
//
// This exercises the real on-chain `voluntarilyLeaveOwnership` contract path (called twice: once
// with a demoteTo, once without) and the real "owners can only remove themselves" rule for real —
// neither is touched by recordSharingAndPermissions.spec.ts or recordPermissionDemotion.spec.ts,
// which only ever exercise grantRole/revokeRole/changeRole.
//
// HIGHER RISK THAN THE OTHER TWO SPECS: this is the only one that mutates RECORD_ID's `owners`
// array, and that array isn't reseedable — every other spec assumes FIXTURE_GUARDIAN is (and
// stays) its sole owner. The recipient is only ever a CO-owner for the middle of this test; by
// the end of a passing run they're fully removed again, via the same real
// voluntarilyLeaveOwnership call every other user hits — Firestore and chain both land clean
// together, atomically, with no separate cleanup step needed.
//
// Deliberately no afterEach. A blunt Firestore-only arrayRemove backstop was tried here and
// removed after it did real damage: when this spec's final step once failed partway, afterEach
// silently stripped the recipient from Firestore's role arrays while their real on-chain role
// stayed active — the fixture looked clean but wasn't, and that mismatch went undetected until
// manually checked against the chain directly. For the one spec that touches the irreplaceable
// `owners` array, a loud failure demanding manual attention is far safer than a quiet one that
// only pretends to have cleaned up.
//
// Business-logic permutations (last-owner protection, subject floors, etc.) are already covered
// with blockchain/crypto mocked by test/orchestration/removeOwner.test.ts — this spec's job is
// proving the real voluntarilyLeaveOwnership contract calls + real self-service UI flow work
// end-to-end, not re-covering every permission rule.

import { test, expect } from '@playwright/test';
import { getBackend } from './helpers/backend';
import { waitForRoleArrayStatus } from './helpers/backend/staging';
import { FIXTURE_GUARDIAN } from './helpers/fixtures/guardian';
import { FIXTURE_RECIPIENT } from './helpers/fixtures/recipient';
import { RECORD_ID } from './helpers/fixtures/record';
import { loginAsFixtureUser } from './helpers/loginAsFixtureUser';

const backend = getBackend();

test('co-owner self-demotes to sharer, then fully removes themselves', async ({ browser }) => {
  test.skip(process.env.E2E_BACKEND !== 'staging', 'Requires the staging-only fixture record');
  // Three real on-chain transactions in sequence (grantRole for the co-owner grant,
  // voluntarilyLeaveOwnership x2), each with Base Sepolia confirmation latency on top.
  test.setTimeout(600_000);

  const guardianContext = await browser.newContext();
  const recipientContext = await browser.newContext();
  const guardianPage = await guardianContext.newPage();
  const recipientPage = await recipientContext.newPage();

  try {
    await loginAsFixtureUser(guardianPage, backend, FIXTURE_GUARDIAN);
    await loginAsFixtureUser(recipientPage, backend, FIXTURE_RECIPIENT);

    // ── As the guardian: grant the recipient co-owner access ──
    await guardianPage.goto(`/app/records/${RECORD_ID}`);
    await guardianPage.getByRole('button', { name: 'More options' }).click();
    await guardianPage.getByRole('button', { name: 'Manage Access' }).click();
    await expect(guardianPage.getByText('Failed to load access data')).not.toBeVisible();

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

    // Dialog opens defaulted to Viewer — pick Owner before confirming.
    await guardianPage.getByRole('button', { name: 'Select Role & Grant Access' }).click();
    await guardianPage.locator('input[type="radio"][value="owner"]').check();
    await guardianPage.getByRole('button', { name: 'Grant Access' }).click();

    await expect(guardianPage.getByText('Transaction Submitted')).toBeVisible({ timeout: 60_000 });
    await guardianPage.getByRole('button', { name: 'Got it' }).click();
    await waitForRoleArrayStatus(RECORD_ID, FIXTURE_RECIPIENT.uid, 'owners', 'present');
    await guardianPage.getByRole('button', { name: 'Dismiss' }).click();

    // ── As the recipient (now co-owner): self-demote to sharer ──
    await recipientPage.goto(`/app/records/${RECORD_ID}`);
    await recipientPage.getByRole('button', { name: 'More options' }).click();
    await recipientPage.getByRole('button', { name: 'Manage Access' }).click();
    await expect(recipientPage.getByText('Failed to load access data')).not.toBeVisible();

    const ownCard = recipientPage
      .getByTestId(`user-card-${FIXTURE_RECIPIENT.uid}`)
      .locator('visible=true');
    await ownCard.getByRole('button', { name: 'More options' }).locator('visible=true').click();
    await recipientPage.getByRole('button', { name: 'Remove User' }).click();
    await recipientPage.getByRole('button', { name: 'Demote to Sharer' }).click();
    await expect(recipientPage.getByText('Transaction Submitted')).toBeVisible({ timeout: 60_000 });
    await recipientPage.getByRole('button', { name: 'Got it' }).click();
    await waitForRoleArrayStatus(RECORD_ID, FIXTURE_RECIPIENT.uid, 'sharers', 'present');
    await waitForRoleArrayStatus(RECORD_ID, FIXTURE_RECIPIENT.uid, 'owners', 'absent');
    await recipientPage.getByRole('button', { name: 'Dismiss' }).click();

    // ── As the recipient (now a sharer): fully remove themselves ──
    await ownCard.getByRole('button', { name: 'More options' }).locator('visible=true').click();
    await recipientPage.getByRole('button', { name: 'Remove User' }).click();
    await recipientPage.getByRole('button', { name: 'Full Revocation' }).click();
    await expect(recipientPage.getByText('Transaction Submitted')).toBeVisible({ timeout: 60_000 });
    await recipientPage.getByRole('button', { name: 'Got it' }).click();
    await waitForRoleArrayStatus(RECORD_ID, FIXTURE_RECIPIENT.uid, 'sharers', 'absent');
  } finally {
    await guardianContext.close();
    await recipientContext.close();
  }
});
