export interface DetectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedCardCrop {
  id: string;
  cropIndex: number;
  file: File;
  previewUrl: string;
  bounds: DetectionBounds;
  confidence: number;
  warnings: string[];
  aspectRatio: number;
  areaPercent: number;
  sourceImageId?: string;
  sourceImageName?: string;
  sourceImageUrl?: string;
  manualCrop?: boolean;
}

export interface DetectionCandidateDebug {
  index: number;
  status: 'accepted' | 'rejected';
  reason: string;
  bounds: DetectionBounds;
  aspectRatio: number;
  areaPercent: number;
  confidence: number;
  score?: number;
  generatedBy?: CandidateOrigin;
  rectangularity?: number;
  edgeScore?: number;
  rescueEligible?: boolean;
  rescuedBy?: string;
}

export interface DetectionDebugInfo {
  sourceImageName: string;
  imageWidth: number;
  imageHeight: number;
  preFilterCandidateCount?: number;
  acceptedCandidateCount?: number;
  contourCandidateCount?: number;
  expandedCandidateCount?: number;
  fallbackClusterCount?: number;
  detectedCardCount: number;
  candidateCount: number;
  rejectedCandidateCount: number;
  sceneBackgroundCoverage?: number;
  textureMapStats?: {
    mean: number;
    p90: number;
    max: number;
  };
  rejectionReasons: Record<string, number>;
  candidates: DetectionCandidateDebug[];
  overlayUrl?: string;
  sceneBackgroundModel?: {
    clusterCount: number;
    dominantClusters: Array<{ h: number; s: number; v: number; weight: number; texture: number }>;
  };
}

export interface MultiCardDetectionResult {
  crops: DetectedCardCrop[];
  warnings: string[];
  debug: DetectionDebugInfo;
}

export interface MultiCardDetectionOptions {
  maxCards?: number;
  hardMaxCards?: number;
  enableDebugOverlay?: boolean;
  debug?: boolean;
  minAreaPercent?: number;
}

type CandidateOrigin = 'component' | 'merge' | 'split' | 'manual' | 'contour' | 'expanded' | 'cluster-fallback' | 'grid_gap_rescue';

interface ComponentBox {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: number;
}

interface CandidateAssessment {
  accepted: boolean;
  reason: string;
  confidence: number;
  aspectRatio: number;
  areaPercent: number;
  score: number;
}

interface CandidateMetrics {
  areaPercent: number;
  aspectRatio: number;
  normalizedRatio: number;
  rectangularity: number;
  borderEdgeDensity: number;
  interiorDensity: number;
  contrastAgainstBackground: number;
  localBackgroundContrast: number;
  outsideEdgeDensity: number;
}

interface DetectionCandidate {
  index: number;
  box: ComponentBox;
  bounds: DetectionBounds;
  generatedBy: CandidateOrigin;
  assessment: CandidateAssessment;
  metrics: CandidateMetrics;
}

interface HSVColor {
  h: number;
  s: number;
  v: number;
}

interface SceneBackgroundCluster extends HSVColor {
  weight: number;
  texture: number;
}

interface SceneBackgroundModel {
  clusters: SceneBackgroundCluster[];
  colorRadius: number;
  textureRadius: number;
}

const MAX_EDGE_DIMENSION = 1400;
const DEFAULT_MIN_AREA_PERCENT = 0.05;
const MIN_CARD_RATIO = 1.2;
const MAX_CARD_RATIO = 2.45;
const EXTREME_CARD_RATIO = 3.2;
const INSIDE_SUPPRESSION_THRESHOLD = 0.7;
const OVERLAP_SUPPRESSION_THRESHOLD = 0.7;
const MERGE_IOU_THRESHOLD = 0.42;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to load image for multi-card detection.'));
    };
    image.src = url;
  });
}

function toGrayArray(imageData: ImageData): Uint8Array {
  const gray = new Uint8Array(imageData.width * imageData.height);
  const data = imageData.data;

  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
    const value = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    gray[j] = value;
  }

  return gray;
}

function normalizeContrast(gray: Uint8Array): Uint8Array {
  let min = 255;
  let max = 0;
  for (let i = 0; i < gray.length; i += 1) {
    const value = gray[i];
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (max <= min) return gray;

  const scale = 255 / (max - min);
  const normalized = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    normalized[i] = clamp(Math.round((gray[i] - min) * scale), 0, 255);
  }

  return normalized;
}

function boxBlur(gray: Uint8Array, width: number, height: number, radius = 1, passes = 1): Uint8Array {
  let current = gray;
  const size = radius * 2 + 1;

  for (let pass = 0; pass < passes; pass += 1) {
    const horizontal = new Uint16Array(current.length);
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      const rowOffset = y * width;
      for (let x = -radius; x <= radius; x += 1) {
        const sampleX = clamp(x, 0, width - 1);
        sum += current[rowOffset + sampleX];
      }
      for (let x = 0; x < width; x += 1) {
        horizontal[rowOffset + x] = Math.round(sum / size);
        const removeX = clamp(x - radius, 0, width - 1);
        const addX = clamp(x + radius + 1, 0, width - 1);
        sum += current[rowOffset + addX] - current[rowOffset + removeX];
      }
    }

    const output = new Uint8Array(current.length);
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let y = -radius; y <= radius; y += 1) {
        const sampleY = clamp(y, 0, height - 1);
        sum += horizontal[sampleY * width + x];
      }
      for (let y = 0; y < height; y += 1) {
        output[y * width + x] = clamp(Math.round(sum / size), 0, 255);
        const removeY = clamp(y - radius, 0, height - 1);
        const addY = clamp(y + radius + 1, 0, height - 1);
        sum += horizontal[addY * width + x] - horizontal[removeY * width + x];
      }
    }

    current = output;
  }

  return current;
}

function adaptiveForegroundMask(gray: Uint8Array, width: number, height: number): Uint8Array {
  const localAverage = boxBlur(gray, width, height, 8, 1);
  const smoothed = boxBlur(gray, width, height, 1, 1);

  let sumDelta = 0;
  for (let i = 0; i < gray.length; i += 1) {
    sumDelta += Math.abs(smoothed[i] - localAverage[i]);
  }

  const meanDelta = sumDelta / Math.max(1, gray.length);
  const deltaThreshold = clamp(Math.round(meanDelta * 1.45), 10, 42);
  const mask = new Uint8Array(gray.length);

  for (let i = 0; i < gray.length; i += 1) {
    const delta = Math.abs(smoothed[i] - localAverage[i]);
    mask[i] = delta >= deltaThreshold ? 1 : 0;
  }

  return closeBinary(mask, width, height);
}

function edgeMap(gray: Uint8Array, width: number, height: number): Uint8Array {
  const magnitude = new Uint16Array(gray.length);
  let sum = 0;
  let sumSq = 0;

  for (let y = 1; y < height - 1; y += 1) {
    const rowOffset = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const idx = rowOffset + x;
      const gx =
        -gray[idx - width - 1] - 2 * gray[idx - 1] - gray[idx + width - 1]
        + gray[idx - width + 1] + 2 * gray[idx + 1] + gray[idx + width + 1];
      const gy =
        -gray[idx - width - 1] - 2 * gray[idx - width] - gray[idx - width + 1]
        + gray[idx + width - 1] + 2 * gray[idx + width] + gray[idx + width + 1];
      const value = Math.abs(gx) + Math.abs(gy);
      magnitude[idx] = value;
      sum += value;
      sumSq += value * value;
    }
  }

  const count = Math.max(1, (width - 2) * (height - 2));
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  const stdev = Math.sqrt(variance);
  const threshold = clamp(Math.round(mean + stdev * 1.1), 16, 255);

  const edges = new Uint8Array(gray.length);
  for (let i = 0; i < magnitude.length; i += 1) {
    edges[i] = magnitude[i] >= threshold ? 1 : 0;
  }

  return edges;
}

function dilate(binary: Uint8Array, width: number, height: number, passes = 1): Uint8Array {
  let current = binary;

  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Uint8Array(current.length);
    for (let y = 1; y < height - 1; y += 1) {
      const rowOffset = y * width;
      for (let x = 1; x < width - 1; x += 1) {
        const idx = rowOffset + x;
        if (
          current[idx]
          || current[idx - 1]
          || current[idx + 1]
          || current[idx - width]
          || current[idx + width]
          || current[idx - width - 1]
          || current[idx - width + 1]
          || current[idx + width - 1]
          || current[idx + width + 1]
        ) {
          next[idx] = 1;
        }
      }
    }
    current = next;
  }

  return current;
}

function erode(binary: Uint8Array, width: number, height: number, passes = 1): Uint8Array {
  let current = binary;

  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Uint8Array(current.length);
    for (let y = 1; y < height - 1; y += 1) {
      const rowOffset = y * width;
      for (let x = 1; x < width - 1; x += 1) {
        const idx = rowOffset + x;
        if (
          current[idx]
          && current[idx - 1]
          && current[idx + 1]
          && current[idx - width]
          && current[idx + width]
        ) {
          next[idx] = 1;
        }
      }
    }
    current = next;
  }

  return current;
}

function closeBinary(binary: Uint8Array, width: number, height: number): Uint8Array {
  return erode(dilate(binary, width, height, 2), width, height, 1);
}

function openBinary(binary: Uint8Array, width: number, height: number): Uint8Array {
  return dilate(erode(binary, width, height, 1), width, height, 1);
}

function collectConnectedComponents(binary: Uint8Array, width: number, height: number): ComponentBox[] {
  const visited = new Uint8Array(binary.length);
  const queue = new Int32Array(binary.length);
  const components: ComponentBox[] = [];

  for (let i = 0; i < binary.length; i += 1) {
    if (binary[i] === 0 || visited[i]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    visited[i] = 1;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let pixels = 0;

    while (head < tail) {
      const index = queue[head++];
      const y = Math.floor(index / width);
      const x = index - y * width;

      pixels += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const neighbors = [
        index - 1,
        index + 1,
        index - width,
        index + width,
        index - width - 1,
        index - width + 1,
        index + width - 1,
        index + width + 1,
      ];

      for (const next of neighbors) {
        if (next < 0 || next >= binary.length) continue;
        if (visited[next] || binary[next] === 0) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }

    components.push({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      pixels,
    });
  }

  return components;
}

function getIoU(a: ComponentBox, b: ComponentBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (intersection === 0) return 0;

  const aArea = a.width * a.height;
  const bArea = b.width * b.height;
  return intersection / (aArea + bArea - intersection);
}

function mergeBoxes(a: ComponentBox, b: ComponentBox): ComponentBox {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    pixels: a.pixels + b.pixels,
  };
}

function getEdgeDistance(a: ComponentBox, b: ComponentBox): number {
  const xDistance = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const yDistance = Math.max(0, Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)));
  return Math.sqrt(xDistance * xDistance + yDistance * yDistance);
}

