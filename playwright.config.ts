import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive the production build: run `npm run build` first (the webServer
 * command builds on its own only when dist/server/index.js is missing). `npm run test:e2e`
 * runs `playwright test`; set PW_BASE_URL to point at an already running server.
 */
const PORT = 4173;
const baseURL = process.env.PW_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `test -f dist/server/index.js || npm run build; PORT=${PORT} node dist/server/index.js`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
