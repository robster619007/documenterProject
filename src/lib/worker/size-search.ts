// Pure size-targeting logic: given an encoder that turns a quality (0..1) into an
// output byte count, find the highest quality whose output fits the target size.
// It knows nothing about images or PDFs — it just calls `encode` — so it is fully
// unit testable in Node with a fake encoder, and is reused by both workers.

export interface SizeSearchOptions {
  // Encodes at the given quality and resolves with the resulting byte length.
  // Assumed monotonic: higher quality -> larger (or equal) output.
  encode: (quality: number) => Promise<number>;
  maxBytes: number;
  // Optional lower bound; when set, output smaller than this counts as "too small".
  minBytes?: number;
  minQuality?: number; // default 0.1
  maxQuality?: number; // default 1.0
  maxIterations?: number; // default 8
}

export interface SizeSearchSuccess {
  ok: true;
  quality: number;
  bytes: number;
  iterations: number;
}

export interface SizeSearchFailure {
  ok: false;
  reason: 'target-unreachable-too-large' | 'target-unreachable-too-small';
  bytes: number; // best byte count achieved
  quality: number; // quality at that best attempt
  iterations: number;
}

export type SizeSearchResult = SizeSearchSuccess | SizeSearchFailure;

// Binary-searches quality to land the encoded size at or below maxBytes (and at
// or above minBytes when given), preferring the highest quality that fits. Caps
// the number of encode calls. Returns a structured failure when the target is
// unreachable at the current encoder settings rather than a best guess.
export async function searchQuality(options: SizeSearchOptions): Promise<SizeSearchResult> {
  const {
    encode,
    maxBytes,
    minBytes,
    minQuality = 0.1,
    maxQuality = 1.0,
    maxIterations = 8,
  } = options;

  let iterations = 0;

  // Try the best quality first: if it already fits under the cap, we are done
  // (nothing beats it on quality). This also handles the "already small" case.
  const bytesAtMax = await encode(maxQuality);
  iterations++;
  if (bytesAtMax <= maxBytes) {
    if (minBytes !== undefined && bytesAtMax < minBytes) {
      // Even at full quality the output is below the floor — cannot get bigger
      // without larger dimensions; that is the caller's lever, not ours.
      return {
        ok: false,
        reason: 'target-unreachable-too-small',
        bytes: bytesAtMax,
        quality: maxQuality,
        iterations,
      };
    }
    return { ok: true, quality: maxQuality, bytes: bytesAtMax, iterations };
  }

  // Full quality is too big. If even the lowest quality overshoots, the target is
  // unreachable at these dimensions.
  const bytesAtMin = await encode(minQuality);
  iterations++;
  if (bytesAtMin > maxBytes) {
    return {
      ok: false,
      reason: 'target-unreachable-too-large',
      bytes: bytesAtMin,
      quality: minQuality,
      iterations,
    };
  }

  // The crossing lies between minQuality and maxQuality. Binary-search for the
  // highest quality whose output is still <= maxBytes.
  let lo = minQuality;
  let hi = maxQuality;
  let best = { quality: minQuality, bytes: bytesAtMin };

  while (iterations < maxIterations) {
    const mid = (lo + hi) / 2;
    const bytes = await encode(mid);
    iterations++;
    if (bytes <= maxBytes) {
      best = { quality: mid, bytes };
      lo = mid; // fits — try to buy more quality
    } else {
      hi = mid; // too big — back off
    }
  }

  if (minBytes !== undefined && best.bytes < minBytes) {
    // The best we can do under the cap is still below the floor at these
    // dimensions: report it so the worker can retry larger or fail cleanly.
    return {
      ok: false,
      reason: 'target-unreachable-too-small',
      bytes: best.bytes,
      quality: best.quality,
      iterations,
    };
  }

  return { ok: true, quality: best.quality, bytes: best.bytes, iterations };
}
