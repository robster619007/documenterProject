/// <reference lib="webworker" />
// Shared image-decoding helper for workers. Registers the browser-native decoders
// on import and lazy-loads heavy ones (HEIC/TIFF) on first use, exactly like the
// image worker. Factored out so the image→PDF worker can decode the same set of
// formats without duplicating the registry wiring.
import { sniffFormat, registerDecoder, getDecoder, NATIVE_FORMATS } from './image-formats';
import type { ImageFormat } from './types';

// Register browser-native decoders once when this module is first imported.
for (const format of NATIVE_FORMATS) {
  registerDecoder(format, (bytes) => createImageBitmap(new Blob([bytes])));
}

// Heavy decoders, imported on demand the first time such a file appears. Each
// module self-registers its decoder.
const LAZY_DECODERS: Partial<Record<ImageFormat, () => Promise<unknown>>> = {
  heic: () => import('./decoders/heic'),
  tiff: () => import('./decoders/tiff'),
};

// A decode outcome the caller can turn into a specific, user-facing failure.
export class ImageDecodeError extends Error {
  constructor(
    public readonly reason: 'unsupported-input' | 'decode-failed',
    public readonly detail?: string,
  ) {
    super(reason);
    this.name = 'ImageDecodeError';
  }
}

// Decodes image bytes to an ImageBitmap, sniffing the format and lazy-loading a
// decoder if needed. Throws ImageDecodeError('unsupported-input') for a format we
// cannot read and ImageDecodeError('decode-failed') for corrupt/incomplete bytes.
export async function decodeImage(bytes: ArrayBuffer): Promise<ImageBitmap> {
  const detected = sniffFormat(bytes);
  const format: ImageFormat | null = detected === 'pdf' || detected === 'unknown' ? null : detected;
  if (!format) throw new ImageDecodeError('unsupported-input');

  let decoder = getDecoder(format);
  if (!decoder && LAZY_DECODERS[format]) {
    await LAZY_DECODERS[format]!();
    decoder = getDecoder(format);
  }
  if (!decoder) throw new ImageDecodeError('unsupported-input', format);

  try {
    return await decoder(bytes);
  } catch {
    throw new ImageDecodeError('decode-failed');
  }
}
