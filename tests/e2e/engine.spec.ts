import { test, expect } from '@playwright/test';

// Drives the real image worker in a real browser (OffscreenCanvas + the size
// search) and reports the spec's headline number: a large photo targeted to
// 20–50KB, plus the iterations used. Runs against the built site via preview.
test('image engine compresses a large photo into a 20-50KB range', async ({ page }) => {
  await page.goto('/dev/engine-harness/');
  await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__engineReady === true);

  const result = await page.evaluate(async () => {
    // Build a large, photo-like image: a colour gradient plus thousands of
    // random blobs give realistic mid-frequency detail — big when encoded, but
    // compressible like a real photo (unlike pure noise).
    const S = 3200;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, S, S);
    for (let i = 0; i <= 10; i++) {
      grad.addColorStop(i / 10, `hsl(${i * 36}, 70%, 55%)`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 6000; i++) {
      ctx.fillStyle = `hsla(${Math.random() * 360}, ${60 + Math.random() * 40}%, ${
        30 + Math.random() * 50
      }%, ${0.3 + Math.random() * 0.5})`;
      ctx.beginPath();
      ctx.arc(Math.random() * S, Math.random() * S, 4 + Math.random() * 34, 0, Math.PI * 2);
      ctx.fill();
    }
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.95));
    const input = await blob.arrayBuffer();

    const run = (window as unknown as Record<string, (i: ArrayBuffer, o: unknown) => Promise<{ beforeBytes: number; afterBytes: number; iterations?: number; width?: number; height?: number }>>).__runImageJob;

    // Resize to a passport-ish size and target 20–50KB, like a real exam photo.
    return run(input, {
      inputFormat: 'jpeg',
      outputFormat: 'jpeg',
      fit: { targetWidth: 413, targetHeight: 531, mode: 'cover' },
      size: { mode: 'range', minBytes: 20 * 1024, maxBytes: 50 * 1024 },
    });
  });

  // Report the real numbers (surfaces in the Playwright output).
  console.log(
    `[engine report] before=${(result.beforeBytes / 1_048_576).toFixed(2)}MB ` +
      `after=${(result.afterBytes / 1024).toFixed(1)}KB ` +
      `iterations=${result.iterations} dims=${result.width}x${result.height}`,
  );

  expect(result.beforeBytes).toBeGreaterThan(1_500_000);
  expect(result.afterBytes).toBeLessThanOrEqual(50 * 1024);
  expect(result.afterBytes).toBeGreaterThanOrEqual(20 * 1024);
  expect(result.iterations).toBeGreaterThan(0);
  expect(result.width).toBe(413);
  expect(result.height).toBe(531);
});

// A companion case proving a genuinely unreachable target fails cleanly rather
// than returning a best guess.
test('image engine reports a clean failure for an impossible target', async ({ page }) => {
  await page.goto('/dev/engine-harness/');
  await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__engineReady === true);

  const failure = await page.evaluate(async () => {
    const S = 1600;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(S, S);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = Math.random() * 255;
      img.data[i + 1] = Math.random() * 255;
      img.data[i + 2] = Math.random() * 255;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.95));
    const input = await blob.arrayBuffer();

    const run = (window as unknown as Record<string, (i: ArrayBuffer, o: unknown) => Promise<unknown>>).__runImageJob;
    try {
      // Full-resolution incompressible noise cannot fit in 5KB — must fail.
      await run(input, {
        inputFormat: 'jpeg',
        outputFormat: 'jpeg',
        fit: { mode: 'contain' },
        size: { mode: 'max', maxBytes: 5 * 1024 },
      });
      return { threw: false, message: '' };
    } catch (e) {
      return { threw: true, message: e instanceof Error ? e.message : String(e) };
    }
  });

  expect(failure.threw).toBe(true);
  expect(failure.message.toLowerCase()).toContain('dimensions');
});

