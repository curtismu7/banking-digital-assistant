// @ts-check
/**
 * Playwright E2E Test Configuration
 *
 * Prerequisites:
 *   npm install   (installs @playwright/test)
 *   npx playwright install chromium   (downloads browser binary)
 *
 * Run tests:
 *   npm run test:e2e              # headless
 *   npm run test:e2e:ui           # interactive UI mode
 *
 * Assumes banking_api_server is already running on http://localhost:3001
 * and banking_api_ui dev server starts automatically via webServer config.
 */

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',

  // Fail fast on CI; allow retries locally
  retries: process.env.CI ? 2 : 0,

  // Run tests in parallel (safe since all API calls are mocked via page.route)
  workers: process.env.CI ? 1 : 2,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    baseURL: 'http://localhost:3000',

    // Capture screenshots and traces on failure for debugging
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',

    // API requests that hit the backend directly
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the React dev-server if it's not already running
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3000',
    reuseExistingServer: true, // don't restart if already running
    timeout: 120_000, // CRA cold-start can take ~60 s
  },
});
