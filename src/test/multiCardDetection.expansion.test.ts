import { describe, expect, it } from 'vitest';
import { multiCardDetectionPhaseUtils } from '@/lib/multiCardDetection';

describe('multiCardDetection expansion phase', () => {
  it('expands up to max expansion fraction when no background boundary exists', () => {
    const W = 140;
    const H = 120;
    const sceneBackgroundMask = new Uint8Array(W * H).fill(0); // no stopping background

    const box = { x: 40, y: 40, width: 20, height: 20, pixels: 300 };
    const expanded = multiCardDetectionPhaseUtils.expandCandidateToFullCard(box, sceneBackgroundMask, W, H);

    // MAX_EXPAND_FRACTION = 0.30 => 6 px per side for width/height=20
    expect(expanded.x).toBe(34);
    expect(expanded.y).toBe(34);
    expect(expanded.width).toBe(32);
    expect(expanded.height).toBe(32);
  });

  it('stops expansion at scene background boundary', () => {
    const W = 120;
    const H = 100;
    const sceneBackgroundMask = new Uint8Array(W * H).fill(1);

    // Non-background island where card can grow: x:[38,61], y:[38,61]
    for (let y = 38; y <= 61; y += 1) {
      for (let x = 38; x <= 61; x += 1) {
        sceneBackgroundMask[y * W + x] = 0;
      }
    }

    const box = { x: 40, y: 40, width: 20, height: 20, pixels: 300 };
    const expanded = multiCardDetectionPhaseUtils.expandCandidateToFullCard(box, sceneBackgroundMask, W, H);

    // It should grow until just before entering background-dominant rows/cols.
    expect(expanded.x).toBe(38);
    expect(expanded.y).toBe(38);
    expect(expanded.width).toBe(24);
    expect(expanded.height).toBe(24);
  });

  it('only attempts expansion for small edge-supported candidates', () => {
    const shouldExpand = multiCardDetectionPhaseUtils.shouldAttemptExpansion(
      { x: 10, y: 10, width: 50, height: 30, pixels: 1000 },
      {
        areaPercent: 0.02,
        aspectRatio: 1.66,
        normalizedRatio: 1.66,
        rectangularity: 0.8,
        borderEdgeDensity: 0.05,
        interiorDensity: 0.2,
        contrastAgainstBackground: 0.1,
        localBackgroundContrast: 0.1,
        outsideEdgeDensity: 0.01,
      },
      800,
      600,
    );

    const shouldNotExpand = multiCardDetectionPhaseUtils.shouldAttemptExpansion(
      { x: 10, y: 10, width: 320, height: 180, pixels: 18000 },
      {
        areaPercent: 0.25,
        aspectRatio: 1.77,
        normalizedRatio: 1.77,
        rectangularity: 0.85,
        borderEdgeDensity: 0.02,
        interiorDensity: 0.2,
        contrastAgainstBackground: 0.1,
        localBackgroundContrast: 0.1,
        outsideEdgeDensity: 0.01,
      },
      800,
      600,
    );

    expect(shouldExpand).toBe(true);
    expect(shouldNotExpand).toBe(false);
  });
});
