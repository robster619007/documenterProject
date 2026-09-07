import { defineConfig, devices } from '@playwright/test';

// e2e and a11y specs both live under tests/ and are selected per-script by path
// (`playwright test tests/e2e` / `tests/a11y`). The web server builds the static
// site and serves it via `astro preview` so tests run against production output.
export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    // Dedicated preview port so tests never collide with a running dev server
    // (astro dev + preview both default to 4321). Tests run against the built
    // site — no dev toolbar, one canonical DOM.
    baseURL: 'http://localhost:4323',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4323',
    url: 'http://localhost:4323',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
