import { test, expect } from '@playwright/test';

// Milestone 6 confirmation of CLAUDE.md rule 4: no ad placeholder may sit within
// 150px of a primary action (upload / convert / download). The AdSlot component
// already enforces a *declared* clearance at build time; this test verifies the
// *rendered* geometry, so a layout change can't quietly violate the rule.
const MIN_CLEARANCE = 150;

// Pages that render both an AdSlot and primary-action controls.
const routes = [
  '/tools/photo-signature-resize/',
  '/tools/compress-pdf/',
  '/tools/image-to-pdf/',
  '/tools/merge-pdf/',
];

// The smallest vertical gap between two rectangles (0 if they overlap vertically).
function verticalGap(a: { top: number; bottom: number }, b: { top: number; bottom: number }): number {
  if (a.top >= b.bottom) return a.top - b.bottom;
  if (b.top >= a.bottom) return b.top - a.bottom;
  return 0;
}

for (const route of routes) {
  test(`no ad within ${MIN_CLEARANCE}px of a primary action on ${route}`, async ({ page }) => {
    await page.goto(route);

    const ads = await page.locator('[data-ad-slot]').all();
    expect(ads.length, 'expected at least one ad slot on this page').toBeGreaterThan(0);
    const actions = await page.locator('[data-primary-action]').all();
    expect(actions.length, 'expected at least one primary action on this page').toBeGreaterThan(0);

    for (const ad of ads) {
      const adBox = await ad.boundingBox();
      if (!adBox) continue;
      const adRect = { top: adBox.y, bottom: adBox.y + adBox.height };
      for (const action of actions) {
        const b = await action.boundingBox();
        if (!b) continue;
        const gap = verticalGap(adRect, { top: b.y, bottom: b.y + b.height });
        expect(gap, `ad slot is only ${Math.round(gap)}px from a primary action`).toBeGreaterThanOrEqual(
          MIN_CLEARANCE,
        );
      }
    }
  });
}
