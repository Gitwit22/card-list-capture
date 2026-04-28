import { describe, expect, it } from 'vitest';
import { multiCardDetectionPhaseUtils } from '@/lib/multiCardDetection';

describe('multiCardDetection fallback clustering phase', () => {
  it('clusters nearby rejected boxes together', () => {
    const boxes = [
      { x: 20, y: 20, width: 28, height: 16, pixels: 320 },
      { x: 56, y: 24, width: 24, height: 14, pixels: 260 },
      { x: 300, y: 200, width: 30, height: 18, pixels: 340 },
      { x: 336, y: 205, width: 25, height: 16, pixels: 290 },
    ];

    const clusters = multiCardDetectionPhaseUtils.clusterRejectedComponents(boxes, 640, 480);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].length + clusters[1].length).toBe(4);
    expect(clusters.every((cluster) => cluster.length >= 2)).toBe(true);
  });

  it('returns empty when no rejected boxes are supplied', () => {
    const clusters = multiCardDetectionPhaseUtils.clusterRejectedComponents([], 640, 480);
    expect(clusters).toHaveLength(0);
  });
});
