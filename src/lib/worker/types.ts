// Shared message and result types for the conversion workers (image + PDF).
// The UI and the workers both import these so the message contract is enforced
// by the type system rather than by convention.

// Input image formats the engine can accept. Extend this union (and register a
// decoder in image-formats.ts) to add a new format — nothing else needs to know.
export type ImageFormat =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'heic'
  | 'avif'
  | 'gif'
  | 'bmp'
  | 'tiff';

// Formats we can *write*. Deliberately narrow: these are the ones with reliable,
// size-controllable browser encoders.
export type OutputImageFormat = 'jpeg' | 'png' | 'webp';

// How to fit a source image into target dimensions.
// contain = whole image visible; cover = fill the box, cropping the overflow.
export type FitMode = 'contain' | 'cover';

// The size goal for a job.
//  - 'original': do not reduce; keep full quality (passthrough / convert only).
//  - 'range':    land the output within [minBytes, maxBytes].
//  - 'max':      keep the output at or below maxBytes (minBytes optional).
export type SizeTarget =
  | { mode: 'original' }
  | { mode: 'range'; minBytes: number; maxBytes: number }
  | { mode: 'max'; maxBytes: number; minBytes?: number };

// How the PDF worker should compress. See documenter-scope: "Keep text" preserves
// selectable text (gentler); "rasterize" flattens pages to images (reliable size).
export type PdfCompressMode = 'keep-text' | 'rasterize';

// Machine-readable failure reasons. Every failure carries one so the UI can show
// a specific, actionable message instead of a generic error.
export type FailureReason =
  | 'unsupported-input'
  | 'decode-failed'
  | 'encode-failed'
  | 'target-unreachable-too-large' // cannot get small enough at these dimensions
  | 'target-unreachable-too-small' // cannot reach minBytes even at best quality
  | 'password-protected' // PDF is encrypted/password-protected; cannot be read
  | 'internal-error';

// Progress updates are posted during a job so the UI can drive an aria-live region.
export interface ProgressMessage {
  type: 'progress';
  jobId: string;
  phase: 'decoding' | 'resizing' | 'encoding' | 'searching' | 'finalizing';
  // 0..1 where known; omit when indeterminate.
  ratio?: number;
}

export interface SuccessMessage {
  type: 'success';
  jobId: string;
  // The produced file bytes. Transferred (not copied) back to the main thread.
  output: ArrayBuffer;
  outputFormat: OutputImageFormat | 'pdf';
  beforeBytes: number;
  afterBytes: number;
  width?: number;
  height?: number;
  // How many encode attempts the size search used (for reporting/telemetry).
  iterations?: number;
}

export interface FailureMessage {
  type: 'failure';
  jobId: string;
  reason: FailureReason;
  // A user-facing sentence: what went wrong and what to try next.
  message: string;
}

export type WorkerResponse = ProgressMessage | SuccessMessage | FailureMessage;
