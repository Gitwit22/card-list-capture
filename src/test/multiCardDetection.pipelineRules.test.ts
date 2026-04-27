import { describe, expect, it } from 'vitest';
import { multiCardDetectionTestUtils } from '@/lib/multiCardDetection';

describe('multiCardDetection pipeline rules', () => {
  it('suppresses small boxes mostly inside larger boxes', () => {
    const larger = { x: 40, y: 60, width: 320, height: 190, pixels: 46000 };
    const partial = { x: 90, y: 95, width: 180, height: 100, pixels: 16000 };

    const inside = multiCardDetectionTestUtils.insideRatio(partial, larger);
    expect(inside).toBeGreaterThan(0.7);
  });

  it('suppresses heavier overlap when one box is smaller', () => {
    const larger = { x: 100, y: 100, width: 320, height: 180, pixels: 42000 };
    const smaller = { x: 125, y: 118, width: 250, height: 145, pixels: 26000 };

    const overlap = multiCardDetectionTestUtils.overlapOverSmaller(smaller, larger);
    expect(overlap).toBeGreaterThan(0.7);
  });

  it('splits a wide row candidate into multiple card boxes', () => {
    const wide = { x: 0, y: 0, width: 360, height: 120, pixels: 24000 };
    const projection = new Uint16Array(360).fill(60);

    for (let x = 115; x < 145; x += 1) projection[x] = 0;
    for (let x = 245; x < 275; x += 1) projection[x] = 0;

    const split = multiCardDetectionTestUtils.splitWideBoxFromProjection(wide, projection);
    expect(split.length).toBe(3);
    expect(split[0].width).toBeGreaterThan(60);
    expect(split[1].width).toBeGreaterThan(60);
    expect(split[2].width).toBeGreaterThan(60);
  });

  it('does not split a normal card box', () => {
    const cardLike = { x: 0, y: 0, width: 180, height: 110, pixels: 12000 };
    const projection = new Uint16Array(180).fill(45);

    const split = multiCardDetectionTestUtils.splitWideBoxFromProjection(cardLike, projection);
    expect(split).toHaveLength(1);
  });

  it('keeps side-by-side cards separate when just sharing a row', () => {
    const a = { x: 30, y: 55, width: 310, height: 182, pixels: 38000 };
    const b = { x: 380, y: 58, width: 305, height: 180, pixels: 37200 };

    const merged = multiCardDetectionTestUtils.mergeNearbyBoxes([a, b]);
    expect(merged).toHaveLength(2);
  });
});
