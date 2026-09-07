import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// Functional round-trips for the two PDF tool islands, driven through their real
// pages against the built site. Inputs are generated so the tests are hermetic.

// A multi-page text PDF built in Node, returned as a Buffer for the file input.
async function makeTextPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 3; p++) {
    const page = doc.addPage([595, 842]);
    for (let line = 0; line < 40; line++) {
      page.drawText(`Application form line ${p * 40 + line}: the quick brown fox.`, {
        x: 50,
        y: 800 - line * 18,
        size: 11,
        font,
      });
    }
  }
  return Buffer.from(await doc.save());
}

// Photo-like JPEG bytes generated in the page, base64-encoded for transport.
async function makePhotoBase64(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(async () => {
    const S = 1400;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, S, S);
    for (let i = 0; i <= 10; i++) g.addColorStop(i / 10, `hsl(${i * 36}, 70%, 55%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 1500; i++) {
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
}

test('compress-pdf page compresses a PDF under a size cap', async ({ page }) => {
  await page.goto('/tools/compress-pdf/');
  const tool = page.getByRole('region', { name: 'PDF compressor' });
  await expect(tool).toHaveAttribute('data-ready', 'true');

  await tool.locator('input[type="file"]').setInputFiles({
    name: 'form.pdf',
    mimeType: 'application/pdf',
    buffer: await makeTextPdf(),
  });
  // Turn on a size limit (default 500 KB is comfortably reachable) and compress.
  await tool.getByRole('checkbox', { name: /compress to a size limit/i }).check();
  await tool.getByRole('button', { name: /compress pdf/i }).click();

  const download = tool.getByRole('link', { name: /download pdf/i });
  await expect(download).toBeVisible({ timeout: 15_000 });
  await expect(download).toHaveAttribute('href', /^blob:/);
  // The shared ResultPreview embeds the generated PDF.
  await expect(tool.getByTitle(/preview of compressed pdf/i)).toBeVisible();
});

test('image-to-pdf page builds a PDF from images', async ({ page }) => {
  await page.goto('/tools/image-to-pdf/');
  const tool = page.getByRole('region', { name: 'Image to PDF converter' });
  await expect(tool).toHaveAttribute('data-ready', 'true');

  const b64 = await makePhotoBase64(page);
  const buffer = Buffer.from(b64, 'base64');
  await tool.locator('input[type="file"]').setInputFiles([
    { name: 'page1.jpg', mimeType: 'image/jpeg', buffer },
    { name: 'page2.jpg', mimeType: 'image/jpeg', buffer },
  ]);

  // Two images listed → two pages.
  await expect(tool.getByRole('button', { name: /make pdf \(2 pages\)/i })).toBeVisible();
  await tool.getByRole('button', { name: /make pdf/i }).click();

  const download = tool.getByRole('link', { name: /download pdf/i });
  await expect(download).toBeVisible({ timeout: 15_000 });
  await expect(download).toHaveAttribute('href', /^blob:/);
  // The shared ResultPreview embeds the generated PDF.
  await expect(tool.getByTitle(/preview of generated pdf/i)).toBeVisible();
});
