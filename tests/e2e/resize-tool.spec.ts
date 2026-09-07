import { test, expect } from '@playwright/test';

// Drives the real ResizeTool island in a real browser against the built site.
// Generates a large, compressible photo in the page, feeds it through the file
// input, and checks the on-screen result lands inside the required range — proving
// the UI ↔ worker round trip works end to end without any upload.

// Builds photo-like JPEG bytes (gradient + blobs) and returns them base64-encoded,
// so the test can hand them to the file input as a real File.
async function makePhotoBase64(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(async () => {
    const S = 2400;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, S, S);
    for (let i = 0; i <= 10; i++) grad.addColorStop(i / 10, `hsl(${i * 36}, 70%, 55%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `hsla(${Math.random() * 360}, 70%, 50%, 0.5)`;
      ctx.beginPath();
      ctx.arc(Math.random() * S, Math.random() * S, 3 + Math.random() * 28, 0, Math.PI * 2);
      ctx.fill();
    }
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.95));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (const byte of buf) bin += String.fromCharCode(byte);
    return btoa(bin);
  });
}

test('resize tool compresses a photo into the required range and offers a download', async ({
  page,
}) => {
  // The dev harness mounts a fixed-spec Photo tool (20–50KB at 276×354).
  await page.goto('/dev/tool-harness/');

  const base64 = await makePhotoBase64(page);
  const buffer = Buffer.from(base64, 'base64');
  expect(buffer.byteLength).toBeGreaterThan(300 * 1024); // genuinely large input

  // Wait for the island to hydrate before feeding the input, or the change event
  // is lost.
  const photoTool = page.getByRole('region', { name: 'Photo resizer' });
  await expect(photoTool).toHaveAttribute('data-ready', 'true');
  await photoTool.locator('input[type="file"]').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer,
  });

  // Preview appears once a file is chosen.
  await expect(photoTool.getByRole('img', { name: /selected photo/i })).toBeVisible();

  await photoTool.getByRole('button', { name: /resize photo/i }).click();

  // Result and a working download link appear.
  const download = photoTool.getByRole('link', { name: /download photo/i });
  await expect(download).toBeVisible({ timeout: 15_000 });
  await expect(photoTool.getByText(/within your target/i)).toBeVisible();
  // The shared ResultPreview shows the generated image.
  await expect(photoTool.getByRole('img', { name: /preview of resized photo/i })).toBeVisible();

  const href = await download.getAttribute('href');
  expect(href).toMatch(/^blob:/);
  await expect(download).toHaveAttribute('download', /photo-resized\.jpg/);
});

test('resize tool reports a clear error for an unsupported file', async ({ page }) => {
  await page.goto('/dev/tool-harness/');

  const signatureTool = page.getByRole('region', { name: 'Signature resizer' });
  await expect(signatureTool).toHaveAttribute('data-ready', 'true');
  // A file that passes the input's image/* filter but whose bytes are not a real
  // image: the worker sniffs the content (not the name) and rejects it.
  await signatureTool.locator('input[type="file"]').setInputFiles({
    name: 'notes.png',
    mimeType: 'image/png',
    buffer: Buffer.from('this is not an image', 'utf8'),
  });
  await signatureTool.getByRole('button', { name: /resize signature/i }).click();

  const alert = signatureTool.getByRole('alert');
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert).toContainText(/not supported/i);
});

test('generic resize tool honours a custom size limit', async ({ page }) => {
  await page.goto('/tools/photo-signature-resize/');

  const tool = page.getByRole('region', { name: 'Image resizer' });
  await expect(tool).toHaveAttribute('data-ready', 'true');

  // Type a custom 40 KB limit and resize to modest dimensions (a tight cap is only
  // reachable once the image is scaled down), then feed a large photo.
  await tool.getByLabel(/maximum size/i).fill('40');
  await tool.getByRole('checkbox', { name: /resize to exact dimensions/i }).check();
  const b64 = await makePhotoBase64(page);
  await tool.locator('input[type="file"]').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(b64, 'base64'),
  });
  await tool.getByRole('button', { name: /resize image/i }).click();

  const download = tool.getByRole('link', { name: /download image/i });
  await expect(download).toBeVisible({ timeout: 15_000 });
  await expect(tool.getByText(/within your target/i)).toBeVisible();
});
