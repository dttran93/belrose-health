// e2e/helpers/loginAsFixtureUser.ts
//
// Generic login for any persistent fixture account (see fixtures/) — seeds it (idempotent, so a
// no-op after the first run against staging) then signs in through the real UI.

import { expect, type Page } from '@playwright/test';
import { seedFixtureUser } from './fixtures/seedFixtureUser';
import type { TestBackend } from './backend/types';
import type { FixtureUser } from './fixtures/types';

export async function loginAsFixtureUser(
  page: Page,
  backend: TestBackend,
  fixture: FixtureUser
): Promise<void> {
  await seedFixtureUser(backend, fixture);

  await page.goto('/auth');
  await page.locator('input[name="email"]').fill(fixture.email);
  await page.locator('input[name="password"]').fill(fixture.password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page).toHaveURL(/\/app/);
}
