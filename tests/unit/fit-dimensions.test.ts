import { describe, it, expect } from 'vitest';
import { computeFitDimensions } from '../../src/lib/worker/fit-dimensions';

describe('computeFitDimensions', () => {
  it('keeps the source size when no target is given', () => {
    const r = computeFitDimensions({ srcWidth: 800, srcHeight: 600, mode: 'contain' });
    expect(r).toMatchObject({ canvasWidth: 800, canvasHeight: 600, drawWidth: 800, drawHeight: 600 });
  });

  it('scales by a single constrained dimension, preserving aspect ratio', () => {
    const r = computeFitDimensions({
      srcWidth: 4000,
      srcHeight: 3000,
      targetWidth: 1000,
      mode: 'contain',
    });
    expect(r.canvasWidth).toBe(1000);
    expect(r.canvasHeight).toBe(750); // 3000 * (1000/4000)
  });

  it('contain fits the whole image inside the box without padding', () => {
    // 4000x3000 into 1000x1000 -> scale by min(0.25, 0.333) = 0.25 -> 1000x750.
    const r = computeFitDimensions({
      srcWidth: 4000,
      srcHeight: 3000,
      targetWidth: 1000,
      targetHeight: 1000,
      mode: 'contain',
    });
    expect(r).toMatchObject({ canvasWidth: 1000, canvasHeight: 750, offsetX: 0, offsetY: 0 });
  });

  it('cover fills the exact target box and center-crops the overflow', () => {
    // 4000x3000 into 1000x1000 -> scale by max(0.25, 0.333) = 0.333 -> draw 1333x1000.
    const r = computeFitDimensions({
      srcWidth: 4000,
      srcHeight: 3000,
      targetWidth: 1000,
      targetHeight: 1000,
      mode: 'cover',
    });
    expect(r.canvasWidth).toBe(1000);
    expect(r.canvasHeight).toBe(1000);
    expect(r.drawWidth).toBe(1333);
    expect(r.drawHeight).toBe(1000);
    expect(r.offsetX).toBe(Math.round((1000 - 1333) / 2)); // negative -> centered crop
    expect(r.offsetY).toBe(0);
  });

  it('throws on non-positive source dimensions', () => {
    expect(() => computeFitDimensions({ srcWidth: 0, srcHeight: 100, mode: 'contain' })).toThrow();
  });
});
