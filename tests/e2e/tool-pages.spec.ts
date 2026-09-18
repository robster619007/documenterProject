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

  // The in-page viewer opens and renders pages (pdf.js) so mobile can scroll them.
  await tool.getByRole('button', { name: /view all pages/i }).click();
  const dialog = page.getByRole('dialog', { name: /preview of compressed pdf/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('canvas').first()).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: /close preview/i }).click();
  await expect(dialog).toBeHidden();
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

// A plain N-page PDF built in Node, for the merge test.
async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    doc.addPage([595, 842]).drawText(`Page ${p + 1}`, { x: 50, y: 800, size: 12, font });
  }
  return Buffer.from(await doc.save());
}

test('merge-pdf page merges files in order, inserting a divider for a labelled file', async ({
  page,
}) => {
  await page.goto('/tools/merge-pdf/');
  const tool = page.getByRole('region', { name: 'PDF merger' });
  await expect(tool).toHaveAttribute('data-ready', 'true');

  // A = 2 pages, B = 1 page.
  await tool.locator('input[type="file"]').setInputFiles([
    { name: 'a.pdf', mimeType: 'application/pdf', buffer: await makePdf(2) },
    { name: 'b.pdf', mimeType: 'application/pdf', buffer: await makePdf(1) },
  ]);

  // Labelling the first file inserts one divider page before it.
  await tool.getByLabel(/section label for a\.pdf/i).fill('Section A');
  await tool.getByRole('button', { name: /merge 2 pdfs/i }).click();

  const download = tool.getByRole('link', { name: /download pdf/i });
  await expect(download).toBeVisible({ timeout: 15_000 });
  const href = await download.getAttribute('href');
  expect(href).toMatch(/^blob:/);
  await expect(download).toHaveAttribute('download', /\.pdf$/);

  // Read the merged bytes back and count pages: divider(1) + A(2) + B(1) = 4.
  const b64 = await page.evaluate(async (url) => {
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    let bin = '';
    for (const byte of buf) bin += String.fromCharCode(byte);
    return btoa(bin);
  }, href!);
  const merged = await PDFDocument.load(Buffer.from(b64, 'base64'));
  expect(merged.getPageCount()).toBe(4);
});
