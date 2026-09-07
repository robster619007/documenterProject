import { describe, it, expect } from 'vitest';
import { searchQuality } from '../../src/lib/worker/size-search';

// A deterministic fake encoder: output bytes scale linearly with quality between
// `atZero` (quality 0) and `atOne` (quality 1). Monotonic, like a real JPEG
// encoder, so the binary search has a well-defined crossing point. Also counts
// calls so we can assert the iteration cap.
function linearEncoder(atZero: number, atOne: number) {
  let calls = 0;
  const encode = async (q: number) => {
    calls++;
    return Math.round(atZero + (atOne - atZero) * q);
  };
  return { encode, calls: () => calls };
}

describe('searchQuality', () => {
  it('returns full quality when the best quality already fits under the cap', async () => {
    const enc = linearEncoder(10_000, 40_000);
    const res = await searchQuality({ encode: enc.encode, maxBytes: 50_000 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.quality).toBe(1.0);
      expect(res.bytes).toBe(40_000);
      expect(res.iterations).toBe(1); // one probe at max quality is enough
    }
  });

  it('finds the highest quality that lands within a [min,max] range', async () => {
    // Ranges from 20KB (q=0) to 200KB (q=1); target 20KB–50KB.
    const enc = linearEncoder(20_000, 200_000);
    const res = await searchQuality({
      encode: enc.encode,
      minBytes: 20_000,
      maxBytes: 50_000,
      maxIterations: 8,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.bytes).toBeLessThanOrEqual(50_000);
      expect(res.bytes).toBeGreaterThanOrEqual(20_000);
      expect(res.quality).toBeGreaterThan(0.1);
      expect(res.quality).toBeLessThan(1.0);
    }
  });

  it('fails cleanly when the target is unreachable — too large even at lowest quality', async () => {
    // Never smaller than 500KB; asking for <= 50KB is impossible.
    const enc = linearEncoder(500_000, 900_000);
    const res = await searchQuality({ encode: enc.encode, maxBytes: 50_000 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('target-unreachable-too-large');
      expect(res.bytes).toBeGreaterThan(50_000);
    }
  });

  it('fails cleanly when the output is below the floor even at full quality', async () => {
    // Maxes out at 8KB; a 20KB floor cannot be reached at these dimensions.
    const enc = linearEncoder(2_000, 8_000);
    const res = await searchQuality({
      encode: enc.encode,
      minBytes: 20_000,
      maxBytes: 50_000,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('target-unreachable-too-small');
      expect(res.bytes).toBe(8_000);
    }
  });

  it('never exceeds the iteration cap', async () => {
    const enc = linearEncoder(10_000, 500_000);
    const res = await searchQuality({
      encode: enc.encode,
      maxBytes: 50_000,
      maxIterations: 8,
    });
    expect(enc.calls()).toBeLessThanOrEqual(8);
    expect(res.iterations).toBeLessThanOrEqual(8);
  });
});