function getAxisGapAndOverlap(
  aStart: number,
  aSize: number,
  bStart: number,
  bSize: number,
): { gap: number; overlap: number } {
  const aEnd = aStart + aSize;
  const bEnd = bStart + bSize;
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  const gap = overlap > 0 ? 0 : Math.max(0, Math.max(aStart - bEnd, bStart - aEnd));
  return { gap, overlap };
}

function hasBackgroundGapBetween(
  a: ComponentBox,
  b: ComponentBox,
  backgroundMask: Uint8Array,
  width: number,
): boolean {
  const aRight = a.x + a.width;
  const bRight = b.x + b.width;
  const aBottom = a.y + a.height;
  const bBottom = b.y + b.height;

  // Horizontal gap (side by side)
  const xGapL = Math.min(aRight, bRight);
  const xGapR = Math.max(a.x, b.x);
  const yOverlapT = Math.max(a.y, b.y);
  const yOverlapB = Math.min(aBottom, bBottom);

  // Vertical gap (stacked)
  const yGapT = Math.min(aBottom, bBottom);
  const yGapB = Math.max(a.y, b.y);
  const xOverlapL = Math.max(a.x, b.x);
  const xOverlapR = Math.min(aRight, bRight);

  let gapX1: number;
  let gapX2: number;
  let gapY1: number;
  let gapY2: number;

  if (xGapL < xGapR && yOverlapT < yOverlapB) {
    gapX1 = xGapL;
    gapX2 = xGapR;
    gapY1 = yOverlapT;
    gapY2 = yOverlapB;
  } else if (yGapT < yGapB && xOverlapL < xOverlapR) {
    gapX1 = xOverlapL;
    gapX2 = xOverlapR;
    gapY1 = yGapT;
    gapY2 = yGapB;
  } else {
    return false;
  }

  let bgCount = 0;
  let totalCount = 0;
  for (let y = gapY1; y < gapY2; y += 1) {
    const rowOffset = y * width;
    for (let x = gapX1; x < gapX2; x += 1) {
      totalCount += 1;
      if (backgroundMask[rowOffset + x]) bgCount += 1;
    }
  }

  if (totalCount < 4) return false;
  return bgCount / totalCount >= 0.60;
}

function shouldMergeByProximity(
  a: ComponentBox,
  b: ComponentBox,
  backgroundMask?: Uint8Array,
  imageWidth?: number,
): boolean {
  // Background-aware guard: if the gap between the two boxes is dominated
  // by background pixels, they are definitely separate cards — never merge.
  if (backgroundMask && imageWidth !== undefined) {
    if (hasBackgroundGapBetween(a, b, backgroundMask, imageWidth)) {
      return false;
    }
  }

  const minSide = Math.min(a.width, a.height, b.width, b.height);
  const maxGap = Math.max(5, Math.round(minSide * 0.08));

  const horizontal = getAxisGapAndOverlap(a.x, a.width, b.x, b.width);
  const vertical = getAxisGapAndOverlap(a.y, a.height, b.y, b.height);

  if (horizontal.gap > maxGap || vertical.gap > maxGap) {
    return false;
  }

  // If both axes have gaps, boxes are diagonally separate and should not merge.
  if (horizontal.gap > 0 && vertical.gap > 0) {
    return false;
  }

  if (horizontal.gap > 0) {
    const overlapRatio = vertical.overlap / Math.max(1, Math.min(a.height, b.height));
    if (overlapRatio < 0.55) {
      return false;
    }
  }

  if (vertical.gap > 0) {
    const overlapRatio = horizontal.overlap / Math.max(1, Math.min(a.width, b.width));
    if (overlapRatio < 0.55) {
      return false;
    }
  }

  const merged = mergeBoxes(a, b);
  const mergedArea = merged.width * merged.height;
  const componentArea = a.width * a.height + b.width * b.height;
  const whitespaceRatio = (mergedArea - componentArea) / Math.max(1, mergedArea);
  if (whitespaceRatio > 0.22) {
    return false;
  }

  const horizontalGap = getAxisGapAndOverlap(a.x, a.width, b.x, b.width).gap;
  const verticalGap = getAxisGapAndOverlap(a.y, a.height, b.y, b.height).gap;
  if (horizontalGap > 0 && horizontalGap > Math.round(Math.min(a.height, b.height) * 0.16)) {
    return false;
  }
  if (verticalGap > 0 && verticalGap > Math.round(Math.min(a.width, b.width) * 0.14)) {
    return false;
  }

  const ratio = merged.width / Math.max(1, merged.height);
  const normalizedRatio = ratio >= 1 ? ratio : 1 / Math.max(0.0001, ratio);
  if (normalizedRatio > 3.2) {
    return false;
  }

  return true;
}

function mergeNearbyBoxes(
  boxes: ComponentBox[],
  backgroundMask?: Uint8Array,
  imageWidth?: number,
): ComponentBox[] {
  const working = [...boxes];
  let merged = true;

  while (merged) {
    merged = false;

    for (let i = 0; i < working.length; i += 1) {
      for (let j = i + 1; j < working.length; j += 1) {
        const a = working[i];
        const b = working[j];

        if (getIoU(a, b) > 0.12 || shouldMergeByProximity(a, b, backgroundMask, imageWidth)) {
          working[i] = mergeBoxes(a, b);
          working.splice(j, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }

  return working;
}

function overlapOverSmaller(a: ComponentBox, b: ComponentBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (intersection === 0) return 0;
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return intersection / Math.max(1, smallerArea);
}

function insideRatio(inner: ComponentBox, outer: ComponentBox): number {
  const x1 = Math.max(inner.x, outer.x);
  const y1 = Math.max(inner.y, outer.y);
  const x2 = Math.min(inner.x + inner.width, outer.x + outer.width);
  const y2 = Math.min(inner.y + inner.height, outer.y + outer.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return intersection / Math.max(1, inner.width * inner.height);
}

function computeBoxSignature(box: ComponentBox): string {
  return `${box.x}:${box.y}:${box.width}:${box.height}:${box.pixels}`;
}

function nonMaximumSuppression(boxes: ComponentBox[], iouThreshold = 0.4): ComponentBox[] {
  const sorted = [...boxes].sort((a, b) => (b.width * b.height) - (a.width * a.height));
  const kept: ComponentBox[] = [];

  while (sorted.length > 0) {
    const current = sorted.shift();
    if (!current) break;

    kept.push(current);

    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      if (getIoU(current, sorted[i]) > iouThreshold) {
        sorted.splice(i, 1);
      }
    }
  }

  return kept;
}

export const multiCardDetectionTestUtils = {
  mergeNearbyBoxes,
  shouldMergeByProximity,
  overlapOverSmaller,
  insideRatio,
  splitWideBoxFromProjection,
  estimateSceneBackground,
  buildSceneBackgroundMask,
  estimateBackground: estimateSceneBackground,
  buildBackgroundMask: buildSceneBackgroundMask,
  computeTextureMap,
  splitBoxByBackgroundGaps,
  findBackgroundSplitBands,
  hasBackgroundGapBetween,
};
export const multiCardDetectionPhaseUtils = {
  detectRectangularContours,
  expandCandidateToFullCard,
  shouldAttemptExpansion,
  clusterRejectedComponents,
};

// ─── Background-aware segmentation helpers ──────────────────────────────────

function rgbToHsv(r: number, g: number, b: number): HSVColor {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h = (h * 60 + 360) % 360;
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

function hsvDistance(a: HSVColor, b: HSVColor): number {
  const hueDelta = Math.abs(a.h - b.h);
  const hue = Math.min(hueDelta, 360 - hueDelta) / 180;
  const sat = Math.abs(a.s - b.s);
  const val = Math.abs(a.v - b.v);
  return Math.sqrt(hue * hue * 0.45 + sat * sat * 0.3 + val * val * 0.25);
}

function computeTextureMap(gray: Uint8Array, width: number, height: number): Uint8Array {
  const texture = new Uint8Array(gray.length);
  for (let y = 1; y < height - 1; y += 1) {
    const rowOffset = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const idx = rowOffset + x;
      const center = gray[idx];
      const meanNeighbors = (
        gray[idx - 1]
        + gray[idx + 1]
        + gray[idx - width]
        + gray[idx + width]
        + gray[idx - width - 1]
        + gray[idx - width + 1]
        + gray[idx + width - 1]
        + gray[idx + width + 1]
      ) / 8;
      texture[idx] = clamp(Math.round(Math.abs(center - meanNeighbors) * 2.2), 0, 255);
    }
  }
  return texture;
}

function estimateSceneBackground(
  imageData: ImageData,
  textureMap: Uint8Array,
  edgeMask: Uint8Array,
  width: number,
  height: number,
): SceneBackgroundModel {
  const data = imageData.data;
  const borderDepth = Math.max(8, Math.round(Math.min(width, height) * 0.05));
  const binStats = new Map<string, { count: number; sumH: number; sumS: number; sumV: number; sumTexture: number }>();

  function addSample(x: number, y: number): void {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = y * width + x;
    const px = idx * 4;
    const hsv = rgbToHsv(data[px], data[px + 1], data[px + 2]);
    const texture = textureMap[idx];
    const edge = edgeMask[idx];

    // Prefer low-detail open-area pixels while still allowing mild texture.
    const weight = clamp(1 - texture / 210 - edge * 0.25, 0.1, 1);
    const hBin = Math.round(hsv.h / 20);
    const sBin = Math.round(hsv.s * 8);
    const vBin = Math.round(hsv.v * 8);
    const key = `${hBin}:${sBin}:${vBin}`;
    const bucket = binStats.get(key) ?? { count: 0, sumH: 0, sumS: 0, sumV: 0, sumTexture: 0 };

    bucket.count += weight;
    bucket.sumH += hsv.h * weight;
    bucket.sumS += hsv.s * weight;
    bucket.sumV += hsv.v * weight;
    bucket.sumTexture += texture * weight;
    binStats.set(key, bucket);
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < borderDepth || x >= width - borderDepth || y < borderDepth || y >= height - borderDepth) {
        addSample(x, y);
      }
    }
  }

  // Also sample interior open regions on a coarse grid so border-touching cards
  // do not dominate the model.
  const stride = Math.max(3, Math.round(Math.min(width, height) * 0.015));
  for (let y = borderDepth; y < height - borderDepth; y += stride) {
    for (let x = borderDepth; x < width - borderDepth; x += stride) {
      const idx = y * width + x;
      if (textureMap[idx] > 52 || edgeMask[idx]) continue;
      addSample(x, y);
    }
  }

  const entries = [...binStats.values()].sort((a, b) => b.count - a.count);
  const totalWeight = entries.reduce((sum, entry) => sum + entry.count, 0);
  const clusters: SceneBackgroundCluster[] = entries
    .slice(0, 4)
    .map((entry) => ({
      h: entry.sumH / Math.max(0.0001, entry.count),
      s: entry.sumS / Math.max(0.0001, entry.count),
      v: entry.sumV / Math.max(0.0001, entry.count),
      texture: entry.sumTexture / Math.max(0.0001, entry.count),
      weight: entry.count / Math.max(0.0001, totalWeight),
    }));

  if (clusters.length === 0) {
    clusters.push({ h: 0, s: 0, v: 0.78, texture: 10, weight: 1 });
  }

  const avgTexture = clusters.reduce((sum, cluster) => sum + cluster.texture * cluster.weight, 0);
  return {
    clusters,
    colorRadius: clamp(0.18 + avgTexture / 520, 0.14, 0.34),
    textureRadius: clamp(Math.round(avgTexture * 1.8 + 22), 18, 86),
  };
}

function buildSceneBackgroundMask(
  imageData: ImageData,
  textureMap: Uint8Array,
  edgeMask: Uint8Array,
  width: number,
  height: number,
  model: SceneBackgroundModel,
): Uint8Array {
  const data = imageData.data;
  const candidate = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const idx = rowOffset + x;
      const px = idx * 4;
      const hsv = rgbToHsv(data[px], data[px + 1], data[px + 2]);
      const texture = textureMap[idx];

      let minColorDistance = Number.POSITIVE_INFINITY;
      let nearest: SceneBackgroundCluster | null = null;

      for (const cluster of model.clusters) {
        const dist = hsvDistance(hsv, cluster);
        if (dist < minColorDistance) {
          minColorDistance = dist;
          nearest = cluster;
        }
      }

      const textureDelta = nearest ? Math.abs(texture - nearest.texture) : texture;
      const colorThreshold = model.colorRadius + clamp((nearest?.weight ?? 0.2) * 0.08, 0.01, 0.08);
      const textureThreshold = model.textureRadius;
      const isBackgroundLike = minColorDistance <= colorThreshold
        && textureDelta <= textureThreshold
        && edgeMask[idx] === 0;

      candidate[idx] = isBackgroundLike ? 1 : 0;
    }
  }

  // Keep only candidate regions that are connected to borders or are very large
  // open regions. This avoids classifying blank card interiors as scene background.
  const visited = new Uint8Array(candidate.length);
  const queue = new Int32Array(candidate.length);
  const mask = new Uint8Array(candidate.length);
  const minOpenRegion = Math.max(120, Math.round(width * height * 0.012));

  function flood(start: number): number[] {
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const region: number[] = [];

    while (head < tail) {
      const idx = queue[head++];
      region.push(idx);
      const y = Math.floor(idx / width);
      const x = idx - y * width;

      const neighbors = [
        idx - 1,
        idx + 1,
        idx - width,
        idx + width,
      ];

      for (const next of neighbors) {
        if (next < 0 || next >= candidate.length) continue;
        const ny = Math.floor(next / width);
        const nx = next - ny * width;
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        if (visited[next] || candidate[next] === 0) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }

    return region;
  }

  for (let i = 0; i < candidate.length; i += 1) {
    if (!candidate[i] || visited[i]) continue;
    const region = flood(i);
    let touchesBorder = false;

    for (const idx of region) {
      const y = Math.floor(idx / width);
      const x = idx - y * width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesBorder = true;
        break;
      }
    }

    if (touchesBorder || region.length >= minOpenRegion) {
      for (const idx of region) {
        mask[idx] = 1;
      }
    }
  }

  return closeBinary(mask, width, height);
}

