// Pure aspect-ratio math for resizing. No browser APIs, so it is fully unit
// testable in Node. The worker uses the result to size an OffscreenCanvas and
// position the source image on it.
import type { FitMode } from './types';

export interface FitInput {
  srcWidth: number;
  srcHeight: number;
  // Target box. Provide one or both; omit both to keep the source size.
  targetWidth?: number;
  targetHeight?: number;
  mode: FitMode;
}

export interface FitResult {
  // Final canvas (output image) dimensions.
  canvasWidth: number;
  canvasHeight: number;
  // Where and how large to draw the source on the canvas. For 'cover' the draw
  // rect is larger than the canvas and offsets are negative (center crop).
  drawWidth: number;
  drawHeight: number;
  offsetX: number;
  offsetY: number;
}

// Computes canvas size and draw rectangle to fit a source image into a target
// box while preserving aspect ratio. Assumes positive source dimensions.
export function computeFitDimensions(input: FitInput): FitResult {
  const { srcWidth, srcHeight, targetWidth, targetHeight, mode } = input;

  if (srcWidth <= 0 || srcHeight <= 0) {
    throw new Error('Source dimensions must be positive.');
  }

  // No target: keep the source untouched.
  if (targetWidth === undefined && targetHeight === undefined) {
    return square(srcWidth, srcHeight);
  }

  // Only one dimension constrained: scale uniformly by it.
  if (targetWidth === undefined || targetHeight === undefined) {
    const scale =
      targetWidth !== undefined ? targetWidth / srcWidth : targetHeight! / srcHeight;
    const w = Math.max(1, Math.round(srcWidth * scale));
    const h = Math.max(1, Math.round(srcHeight * scale));
    return square(w, h);
  }

  // Both dimensions constrained.
  const scaleContain = Math.min(targetWidth / srcWidth, targetHeight / srcHeight);
  const scaleCover = Math.max(targetWidth / srcWidth, targetHeight / srcHeight);
  const scale = mode === 'cover' ? scaleCover : scaleContain;

  const drawWidth = Math.max(1, Math.round(srcWidth * scale));
  const drawHeight = Math.max(1, Math.round(srcHeight * scale));

  if (mode === 'cover') {
    // Canvas is exactly the target box; the scaled image overflows and is
    // centered so the crop is symmetric.
    return {
      canvasWidth: targetWidth,
      canvasHeight: targetHeight,
      drawWidth,
      drawHeight,
      offsetX: Math.round((targetWidth - drawWidth) / 2),
      offsetY: Math.round((targetHeight - drawHeight) / 2),
    };
  }

  // contain: canvas hugs the scaled image (no letterbox padding added).
  return square(drawWidth, drawHeight);
}

// Helper: a canvas the same size as the drawn image, drawn at the origin.
function square(width: number, height: number): FitResult {
  return {
    canvasWidth: width,
    canvasHeight: height,
    drawWidth: width,
    drawHeight: height,
    offsetX: 0,
    offsetY: 0,
  };
}
