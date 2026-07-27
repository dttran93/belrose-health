export const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  // Dedicated e2e port (playwright.config.ts / playwright.staging.config.ts) — kept separate
  // from 5173 on purpose, so e2e runs never collide with a developer's already-running dev server.
  'http://localhost:5174',
  'https://belrosehealth.com',
  'https://www.belrosehealth.com',
];
