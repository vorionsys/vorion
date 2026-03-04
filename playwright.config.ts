import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration for Vorion web apps.
 *
 * Critical journeys tested:
 * - AgentAnchor: auth -> agent registration -> trust scoring -> governance
 * - Dashboard: login -> command center -> metrics
 * - Status: page loads -> real data renders -> auto-refresh works
 *
 * Usage:
 *   npx playwright test                    # Run all E2E tests
 *   npx playwright test --project=chromium # Single browser
 *   npx playwright test --ui               # Interactive UI mode
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github']]
    : [['html', { open: 'on-failure' }]],

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  /* Start dev server before running E2E tests in local development */
  webServer: process.env.CI
    ? undefined
    : {
        command: 'npx turbo dev --filter=agentanchor',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
