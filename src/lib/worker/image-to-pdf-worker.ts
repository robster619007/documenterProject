/// <reference lib="webworker" />
// The image→PDF Web Worker (new in Milestone 5). Takes one or more images and
// builds a PDF with one image per page, optionally binary-searching a shared JPEG
// quality to keep the whole document under a size target. All decoding/encoding is
// off the main thread (CLAUDE.md rule 2) and nothing is uploaded (rule 1).
import { PDFDocument } from 'pdf-lib';
import { searchQuality } from './size-search';
import { decodeImage, ImageDecodeError } from './decode-image';
import type { SizeTarget, WorkerResponse } from './types';

export interface ImageToPdfJob {
  jobId: string;
  images: ArrayBuffer[]; // one or more images, in page order
  size: SizeTarget;
  // Longest edge each page image is scaled down to (px). Caps PDF size and memory.
  maxEdgePx?: number;
}

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

const formatKB = (bytes: number) => `${Math.round(bytes / 1024)}KB`;

self.onmessage = async (event: MessageEvent<ImageToPdfJob>) => {
  const job = event.data;
  try {
    await runJob(job);
  } catch (err) {
    if (err instanceof ImageDecodeError) {
      return post({
        type: 'failure',
        jobId: job.jobId,
        reason: err.reason,
        message:
          err.reason === 'unsupported-input'
            ? 'One of those files is not a supported image. Use JPG, PNG, WebP, HEIC, AVIF, GIF, BMP or TIFF.'
            : 'One of those images could not be read — it may be corrupt. Remove it and try again.',
      });
    }
    post({
      type: 'failure',
      jobId: job.jobId,
      reason: 'internal-error',
      message: `Could not build the PDF (${
        err instanceof Error ? err.message : 'unknown error'
      }). Try fewer or smaller images.`,
    });
  }
};

async function runJob(job: ImageToPdfJob): Promise<void> {
  const { jobId, images, size } = job;
  if (images.length === 0) {
    return post({
      type: 'failure',
      jobId,
      reason: 'internal-error',
      message: 'Add at least one image to make a PDF.',
    });
  }
  const beforeBytes = images.reduce((sum, b) => sum + b.byteLength, 0);
  const maxEdge = job.maxEdgePx ?? 2000;

  // 1. Decode every image and draw it (scaled to fit maxEdge) onto a canvas.
  post({ type: 'progress', jobId, phase: 'decoding' });
  const canvases: OffscreenCanvas[] = [];
  for (let i = 0; i < images.length; i++) {
    const bitmap = await decodeImage(images[i]);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return post({
        type: 'failure',
        jobId,
        reason: 'internal-error',
        message: 'Could not prepare the page canvas. Reload the page and try again.',
      });
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    canvases.push(canvas);
    post({ type: 'progress', jobId, phase: 'resizing', ratio: (i + 1) / images.length });
  }

  // 2. Choose a JPEG quality. Sum-of-JPEG bytes tracks final PDF size closely.
  const cap = size.mode === 'original' ? undefined : size.maxBytes;
  const minBytes = size.mode === 'range' ? size.minBytes : undefined;
  let quality = 0.9;
  if (cap !== undefined) {
    post({ type: 'progress', jobId, phase: 'searching' });
    const encode = async (q: number) => {
      let sum = 0;
      for (const c of canvases) sum += (await c.convertToBlob({ type: 'image/jpeg', quality: q })).size;
      return sum;
    };
    const result = await searchQuality({ encode, maxBytes: Math.floor(cap * 0.92), minBytes });
    if (!result.ok) {
      return post({
        type: 'failure',
        jobId,
        reason: result.reason,
        message:
          result.reason === 'target-unreachable-too-large'
            ? `These images can't fit under ${formatKB(cap)} as a PDF. Try a higher limit or fewer images.`
            : `This PDF can't reach the minimum of ${formatKB(minBytes ?? 0)}. Try a lower minimum.`,
      });
    }
    quality = result.quality;
  }

  // 3. Assemble the PDF, one image per page.
  post({ type: 'progress', jobId, phase: 'finalizing' });
  const doc = await PDFDocument.create();
  for (const canvas of canvases) {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const img = await doc.embedJpg(bytes);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  const saved = await doc.save({ useObjectStreams: true });
  const output = saved.buffer.slice(
    saved.byteOffset,
    saved.byteOffset + saved.byteLength,
  ) as ArrayBuffer;

  post(
    {
      type: 'success',
      jobId,
      output,
      outputFormat: 'pdf',
      beforeBytes,
      afterBytes: output.byteLength,
    },
    [output],
  );
}
