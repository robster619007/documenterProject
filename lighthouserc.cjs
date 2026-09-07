// Lighthouse CI budgets from CLAUDE.md. Written as CommonJS (.cjs) because the
// package is an ES module ("type":"module") and LHCI's config loader reads the
// rc file via require(); an ESM export default is not applied correctly.
//
// LHCI serves ./dist itself (no external upload — reports are written under
// lighthouse-logs/reports locally, keeping the "nothing leaves the device"
// posture even for tooling). Chrome is resolved from Playwright's managed
// install so no separate system Chrome is required (same browser as e2e/a11y).
//
// Run this config via `npm run lh`, which uses scripts/run-lh.mjs to point the
// temp dir at lighthouse-logs/tmp before Chrome launches — see that file for why
// (Windows TMP/TEMP leaks into WSL and would otherwise scatter Chrome profile
// folders into the project root). This only affects `npm run lh`; it is never
// triggered by the app itself (dev/build/preview or the deployed static site).
//
// Note: INP is a field-only metric and cannot be measured in a Lighthouse lab
// run. Total Blocking Time is the lab proxy and is asserted here; true INP is
// checked separately in the browser/field.
const { chromium } = require('@playwright/test');

process.env.CHROME_PATH ||= chromium.executablePath();

// Shared field budgets applied to every page.
const sharedBudgets = {
  'largest-contentful-paint': ['error', { maxNumericValue: 2000 }],
  'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
  'total-blocking-time': ['error', { maxNumericValue: 200 }],
};

// Every public route, listed explicitly. LHCI's staticDistDir autodiscovery
// silently caps at ~5 pages, so instead scripts/serve-dist.mjs serves the build on
// a fixed port and we audit each URL by hand — nothing gets skipped.
const PORT = 43210;
const paths = [
  '/',
  '/privacy/',
  '/about/',
  '/contact/',
  '/terms/',
  '/tools/photo-signature-resize/',
  '/tools/compress-pdf/',
  '/tools/image-to-pdf/',
];

module.exports = {
  ci: {
    collect: {
      // run-lh.mjs points LH_DIST at a public-only copy of dist (the dev harness
      // pages ship test JS and are not public, so they are excluded from budgets)
      // and serve-dist.mjs serves it on PORT.
      startServerCommand: `node ${__dirname}/scripts/serve-dist.mjs`,
      startServerReadyPattern: 'serving',
      url: paths.map((p) => `http://localhost:${PORT}${p}`),
      numberOfRuns: 3,
    },
    assert: {
      // Tiered performance budgets per CLAUDE.md: content pages >= 0.95, tool and
      // exam pages (which hydrate a React island) >= 0.90. assertMatrix applies
      // each entry to the URLs its pattern matches; the two patterns are mutually
      // exclusive so no page is judged against both.
      assertMatrix: [
        {
          matchingUrlPattern: '.*/(tools|exam)/.*',
          assertions: {
            'categories:performance': ['error', { minScore: 0.9 }],
            ...sharedBudgets,
          },
        },
        {
          matchingUrlPattern: '^(?!.*/(tools|exam)/).*$',
          assertions: {
            'categories:performance': ['error', { minScore: 0.95 }],
            ...sharedBudgets,
          },
        },
      ],
    },
    upload: {
      target: 'filesystem',
      outputDir: './lighthouse-logs/reports',
    },
  },
};
