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
}

export interface DetectionDebugInfo {
  sourceImageName: string;
  imageWidth: number;
  imageHeight: number;
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
}

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
}

const MAX_EDGE_DIMENSION = 1400;

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
  const maxGap = Math.max(4, Math.round(minSide * 0.04));

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

  const ratio = merged.width / Math.max(1, merged.height);
  const normalizedRatio = ratio >= 1 ? ratio : 1 / Math.max(0.0001, ratio);
  if (normalizedRatio > 3.8) {
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

function assessCandidate(box: ComponentBox, imageWidth: number, imageHeight: number): CandidateAssessment {
  const imageArea = imageWidth * imageHeight;
  const area = box.width * box.height;
  const areaPercent = area / Math.max(1, imageArea);
  const rawRatio = box.width / Math.max(1, box.height);
  const aspectRatio = rawRatio;
  const normalizedRatio = rawRatio >= 1 ? rawRatio : 1 / Math.max(0.0001, rawRatio);
  const density = box.pixels / Math.max(1, area);

  if (areaPercent < 0.008) {
    return { accepted: false, reason: 'too_small', confidence: 0, aspectRatio, areaPercent };
  }
  if (areaPercent > 0.82) {
    return { accepted: false, reason: 'too_large_background', confidence: 0, aspectRatio, areaPercent };
  }
  if (box.width < imageWidth * 0.08 || box.height < imageHeight * 0.06) {
    return { accepted: false, reason: 'insufficient_dimensions', confidence: 0, aspectRatio, areaPercent };
  }
  if (normalizedRatio < 1.0 || normalizedRatio > 3.3) {
    return { accepted: false, reason: 'aspect_ratio_out_of_range', confidence: 0, aspectRatio, areaPercent };
  }
  if (density < 0.006 || density > 0.7) {
    return { accepted: false, reason: 'edge_density_out_of_range', confidence: 0, aspectRatio, areaPercent };
  }

  const areaScore = 1 - Math.min(1, Math.abs(areaPercent - 0.12) / 0.12);
  const aspectScore = 1 - Math.min(1, Math.abs(normalizedRatio - 1.75) / 1.75);
  const densityScore = 1 - Math.min(1, Math.abs(density - 0.14) / 0.14);
  const confidence = clamp(0.35 + areaScore * 0.3 + aspectScore * 0.2 + densityScore * 0.2, 0.2, 0.99);

  return {
    accepted: true,
    reason: 'accepted',
    confidence,
    aspectRatio,
    areaPercent,
  };
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
  const edges = closeBinary(edgeMap(gray, workWidth, workHeight), workWidth, workHeight);
  const components = collectConnectedComponents(edges, workWidth, workHeight);

  const evaluations = components.map((box, index) => {
    const bounds = componentToBounds(box, scale, image.naturalWidth, image.naturalHeight);
    const assessment = assessCandidate(box, workWidth, workHeight);

    return {
      index,
      box,
      bounds,
      assessment,
    };
  });

  const acceptedBoxes = evaluations
    .filter((candidate) => candidate.assessment.accepted)
    .map((candidate) => candidate.box);

  const cleanedAccepted = sortReadingOrder(nonMaximumSuppression(mergeNearbyBoxes(acceptedBoxes), 0.4));
  const selectedBoxes = cleanedAccepted.slice(0, hardMax);

  if (cleanedAccepted.length > hardMax) {
    warnings.push(`Detected ${cleanedAccepted.length} card-like regions; processing the first ${hardMax}.`);
  }

  const selectedSet = new Set(selectedBoxes.map((box) => `${box.x}:${box.y}:${box.width}:${box.height}:${box.pixels}`));
  const candidates: DetectionCandidateDebug[] = evaluations.map((evaluation) => {
    const fingerprint = `${evaluation.box.x}:${evaluation.box.y}:${evaluation.box.width}:${evaluation.box.height}:${evaluation.box.pixels}`;
    const accepted = evaluation.assessment.accepted && selectedSet.has(fingerprint);
    const reason = accepted
      ? 'accepted'
      : (evaluation.assessment.accepted ? 'suppressed_or_merged' : evaluation.assessment.reason);

    return {
      index: evaluation.index,
      status: accepted ? 'accepted' : 'rejected',
      reason,
      bounds: evaluation.bounds,
      aspectRatio: Number(evaluation.assessment.aspectRatio.toFixed(3)),
      areaPercent: Number((evaluation.assessment.areaPercent * 100).toFixed(3)),
      confidence: Number(evaluation.assessment.confidence.toFixed(3)),
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
    )?.confidence ?? 0.6;

    const warningsForCrop: string[] = [];
    if (normalizedRatio < 1.0 || normalizedRatio > 3.3) {
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

  if (crops.length > 0 && averageConfidence < 0.62) {
    warnings.push('Some cards may not have been detected. Try fewer cards per photo or add manual crops.');
  }

  const acceptedOverlayBoxes = crops.map((crop) => ({ bounds: crop.bounds, cropIndex: crop.cropIndex }));
  const rejectedForOverlay = candidates.filter((candidate) => candidate.status === 'rejected');

  const debug: DetectionDebugInfo = {
    sourceImageName: file.name,
    imageWidth: image.naturalWidth,
    imageHeight: image.naturalHeight,
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
