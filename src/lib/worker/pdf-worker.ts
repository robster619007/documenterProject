/// <reference lib="webworker" />
// The PDF compression Web Worker. Two strategies (see documenter-scope):
//   - 'keep-text': preserve selectable text; only re-save with object-stream
//     compression. Gentle — may not reach a tight size limit.
//   - 'rasterize': render each page to an image with pdf.js and rebuild the PDF
//     from JPEGs, binary-searching quality (and dropping render scale if needed)
//     to hit the size target. Reliable size control; text becomes a picture.
// 'auto' inspects the PDF for real text and picks a sensible default.
import { PDFDocument } from 'pdf-lib';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { searchQuality } from './size-search';
import type { PdfCompressMode, SizeTarget, WorkerResponse } from './types';

GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export interface PdfJob {
  jobId: string;
  input: ArrayBuffer;
  mode?: PdfCompressMode | 'auto';
  size: SizeTarget;
  // Initial render scale for rasterize (1 ≈ 72dpi). Dropped automatically if the
  // target can't be met at this scale. Default 2 (~144dpi).
  maxScale?: number;
}

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

const formatKB = (bytes: number) => `${Math.round(bytes / 1024)}KB`;

// pdf.js detaches the ArrayBuffer it is given, so hand it a fresh copy each time.
const copy = (buf: ArrayBuffer) => buf.slice(0);

self.onmessage = async (event: MessageEvent<PdfJob>) => {
  const job = event.data;
  try {
    await runPdfJob(job);
  } catch (err) {
    post({
      type: 'failure',
      jobId: job.jobId,
      reason: 'internal-error',
      message: `Could not process that PDF (${
        err instanceof Error ? err.message : 'unknown error'
      }). It may be encrypted or damaged.`,
    });
  }
};

async function runPdfJob(job: PdfJob): Promise<void> {
  const { input } = job;
  const beforeBytes = input.byteLength;

  const mode = job.mode && job.mode !== 'auto' ? job.mode : await pickMode(input);

  if (mode === 'keep-text') {
    return keepText(job, beforeBytes);
  }
  return rasterize(job, beforeBytes);
}

// Chooses a default mode: keep the text path for PDFs that actually contain text,
// otherwise rasterize (scans/photos have no real text to preserve).
async function pickMode(input: ArrayBuffer): Promise<PdfCompressMode> {
  const task = getDocument({ data: copy(input) });
  try {
    const pdf = await task.promise;
    const pages = Math.min(pdf.numPages, 3);
    let chars = 0;
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ('str' in item) chars += item.str.trim().length;
      }
    }
    return chars > 20 * pages ? 'keep-text' : 'rasterize';
  } catch {
    return 'rasterize';
  } finally {
    await task.destroy();
  }
}

// keep-text: re-save with object streams. No image surgery in the prototype, so
// compression is modest and honest about not reaching aggressive targets.
async function keepText(job: PdfJob, beforeBytes: number): Promise<void> {
  const { jobId, input, size } = job;
  post({ type: 'progress', jobId, phase: 'finalizing' });
  const doc = await PDFDocument.load(copy(input), { updateMetadata: false });
  const bytes = await doc.save({ useObjectStreams: true });
  const output = toArrayBuffer(bytes);

  const cap = maxBytesOf(size);
  if (cap !== undefined && output.byteLength > cap) {
    return post({
      type: 'failure',
      jobId,
      reason: 'target-unreachable-too-large',
      message: `Keeping the text selectable, this PDF only compresses to ${formatKB(
        output.byteLength,
      )} — above the ${formatKB(cap)} limit. Switch to "Smallest size" mode to go lower.`,
    });
  }

  post(successMessage(jobId, output, beforeBytes), [output]);
}

// rasterize: render pages once per scale, then binary-search JPEG quality to fit.
async function rasterize(job: PdfJob, beforeBytes: number): Promise<void> {
  const { jobId, input, size } = job;
  const cap = maxBytesOf(size);

  post({ type: 'progress', jobId, phase: 'resizing' });
  const scales = candidateScales(job.maxScale ?? 2);

  for (const scale of scales) {
    const pages = await renderPages(copy(input), scale, jobId);

    // Sum-of-JPEG bytes closely tracks final PDF size; search against it with a
    // small margin for PDF structure, then build once at the chosen quality.
    const encode = async (q: number) => {
      let sum = 0;
      for (const c of pages) sum += (await c.convertToBlob({ type: 'image/jpeg', quality: q })).size;
      return sum;
    };

    let quality = 0.92;
    if (cap !== undefined) {
      post({ type: 'progress', jobId, phase: 'searching' });
      const result = await searchQuality({ encode, maxBytes: Math.floor(cap * 0.92) });
      if (!result.ok) {
        // Too big even at lowest quality → try a smaller render scale next.
        if (result.reason === 'target-unreachable-too-large' && scale !== scales[scales.length - 1]) {
          continue;
        }
        return post({
          type: 'failure',
          jobId,
          reason: 'target-unreachable-too-large',
          message: `This PDF can't be squeezed under ${formatKB(cap)} even flattened. Try a higher limit.`,
        });
      }
      quality = result.quality;
    }

    post({ type: 'progress', jobId, phase: 'finalizing' });
    const output = await buildPdf(pages, quality);

    if (cap !== undefined && output.byteLength > cap && scale !== scales[scales.length - 1]) {
      continue; // overshoot after building → drop scale and retry
    }
    return post(successMessage(jobId, output, beforeBytes), [output]);
  }
}

// Renders every page of the PDF to an OffscreenCanvas at the given scale.
async function renderPages(data: ArrayBuffer, scale: number, jobId: string): Promise<OffscreenCanvas[]> {
  const task = getDocument({ data });
  const pdf = await task.promise;
  const canvases: OffscreenCanvas[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
      // canvas must be null when rendering via a (here Offscreen) 2D context.
      await page.render({ canvas: null, canvasContext: ctx, viewport }).promise;
      canvases.push(canvas);
      post({ type: 'progress', jobId, phase: 'resizing', ratio: i / pdf.numPages });
    }
  } finally {
    await task.destroy();
  }
  return canvases;
}

// Assembles a new PDF from the page images at the given JPEG quality.
async function buildPdf(pages: OffscreenCanvas[], quality: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (const canvas of pages) {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const img = await doc.embedJpg(bytes);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return toArrayBuffer(await doc.save({ useObjectStreams: true }));
}

function candidateScales(maxScale: number): number[] {
  return [maxScale, maxScale * 0.66, maxScale * 0.44].map((s) => Math.max(0.3, s));
}

function maxBytesOf(size: SizeTarget): number | undefined {
  return size.mode === 'original' ? undefined : size.maxBytes;
}

function successMessage(jobId: string, output: ArrayBuffer, beforeBytes: number): WorkerResponse {
  return {
    type: 'success',
    jobId,
    output,
    outputFormat: 'pdf',
    beforeBytes,
    afterBytes: output.byteLength,
  };
}

// Returns a standalone ArrayBuffer for a Uint8Array (safe to transfer).
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
