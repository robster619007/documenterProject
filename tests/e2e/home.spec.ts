import { test, expect } from '@playwright/test';

test('home page renders with SEO head', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Documenter/);
  // Exactly one h1, and it names the product's promise.
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name: /fit any document/i })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://documenter.pages.dev/',
  );
});
