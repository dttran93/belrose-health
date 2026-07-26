import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// The "staging" e2e tier: drives the real browser + real frontend against the real, persistent
// `staging` Firebase project (belrose-757fe — see .firebaserc) and the real Base Sepolia chain,
// instead of the local emulator playwright.config.ts uses. No `firebase emulators:exec` wrapper
// here — there's no local emulator involved, and Cloud Functions must already be deployed to
// belrose-757fe for these specs to exercise real code (true today, since that project is also
// used for manual testing).
//
// .env.local already holds the real VITE_FIREBASE_* values for belrose-757fe (the only Firebase
// project that exists right now) — the only thing that changes here is NOT setting
// VITE_USE_EMULATOR, so src/firebase/config.ts skips connectXEmulator() and talks to real
// Firebase, plus E2E_BACKEND=staging so the specs' getBackend() (e2e/helpers/backend/) picks the
// real Admin SDK backend instead of the emulator REST helpers.
loadEnv({ path: '.env.local' });
process.env.E2E_BACKEND = 'staging';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  // Unlike the emulator tier, every spec here hits the same rate-limited real services (Base
  // Sepolia RPC, Pimlico, Firestore) — running them concurrently across workers caused
  // intermittent timeouts on whichever test's wallet-registration step lost the race for
  // bandwidth. One worker trades wall-clock time for not chasing flaky contention.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Same dedicated port + reuseExistingServer: false rationale as playwright.config.ts — never
    // silently reuse an already-running dev server here.
    command: 'npm run dev -- --port 5174',
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
