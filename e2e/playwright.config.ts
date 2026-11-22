/**
 * End-to-end tour (docs/plans/e2e-test-club.md).
 *
 *   E2E_TARGET=mock  — the offline mock store (Layer 1). E2E_BASE_URL defaults
 *                      to http://localhost:3100/bpm; start the app first.
 *   E2E_TARGET=prod  — production, signed in as the E2E test club's personas
 *                      (Layer 2). Needs E2E_ACCOUNTS; see e2e/personas.ts.
 *
 *   npx playwright test -c e2e
 *
 * One worker, always: every journey shares one club and one session list.
 * Traces only on failure — recording every test costs a third of the CPU.
 */
import { defineConfig } from '@playwright/test';
import { baseUrl } from './target';

// The container this repo is developed in ships its own Chromium; CI runs
// `npx playwright install chromium` and leaves this unset.
const executablePath = process.env.E2E_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  outputDir: '../e2e-results/artifacts',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: '../e2e-results/report' }],
    ['json', { outputFile: '../e2e-results/results.json' }],
  ],
  use: {
    baseURL: baseUrl() + '/',
    // iPhone-class: the app is mobile-first, and a desktop width lies.
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-CA',
    timezoneId: 'America/Vancouver',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
});
