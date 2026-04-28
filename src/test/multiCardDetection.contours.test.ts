import { describe, expect, it } from 'vitest';
import { multiCardDetectionPhaseUtils } from '@/lib/multiCardDetection';

function drawRectEdges(
  edges: Uint8Array,
  width: number,
  box: { x: number; y: number; w: number; h: number },
): void {
  const left = box.x;
  const right = box.x + box.w - 1;
  const top = box.y;
  const bottom = box.y + box.h - 1;

  for (let x = left; x <= right; x += 1) {
    edges[top * width + x] = 1;
    edges[bottom * width + x] = 1;
  }
  for (let y = top; y <= bottom; y += 1) {
    edges[y * width + left] = 1;
    edges[y * width + right] = 1;
  }
}

describe('multiCardDetection contour phase', () => {
  it('detects a card-like rectangle from edge contours', () => {
    const W = 240;
    const H = 180;
    const edges = new Uint8Array(W * H);
    const bgMask = new Uint8Array(W * H);

    drawRectEdges(edges, W, { x: 50, y: 45, w: 120, h: 72 });

    const boxes = multiCardDetectionPhaseUtils.detectRectangularContours(edges, bgMask, W, H, 0.05);
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes[0].width).toBeGreaterThanOrEqual(110);
    expect(boxes[0].height).toBeGreaterThanOrEqual(64);
  });

  it('rejects non-card extreme aspect-ratio contours', () => {
    const W = 260;
    const H = 220;
    const edges = new Uint8Array(W * H);
    const bgMask = new Uint8Array(W * H);

    // Very tall and narrow shape (normalized ratio far beyond allowed range).
    drawRectEdges(edges, W, { x: 115, y: 10, w: 18, h: 190 });

    const boxes = multiCardDetectionPhaseUtils.detectRectangularContours(edges, bgMask, W, H, 0.03);
    expect(boxes).toHaveLength(0);
  });
});
