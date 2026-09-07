import { describe, it, expect } from 'vitest';
import {
  sniffFormat,
  registerDecoder,
  getDecoder,
  isFormatSupported,
  supportedInputFormats,
} from '../../src/lib/worker/image-formats';

// Builds a 12+ byte buffer beginning with the given signature bytes.
function header(sig: number[]): Uint8Array {
  const buf = new Uint8Array(16);
  buf.set(sig, 0);
  return buf;
}

// ISO-BMFF header: 4 size bytes, then 'ftyp', then a 4-char brand.
function isobmff(brand: string): Uint8Array {
  const buf = new Uint8Array(16);
  buf.set([0, 0, 0, 0x18], 0);
  buf.set([...'ftyp'].map((c) => c.charCodeAt(0)), 4);
  buf.set([...brand].map((c) => c.charCodeAt(0)), 8);
  return buf;
}

describe('sniffFormat', () => {
  it('detects raster formats by magic bytes', () => {
    expect(sniffFormat(header([0xff, 0xd8, 0xff]))).toBe('jpeg');
    expect(sniffFormat(header([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(sniffFormat(header([0x47, 0x49, 0x46, 0x38]))).toBe('gif');
    expect(sniffFormat(header([0x42, 0x4d]))).toBe('bmp');
    expect(sniffFormat(header([0x49, 0x49, 0x2a, 0x00]))).toBe('tiff');
  });

  it('detects RIFF/WebP, HEIC and AVIF containers', () => {
    const webp = new Uint8Array(16);
    webp.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
    webp.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
    expect(sniffFormat(webp)).toBe('webp');
    expect(sniffFormat(isobmff('heic'))).toBe('heic');
    expect(sniffFormat(isobmff('mif1'))).toBe('heic');
    expect(sniffFormat(isobmff('avif'))).toBe('avif');
  });

  it('detects PDF and reports unknown otherwise', () => {
    expect(sniffFormat(header([0x25, 0x50, 0x44, 0x46]))).toBe('pdf');
    expect(sniffFormat(header([0x00, 0x01, 0x02, 0x03]))).toBe('unknown');
    expect(sniffFormat(new Uint8Array(4))).toBe('unknown'); // too short
  });
});

describe('decoder registry', () => {
  it('registers, looks up, and reports support for a format', () => {
    expect(isFormatSupported('tiff')).toBe(false);
    const fake = async () => ({}) as unknown as ImageBitmap;
    registerDecoder('tiff', fake);
    expect(isFormatSupported('tiff')).toBe(true);
    expect(getDecoder('tiff')).toBe(fake);
    expect(supportedInputFormats()).toContain('tiff');
  });
});
