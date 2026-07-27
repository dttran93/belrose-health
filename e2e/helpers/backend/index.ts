// e2e/helpers/backend/index.ts
//
// Selects which TestBackend implementation the specs drive through. Defaults to the emulator
// (existing `test:e2e` behavior, unaffected) — the staging backend only activates when
// playwright.staging.config.ts sets E2E_BACKEND=staging before the test files load.

import type { TestBackend } from './types';
import { emulatorBackend } from './emulator';
import { stagingBackend } from './staging';

export function getBackend(): TestBackend {
  return process.env.E2E_BACKEND === 'staging' ? stagingBackend : emulatorBackend;
}

export type { TestBackend, CreateAuthUserParams, CleanupRefs } from './types';
