import { describe, expect, it } from 'vitest';
import { multiCardDetectionTestUtils } from '@/lib/multiCardDetection';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal ImageData-like object for testing background estimation.
 * Each pixel is filled with the supplied [r, g, b] colour or a per-pixel
 * callback that receives (x, y) and returns [r, g, b].
 */
function makeImageData(
  width: number,
  height: number,
  fill: [number, number, number] | ((x: number, y: number) => [number, number, number]),
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const [r, g, b] = typeof fill === 'function' ? fill(x, y) : fill;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as unknown as ImageData;
}

/**
 * Build a Uint8Array background mask for testing. Pass 1 for background pixels,
 * 0 for foreground pixels via the callback.
 */
function makeMask(
  width: number,
  height: number,
  fill: ((x: number, y: number) => 0 | 1),
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      mask[y * width + x] = fill(x, y);
    }
  }
  return mask;
}

// ─── Existing tests ─────────────────────────────────────────────────────────

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

// ─── Background estimation ───────────────────────────────────────────────────

describe('estimateBackground', () => {
  it('estimates the dominant border colour from a solid-colour image', () => {
    // 100×60 image where all border pixels are grey (128,128,128)
    const imageData = makeImageData(100, 60, [128, 128, 128]);
    const model = multiCardDetectionTestUtils.estimateBackground(imageData, 100, 60);
    expect(model.r).toBeCloseTo(128, 0);
    expect(model.g).toBeCloseTo(128, 0);
    expect(model.b).toBeCloseTo(128, 0);
    expect(model.radius).toBeGreaterThan(0);
  });

  it('estimates background near the border even when the centre is a card', () => {
    // Border = light grey (200,200,200), centre = dark card (40,40,40)
    const W = 120;
    const H = 80;
    const imageData = makeImageData(W, H, (x, y) => {
      const isBorder = x < 8 || x >= W - 8 || y < 8 || y >= H - 8;
      return isBorder ? [200, 200, 200] : [40, 40, 40];
    });
    const model = multiCardDetectionTestUtils.estimateBackground(imageData, W, H);
    // Background mean should be closer to 200 than to 40
    expect(model.r).toBeGreaterThan(150);
  });
});

// ─── Background mask ─────────────────────────────────────────────────────────

describe('buildBackgroundMask', () => {
  it('marks pixels close to the background colour as background', () => {
    const W = 10;
    const H = 10;
    const imageData = makeImageData(W, H, [200, 200, 200]);
    const model = { r: 200, g: 200, b: 200, radius: 30 };
    const mask = multiCardDetectionTestUtils.buildBackgroundMask(imageData, W, H, model);
    // All pixels should be background
    expect(Array.from(mask).every((v) => v === 1)).toBe(true);
  });

  it('marks pixels far from the background colour as foreground', () => {
    const W = 4;
    const H = 4;
    // Background model is grey; all pixels are bright red — far from grey
    const imageData = makeImageData(W, H, [255, 0, 0]);
    const model = { r: 200, g: 200, b: 200, radius: 30 };
    const mask = multiCardDetectionTestUtils.buildBackgroundMask(imageData, W, H, model);
    expect(Array.from(mask).every((v) => v === 0)).toBe(true);
  });
});

// ─── Background split bands ──────────────────────────────────────────────────

describe('findBackgroundSplitBands', () => {
  it('finds a clear gap in a two-card side-by-side projection', () => {
    // 300 columns, height 100. Columns 140–159 are all background.
    const projection = new Uint16Array(300).fill(0);
    for (let x = 140; x < 160; x += 1) projection[x] = 100; // background band

    const cuts = multiCardDetectionTestUtils.findBackgroundSplitBands(projection, 100, 0.52, 6);
    expect(cuts.length).toBe(1);
    expect(cuts[0]).toBeGreaterThanOrEqual(140);
    expect(cuts[0]).toBeLessThanOrEqual(160);
  });

  it('finds two gaps in a three-card horizontal row', () => {
    // 450 columns. Gaps at 140–154 and 295–309.
    const projection = new Uint16Array(450).fill(0);
    for (let x = 140; x < 155; x += 1) projection[x] = 100;
    for (let x = 295; x < 310; x += 1) projection[x] = 100;

    const cuts = multiCardDetectionTestUtils.findBackgroundSplitBands(projection, 100, 0.52, 6);
    expect(cuts.length).toBe(2);
  });

  it('returns no cuts when there are no background bands', () => {
    const projection = new Uint16Array(200).fill(0); // all foreground
    const cuts = multiCardDetectionTestUtils.findBackgroundSplitBands(projection, 100, 0.52, 6);
    expect(cuts.length).toBe(0);
  });
});

// ─── hasBackgroundGapBetween ─────────────────────────────────────────────────

