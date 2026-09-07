import { test, expect } from '@playwright/test';

// The most important test in the suite: it protects the product's core promise —
// "your file never leaves your device." It performs a real conversion in the
// browser while recording every network request, then asserts that (a) nothing
// went to another origin, and (b) no request body contained the file's bytes.
// If this test ever fails, the privacy claim is broken.

test('no network request carries file data during a conversion', async ({ page }) => {
  await page.goto('/dev/tool-harness/');
  const pageOrigin = new URL(page.url()).origin;

  const photoTool = page.getByRole('region', { name: 'Photo resizer' });
  await expect(photoTool).toHaveAttribute('data-ready', 'true');

  // Build a real photo in the page and hand its exact bytes to Node so we can
  // search every request body for them afterwards.
  const b64 = await page.evaluate(async () => {
    const S = 1200;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, S, S);
    for (let i = 0; i <= 10; i++) g.addColorStop(i / 10, `hsl(${i * 36}, 70%, 55%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 1200; i++) {
      ctx.fillStyle = `hsla(${Math.random() * 360}, 70%, 50%, 0.5)`;
      ctx.beginPath();
      ctx.arc(Math.random() * S, Math.random() * S, 3 + Math.random() * 24, 0, Math.PI * 2);
      ctx.fill();
    }
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (const byte of buf) bin += String.fromCharCode(byte);
    return btoa(bin);
  });
  const fileBytes = Buffer.from(b64, 'base64');
  // A distinctive 128-byte needle taken from the middle of the file. If any request
  // body contains this, the file (or part of it) was transmitted.
  const needle = fileBytes.subarray(Math.floor(fileBytes.length / 2), Math.floor(fileBytes.length / 2) + 128);

  // Record every request fired from the moment we start converting.
  interface Seen {
    url: string;
    method: string;
    resourceType: string;
    body: Buffer | null;
  }
  const requests: Seen[] = [];
  const record = (req: import('@playwright/test').Request) => {
    requests.push({
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      body: req.postDataBuffer(),
    });
  };

  await photoTool.locator('input[type="file"]').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: fileBytes,
  });

  page.on('request', record);
  await photoTool.getByRole('button', { name: /resize photo/i }).click();
  await expect(photoTool.getByRole('link', { name: /download photo/i })).toBeVisible({
    timeout: 15_000,
  });
  // Give any (hypothetical) stray request a moment to appear before we judge.
  await page.waitForTimeout(500);
  page.off('request', record);

  // (a) Nothing left the page's own origin. blob:/data:/about: are in-browser only.
  const external = requests.filter((r) => {
    if (/^(blob:|data:|about:)/.test(r.url)) return false;
    try {
      return new URL(r.url).origin !== pageOrigin;
    } catch {
      return false;
    }
  });
  console.log(
    `[no-upload] ${requests.length} request(s) during conversion; ${external.length} cross-origin`,
  );
  expect(external, `unexpected cross-origin requests: ${external.map((r) => r.url).join(', ')}`).toEqual([]);

  // (b) No request body carried the file's bytes.
  const carriers = requests.filter((r) => r.body != null && r.body.includes(needle));
  expect(
    carriers,
    `a request body contained the file bytes: ${carriers.map((r) => `${r.method} ${r.url}`).join(', ')}`,
  ).toEqual([]);
});
