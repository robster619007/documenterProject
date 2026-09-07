/// <reference lib="webworker" />
// The image conversion Web Worker. Runs entirely off the main thread: decodes an
// image, resizes it on an OffscreenCanvas, then encodes it — binary-searching
// JPEG/WebP quality to hit a target size. Native formats decode via
// createImageBitmap; HEIC/TIFF decoders are registered lazily (added later).
import { sniffFormat, registerDecoder, getDecoder, NATIVE_FORMATS } from './image-formats';
import { computeFitDimensions } from './fit-dimensions';
import { searchQuality } from './size-search';
import type {
  ImageFormat,
  OutputImageFormat,
  FitMode,
  SizeTarget,
  WorkerResponse,
} from './types';

// Register the browser-native decoders once at worker startup.
for (const format of NATIVE_FORMATS) {
  registerDecoder(format, (bytes) => createImageBitmap(new Blob([bytes])));
}

// Formats whose decoders are heavy (WASM / extra JS) and loaded on demand the
// first time such a file appears. Each imported module self-registers.
const LAZY_DECODERS: Partial<Record<ImageFormat, () => Promise<unknown>>> = {
  heic: () => import('./decoders/heic'),
  tiff: () => import('./decoders/tiff'),
};

export interface ImageJob {
  jobId: string;
  input: ArrayBuffer;
  inputFormat?: ImageFormat; // sniffed if omitted
  outputFormat: OutputImageFormat;
  fit: { targetWidth?: number; targetHeight?: number; mode: FitMode };
  size: SizeTarget;
}

const MIME: Record<OutputImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (event: MessageEvent<ImageJob>) => {
  const job = event.data;
  try {
    await runImageJob(job);
  } catch (err) {
    post({
      type: 'failure',
      jobId: job.jobId,
      reason: 'internal-error',
      message: `Something went wrong while processing the image (${
        err instanceof Error ? err.message : 'unknown error'
      }). Try a different file.`,
    });
  }
};

async function runImageJob(job: ImageJob): Promise<void> {
  const { jobId, input, outputFormat, fit, size } = job;
  const beforeBytes = input.byteLength;

  // 1. Identify and decode.
  const format = job.inputFormat ?? asImageFormat(sniffFormat(input));
  if (!format) {
    return post({
      type: 'failure',
      jobId,
      reason: 'unsupported-input',
      message: 'That file type is not supported. Upload a JPG, PNG, WebP, HEIC, AVIF, GIF, BMP or TIFF image.',
    });
  }
  post({ type: 'progress', jobId, phase: 'decoding' });

  // Load a heavy decoder on demand if this format needs one and isn't ready yet.
  let decoder = getDecoder(format);
  if (!decoder && LAZY_DECODERS[format]) {
    await LAZY_DECODERS[format]!();
    decoder = getDecoder(format);
  }
  if (!decoder) {
    return post({
      type: 'failure',
      jobId,
      reason: 'unsupported-input',
      message: `${format.toUpperCase()} images are not enabled yet. Try converting to JPG or PNG first.`,
    });
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await decoder(input);
  } catch {
    return post({
      type: 'failure',
      jobId,
      reason: 'decode-failed',
      message: 'That image could not be read — it may be corrupt or incomplete. Try re-saving or choosing another file.',
    });
  }

  // 2. Resize onto an OffscreenCanvas.
  post({ type: 'progress', jobId, phase: 'resizing' });
  const dims = computeFitDimensions({
    srcWidth: bitmap.width,
    srcHeight: bitmap.height,
    targetWidth: fit.targetWidth,
    targetHeight: fit.targetHeight,
    mode: fit.mode,
  });
  const canvas = new OffscreenCanvas(dims.canvasWidth, dims.canvasHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return post({
      type: 'failure',
      jobId,
      reason: 'internal-error',
      message: 'Could not prepare the image canvas. Reload the page and try again.',
    });
  }
  ctx.drawImage(bitmap, dims.offsetX, dims.offsetY, dims.drawWidth, dims.drawHeight);
  bitmap.close();

  const encodeAt = async (quality: number): Promise<ArrayBuffer> => {
    const blob = await canvas.convertToBlob({ type: MIME[outputFormat], quality });
    return blob.arrayBuffer();
  };

  // 3. Encode to hit the size target.
  let output: ArrayBuffer;
  let iterations: number | undefined;

  if (size.mode === 'original' || outputFormat === 'png') {
    // No size search: PNG is lossless (quality has no effect) and 'original'
    // means keep full quality. Encode once at top quality.
    post({ type: 'progress', jobId, phase: 'encoding' });
    output = await encodeAt(1.0);

    // If a hard cap was requested but a single encode overshoots, fail clearly.
    if (size.mode !== 'original' && 'maxBytes' in size && output.byteLength > size.maxBytes) {
      return post({
        type: 'failure',
        jobId,
        reason: 'target-unreachable-too-large',
        message: `This image can't reach ${formatKB(size.maxBytes)} as ${outputFormat.toUpperCase()}. Try JPEG, or smaller dimensions.`,
      });
    }
  } else {
    // Binary-search quality (JPEG/WebP) to land within the target.
    post({ type: 'progress', jobId, phase: 'searching' });
    const maxBytes = size.maxBytes;
    const minBytes = size.mode === 'range' ? size.minBytes : size.minBytes;
    const result = await searchQuality({ encode: async (q) => (await encodeAt(q)).byteLength, maxBytes, minBytes });
    if (!result.ok) {
      return post({
        type: 'failure',
        jobId,
        reason: result.reason,
        message:
          result.reason === 'target-unreachable-too-large'
            ? `This image can't be squeezed under ${formatKB(maxBytes)} at these dimensions. Try smaller dimensions.`
            : `This image can't reach the minimum of ${formatKB(minBytes ?? 0)} at these dimensions. Try larger dimensions or a higher-detail source.`,
      });
    }
    post({ type: 'progress', jobId, phase: 'finalizing' });
    output = await encodeAt(result.quality); // re-encode once at the winning quality
    iterations = result.iterations;
  }

  post(
    {
      type: 'success',
      jobId,
      output,
      outputFormat,
      beforeBytes,
      afterBytes: output.byteLength,
      width: dims.canvasWidth,
      height: dims.canvasHeight,
      iterations,
    },
    [output], // transfer, don't copy
  );
}

// Narrows a sniffed result to an ImageFormat (drops 'pdf'/'unknown').
function asImageFormat(detected: ReturnType<typeof sniffFormat>): ImageFormat | null {
  return detected === 'pdf' || detected === 'unknown' ? null : detected;
}

const formatKB = (bytes: number) => `${Math.round(bytes / 1024)}KB`;
