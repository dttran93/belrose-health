// e2e/helpers/driveGuestClaimFlow.ts
//
// The part of GuestClaimAccountModal's UI that's identical no matter how the guest got there —
// requestFlowGuestClaim.spec.ts (guestContext="record_request") and recordShareGuestClaim.spec.ts
// (guestContext="sharing") both land on this same "Create Your Account" step already, just via
// different setup. What differs between them happens *inside* handleClaim (Step 1a's wrappedKeys
// rewrap only runs for "sharing") and in what the caller does before/after this — not in these
// UI steps, so this is the only part worth sharing.

import { expect, type Page } from '@playwright/test';

export async function driveGuestClaimFlow(
  page: Page,
  { firstName, lastName, password }: { firstName: string; lastName: string; password: string }
): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Create Your Account' })).toBeVisible({
    timeout: 60_000,
  });

  await page.locator('input[placeholder="Jane"]').fill(firstName);
  await page.locator('input[placeholder="Smith"]').fill(lastName);
  await page.locator('input[placeholder="At least 8 characters"]').fill(password);
  await page.locator('input[placeholder="Repeat your password"]').fill(password);
  await page.getByRole('button', { name: 'Continue →' }).click();

  // Real wallet generation + on-chain registration (Base Sepolia) happens here — give it room.
  await expect(page.getByRole('heading', { name: 'Save Your Recovery Key' })).toBeVisible({
    timeout: 60_000,
  });
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'Complete Registration' }).click();

  // Longer than the step above — this one chains several more sequential real round trips on
  // top of the on-chain wait (a Firestore query, then a separate Cloud Function call +
  // custom-token sign-in), so it's the slowest single wait in the flow. guestContext="sharing"
  // callers (recordShareGuestClaim.spec.ts) additionally run Step 1a's real wrappedKeys rewrap
  // here — empirically confirmed to complete successfully, just past the previous 90s budget —
  // so this needs real headroom rather than a value tuned to the faster record_request path.
  await expect(page.getByRole('heading', { name: 'Welcome to Belrose!' })).toBeVisible({
    timeout: 150_000,
  });
  await page.getByRole('button', { name: 'Get Started' }).click();
}