function getColumnBackgroundProjection(
  backgroundMask: Uint8Array,
  width: number,
  box: ComponentBox,
): Uint16Array {
  const projection = new Uint16Array(box.width);
  const left = clamp(box.x, 0, width - 1);
  const right = clamp(box.x + box.width, 0, width);
  const bottom = box.y + box.height;

  for (let y = box.y; y < bottom; y += 1) {
    const rowOffset = y * width;
    for (let x = left; x < right; x += 1) {
      if (backgroundMask[rowOffset + x]) projection[x - left] += 1;
    }
  }
  return projection;
}

function getRowBackgroundProjection(
  backgroundMask: Uint8Array,
  width: number,
  box: ComponentBox,
): Uint16Array {
  const projection = new Uint16Array(box.height);
  const left = clamp(box.x, 0, width - 1);
  const right = clamp(box.x + box.width, 0, width);
  const bottom = box.y + box.height;

  for (let y = box.y; y < bottom; y += 1) {
    const rowOffset = y * width;
    let rowBg = 0;
    for (let x = left; x < right; x += 1) {
      if (backgroundMask[rowOffset + x]) rowBg += 1;
    }
    projection[y - box.y] = rowBg;
  }
  return projection;
}

function findBackgroundSplitBands(
  projection: Uint16Array,
  perpendicularSize: number,
  minBgFraction: number,
  minBandPx: number,
): number[] {
  const threshold = Math.round(perpendicularSize * minBgFraction);
  const smoothed = smoothProjection(projection);
  const cutPositions: number[] = [];
  let bandStart = -1;

  for (let i = 0; i < smoothed.length; i += 1) {
    const isBackground = smoothed[i] >= threshold;
    if (isBackground && bandStart < 0) {
      bandStart = i;
    }
    if (!isBackground && bandStart >= 0) {
      const bandLen = i - bandStart;
      if (bandLen >= minBandPx) {
        cutPositions.push(bandStart + Math.round(bandLen / 2));
      }
      bandStart = -1;
    }
  }
  if (bandStart >= 0) {
    const bandLen = smoothed.length - bandStart;
    if (bandLen >= minBandPx) {
      cutPositions.push(bandStart + Math.round(bandLen / 2));
    }
  }

  return cutPositions;
}

/**
 * Background-aware split. Analyses both vertical and horizontal background
 * projection profiles to find columns/rows that are dominated by background
 * pixels, indicating the gap between two separate cards. Handles:
 *   - Side-by-side cards (vertical column split)
 *   - Stacked cards     (horizontal row split)
 *   - Lower aspect-ratio boxes than the legacy foreground-projection split
 */