// PDF: rasterize a scan-style (image-heavy) PDF under a hard size cap.
test('pdf engine (rasterize) compresses an image PDF under a size cap', async ({ page }) => {
  await page.goto('/dev/engine-harness/');
  await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__engineReady === true);

  const result = await page.evaluate(async () => {
    const w = window as unknown as Record<string, (...a: unknown[]) => Promise<never>>;
    const S = 2000;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, S, S);
    for (let i = 0; i <= 10; i++) g.addColorStop(i / 10, `hsl(${i * 36}, 70%, 55%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `hsla(${Math.random() * 360}, 70%, 50%, 0.5)`;
      ctx.beginPath();
      ctx.arc(Math.random() * S, Math.random() * S, 3 + Math.random() * 30, 0, Math.PI * 2);
      ctx.fill();
    }
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.95));
    const jpeg = await blob.arrayBuffer();
    const pdf = (await w.__makeImagePdf(jpeg)) as unknown as ArrayBuffer;
    const before = pdf.byteLength;
    const out = (await w.__runPdfJob(pdf, {
      mode: 'rasterize',
      size: { mode: 'max', maxBytes: 200 * 1024 },
    })) as unknown as { afterBytes: number };
    return { before, after: out.afterBytes };
  });

  console.log(
    `[pdf report] rasterize before=${(result.before / 1_048_576).toFixed(2)}MB after=${(
      result.after / 1024
    ).toFixed(1)}KB`,
  );
  expect(result.before).toBeGreaterThan(300 * 1024);
  expect(result.after).toBeLessThanOrEqual(200 * 1024);
});

// PDF: the two modes behave differently — keep-text preserves selectable text,
// rasterize flattens it away.
test('pdf engine keeps text in keep-text mode and drops it when rasterizing', async ({ page }) => {
  await page.goto('/dev/engine-harness/');
  await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__engineReady === true);

  const res = await page.evaluate(async () => {
    const w = window as unknown as Record<string, (...a: unknown[]) => Promise<never>>;
    const pdf = (await w.__makeTextPdf()) as unknown as ArrayBuffer;
    const inputText = (await w.__pdfTextLength(pdf.slice(0))) as unknown as number;

    const kept = (await w.__runPdfJob(pdf.slice(0), {
      mode: 'keep-text',
      size: { mode: 'max', maxBytes: 5 * 1024 * 1024 },
    })) as unknown as { output: ArrayBuffer };
    const keptText = (await w.__pdfTextLength(kept.output)) as unknown as number;

    const ras = (await w.__runPdfJob(pdf.slice(0), {
      mode: 'rasterize',
      size: { mode: 'max', maxBytes: 5 * 1024 * 1024 },
    })) as unknown as { output: ArrayBuffer };
    const rasText = (await w.__pdfTextLength(ras.output)) as unknown as number;

    return { inputText, keptText, rasText };
  });

  console.log(
    `[pdf report] text chars — input=${res.inputText} keep-text=${res.keptText} rasterize=${res.rasText}`,
  );
  expect(res.inputText).toBeGreaterThan(0);
  expect(res.keptText).toBeGreaterThan(0); // text preserved
  expect(res.rasText).toBe(0); // text flattened to an image
});

// Proves the pluggable-decoder path: a TIFF (not natively decodable by the
// browser) is decoded via the lazily-loaded utif2 decoder and re-encoded.
test('image engine decodes TIFF through the lazy decoder registry', async ({ page }) => {
  await page.goto('/dev/engine-harness/');
  await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__engineReady === true);

  const res = await page.evaluate(async () => {
    const w = window as unknown as Record<string, (...a: unknown[]) => Promise<never>>;
    const tiff = (await w.__makeTiff(80, 80)) as unknown as ArrayBuffer;
    const out = (await w.__runImageJob(tiff, {
      outputFormat: 'jpeg',
      fit: { mode: 'contain' },
      size: { mode: 'original' },
    })) as unknown as { afterBytes: number; outputFormat: string; width: number; height: number };
    return { after: out.afterBytes, fmt: out.outputFormat, width: out.width, height: out.height };
  });

  expect(res.after).toBeGreaterThan(0);
  expect(res.fmt).toBe('jpeg');
  expect(res.width).toBe(80);
  expect(res.height).toBe(80);
});
