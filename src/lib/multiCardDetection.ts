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
}

export interface DetectionDebugInfo {
  sourceImageName: string;
  imageWidth: number;
  imageHeight: number;
  preFilterCandidateCount?: number;
  acceptedCandidateCount?: number;
  detectedCardCount: number;
  candidateCount: number;
  rejectedCandidateCount: number;
  rejectionReasons: Record<string, number>;
  candidates: DetectionCandidateDebug[];
  overlayUrl?: string;
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

type CandidateOrigin = 'component' | 'merge' | 'split' | 'manual';

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

function shouldMergeByProximity(a: ComponentBox, b: ComponentBox): boolean {
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

function mergeNearbyBoxes(boxes: ComponentBox[]): ComponentBox[] {
  const working = [...boxes];
  let merged = true;

  while (merged) {
    merged = false;

    for (let i = 0; i < working.length; i += 1) {
      for (let j = i + 1; j < working.length; j += 1) {
        const a = working[i];
        const b = working[j];

        if (getIoU(a, b) > 0.12 || shouldMergeByProximity(a, b)) {
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
};

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

  return {
    areaPercent: area / Math.max(1, imageArea),
    aspectRatio: rawRatio,
    normalizedRatio,
    rectangularity,
    borderEdgeDensity: borderEdges / Math.max(1, borderPixels),
    interiorDensity: interiorForeground / Math.max(1, interiorPixels),
    contrastAgainstBackground: Math.abs(insideMean - outsideMean) / 255,
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
  if (metrics.contrastAgainstBackground < 0.035 && metrics.borderEdgeDensity < 0.03) {
    return { accepted: false, reason: 'mostly_background', confidence: 0, aspectRatio, areaPercent, score: 0 };
  }

  const areaScore = 1 - Math.min(1, Math.abs(areaPercent - 0.14) / 0.14);
  const aspectDistance = getClosestCardRatioDistance(normalizedRatio);
  const aspectScore = 1 - Math.min(1, aspectDistance / 0.7);
  const rectangularityScore = 1 - Math.min(1, Math.abs(metrics.rectangularity - 0.62) / 0.62);
  const borderScore = clamp(metrics.borderEdgeDensity / 0.2, 0, 1);
  const interiorScore = 1 - Math.min(1, Math.abs(metrics.interiorDensity - 0.22) / 0.22);
  const contrastScore = clamp(metrics.contrastAgainstBackground / 0.22, 0, 1);
  const backgroundPenalty = (metrics.interiorDensity < 0.08 && metrics.contrastAgainstBackground < 0.05) ? 0.35 : 0;
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

function suppressCandidates(candidates: DetectionCandidate[]): {
  accepted: DetectionCandidate[];
  suppressed: Array<{ candidate: DetectionCandidate; reason: string }>;
} {
  const sorted = [...candidates].sort((a, b) => (
    b.assessment.score - a.assessment.score
      || (b.box.width * b.box.height) - (a.box.width * a.box.height)
  ));

  const accepted: DetectionCandidate[] = [];
  const suppressed: Array<{ candidate: DetectionCandidate; reason: string }> = [];

  sorted.forEach((candidate) => {
    let rejectReason: string | null = null;

    for (const keeper of accepted) {
      const inside = insideRatio(candidate.box, keeper.box);
      const overlapSmall = overlapOverSmaller(candidate.box, keeper.box);
      const iou = getIoU(candidate.box, keeper.box);

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

function buildDebugOverlay(
  image: HTMLImageElement,
  accepted: Array<{ bounds: DetectionBounds; cropIndex: number }>,
  rejected: DetectionCandidateDebug[],
): string {
  const canvas = createCanvas(image.naturalWidth, image.naturalHeight);
  const context = canvas.getContext('2d');
  if (!context) return '';

  context.drawImage(image, 0, 0);
  context.lineWidth = Math.max(2, Math.round(Math.min(image.naturalWidth, image.naturalHeight) / 400));
  context.font = `${Math.max(14, Math.round(Math.min(image.naturalWidth, image.naturalHeight) / 45))}px sans-serif`;

  rejected.forEach((candidate, index) => {
    context.strokeStyle = 'rgba(239,68,68,0.85)';
    context.fillStyle = 'rgba(239,68,68,0.18)';
    context.fillRect(candidate.bounds.x, candidate.bounds.y, candidate.bounds.width, candidate.bounds.height);
    context.strokeRect(candidate.bounds.x, candidate.bounds.y, candidate.bounds.width, candidate.bounds.height);
    context.fillStyle = 'rgba(127,29,29,0.95)';
    context.fillText(`R${index + 1}`, candidate.bounds.x + 4, Math.max(16, candidate.bounds.y - 6));
  });

  accepted.forEach((candidate) => {
    context.strokeStyle = 'rgba(34,197,94,0.95)';
    context.fillStyle = 'rgba(34,197,94,0.15)';
    context.fillRect(candidate.bounds.x, candidate.bounds.y, candidate.bounds.width, candidate.bounds.height);
    context.strokeRect(candidate.bounds.x, candidate.bounds.y, candidate.bounds.width, candidate.bounds.height);
    context.fillStyle = 'rgba(20,83,45,0.95)';
    context.fillText(`#${candidate.cropIndex}`, candidate.bounds.x + 4, Math.max(16, candidate.bounds.y - 6));
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

  const gray = normalizeContrast(toGrayArray(workContext.getImageData(0, 0, workWidth, workHeight)));
  const denoisedGray = boxBlur(gray, workWidth, workHeight, 1, 1);
  const foregroundMask = openBinary(adaptiveForegroundMask(denoisedGray, workWidth, workHeight), workWidth, workHeight);
  const edges = closeBinary(edgeMap(denoisedGray, workWidth, workHeight), workWidth, workHeight);

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

  const mergedBoxes = mergeNearbyBoxes(components);

  const baseCandidates = mergedBoxes.map((box, index): DetectionCandidate => {
    const metrics = measureCandidateMetrics(box, denoisedGray, edges, foregroundMask, workWidth, workHeight);
    const assessment = assessCandidate(box, metrics, workWidth, workHeight, minAreaPercent);

    return {
      index,
      box,
      bounds: componentToBounds(box, scale, image.naturalWidth, image.naturalHeight),
      generatedBy: components.length === mergedBoxes.length ? 'component' : 'merge',
      assessment,
      metrics,
    };
  });

  const expandedCandidates: DetectionCandidate[] = [];
  const splitRejections: Array<{ candidate: DetectionCandidate; reason: string }> = [];

  baseCandidates.forEach((candidate) => {
    const children = splitWideCandidate(candidate.box, foregroundMask, workWidth, workHeight);
    if (children.length <= 1) {
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

  const prelimAccepted = expandedCandidates.filter((candidate) => candidate.assessment.accepted);
  const prelimRejected = expandedCandidates
    .filter((candidate) => !candidate.assessment.accepted)
    .map((candidate) => ({ candidate, reason: candidate.assessment.reason }));

  const suppression = suppressCandidates(prelimAccepted);
  const cleanedAccepted = sortReadingOrder(nonMaximumSuppression(
    suppression.accepted.map((candidate) => candidate.box),
    0.35,
  ));
  const selectedBoxes = cleanedAccepted.slice(0, hardMax);

  if (cleanedAccepted.length > hardMax) {
    warnings.push(`Detected ${cleanedAccepted.length} card-like regions; processing the first ${hardMax}.`);
  }

  const selectedSet = new Set(selectedBoxes.map((box) => computeBoxSignature(box)));

  const debugCandidatesSource: Array<{ candidate: DetectionCandidate; reason: string }> = [
    ...prelimRejected,
    ...suppression.suppressed,
    ...splitRejections,
    ...suppression.accepted.map((candidate) => ({
      candidate,
      reason: selectedSet.has(computeBoxSignature(candidate.box)) ? 'accepted' : 'suppressed_or_merged',
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
      const accepted = reason === 'accepted';
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
      };
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

  if (crops.length > 0 && crops.length < recommendedMax) {
    warnings.push('Some cards may not have been detected. Try fewer cards per photo or add manual crops.');
  }

  const averageConfidence = crops.length
    ? crops.reduce((sum, crop) => sum + crop.confidence, 0) / crops.length
    : 0;

  if (crops.length > 0 && averageConfidence < 0.58) {
    warnings.push('Some cards may not have been detected. Try fewer cards per photo or add manual crops.');
  }

  const acceptedOverlayBoxes = crops.map((crop) => ({ bounds: crop.bounds, cropIndex: crop.cropIndex }));
  const rejectedForOverlay = candidates.filter((candidate) => candidate.status === 'rejected');

  const debug: DetectionDebugInfo = {
    sourceImageName: file.name,
    imageWidth: image.naturalWidth,
    imageHeight: image.naturalHeight,
    preFilterCandidateCount: baseCandidates.length,
    acceptedCandidateCount: suppression.accepted.length,
    detectedCardCount: crops.length,
    candidateCount: candidates.length,
    rejectedCandidateCount: rejectedForOverlay.length,
    rejectionReasons,
    candidates,
    overlayUrl: showOverlay ? buildDebugOverlay(image, acceptedOverlayBoxes, rejectedForOverlay) : undefined,
  };

  if (debugEnabled) {
    // Developer diagnostics for QA tuning.
    console.groupCollapsed(`[MultiCardDetection] ${file.name}`);
    console.log('sourceImageName:', debug.sourceImageName);
    console.log('image width/height:', `${debug.imageWidth}x${debug.imageHeight}`);
    console.log('detected card count:', debug.detectedCardCount);
    console.log('rejected candidate count:', debug.rejectedCandidateCount);
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
