import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Every public route is scanned with axe-core. Add new routes here as pages ship.
const routes = [
  '/',
  '/privacy',
  '/about',
  '/contact',
  '/terms',
  '/tools/photo-signature-resize',
  '/tools/compress-pdf',
  '/tools/image-to-pdf',
  '/tools/merge-pdf',
];

for (const route of routes) {
  test(`no accessibility violations on ${route}`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}
