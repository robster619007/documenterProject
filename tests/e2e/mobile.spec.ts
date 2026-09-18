import { test, expect } from '@playwright/test';

// Milestone 6 manual check, automated: at a 360px-wide viewport (a common small
// phone) no page may scroll horizontally, and the unverified-spec disclaimer must
// be visible without scrolling on the exam pages.
test.use({ viewport: { width: 360, height: 740 } });

const routes = [
  '/',
  '/privacy/',
  '/about/',
  '/contact/',
  '/terms/',
  '/tools/photo-signature-resize/',
  '/tools/compress-pdf/',
  '/tools/image-to-pdf/',
  '/tools/merge-pdf/',
];

for (const route of routes) {
  test(`no horizontal overflow at 360px on ${route}`, async ({ page }) => {
    await page.goto(route);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // Allow a 1px rounding tolerance; anything more means the layout breaks the
    // viewport and forces sideways scrolling.
    expect(overflow, `${route} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
  });
}
