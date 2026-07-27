// e2e/signup.spec.ts
//
// Drives the real signup flow (real wallet generation + real
// on-chain registration via Base Sepolia/Pimlico, since that's baked into step 1 of
// registration itself — there's no way to sign up without it), verifies the email without a
// real inbox (via getBackend() — see e2e/helpers/backend/), and confirms the user lands on
// the real protected app. Runs against either the Firebase emulator or real staging
// (belrose-757fe) depending on E2E_BACKEND; see playwright.config.ts / playwright.staging.config.ts.

import { test, expect } from '@playwright/test';
import { TEST_INVITE_CODE } from './helpers/seedInvite';
import { getBackend } from './helpers/backend';

const backend = getBackend();
// Set inside the test once the email is generated; read by afterEach for cleanup — the backend
// is a no-op under the emulator (state resets on the next boot) and real under staging.
let email: string | undefined;

test.afterEach(async () => {
  if (!email) return;
  await backend.cleanup({ docPaths: [`invites/${email.toLowerCase()}`], authEmails: [email] });
});

test('signs up, verifies email via the Auth emulator, and reaches /app', async ({ page }) => {
  email = `e2e-${Date.now()}@example.com`;
  const password = 'Sup3rSecure!2026';

  await backend.seedInvite(email);

  await page.goto('/auth/register');

  // AlphaGateScreen gates every new registration behind an invite-code check.
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Check my access' }).click();
  await page.getByLabel('Invite code').fill(TEST_INVITE_CODE);
  await page.getByRole('button', { name: 'Verify & continue' }).click();

  await page.locator('input[name="firstName"]').fill('E2E');
  await page.locator('input[name="lastName"]').fill('Smoke');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirmPassword"]').fill(password);
  await page.getByRole('button', { name: 'Create Account' }).click();

  // Step 1 completing generates a wallet and registers it on-chain for real (Base Sepolia +
  // Pimlico) before advancing — give this real network round trip generous headroom.
  await expect(page.getByRole('heading', { name: 'Save Your Recovery Key' })).toBeVisible({
    timeout: 60_000,
  });

  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'Complete Registration' }).first().click();

  await page.getByRole('button', { name: 'Continue to Verification' }).click({ timeout: 30_000 });

  await expect(page).toHaveURL(/\/verification/);

  await backend.verifyEmail(email);

  await page.getByRole('button', { name: "I've Verified My Email" }).click();
  await expect(page.getByRole('button', { name: 'Continue to App' })).toBeEnabled();
  await page.getByRole('button', { name: 'Continue to App' }).click();

  await expect(page).toHaveURL(/\/app/);
});
