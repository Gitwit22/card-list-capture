import { describe, expect, it } from 'vitest';
import { multiCardDetectionTestUtils } from '@/lib/multiCardDetection';

describe('multiCardDetection merge heuristics', () => {
  it('does not merge clearly separated card boxes', () => {
    const boxes = [
      { x: 40, y: 60, width: 320, height: 190, pixels: 42000 },
      { x: 378, y: 62, width: 318, height: 188, pixels: 41500 },
    ];

    const merged = multiCardDetectionTestUtils.mergeNearbyBoxes(boxes);
    expect(merged).toHaveLength(2);
  });

  it('still merges tiny fragmented regions from one card', () => {
    const boxes = [
      { x: 100, y: 120, width: 220, height: 130, pixels: 16000 },
      { x: 102, y: 122, width: 214, height: 126, pixels: 15200 },
    ];

    const merged = multiCardDetectionTestUtils.mergeNearbyBoxes(boxes);
    expect(merged).toHaveLength(1);
    expect(merged[0].width).toBeGreaterThanOrEqual(220);
    expect(merged[0].height).toBeGreaterThanOrEqual(130);
  });
});