describe('hasBackgroundGapBetween', () => {
  const W = 200;
  const H = 100;

  it('returns true when horizontal gap between boxes is background', () => {
    // Card A: columns 0–79.  Card B: columns 120–199.  Gap: 80–119 (all bg).
    const a = { x: 0, y: 10, width: 80, height: 80, pixels: 5000 };
    const b = { x: 120, y: 10, width: 80, height: 80, pixels: 5000 };
    const bgMask = makeMask(W, H, (x, y) => {
      const inGap = x >= 80 && x < 120 && y >= 10 && y < 90;
      return inGap ? 1 : 0;
    });
    expect(multiCardDetectionTestUtils.hasBackgroundGapBetween(a, b, bgMask, W)).toBe(true);
  });

  it('returns true when vertical gap between stacked boxes is background', () => {
    // Card A: rows 0–49.  Card B: rows 70–99.  Gap: rows 50–69 (all bg).
    const a = { x: 20, y: 0, width: 160, height: 50, pixels: 5000 };
    const b = { x: 20, y: 70, width: 160, height: 30, pixels: 3000 };
    const bgMask = makeMask(W, H, (x, y) => {
      const inGap = y >= 50 && y < 70 && x >= 20 && x < 180;
      return inGap ? 1 : 0;
    });
    expect(multiCardDetectionTestUtils.hasBackgroundGapBetween(a, b, bgMask, W)).toBe(true);
  });

  it('returns false when the gap is mostly card (foreground)', () => {
    const a = { x: 0, y: 0, width: 80, height: 80, pixels: 5000 };
    const b = { x: 100, y: 0, width: 80, height: 80, pixels: 5000 };
    // Gap pixels are all foreground (0)
    const bgMask = makeMask(W, H, () => 0);
    expect(multiCardDetectionTestUtils.hasBackgroundGapBetween(a, b, bgMask, W)).toBe(false);
  });
});

// ─── Background-aware merge guard ────────────────────────────────────────────

describe('mergeNearbyBoxes with background mask', () => {
  const W = 400;
  const H = 200;

  it('does NOT merge boxes when the gap is background-dominant', () => {
    // Two cards separated by a 30 px background column at x=160–189.
    // Without the mask they would ordinarily be merged (gap < maxGap).
    const a = { x: 20, y: 20, width: 140, height: 160, pixels: 10000 };
    const b = { x: 190, y: 20, width: 140, height: 160, pixels: 10000 };
    const bgMask = makeMask(W, H, (x, y) => {
      return x >= 160 && x < 190 && y >= 20 && y < 180 ? 1 : 0;
    });
    const merged = multiCardDetectionTestUtils.mergeNearbyBoxes([a, b], bgMask, W);
    expect(merged).toHaveLength(2);
  });

  it('still merges overlapping fragments that belong to one card (no gap mask)', () => {
    const a = { x: 50, y: 50, width: 200, height: 120, pixels: 12000 };
    const b = { x: 55, y: 54, width: 190, height: 112, pixels: 11000 };
    const merged = multiCardDetectionTestUtils.mergeNearbyBoxes([a, b]);
    expect(merged).toHaveLength(1);
  });
});

// ─── Background-aware split (splitBoxByBackgroundGaps) ───────────────────────

describe('splitBoxByBackgroundGaps', () => {
  const W = 600;
  const H = 300;

  /**
   * Build a foreground mask that is all-foreground inside card regions and
   * all-background in the gap band.
   */
  function makePairMasks(
    gapX1: number,
    gapX2: number,
  ): { bgMask: Uint8Array; fgMask: Uint8Array } {
    const bgMask = makeMask(W, H, (x) => (x >= gapX1 && x < gapX2 ? 1 : 0));
    const fgMask = makeMask(W, H, (x) => (x >= gapX1 && x < gapX2 ? 0 : 1));
    return { bgMask, fgMask };
  }

  it('splits a wide merged box into two children when a background column gap exists', () => {
    // Combined box for two side-by-side 200×120 cards with a 30-px gap at x=200–229.
    const mergedBox = { x: 0, y: 10, width: 430, height: 120, pixels: 40000 };
    const { bgMask, fgMask } = makePairMasks(200, 230);

    const children = multiCardDetectionTestUtils.splitBoxByBackgroundGaps(
      mergedBox, bgMask, fgMask, W, H,
    );
    expect(children.length).toBe(2);
    expect(children[0].width).toBeGreaterThan(100);
    expect(children[1].width).toBeGreaterThan(100);
  });

  it('splits a tall merged box into two children when a background row gap exists', () => {
    // Two 300×100 cards stacked with a 20-px background gap at rows 100–119.
    const mergedBox = { x: 50, y: 0, width: 300, height: 220, pixels: 40000 };
    const bgMask = makeMask(W, H, (_x, y) => (y >= 100 && y < 120 ? 1 : 0));
    const fgMask = makeMask(W, H, (_x, y) => (y >= 100 && y < 120 ? 0 : 1));

    const children = multiCardDetectionTestUtils.splitBoxByBackgroundGaps(
      mergedBox, bgMask, fgMask, W, H,
    );
    expect(children.length).toBe(2);
    expect(children[0].height).toBeGreaterThan(50);
    expect(children[1].height).toBeGreaterThan(50);
  });

  it('returns the original box when no background gap is present', () => {
    const box = { x: 0, y: 0, width: 300, height: 150, pixels: 25000 };
    // No background pixels at all
    const bgMask = new Uint8Array(W * H).fill(0);
    const fgMask = new Uint8Array(W * H).fill(1);

    const children = multiCardDetectionTestUtils.splitBoxByBackgroundGaps(
      box, bgMask, fgMask, W, H,
    );
    expect(children.length).toBe(1);
  });

  it('does not split a single normal card with uniform background around it', () => {
    // A 200×110 card box. Background is outside the card entirely.
    const box = { x: 50, y: 50, width: 200, height: 110, pixels: 15000 };
    // Background only around the card, not inside
    const bgMask = makeMask(W, H, (x, y) => {
      return (x < 50 || x >= 250 || y < 50 || y >= 160) ? 1 : 0;
    });
    const fgMask = makeMask(W, H, (x, y) => {
      return (x >= 50 && x < 250 && y >= 50 && y < 160) ? 1 : 0;
    });

    const children = multiCardDetectionTestUtils.splitBoxByBackgroundGaps(
      box, bgMask, fgMask, W, H,
    );
    expect(children.length).toBe(1);
  });
});
