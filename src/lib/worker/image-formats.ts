// Format detection + a decoder registry. This is the extensibility seam: adding
// a new input format means (1) add it to the ImageFormat union in types.ts,
// (2) teach sniffFormat its magic bytes here, and (3) registerDecoder(...) for it.
// Nothing elsewhere in the engine needs to change.
import type { ImageFormat } from './types';

export type DetectedFormat = ImageFormat | 'pdf' | 'unknown';

// A decoder turns raw file bytes into an ImageBitmap the worker can draw. Most
// formats use the browser's built-in createImageBitmap; formats the browser
// can't decode natively (e.g. HEIC, TIFF) register a WASM-backed decoder instead.
export type ImageDecoder = (bytes: ArrayBuffer) => Promise<ImageBitmap>;

// Formats the browser decodes natively via createImageBitmap. HEIC and TIFF are
// intentionally absent — they need a plugged-in decoder.
export const NATIVE_FORMATS: readonly ImageFormat[] = [
  'jpeg',
  'png',
  'webp',
  'avif',
  'gif',
  'bmp',
];

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end));

const startsWith = (bytes: Uint8Array, sig: number[]): boolean =>
  sig.every((b, i) => bytes[i] === b);

// Identifies a file from its leading bytes (magic numbers). Pure and synchronous
// so it is trivially unit tested. Returns 'unknown' when nothing matches.
export function sniffFormat(input: ArrayBuffer | Uint8Array): DetectedFormat {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 12) return 'unknown';

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif'; // GIF8
  if (startsWith(bytes, [0x42, 0x4d])) return 'bmp'; // BM
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf'; // %PDF
  // TIFF: little-endian (II*\0) or big-endian (MM\0*)
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]))
    return 'tiff';
  // RIFF-based WebP: 'RIFF' .... 'WEBP'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';

  // ISO-BMFF (HEIC/AVIF): 'ftyp' at offset 4, brand at offset 8.
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    const heicBrands = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'];
    if (heicBrands.includes(brand)) return 'heic';
  }

  return 'unknown';
}

// --- Decoder registry -------------------------------------------------------

const decoders = new Map<ImageFormat, ImageDecoder>();

// Registers (or overrides) the decoder for a format. Called by the worker at
// startup for native formats and by lazy loaders for plugged-in ones (HEIC/TIFF).
export function registerDecoder(format: ImageFormat, decoder: ImageDecoder): void {
  decoders.set(format, decoder);
}

// Returns the decoder for a format, or undefined if none is registered yet.
export function getDecoder(format: ImageFormat): ImageDecoder | undefined {
  return decoders.get(format);
}

// Whether a format currently has a decoder available.
export function isFormatSupported(format: ImageFormat): boolean {
  return decoders.has(format);
}

// The formats that can be decoded right now. Useful for building the file
// picker's `accept` list and for tests.
export function supportedInputFormats(): ImageFormat[] {
  return [...decoders.keys()];
}