function splitBoxByBackgroundGaps(
  box: ComponentBox,
  backgroundMask: Uint8Array,
  foreground: Uint8Array,
  width: number,
  height: number,
): ComponentBox[] {
  const ratio = box.width / Math.max(1, box.height);

  // ── Vertical split: columns dominated by background (side-by-side cards) ──
  // Trigger when box is wider than ~1.5× its height, or covers >40% of image width.
  if (ratio >= 1.5 || box.width > width * 0.4) {
    const colProjection = getColumnBackgroundProjection(backgroundMask, width, box);
    const minBandPx = Math.max(6, Math.round(box.width * 0.025));
    const vertCuts = findBackgroundSplitBands(colProjection, box.height, 0.52, minBandPx);

    if (vertCuts.length > 0) {
      const boundaries = [0, ...vertCuts, box.width];
      const children: ComponentBox[] = [];

      for (let i = 0; i < boundaries.length - 1; i += 1) {
        const startOff = boundaries[i];
        const endOff = boundaries[i + 1];
        const childWidth = endOff - startOff;
        // Child must be wide enough to plausibly be a single card
        if (childWidth < Math.round(box.height * 0.55)) continue;

        // Refine vertical extent using foreground mask
        const childX = box.x + startOff;
        let minY = box.y + box.height;
        let maxY = box.y;
        let pixels = 0;
        for (let y = box.y; y < box.y + box.height; y += 1) {
          const rowOffset = y * width;
          for (let x = childX; x < childX + childWidth; x += 1) {
            if (foreground[clamp(rowOffset + x, 0, foreground.length - 1)]) {
              pixels += 1;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (pixels === 0 || minY > maxY) continue;

        children.push({
          x: childX,
          y: clamp(minY, box.y, box.y + box.height - 1),
          width: childWidth,
          height: Math.max(1, maxY - minY + 1),
          pixels,
        });
      }

      if (children.length >= 2) return children;
    }
  }

  // ── Horizontal split: rows dominated by background (stacked cards) ─────────
  // Trigger when box is taller than expected for a single card, or nearly
  // square/portrait, or covers >40% of image height.
  if (ratio <= 1.8 || box.height > height * 0.4) {
    const rowProjection = getRowBackgroundProjection(backgroundMask, width, box);
    const minBandPx = Math.max(6, Math.round(box.height * 0.025));
    const horizCuts = findBackgroundSplitBands(rowProjection, box.width, 0.52, minBandPx);

    if (horizCuts.length > 0) {
      const boundaries = [0, ...horizCuts, box.height];
      const children: ComponentBox[] = [];

      for (let i = 0; i < boundaries.length - 1; i += 1) {
        const startOff = boundaries[i];
        const endOff = boundaries[i + 1];
        const childHeight = endOff - startOff;
        // Child must be tall enough relative to box width to be a single card
        if (childHeight < Math.round(box.width * 0.35)) continue;

        // Refine horizontal extent using foreground mask
        const childY = box.y + startOff;
        let minX = box.x + box.width;
        let maxX = box.x;
        let pixels = 0;
        for (let y = childY; y < childY + childHeight; y += 1) {
          const rowOffset = y * width;
          for (let x = box.x; x < box.x + box.width; x += 1) {
            if (foreground[clamp(rowOffset + x, 0, foreground.length - 1)]) {
              pixels += 1;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
            }
          }
        }
        if (pixels === 0 || minX > maxX) continue;

        children.push({
          x: clamp(minX, box.x, box.x + box.width - 1),
          y: childY,
          width: Math.max(1, maxX - minX + 1),
          height: childHeight,
          pixels,
        });
      }

      if (children.length >= 2) return children;
    }
  }

  return [box];
}

function sortReadingOrder(boxes: ComponentBox[]): ComponentBox[] {
  if (boxes.length <= 1) return boxes;

  const medianHeight = [...boxes]
    .map((box) => box.height)
    .sort((a, b) => a - b)[Math.floor(boxes.length / 2)] || 1;
  const rowTolerance = Math.max(12, Math.round(medianHeight * 0.6));

  return [...boxes].sort((a, b) => {
    const rowA = Math.round(a.y / rowTolerance);
    const rowB = Math.round(b.y / rowTolerance);
    if (rowA !== rowB) return rowA - rowB;
    return a.x - b.x;
  });
}

function componentToBounds(box: ComponentBox, scale: number, sourceWidth: number, sourceHeight: number): DetectionBounds {
  const padding = Math.round(Math.min(box.width, box.height) * 0.04);
  const x = clamp(Math.round((box.x - padding) / scale), 0, sourceWidth - 1);
  const y = clamp(Math.round((box.y - padding) / scale), 0, sourceHeight - 1);
  const right = clamp(Math.round((box.x + box.width + padding) / scale), x + 1, sourceWidth);
  const bottom = clamp(Math.round((box.y + box.height + padding) / scale), y + 1, sourceHeight);

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

function getClosestCardRatioDistance(normalizedRatio: number): number {
  const targetRatios = [1.4, 1.58, 1.75, 1.95];
  return Math.min(...targetRatios.map((target) => Math.abs(normalizedRatio - target)));
}

function measureCandidateMetrics(
  box: ComponentBox,
  gray: Uint8Array,
  edges: Uint8Array,
  foreground: Uint8Array,
  imageWidth: number,
  imageHeight: number,
): CandidateMetrics {
  const area = box.width * box.height;
  const imageArea = imageWidth * imageHeight;
  const rawRatio = box.width / Math.max(1, box.height);
  const normalizedRatio = rawRatio >= 1 ? rawRatio : 1 / Math.max(0.0001, rawRatio);
  const rectangularity = box.pixels / Math.max(1, area);

  let borderEdges = 0;
  let borderPixels = 0;
  let interiorForeground = 0;
  let interiorPixels = 0;
  let insideSum = 0;

  const left = clamp(box.x, 0, imageWidth - 1);
  const top = clamp(box.y, 0, imageHeight - 1);
  const right = clamp(box.x + box.width - 1, left, imageWidth - 1);
  const bottom = clamp(box.y + box.height - 1, top, imageHeight - 1);
  const borderThickness = Math.max(2, Math.round(Math.min(box.width, box.height) * 0.05));

  for (let y = top; y <= bottom; y += 1) {
    const rowOffset = y * imageWidth;
    for (let x = left; x <= right; x += 1) {
      const index = rowOffset + x;
      const isBorder = (
        x - left < borderThickness
        || right - x < borderThickness
        || y - top < borderThickness
        || bottom - y < borderThickness
      );

      if (isBorder) {
        borderPixels += 1;
        borderEdges += edges[index];
      } else {
        interiorPixels += 1;
        interiorForeground += foreground[index];
      }

      insideSum += gray[index];
    }
  }

  const outsideMargin = Math.max(5, Math.round(Math.min(box.width, box.height) * 0.08));
  const outerLeft = clamp(left - outsideMargin, 0, imageWidth - 1);
  const outerTop = clamp(top - outsideMargin, 0, imageHeight - 1);
  const outerRight = clamp(right + outsideMargin, 0, imageWidth - 1);
  const outerBottom = clamp(bottom + outsideMargin, 0, imageHeight - 1);

  let outsideSum = 0;
  let outsideCount = 0;
  let outsideEdgeCount = 0;

  for (let y = outerTop; y <= outerBottom; y += 1) {
    const rowOffset = y * imageWidth;
    for (let x = outerLeft; x <= outerRight; x += 1) {
      const inside = x >= left && x <= right && y >= top && y <= bottom;
      if (inside) continue;

      const index = rowOffset + x;
      outsideSum += gray[index];
      outsideEdgeCount += edges[index];
      outsideCount += 1;
    }
  }

  const insideMean = insideSum / Math.max(1, area);
  const outsideMean = outsideSum / Math.max(1, outsideCount);
  const localBackgroundContrast = Math.abs(insideMean - outsideMean) / 255;

  return {
    areaPercent: area / Math.max(1, imageArea),
    aspectRatio: rawRatio,
    normalizedRatio,
    rectangularity,
    borderEdgeDensity: borderEdges / Math.max(1, borderPixels),
    interiorDensity: interiorForeground / Math.max(1, interiorPixels),
    contrastAgainstBackground: localBackgroundContrast,
    localBackgroundContrast,
    outsideEdgeDensity: outsideEdgeCount / Math.max(1, outsideCount),
  };
}

function assessCandidate(
  box: ComponentBox,
  metrics: CandidateMetrics,
  imageWidth: number,
  imageHeight: number,
  minAreaPercent: number,
): CandidateAssessment {
  const imageArea = imageWidth * imageHeight;
  const area = box.width * box.height;
  const areaPercent = metrics.areaPercent;
  const aspectRatio = metrics.aspectRatio;
  const normalizedRatio = metrics.normalizedRatio;
  const density = metrics.interiorDensity;
  const localBgContrast = metrics.localBackgroundContrast;

  if (areaPercent < minAreaPercent) {
    return { accepted: false, reason: 'too_small', confidence: 0, aspectRatio, areaPercent, score: 0 };
  }
  if (areaPercent > 0.82) {
    return { accepted: false, reason: 'too_large_background', confidence: 0, aspectRatio, areaPercent, score: 0 };
  }
  if (box.width < imageWidth * 0.08 || box.height < imageHeight * 0.06) {
    return { accepted: false, reason: 'insufficient_dimensions', confidence: 0, aspectRatio, areaPercent, score: 0 };
  }
  if (normalizedRatio < MIN_CARD_RATIO || normalizedRatio > EXTREME_CARD_RATIO) {
    return { accepted: false, reason: 'aspect_ratio_out_of_range', confidence: 0, aspectRatio, areaPercent, score: 0 };
  }
  if (normalizedRatio > MAX_CARD_RATIO && getClosestCardRatioDistance(normalizedRatio) > 0.25) {
    return { accepted: false, reason: 'extreme_aspect_ratio', confidence: 0, aspectRatio, areaPercent, score: 0 };
  }
  if (density < 0.03 || density > 0.95) {
    return { accepted: false, reason: 'content_density_out_of_range', confidence: 0, aspectRatio, areaPercent, score: 0 };
  }
  if (localBgContrast < 0.03 && metrics.borderEdgeDensity < 0.03) {
    return { accepted: false, reason: 'mostly_background', confidence: 0, aspectRatio, areaPercent, score: 0 };
  }
  if (localBgContrast < 0.022 && density < 0.11) {
    return { accepted: false, reason: 'local_bg_too_similar', confidence: 0, aspectRatio, areaPercent, score: 0 };
  }

  const areaScore = 1 - Math.min(1, Math.abs(areaPercent - 0.14) / 0.14);
  const aspectDistance = getClosestCardRatioDistance(normalizedRatio);
  const aspectScore = 1 - Math.min(1, aspectDistance / 0.7);
  const rectangularityScore = 1 - Math.min(1, Math.abs(metrics.rectangularity - 0.62) / 0.62);
  const borderScore = clamp(metrics.borderEdgeDensity / 0.2, 0, 1);
  const interiorScore = 1 - Math.min(1, Math.abs(metrics.interiorDensity - 0.22) / 0.22);
  const contrastScore = clamp(localBgContrast / 0.22, 0, 1);
  const backgroundPenalty = (metrics.interiorDensity < 0.08 && localBgContrast < 0.05) ? 0.35 : 0;
  const clutterPenalty = metrics.outsideEdgeDensity > 0.2 ? 0.08 : 0;

  const score = clamp(
    areaScore * 0.18
      + aspectScore * 0.2
      + rectangularityScore * 0.16
      + borderScore * 0.16
      + interiorScore * 0.14
      + contrastScore * 0.16
      - backgroundPenalty
      - clutterPenalty,
    0,
    1,
  );

  if (score < 0.32) {
    return { accepted: false, reason: 'low_card_score', confidence: score, aspectRatio, areaPercent, score };
  }

  const confidence = clamp(0.25 + score * 0.72, 0.2, 0.99);

  return {
    accepted: true,
    reason: 'accepted',
    confidence,
    aspectRatio,
    areaPercent,
    score,
  };
}

function getVerticalProjection(binary: Uint8Array, width: number, box: ComponentBox): Uint16Array {
  const projection = new Uint16Array(box.width);
  const left = clamp(box.x, 0, width - 1);
  const right = clamp(box.x + box.width - 1, left, width - 1);

  for (let y = box.y; y < box.y + box.height; y += 1) {
    const rowOffset = y * width;
    for (let x = left; x <= right; x += 1) {
      projection[x - left] += binary[rowOffset + x];
    }
  }

  return projection;
}

function smoothProjection(values: Uint16Array): Uint16Array {
  const smoothed = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    let sum = 0;
    let count = 0;
    for (let d = -2; d <= 2; d += 1) {
      const idx = i + d;
      if (idx < 0 || idx >= values.length) continue;
      sum += values[idx];
      count += 1;
    }
    smoothed[i] = Math.round(sum / Math.max(1, count));
  }
  return smoothed;
}

function splitWideBoxFromProjection(box: ComponentBox, projection: Uint16Array): ComponentBox[] {
  const ratio = box.width / Math.max(1, box.height);
  if (ratio < 2.4) return [box];

  const smoothed = smoothProjection(projection);
  const threshold = Math.max(2, Math.round(box.height * 0.04));
  const minGap = Math.max(8, Math.round(box.width * 0.035));

  const cutOffsets: number[] = [];
  let gapStart = -1;
  for (let i = 0; i < smoothed.length; i += 1) {
    const isGap = smoothed[i] <= threshold;
    if (isGap && gapStart < 0) {
      gapStart = i;
    }
    if (!isGap && gapStart >= 0) {
      const gapLen = i - gapStart;
      if (gapLen >= minGap) {
        cutOffsets.push(gapStart + Math.round(gapLen / 2));
      }
      gapStart = -1;
    }
  }

  if (gapStart >= 0) {
    const gapLen = smoothed.length - gapStart;
    if (gapLen >= minGap) {
      cutOffsets.push(gapStart + Math.round(gapLen / 2));
    }
  }

  if (cutOffsets.length === 0) return [box];

  const splitXs = [0, ...cutOffsets, smoothed.length - 1]
    .map((offset) => clamp(offset, 0, smoothed.length - 1))
    .sort((a, b) => a - b);

  const children: ComponentBox[] = [];
  for (let i = 0; i < splitXs.length - 1; i += 1) {
    const startOffset = splitXs[i];
    const endOffset = splitXs[i + 1];
    const childWidth = Math.max(1, endOffset - startOffset);
    if (childWidth < Math.round(box.height * 0.55)) continue;

    children.push({
      x: box.x + startOffset,
      y: box.y,
      width: childWidth,
      height: box.height,
      pixels: Math.round(childWidth * box.height * 0.55),
    });
  }

  return children.length >= 2 ? children : [box];
}

function splitWideCandidate(
  box: ComponentBox,
  foreground: Uint8Array,
  width: number,
  height: number,
): ComponentBox[] {
  const splitSkeleton = splitWideBoxFromProjection(box, getVerticalProjection(foreground, width, box));
  if (splitSkeleton.length <= 1) return [box];

  const children: ComponentBox[] = [];
  for (const skeleton of splitSkeleton) {
    const childX = skeleton.x;
    const childWidth = skeleton.width;

    let minY = height;
    let maxY = 0;
    let pixels = 0;

    for (let y = box.y; y < box.y + box.height; y += 1) {
      const rowOffset = y * width;
      for (let x = childX; x < childX + childWidth; x += 1) {
        const index = rowOffset + x;
        if (foreground[index] === 0) continue;
        pixels += 1;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (pixels === 0 || minY >= maxY) continue;

    children.push({
      x: childX,
      y: minY,
      width: childWidth,
      height: maxY - minY + 1,
      pixels,
    });
  }

  return children.length >= 2 ? children : [box];
}

function suppressCandidates(
  candidates: DetectionCandidate[],
  recommendedMax: number = 6,
): {
  accepted: DetectionCandidate[];
  suppressed: Array<{ candidate: DetectionCandidate; reason: string }>;
} {
  const sorted = [...candidates].sort((a, b) => (
    b.assessment.score - a.assessment.score
      || (b.box.width * b.box.height) - (a.box.width * a.box.height)
  ));

  const accepted: DetectionCandidate[] = [];
  const suppressed: Array<{ candidate: DetectionCandidate; reason: string }> = [];

  // Minimum per-card area: at least half the expected per-card area share.
  // Used by the multi-card-aware guard below.
  const perCardMinAreaPercent = 0.5 / Math.max(1, recommendedMax);

  sorted.forEach((candidate) => {
    let rejectReason: string | null = null;

    for (const keeper of accepted) {
      const inside = insideRatio(candidate.box, keeper.box);
      const overlapSmall = overlapOverSmaller(candidate.box, keeper.box);
      const iou = getIoU(candidate.box, keeper.box);

      // Multi-card-aware guard: if the keeper is much larger than the candidate
      // (area ratio > 2.5) AND the candidate looks like a valid individual card
      // (score ≥ 0.40 and occupies a plausible per-card share of the image),
      // skip suppression from this particular keeper. The keeper may be a merged
      // bounding box spanning multiple cards, and suppressing the individual card
      // would cause under-detection.
      const keeperArea = keeper.box.width * keeper.box.height;
      const candidateArea = candidate.box.width * candidate.box.height;
      const areaRatio = keeperArea / Math.max(1, candidateArea);
      if (
        areaRatio > 2.5
        && candidate.assessment.score >= 0.40
        && candidate.assessment.areaPercent >= perCardMinAreaPercent
      ) {
        continue; // don't let this oversized keeper suppress the candidate
      }

      if (inside >= INSIDE_SUPPRESSION_THRESHOLD) {
        rejectReason = 'inside_larger_candidate';
        break;
      }

      if (overlapSmall >= OVERLAP_SUPPRESSION_THRESHOLD || iou > MERGE_IOU_THRESHOLD) {
        rejectReason = 'overlap_smaller_suppressed';
        break;
      }
    }

    if (rejectReason) {
      suppressed.push({ candidate, reason: rejectReason });
      return;
    }

    accepted.push(candidate);
  });

  return { accepted, suppressed };
}

// ─── Phase 2: Rectangle contour detection ────────────────────────────────────
// Find rectangular card boundaries by closing the edge map and collecting
// connected components within the closed edge layer. This path detects cards
// based on their physical outline/shadow rather than their printed content,
// complementing the existing foreground-content connected-component path.

function detectRectangularContours(
  edges: Uint8Array,
  sceneBackgroundMask: Uint8Array,
  width: number,
  height: number,
  minAreaPercent: number,
): ComponentBox[] {
  const imageArea = width * height;

  // Close edges more aggressively to connect broken card outlines
  // (shadows, corners, low-contrast borders all produce broken lines).
  const closedEdges = dilate(edges, width, height, 3);

  const rawComponents = collectConnectedComponents(closedEdges, width, height);
  const candidates: ComponentBox[] = [];

  for (const comp of rawComponents) {
    const area = comp.width * comp.height;
    const areaPercent = area / imageArea;

    if (areaPercent < minAreaPercent * 0.4) continue;
    if (areaPercent > 0.9) continue;
    if (comp.width < width * 0.05 || comp.height < height * 0.04) continue;

    const rawRatio = comp.width / Math.max(1, comp.height);
    const normalizedRatio = rawRatio >= 1 ? rawRatio : 1 / Math.max(0.0001, rawRatio);
    if (normalizedRatio < MIN_CARD_RATIO - 0.15 || normalizedRatio > EXTREME_CARD_RATIO + 0.2) continue;

    // Require edge coverage on the bounding box perimeter — distinguishes
    // real card outlines from scattered interior text/print noise.
    const borderDepth = Math.max(2, Math.round(Math.min(comp.width, comp.height) * 0.07));
    let borderEdges = 0;
    let borderPixels = 0;
    const left = clamp(comp.x, 0, width - 1);
    const top = clamp(comp.y, 0, height - 1);
    const right = clamp(comp.x + comp.width - 1, left, width - 1);
    const bottom = clamp(comp.y + comp.height - 1, top, height - 1);

    for (let y = top; y <= bottom; y += 1) {
      const rowOffset = y * width;
      for (let x = left; x <= right; x += 1) {
        const onBorder = (
          x - left < borderDepth
          || right - x < borderDepth
          || y - top < borderDepth
          || bottom - y < borderDepth
        );
        if (onBorder) {
          borderPixels += 1;
          borderEdges += edges[rowOffset + x];
        }
      }
    }

    const edgeDensity = borderEdges / Math.max(1, borderPixels);
    if (edgeDensity < 0.025) continue;

    candidates.push({ x: left, y: top, width: right - left + 1, height: bottom - top + 1, pixels: comp.pixels });
  }

  return candidates;
}

// ─── Phase 4: Candidate expansion to full card ──────────────────────────────
// Expand a partial candidate outward until its boundary hits scene background.
// This turns partial text/logo detections into full card crops.

function expandCandidateToFullCard(
  box: ComponentBox,
  sceneBackgroundMask: Uint8Array,
  width: number,
  height: number,
): ComponentBox {
  const MAX_EXPAND_FRACTION = 0.30;
  const BG_STOP_THRESHOLD = 0.55;

  let top = box.y;
  let bottom = box.y + box.height - 1;
  let left = box.x;
  let right = box.x + box.width - 1;

  const maxExpandH = Math.round(box.height * MAX_EXPAND_FRACTION);
  const maxExpandW = Math.round(box.width * MAX_EXPAND_FRACTION);

  function rowBgFraction(y: number, x1: number, x2: number): number {
    if (y < 0 || y >= height) return 1;
    let bg = 0;
    let total = 0;
    const rowOffset = y * width;
    for (let x = Math.max(0, x1); x <= Math.min(width - 1, x2); x += 1) {
      total += 1;
      bg += sceneBackgroundMask[rowOffset + x];
    }
    return total === 0 ? 1 : bg / total;
  }

  function colBgFraction(x: number, y1: number, y2: number): number {
    if (x < 0 || x >= width) return 1;
    let bg = 0;
    let total = 0;
    for (let y = Math.max(0, y1); y <= Math.min(height - 1, y2); y += 1) {
      total += 1;
      bg += sceneBackgroundMask[y * width + x];
    }
    return total === 0 ? 1 : bg / total;
  }

  for (let i = 0; i < maxExpandH; i += 1) {
    if (top <= 0) break;
    if (rowBgFraction(top - 1, left, right) >= BG_STOP_THRESHOLD) break;
    top -= 1;
  }

  for (let i = 0; i < maxExpandH; i += 1) {
    if (bottom >= height - 1) break;
    if (rowBgFraction(bottom + 1, left, right) >= BG_STOP_THRESHOLD) break;
    bottom += 1;
  }

  for (let i = 0; i < maxExpandW; i += 1) {
    if (left <= 0) break;
    if (colBgFraction(left - 1, top, bottom) >= BG_STOP_THRESHOLD) break;
    left -= 1;
  }

  for (let i = 0; i < maxExpandW; i += 1) {
    if (right >= width - 1) break;
    if (colBgFraction(right + 1, top, bottom) >= BG_STOP_THRESHOLD) break;
    right += 1;
  }

  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
    pixels: box.pixels,
  };
}

/**
 * Find the position (row or column index) of the dominant background gap band
 * in the middle 20–80 % of the image. Used by the grid rescue pass to locate
 * the natural split between a 2×2 card layout's rows or columns.
 *
 * Returns -1 when no meaningful gap is found (all band fractions are low).
 */
function findPrimaryGap(
  sceneBackgroundMask: Uint8Array,
  width: number,
  height: number,
  direction: 'horizontal' | 'vertical',
): number {
  const size = direction === 'horizontal' ? height : width;
  const crossSize = direction === 'horizontal' ? width : height;

  // Compute per-band background fraction
  const raw = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    let bgCount = 0;
    for (let j = 0; j < crossSize; j += 1) {
      const idx = direction === 'horizontal' ? i * width + j : j * width + i;
      bgCount += sceneBackgroundMask[idx];
    }
    raw[i] = bgCount / crossSize;
  }

  // Smooth ± 5 bands
  const smoothed = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    let sum = 0;
    let count = 0;
    for (let d = -5; d <= 5; d += 1) {
      const idx = i + d;
      if (idx < 0 || idx >= size) continue;
      sum += raw[idx];
      count += 1;
    }
    smoothed[i] = sum / Math.max(1, count);
  }

  // Find maximum in middle 20–80 %
  const lo = Math.floor(size * 0.20);
  const hi = Math.floor(size * 0.80);
  let bestPos = -1;
  let bestVal = 0.35; // minimum threshold to be considered a gap

  for (let i = lo; i <= hi; i += 1) {
    if (smoothed[i] > bestVal) {
      bestVal = smoothed[i];
      bestPos = i;
    }
  }

  return bestPos;
}

/**
 * Background-grid rescue pass for images where 4 cards are arranged in a 2×2
 * grid. When fewer cards than expected were found, divide the image at its
 * dominant background gap lines and create a candidate for each grid cell not
 * already covered by an accepted crop.
 *
 * Only runs when `recommendedMax >= 4` and fewer than `recommendedMax` cards
 * have been accepted so far.
 */
function runBackgroundGridRescue(
  sceneBackgroundMask: Uint8Array,
  foregroundMask: Uint8Array,
  denoisedGray: Uint8Array,
  edges: Uint8Array,
  workWidth: number,
  workHeight: number,
  scale: number,
  naturalWidth: number,
  naturalHeight: number,
  acceptedSoFar: DetectionCandidate[],
  recommendedMax: number,
  minAreaPercent: number,
  nextIndex: number,
): DetectionCandidate[] {
  const GRID_RESCUE_MIN_SCORE = 0.20;
  const COVERAGE_OVERLAP_THRESHOLD = 0.35;

  // Find split lines
  const midY = findPrimaryGap(sceneBackgroundMask, workWidth, workHeight, 'horizontal');
  const midX = findPrimaryGap(sceneBackgroundMask, workWidth, workHeight, 'vertical');

  // Fall back to image centre when no gap found
  const splitY = midY > 0 ? midY : Math.floor(workHeight / 2);
  const splitX = midX > 0 ? midX : Math.floor(workWidth / 2);

  console.debug(`[gridRescue] splitX=${splitX} splitY=${splitY} (midX=${midX} midY=${midY})`);

  const cells: Array<{ x: number; y: number; w: number; h: number; label: string }> = [
    { x: 0,      y: 0,      w: splitX,           h: splitY,            label: 'TL' },
    { x: splitX, y: 0,      w: workWidth - splitX, h: splitY,          label: 'TR' },
    { x: 0,      y: splitY, w: splitX,           h: workHeight - splitY, label: 'BL' },
    { x: splitX, y: splitY, w: workWidth - splitX, h: workHeight - splitY, label: 'BR' },
  ];

  const rescued: DetectionCandidate[] = [];

  for (const cell of cells) {
    if (cell.w < 10 || cell.h < 10) continue;

    // Check if this cell is already well covered by an accepted candidate
    const cellBox: ComponentBox = { x: cell.x, y: cell.y, width: cell.w, height: cell.h, pixels: 0 };
    const isCovered = acceptedSoFar.some(
      (a) => getIoU(cellBox, a.box) >= COVERAGE_OVERLAP_THRESHOLD,
    );
    if (isCovered) {
      console.debug(`[gridRescue] ${cell.label}: already covered`);
      continue;
    }

    // Compute foreground density in this cell
    let fgPixels = 0;
    for (let y = cell.y; y < cell.y + cell.h; y += 1) {
      const rowOffset = y * workWidth;
      for (let x = cell.x; x < cell.x + cell.w; x += 1) {
        fgPixels += foregroundMask[rowOffset + x];
      }
    }
    const cellArea = cell.w * cell.h;
    const fgDensity = fgPixels / Math.max(1, cellArea);

    if (fgDensity < 0.03) {
      console.debug(`[gridRescue] ${cell.label}: skipped — too little foreground (${(fgDensity * 100).toFixed(1)} %)`);
      continue;
    }

    // Tighten to foreground bounding box within the cell
    let minX = cell.x + cell.w - 1;
    let maxX = cell.x;
    let minY = cell.y + cell.h - 1;
    let maxY = cell.y;

    for (let y = cell.y; y < cell.y + cell.h; y += 1) {
      const rowOffset = y * workWidth;
      for (let x = cell.x; x < cell.x + cell.w; x += 1) {
        if (foregroundMask[rowOffset + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (minX > maxX || minY > maxY) continue;

    const tightBox: ComponentBox = {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      pixels: fgPixels,
    };

    const expandedBox = expandCandidateToFullCard(tightBox, sceneBackgroundMask, workWidth, workHeight);
    const metrics = measureCandidateMetrics(expandedBox, denoisedGray, edges, foregroundMask, workWidth, workHeight);
    const assessment = assessCandidate(expandedBox, metrics, workWidth, workHeight, minAreaPercent);

    const rescueScore = assessment.score;
    const accepted = rescueScore >= GRID_RESCUE_MIN_SCORE;

    console.debug(`[gridRescue] ${cell.label}: score=${rescueScore.toFixed(3)} accepted=${accepted} reason=${assessment.reason}`);

    if (!accepted) continue;

    rescued.push({
      index: nextIndex + rescued.length,
      box: expandedBox,
      bounds: componentToBounds(expandedBox, scale, naturalWidth, naturalHeight),
      generatedBy: 'grid_gap_rescue',
      assessment: { ...assessment, accepted: true, reason: 'grid_gap_rescue' },
      metrics,
    });
  }

  return rescued;
}

function shouldAttemptExpansion(
  box: ComponentBox,
  metrics: CandidateMetrics,
  workWidth: number,
  workHeight: number,
): boolean {
  const areaPercent = (box.width * box.height) / Math.max(1, workWidth * workHeight);
  const hasEdgeEvidence = metrics.borderEdgeDensity > 0.03;
  // Only expand small candidates that already have some boundary evidence —
  // these are likely partial crops of a larger card.
  return areaPercent < 0.15 && hasEdgeEvidence;
}

// ─── Phase 7: Fallback clustering for missed cards ───────────────────────────
// When too few cards are found but many small components were rejected, group
// those components spatially and attempt to expand each cluster into a card.

function clusterRejectedComponents(
  rejectedBoxes: ComponentBox[],
  width: number,
  height: number,
): ComponentBox[][] {
  if (rejectedBoxes.length === 0) return [];

  const clusterGap = Math.max(20, Math.round(Math.min(width, height) * 0.055));
  const remaining = [...rejectedBoxes];
  const clusters: ComponentBox[][] = [];

  while (remaining.length > 0) {
    const seed = remaining.shift();
    if (!seed) break;
    const cluster = [seed];
    let added = true;

    while (added) {
      added = false;
      for (let i = remaining.length - 1; i >= 0; i -= 1) {
        const box = remaining[i];
        if (cluster.some((member) => getEdgeDistance(member, box) <= clusterGap)) {
          cluster.push(box);
          remaining.splice(i, 1);
          added = true;
        }
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function buildDebugOverlay(
  image: HTMLImageElement,
  accepted: Array<{ bounds: DetectionBounds; cropIndex: number; generatedBy?: CandidateOrigin }>,
  rejected: DetectionCandidateDebug[],
): string {
  const canvas = createCanvas(image.naturalWidth, image.naturalHeight);
  const context = canvas.getContext('2d');
  if (!context) return '';

  context.drawImage(image, 0, 0);
  context.lineWidth = Math.max(2, Math.round(Math.min(image.naturalWidth, image.naturalHeight) / 400));
  context.font = `${Math.max(14, Math.round(Math.min(image.naturalWidth, image.naturalHeight) / 45))}px sans-serif`;

  function styleForOrigin(origin?: CandidateOrigin): { stroke: string; fill: string; label: string } {
    if (origin === 'contour') {
      return { stroke: 'rgba(249,115,22,0.9)', fill: 'rgba(249,115,22,0.2)', label: 'CT' };
    }
    if (origin === 'expanded') {
      return { stroke: 'rgba(14,165,233,0.9)', fill: 'rgba(14,165,233,0.2)', label: 'EX' };
    }
    if (origin === 'cluster-fallback') {
      return { stroke: 'rgba(168,85,247,0.9)', fill: 'rgba(168,85,247,0.2)', label: 'CF' };
    }
    return { stroke: 'rgba(34,197,94,0.95)', fill: 'rgba(34,197,94,0.15)', label: 'CC' };
  }

  rejected.forEach((candidate, index) => {
    const originStyle = styleForOrigin(candidate.generatedBy);
    context.strokeStyle = originStyle.stroke;
    context.fillStyle = originStyle.fill;
    context.fillRect(candidate.bounds.x, candidate.bounds.y, candidate.bounds.width, candidate.bounds.height);
    context.strokeRect(candidate.bounds.x, candidate.bounds.y, candidate.bounds.width, candidate.bounds.height);
    context.fillStyle = 'rgba(127,29,29,0.95)';
    context.fillText(`${originStyle.label}-R${index + 1}`, candidate.bounds.x + 4, Math.max(16, candidate.bounds.y - 6));
  });

  accepted.forEach((candidate) => {
    const originStyle = styleForOrigin(candidate.generatedBy);
    context.strokeStyle = originStyle.stroke;
    context.fillStyle = originStyle.fill;
    context.fillRect(candidate.bounds.x, candidate.bounds.y, candidate.bounds.width, candidate.bounds.height);
    context.strokeRect(candidate.bounds.x, candidate.bounds.y, candidate.bounds.width, candidate.bounds.height);
    context.fillStyle = 'rgba(20,83,45,0.95)';
    context.fillText(`${originStyle.label}-#${candidate.cropIndex}`, candidate.bounds.x + 4, Math.max(16, candidate.bounds.y - 6));
  });

  return canvas.toDataURL('image/png');
}

async function cropCardToFile(
  sourceCanvas: HTMLCanvasElement,
  bounds: DetectionBounds,
  fileNamePrefix: string,
  cropIndex: number,
): Promise<{ file: File; previewUrl: string }> {
  const cropCanvas = createCanvas(bounds.width, bounds.height);
  const cropContext = cropCanvas.getContext('2d');

  if (!cropContext) {
    throw new Error('Unable to create crop canvas.');
  }

  cropContext.drawImage(
    sourceCanvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  );

  const blob = await new Promise<Blob>((resolve, reject) => {
    cropCanvas.toBlob((value) => {
      if (!value) {
        reject(new Error('Unable to encode detected crop.'));
        return;
      }
      resolve(value);
    }, 'image/jpeg', 0.92);
  });

  const fileName = `${fileNamePrefix.replace(/\.[^.]+$/, '')}-crop-${String(cropIndex).padStart(2, '0')}.jpg`;
  const file = new File([blob], fileName, { type: 'image/jpeg' });
  return { file, previewUrl: URL.createObjectURL(file) };
}

export async function detectBusinessCardCrops(
  file: File,
  options: MultiCardDetectionOptions = {},
): Promise<MultiCardDetectionResult> {
  const recommendedMax = Math.max(1, options.maxCards ?? 6);
  const hardMax = Math.max(recommendedMax, options.hardMaxCards ?? 12);
  const debugEnabled = Boolean(options.debug ?? import.meta.env.DEV);
  const showOverlay = Boolean(options.enableDebugOverlay ?? import.meta.env.DEV);
  const minAreaPercent = clamp(options.minAreaPercent ?? DEFAULT_MIN_AREA_PERCENT, 0.02, 0.2);
  const warnings: string[] = [];

  const image = await loadImage(file);
  const sourceCanvas = createCanvas(image.naturalWidth, image.naturalHeight);
  const sourceContext = sourceCanvas.getContext('2d');

  if (!sourceContext) {
    throw new Error('Unable to prepare source image for card detection.');
  }

  sourceContext.drawImage(image, 0, 0);

  const scale = Math.min(1, MAX_EDGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const workWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const workHeight = Math.max(1, Math.round(image.naturalHeight * scale));

  const workCanvas = createCanvas(workWidth, workHeight);
  const workContext = workCanvas.getContext('2d', { willReadFrequently: true });
  if (!workContext) {
    throw new Error('Unable to initialize detection workspace.');
  }

  workContext.drawImage(image, 0, 0, workWidth, workHeight);

  const workImageData = workContext.getImageData(0, 0, workWidth, workHeight);
  const gray = normalizeContrast(toGrayArray(workImageData));
  const denoisedGray = boxBlur(gray, workWidth, workHeight, 1, 1);
  const foregroundMask = openBinary(adaptiveForegroundMask(denoisedGray, workWidth, workHeight), workWidth, workHeight);
  const edges = closeBinary(edgeMap(denoisedGray, workWidth, workHeight), workWidth, workHeight);
  const textureMap = computeTextureMap(denoisedGray, workWidth, workHeight);

  // ── Scene-background segmentation ────────────────────────────────────────
  // Build a dynamic model of the scene around cards using border samples and
  // interior open regions, then mark high-confidence scene background.
  const sceneBackgroundModel = estimateSceneBackground(workImageData, textureMap, edges, workWidth, workHeight);
  const sceneBackgroundMask = buildSceneBackgroundMask(
    workImageData,
    textureMap,
    edges,
    workWidth,
    workHeight,
    sceneBackgroundModel,
  );

  const componentMinPixels = Math.max(80, Math.round(workWidth * workHeight * 0.0012));
  const components = collectConnectedComponents(foregroundMask, workWidth, workHeight)
    .filter((component) => component.pixels >= componentMinPixels)
    .map((component) => ({
      ...component,
      x: clamp(component.x - 2, 0, workWidth - 1),
      y: clamp(component.y - 2, 0, workHeight - 1),
      width: clamp(component.width + 4, 1, workWidth),
      height: clamp(component.height + 4, 1, workHeight),
    }));

  // Pass scene background mask so components separated by visible background
  // are never merged into a single candidate.
  const mergedBoxes = mergeNearbyBoxes(components, sceneBackgroundMask, workWidth);

  // ── Phase 2: Merge component path with contour detection path ─────────────
  // Component path finds areas with printed content; contour path finds card
  // outlines via edge closing. Cards missed by one path are often found by
  // the other. Deduplicate by IoU before scoring.
  const contourBoxes = detectRectangularContours(edges, sceneBackgroundMask, workWidth, workHeight, minAreaPercent);

  const baseCandidates: DetectionCandidate[] = [];
  const seenBoxSignatures = new Set<string>();

  mergedBoxes.forEach((box, index) => {
    const sig = computeBoxSignature(box);
    if (seenBoxSignatures.has(sig)) return;
    seenBoxSignatures.add(sig);
    const metrics = measureCandidateMetrics(box, denoisedGray, edges, foregroundMask, workWidth, workHeight);
    const assessment = assessCandidate(box, metrics, workWidth, workHeight, minAreaPercent);
    baseCandidates.push({
      index,
      box,
      bounds: componentToBounds(box, scale, image.naturalWidth, image.naturalHeight),
      generatedBy: components.length === mergedBoxes.length ? 'component' : 'merge',
      assessment,
      metrics,
    });
  });

  contourBoxes.forEach((box, idx) => {
    const isDuplicate = baseCandidates.some((existing) => getIoU(existing.box, box) > 0.45);
    if (isDuplicate) return;
    const metrics = measureCandidateMetrics(box, denoisedGray, edges, foregroundMask, workWidth, workHeight);
    const assessment = assessCandidate(box, metrics, workWidth, workHeight, minAreaPercent);
    baseCandidates.push({
      index: mergedBoxes.length + idx,
      box,
      bounds: componentToBounds(box, scale, image.naturalWidth, image.naturalHeight),
      generatedBy: 'contour',
      assessment,
      metrics,
    });
  });

  // ── Split phase (unchanged logic, now operates on unified candidate set) ──
  const expandedCandidates: DetectionCandidate[] = [];
  const splitRejections: Array<{ candidate: DetectionCandidate; reason: string }> = [];

  baseCandidates.forEach((candidate) => {
    // Use background-aware split first (handles both side-by-side and stacked
    // cards). Falls back to no-split automatically if no background bands found.
    const children = splitBoxByBackgroundGaps(
      candidate.box,
      sceneBackgroundMask,
      foregroundMask,
      workWidth,
      workHeight,
    );
    if (children.length <= 1) {
      // Also try the legacy foreground-gap wide split as a secondary pass.
      const legacyChildren = splitWideCandidate(candidate.box, foregroundMask, workWidth, workHeight);
      if (legacyChildren.length > 1) {
        const legacySplitChildren = legacyChildren.map((child, childIndex): DetectionCandidate => {
          const metrics = measureCandidateMetrics(child, denoisedGray, edges, foregroundMask, workWidth, workHeight);
          const assessment = assessCandidate(child, metrics, workWidth, workHeight, minAreaPercent);
          return {
            index: candidate.index * 100 + childIndex,
            box: child,
            bounds: componentToBounds(child, scale, image.naturalWidth, image.naturalHeight),
            generatedBy: 'split',
            assessment,
            metrics,
          };
        });
        const validLegacy = legacySplitChildren.filter((c) => c.assessment.accepted);
        if (validLegacy.length >= 2) {
          expandedCandidates.push(...legacySplitChildren);
          splitRejections.push({ candidate, reason: 'split_into_children' });
          return;
        }
      }
      expandedCandidates.push(candidate);
      return;
    }

    const splitChildren = children.map((child, childIndex): DetectionCandidate => {
      const metrics = measureCandidateMetrics(child, denoisedGray, edges, foregroundMask, workWidth, workHeight);
      const assessment = assessCandidate(child, metrics, workWidth, workHeight, minAreaPercent);
      return {
        index: candidate.index * 100 + childIndex,
        box: child,
        bounds: componentToBounds(child, scale, image.naturalWidth, image.naturalHeight),
        generatedBy: 'split',
        assessment,
        metrics,
      };
    });

    const validChildren = splitChildren.filter((child) => child.assessment.accepted);
    if (validChildren.length >= 2) {
      expandedCandidates.push(...splitChildren);
      splitRejections.push({ candidate, reason: 'split_into_children' });
      return;
    }

    expandedCandidates.push(candidate);
  });

  // ── Phase 4: Candidate expansion ─────────────────────────────────────────
  // Grow small partial detections (text/logo fragment) outward to the full card
  // boundary. Expansion stops at scene background, not at blank card interiors.
  const expansionRejections: Array<{ candidate: DetectionCandidate; reason: string }> = [];
  const postExpansionCandidates = expandedCandidates.map((candidate): DetectionCandidate => {
    if (!shouldAttemptExpansion(candidate.box, candidate.metrics, workWidth, workHeight)) {
      return candidate;
    }
    const expandedBox = expandCandidateToFullCard(candidate.box, sceneBackgroundMask, workWidth, workHeight);
    const grew = (
      expandedBox.width > candidate.box.width * 1.04
      || expandedBox.height > candidate.box.height * 1.04
    );
    if (!grew) return candidate;
    const newMetrics = measureCandidateMetrics(expandedBox, denoisedGray, edges, foregroundMask, workWidth, workHeight);
    const newAssessment = assessCandidate(expandedBox, newMetrics, workWidth, workHeight, minAreaPercent);
    if (!newAssessment.accepted) {
      expansionRejections.push({ candidate, reason: 'expansion_did_not_improve_score' });
      return candidate;
    }
    return {
      ...candidate,
      box: expandedBox,
      bounds: componentToBounds(expandedBox, scale, image.naturalWidth, image.naturalHeight),
      generatedBy: 'expanded',
      assessment: newAssessment,
      metrics: newMetrics,
    };
  });

  const prelimAccepted = postExpansionCandidates.filter((candidate) => candidate.assessment.accepted);
  const prelimRejected = postExpansionCandidates
    .filter((candidate) => !candidate.assessment.accepted)
    .map((candidate) => ({ candidate, reason: candidate.assessment.reason }));

  let fallbackClusterCount = 0;

  // ── Phase 7: Fallback clustering ─────────────────────────────────────────
  // If far fewer cards found than expected but many rejected components exist,
  // group those components spatially, expand each cluster to a full-card region,
  // and rescore. Adds valid clusters back to the accepted pool.
  if (
    prelimAccepted.length < Math.ceil(recommendedMax * 0.5)
    && prelimRejected.length > 1
  ) {
    const rescuableBoxes = prelimRejected
      .filter((r) => (
        r.candidate.assessment.reason !== 'too_large_background'
        && r.candidate.assessment.reason !== 'aspect_ratio_out_of_range'
      ))
      .map((r) => r.candidate.box);

    const clusters = clusterRejectedComponents(rescuableBoxes, workWidth, workHeight);
    fallbackClusterCount = clusters.length;

    for (const cluster of clusters) {
      if (cluster.length < 2) continue;

      const clusterX = cluster.reduce((m, b) => Math.min(m, b.x), cluster[0].x);
      const clusterY = cluster.reduce((m, b) => Math.min(m, b.y), cluster[0].y);
      const clusterRight = cluster.reduce((m, b) => Math.max(m, b.x + b.width), 0);
      const clusterBottom = cluster.reduce((m, b) => Math.max(m, b.y + b.height), 0);
      const clusterBound: ComponentBox = {
        x: clusterX,
        y: clusterY,
        width: clusterRight - clusterX,
        height: clusterBottom - clusterY,
        pixels: cluster.reduce((sum, b) => sum + b.pixels, 0),
      };

      const expandedCluster = expandCandidateToFullCard(clusterBound, sceneBackgroundMask, workWidth, workHeight);
      const alreadyCovered = prelimAccepted.some((c) => getIoU(c.box, expandedCluster) > 0.35);
      if (alreadyCovered) continue;

      const metrics = measureCandidateMetrics(expandedCluster, denoisedGray, edges, foregroundMask, workWidth, workHeight);
      const assessment = assessCandidate(expandedCluster, metrics, workWidth, workHeight, minAreaPercent);
      if (!assessment.accepted) continue;

      prelimAccepted.push({
        index: -(prelimAccepted.length + 1),
        box: expandedCluster,
        bounds: componentToBounds(expandedCluster, scale, image.naturalWidth, image.naturalHeight),
        generatedBy: 'cluster-fallback',
        assessment,
        metrics,
      });
    }
  }

  const suppression = suppressCandidates(prelimAccepted, recommendedMax);

  // ── Post-suppression rescue pass ─────────────────────────────────────────
  // When the suppression step left fewer cards than expected (< 50% of
  // recommendedMax), a large merged region may have incorrectly suppressed
  // valid individual-card candidates. Rescue suppressed candidates that have
  // a decent score (≥ 0.35) and don't significantly overlap with any already-
  // accepted candidate (IoU < 0.30).
  const rescueMinScore = 0.35;
  const rescueMaxIoU = 0.30;
  const rescueThreshold = Math.ceil(recommendedMax * 0.5);
  const rescued: DetectionCandidate[] = [];

  if (suppression.accepted.length < rescueThreshold) {
    for (const { candidate } of suppression.suppressed) {
      if (candidate.assessment.score < rescueMinScore) continue;

      const overlapsAccepted = [...suppression.accepted, ...rescued].some(
        (a) => getIoU(candidate.box, a.box) >= rescueMaxIoU,
      );
      if (overlapsAccepted) continue;

      rescued.push(candidate);
      if (suppression.accepted.length + rescued.length >= hardMax) break;
    }
    if (rescued.length > 0) {
      warnings.push(`Rescued ${rescued.length} suppressed candidate(s) — fewer than ${rescueThreshold} cards were found after suppression.`);
    }
  }

  // ── Background-grid rescue (2×2 layout fallback) ──────────────────────────
  // When fewer cards than expected are found and recommendedMax >= 4, divide
  // the image at background-gap lines and create candidates for uncovered cells.
  const gridRescued: DetectionCandidate[] = [];

  if (
    recommendedMax >= 4
    && (suppression.accepted.length + rescued.length) < recommendedMax
  ) {
    const nextIdx = suppression.accepted.length + rescued.length + 100_000;
    const gridCandidates = runBackgroundGridRescue(
      sceneBackgroundMask,
      foregroundMask,
      denoisedGray,
      edges,
      workWidth,
      workHeight,
      scale,
      image.naturalWidth,
      image.naturalHeight,
      [...suppression.accepted, ...rescued],
      recommendedMax,
      minAreaPercent,
      nextIdx,
    );
    for (const gc of gridCandidates) {
      const overlaps = [...suppression.accepted, ...rescued, ...gridRescued].some(
        (a) => getIoU(a.box, gc.box) >= 0.25,
      );
      if (!overlaps) gridRescued.push(gc);
    }
    if (gridRescued.length > 0) {
      warnings.push(`Grid rescue found ${gridRescued.length} additional card region(s) for ${recommendedMax}-card layout.`);
    }
  }

  const allAccepted = [...suppression.accepted, ...rescued, ...gridRescued];

  const cleanedAccepted = sortReadingOrder(nonMaximumSuppression(
    allAccepted.map((candidate) => candidate.box),
    0.35,
  ));
  const selectedBoxes = cleanedAccepted.slice(0, hardMax);

  if (cleanedAccepted.length > hardMax) {
    warnings.push(`Detected ${cleanedAccepted.length} card-like regions; processing the first ${hardMax}.`);
  }

  const selectedSet = new Set(selectedBoxes.map((box) => computeBoxSignature(box)));

  const rescuedSet = new Set(rescued.map((c) => `${c.index}:${computeBoxSignature(c.box)}:${c.generatedBy}`));

  const debugCandidatesSource: Array<{ candidate: DetectionCandidate; reason: string }> = [
    ...prelimRejected,
    ...suppression.suppressed,
    ...splitRejections,
    ...expansionRejections,
    ...suppression.accepted.map((candidate) => ({
      candidate,
      reason: selectedSet.has(computeBoxSignature(candidate.box)) ? 'accepted' : 'suppressed_or_merged',
    })),
    ...rescued.map((candidate) => ({
      candidate,
      reason: 'rescued',
    })),
    ...gridRescued.map((candidate) => ({
      candidate,
      reason: 'grid_gap_rescue',
    })),
  ];

  const candidateSeen = new Set<string>();
  const candidates: DetectionCandidateDebug[] = debugCandidatesSource
    .filter(({ candidate }) => {
      const key = `${candidate.index}:${computeBoxSignature(candidate.box)}:${candidate.generatedBy}`;
      if (candidateSeen.has(key)) return false;
      candidateSeen.add(key);
      return true;
    })
    .map(({ candidate, reason }) => {
      const accepted = reason === 'accepted' || reason === 'rescued' || reason === 'grid_gap_rescue';
      const isRescued = reason === 'rescued' || reason === 'grid_gap_rescue';
      const candidateKey = `${candidate.index}:${computeBoxSignature(candidate.box)}:${candidate.generatedBy}`;
      return {
        index: candidate.index,
        status: accepted ? 'accepted' : 'rejected',
        reason,
        generatedBy: candidate.generatedBy,
        bounds: candidate.bounds,
        aspectRatio: Number(candidate.assessment.aspectRatio.toFixed(3)),
        areaPercent: Number((candidate.assessment.areaPercent * 100).toFixed(3)),
        confidence: Number(candidate.assessment.confidence.toFixed(3)),
        score: Number(candidate.assessment.score.toFixed(3)),
        // Debug metrics from the candidate's measurement pass
        rectangularity: Number(candidate.metrics.rectangularity.toFixed(3)),
        edgeScore: Number(candidate.metrics.borderEdgeDensity.toFixed(3)),
        rescueEligible: rescuedSet.has(candidateKey) || candidate.assessment.score >= rescueMinScore,
        ...(isRescued && { rescuedBy: reason === 'grid_gap_rescue' ? 'grid_gap_rescue' : 'post_suppression_rescue' }),
      } satisfies DetectionCandidateDebug;
    });

  const rejectionReasons: Record<string, number> = {};
  candidates
    .filter((candidate) => candidate.status === 'rejected')
    .forEach((candidate) => {
      rejectionReasons[candidate.reason] = (rejectionReasons[candidate.reason] ?? 0) + 1;
    });

  const crops: DetectedCardCrop[] = [];
  for (let index = 0; index < selectedBoxes.length; index += 1) {
    const box = selectedBoxes[index];
    const bounds = componentToBounds(box, scale, image.naturalWidth, image.naturalHeight);
    const areaPercent = (bounds.width * bounds.height) / Math.max(1, image.naturalWidth * image.naturalHeight);
    const ratio = bounds.width / Math.max(1, bounds.height);
    const normalizedRatio = ratio >= 1 ? ratio : 1 / Math.max(0.0001, ratio);

    const confidenceBase = candidates.find((candidate) =>
      candidate.status === 'accepted'
      && candidate.bounds.x === bounds.x
      && candidate.bounds.y === bounds.y
      && candidate.bounds.width === bounds.width
      && candidate.bounds.height === bounds.height,
    )?.confidence ?? 0.58;

    const warningsForCrop: string[] = [];
    if (normalizedRatio < MIN_CARD_RATIO || normalizedRatio > MAX_CARD_RATIO) {
      warningsForCrop.push('Aspect ratio is unusual for a business card.');
    }

    // Warn when a single large crop might contain more than one card.
    // Heuristic: the crop covers more than 28 % of the image AND its
    // normalised aspect ratio deviates noticeably from typical card shapes.
    const closestRatioDistance = getClosestCardRatioDistance(normalizedRatio);
    if (
      crops.length === 0 // we haven't pushed any crop yet — this is the first one
      && selectedBoxes.length === 1
      && areaPercent > 0.28
      && closestRatioDistance > 0.18
    ) {
      warningsForCrop.push('Possible multiple cards detected — review crop box.');
    }

    const cropped = await cropCardToFile(sourceCanvas, bounds, file.name, index + 1);

    crops.push({
      id: crypto.randomUUID(),
      cropIndex: index + 1,
      file: cropped.file,
      previewUrl: cropped.previewUrl,
      bounds,
      confidence: confidenceBase,
      warnings: warningsForCrop,
      aspectRatio: Number(ratio.toFixed(3)),
      areaPercent: Number((areaPercent * 100).toFixed(3)),
    });
  }

  if (crops.length === 0) {
    warnings.push('No clear card regions were detected. Falling back to single-card extraction.');
  }

  if (crops.length > recommendedMax) {
    warnings.push(`More than ${recommendedMax} card-like regions were detected. Review crops before processing.`);
  }

  // Under-detection warning: fewer crops than half of what was expected.
  if (crops.length > 0 && crops.length < Math.ceil(recommendedMax * 0.5)) {
    warnings.push(`Only ${crops.length} of an expected ~${recommendedMax} cards were detected. Some cards may be missing — try better lighting or use manual crops.`);
  } else if (crops.length > 0 && crops.length < recommendedMax) {
    warnings.push('Some cards may not have been detected. Try fewer cards per photo or add manual crops.');
  }

  const averageConfidence = crops.length
    ? crops.reduce((sum, crop) => sum + crop.confidence, 0) / crops.length
    : 0;

  if (crops.length > 0 && averageConfidence < 0.58) {
    warnings.push('Some cards may not have been detected. Try fewer cards per photo or add manual crops.');
  }

  const acceptedOverlayBoxes = crops.map((crop) => {
    const source = candidates.find((candidate) => (
      candidate.status === 'accepted'
      && candidate.bounds.x === crop.bounds.x
      && candidate.bounds.y === crop.bounds.y
      && candidate.bounds.width === crop.bounds.width
      && candidate.bounds.height === crop.bounds.height
    ));
    return { bounds: crop.bounds, cropIndex: crop.cropIndex, generatedBy: source?.generatedBy };
  });
  const rejectedForOverlay = candidates.filter((candidate) => candidate.status === 'rejected');

  const textureValues = Array.from(textureMap);
  const sortedTexture = [...textureValues].sort((a, b) => a - b);
  const textureMean = textureValues.reduce((sum, value) => sum + value, 0) / Math.max(1, textureValues.length);
  const textureP90 = sortedTexture[Math.min(sortedTexture.length - 1, Math.floor(sortedTexture.length * 0.9))] ?? 0;
  const textureMax = sortedTexture[sortedTexture.length - 1] ?? 0;

  const sceneBackgroundCoverage = sceneBackgroundMask.reduce((sum, value) => sum + value, 0) / Math.max(1, sceneBackgroundMask.length);
  const contourCandidateCount = baseCandidates.filter((candidate) => candidate.generatedBy === 'contour').length;
  const expandedCandidateCount = postExpansionCandidates.filter((candidate) => candidate.generatedBy === 'expanded').length;

  const debug: DetectionDebugInfo = {
    sourceImageName: file.name,
    imageWidth: image.naturalWidth,
    imageHeight: image.naturalHeight,
    preFilterCandidateCount: baseCandidates.length,
    acceptedCandidateCount: suppression.accepted.length,
    contourCandidateCount,
    expandedCandidateCount,
    fallbackClusterCount,
    detectedCardCount: crops.length,
    candidateCount: candidates.length,
    rejectedCandidateCount: rejectedForOverlay.length,
    sceneBackgroundCoverage: Number(sceneBackgroundCoverage.toFixed(4)),
    textureMapStats: {
      mean: Number(textureMean.toFixed(2)),
      p90: Number(textureP90.toFixed(2)),
      max: Number(textureMax.toFixed(2)),
    },
    rejectionReasons,
    candidates,
    overlayUrl: showOverlay ? buildDebugOverlay(image, acceptedOverlayBoxes, rejectedForOverlay) : undefined,
    sceneBackgroundModel: debugEnabled
      ? {
          clusterCount: sceneBackgroundModel.clusters.length,
          dominantClusters: sceneBackgroundModel.clusters.map((cluster) => ({
            h: Number(cluster.h.toFixed(2)),
            s: Number(cluster.s.toFixed(4)),
            v: Number(cluster.v.toFixed(4)),
            weight: Number(cluster.weight.toFixed(4)),
            texture: Number(cluster.texture.toFixed(2)),
          })),
        }
      : undefined,
  };

  if (debugEnabled) {
    // Developer diagnostics for QA tuning.
    console.groupCollapsed(`[MultiCardDetection] ${file.name}`);
    console.log('sourceImageName:', debug.sourceImageName);
    console.log('image width/height:', `${debug.imageWidth}x${debug.imageHeight}`);
    console.log('detected card count:', debug.detectedCardCount);
    console.log('rejected candidate count:', debug.rejectedCandidateCount);
    console.log('contour candidate count:', debug.contourCandidateCount);
    console.log('expanded candidate count:', debug.expandedCandidateCount);
    console.log('fallback cluster count:', debug.fallbackClusterCount);
    console.log('scene background coverage:', debug.sceneBackgroundCoverage);
    console.log('texture map stats:', debug.textureMapStats);
    console.log('rejection reasons:', debug.rejectionReasons);
    console.table(crops.map((crop) => ({
      cropIndex: crop.cropIndex,
      x: crop.bounds.x,
      y: crop.bounds.y,
      width: crop.bounds.width,
      height: crop.bounds.height,
      aspectRatio: crop.aspectRatio,
      areaPercent: crop.areaPercent,
      confidence: Number(crop.confidence.toFixed(3)),
    })));
    console.groupEnd();
  }

  return {
    crops,
    warnings,
    debug,
  };
}
