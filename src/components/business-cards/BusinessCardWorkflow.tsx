import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, RotateCw, ShieldCheck, Trash2, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { DataReview } from '@/components/DataReview';
import { ExportSidebar } from '@/components/ExportSidebar';
import { ImageCapture, BusinessCardCaptureMode, QueuedCapture } from '@/components/ImageCapture';
import { ScanToSheetLoadingAnimation } from '@/components/ScanToSheetLoadingAnimation';
import { SettingsMenu } from '@/components/SettingsMenu';
import { SessionBanner } from '@/components/business-cards/SessionBanner';
import {
  clearSession,
  fileToImageRecord,
  imageRecordToFile,
  loadSession,
  saveSession,
  type ImageRecord,
  type LocalDraftSession,
  type SerializedBatchItem,
  type SerializedCardSide,
} from '@/lib/sessionStore';
import { getSessionSettings } from '@/lib/sessionSettings';
import {
  BatchCardItem,
  BatchProgressSnapshot,
  BusinessCardEntry,
  CardImageSide,
  ScanMode,
} from '@/types/scan';
import {
  createEmptyBusinessCard,
  extractBusinessCardBatch,
  extractBusinessCardRecord,
  getDefaultBatchConcurrency,
} from '@/lib/extraction';
import {
  exportData,
  getBusinessCardExportColumnGroups,
  type ExportFormat,
} from '@/lib/export';
import { detectBusinessCardCrops, type DetectionDebugInfo } from '@/lib/multiCardDetection';
import { CropModal } from '@/components/business-cards/CropModal';
import { ManualEntryModal } from '@/components/business-cards/ManualEntryModal';
import { ExportPreviewModal } from '@/components/business-cards/ExportPreviewModal';
import { toast } from 'sonner';
import {
  runBatchAnalysis,
  buildBatchCorrectionSuggestions,
  addCorrectionRule,
  analyzeBatch,
  type BatchCorrectionSuggestion,
} from '@/lib/batchBusinessCardResolver';
import { validateBatch } from '@/lib/exportValidation';
import { BatchCorrectionRule, ScanSessionCorrections } from '@/types/scan';

type Step = 'capture' | 'batch-queue' | 'processing' | 'batch-processing' | 'review';
type BusinessCardFilter = 'all' | 'needs_review' | 'complete' | 'failed';

const emptySnapshot: BatchProgressSnapshot = {
  total: 0,
  queued: 0,
  processing: 0,
  done: 0,
  failed: 0,
  needsReview: 0,
};

interface BusinessCardWorkflowProps {
  mode: BusinessCardCaptureMode;
  title: string;
  subtitle: string;
}

interface CardBatch {
  id: string;
  sourceImageName: string;
  sourceImageUrl?: string;
  scanMode: ScanMode;
  detectedCount: number;
  createdAt: string;
}

interface WorkflowDetectedCardCrop {
  id: string;
  sourceImageId: string;
  sourceImageName: string;
  sourceImageUrl?: string;
  cropIndex: number;
  cropImageUrl: string;
  confidence: number;
  aspectRatio: number;
  areaPercent: number;
  warnings: string[];
  queueItemId: string;
  manualCrop?: boolean;
}

function makeCardImageSide(capture: QueuedCapture): CardImageSide {
  return {
    file: capture.file,
    previewUrl: capture.previewUrl,
    filename: capture.file.name,
    sourceType: capture.sourceType,
  };
}

function inferPairKey(filename?: string): string | null {
  if (!filename) return null;
  const base = filename.replace(/\.[^.]+$/, '').toLowerCase();
  const cleaned = base
    .replace(/(?:^|[_\-\s])(front|back|sidea|sideb|f|b)(?:[_\-\s]|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

export function BusinessCardWorkflow({ mode, title, subtitle }: BusinessCardWorkflowProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('capture');
  const [scanMode, setScanMode] = useState<ScanMode>('single-card');
  const [data, setData] = useState<BusinessCardEntry[]>([]);
  const [batchQueue, setBatchQueue] = useState<BatchCardItem[]>([]);
  const [batchSessionRows, setBatchSessionRows] = useState<BusinessCardEntry[]>([]);
  const [detectedCardCrops, setDetectedCardCrops] = useState<WorkflowDetectedCardCrop[]>([]);
  const [detectionDebugBySource, setDetectionDebugBySource] = useState<Record<string, DetectionDebugInfo>>({});
  const sourceCaptureRef = useRef<Map<string, QueuedCapture>>(new Map());
  const [showDeveloperDebugOverlay, setShowDeveloperDebugOverlay] = useState(Boolean(import.meta.env.DEV));
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropModalSource, setCropModalSource] = useState<{
    batchId: string;
    sourceImageUrl: string;
    sourceImageName: string;
    nextCropIndex: number;
  } | null>(null);
  const [manualEntryModalOpen, setManualEntryModalOpen] = useState(false);
  const [manualEntrySource, setManualEntrySource] = useState<{
    batchId: string;
    sourceImageName: string;
    sourceImageId: string;
    sourceImageUrl?: string;
  } | null>(null);
  const [isAddingManualCrop, setIsAddingManualCrop] = useState(false);
  const [isAddingManualEntry, setIsAddingManualEntry] = useState(false);
  const [cardBatches, setCardBatches] = useState<CardBatch[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgressSnapshot>(emptySnapshot);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [singleCardDraft, setSingleCardDraft] = useState<BatchCardItem | null>(null);
  const [rapidPendingCardId, setRapidPendingCardId] = useState<string | null>(null);
  const [businessCardFilter, setBusinessCardFilter] = useState<BusinessCardFilter>('all');
  // Phase 3 state
  const [sessionCorrections, setSessionCorrections] = useState<ScanSessionCorrections>({ rules: [] });
  const [focusedCardId, setFocusedCardId] = useState<string | null>(null);
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [batchCorrectionSuggestions, setBatchCorrectionSuggestions] = useState<Record<string, BatchCorrectionSuggestion[]>>({});
  const [exportFormatSelection, setExportFormatSelection] = useState<Record<ExportFormat, boolean>>({
    xlsx: true,
    csv: false,
    tsv: false,
    json: false,
    md: false,
  });
  const [exportColumnSelection, setExportColumnSelection] = useState<Record<string, boolean>>({});
  const [showAdvancedExportColumns, setShowAdvancedExportColumns] = useState(false);

  const exportColumnGroups = useMemo(
    () => getBusinessCardExportColumnGroups(data),
    [data],
  );

  const availableExportColumns = useMemo(
    () => showAdvancedExportColumns
      ? [...exportColumnGroups.defaultColumns, ...exportColumnGroups.advancedColumns]
      : exportColumnGroups.defaultColumns,
    [showAdvancedExportColumns, exportColumnGroups],
  );

  const selectedExportColumns = useMemo(
    () => availableExportColumns.filter((column) => exportColumnSelection[column] !== false),
    [availableExportColumns, exportColumnSelection],
  );

  const selectedExportFormats = useMemo(
    () => (Object.entries(exportFormatSelection) as Array<[ExportFormat, boolean]>)
      .filter(([, included]) => included)
      .map(([format]) => format),
    [exportFormatSelection],
  );

  useEffect(() => {
    setExportColumnSelection((prev) => {
      const next: Record<string, boolean> = {};
      exportColumnGroups.allColumns.forEach((column) => {
        next[column] = prev[column] ?? exportColumnGroups.defaultColumns.includes(column);
      });
      return next;
    });
  }, [exportColumnGroups]);

  // ── Session persistence ───────────────────────────────────────────────────
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const sessionCreatedAtRef = useRef<string>(new Date().toISOString());
  const persistedImageKeysRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pendingSession, setPendingSession] = useState<LocalDraftSession | null>(null);
  const [sessionInitialized, setSessionInitialized] = useState(false);

  const singleBackInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setBatchSessionRows(data);
  }, [data]);

  // ── Session init: check for recoverable session on mount ─────────────────
  useEffect(() => {
    const settings = getSessionSettings();
    if (!settings.resumeUnfinishedSessions) {
      setSessionInitialized(true);
      return;
    }
    loadSession()
      .then((result) => {
        if (result && result.session.mode === mode) {
          if (import.meta.env.DEV) {
            console.debug('[ScanMode] route-load — pending session found', {
              storedScanMode: result.session.scanMode ?? null,
              sessionId: result.session.id,
              route: window.location.pathname,
            });
          }
          setPendingSession(result.session);
        }
        setSessionInitialized(true);
      })
      .catch(() => setSessionInitialized(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-save: debounced save on meaningful state changes ─────────────────
  // Skip during active processing to avoid partial state snapshots.
  useEffect(() => {
    if (!sessionInitialized || isBatchProcessing) return;
    if (step === 'processing' || step === 'batch-processing') return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      (async () => {
        try {
          // Collect images that haven't been stored yet.
          const newImages: ImageRecord[] = [];

          const serializedQueue: SerializedBatchItem[] = await Promise.all(
            batchQueue.map(async (item) => {
              const serializeSide = async (
                side: (typeof item)['front'],
                sideLabel: 'front' | 'back',
              ): Promise<SerializedCardSide> => {
                const key = `${item.id}-${sideLabel}`;
                if (!persistedImageKeysRef.current.has(key)) {
                  try {
                    const record = await fileToImageRecord(key, side.file);
                    newImages.push(record);
                    persistedImageKeysRef.current.add(key);
                  } catch {
                    // file may no longer be accessible — skip
                  }
                }
                return { imageKey: key, filename: side.filename, sourceType: side.sourceType };
              };

              return {
                id: item.id,
                front: await serializeSide(item.front, 'front'),
                back: item.back ? await serializeSide(item.back, 'back') : undefined,
                sourceImageId: item.sourceImageId,
                sourceImageName: item.sourceImageName,
                sourceImageUrl: item.sourceImageUrl,
                cropIndex: item.cropIndex,
                scanMode: item.scanMode,
                confidence: item.confidence,
                warnings: item.warnings,
                status: item.status,
                error: item.error,
                extractedRows: item.extractedRows,
                needsReview: item.needsReview,
                index: item.index,
                manualCrop: item.manualCrop,
                manualEntry: item.manualEntry,
                manualCropBounds: item.manualCropBounds,
              };
            }),
          );

          const draft: LocalDraftSession = {
            id: sessionIdRef.current,
            mode,
            scanMode,
            step,
            batchQueue: serializedQueue,
            data,
            rapidPendingCardId,
            createdAt: sessionCreatedAtRef.current,
            updatedAt: new Date().toISOString(),
          };

          await saveSession(draft, newImages);
        } catch {
          // Session save errors are non-fatal — silent.
        }
      })();
    }, 800);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionInitialized, step, batchQueue, data, rapidPendingCardId, isBatchProcessing, mode, scanMode]);

  // ── Resume handler ────────────────────────────────────────────────────────
  const handleResumeSession = useCallback(async () => {
    if (!pendingSession) return;
    setPendingSession(null);

    const stored = await loadSession().catch(() => null);
    if (!stored) return;

    const { session, images } = stored;

    const rebuiltQueue: BatchCardItem[] = await Promise.all(
      session.batchQueue.map(async (item) => {
        const rebuildSide = async (
          side: SerializedCardSide,
        ): Promise<CardImageSide> => {
          const record = images.get(side.imageKey);
          if (record) {
            const file = imageRecordToFile(record);
            const previewUrl = URL.createObjectURL(file);
            return { file, previewUrl, filename: side.filename, sourceType: side.sourceType };
          }
          // Image bytes missing — create a placeholder file.
          const file = new File([], side.filename ?? 'card.jpg', { type: 'image/jpeg' });
          return { file, previewUrl: '', filename: side.filename, sourceType: side.sourceType };
        };

        return {
          id: item.id,
          front: await rebuildSide(item.front),
          back: item.back ? await rebuildSide(item.back) : undefined,
          sourceImageId: item.sourceImageId,
          sourceImageName: item.sourceImageName,
          sourceImageUrl: item.sourceImageUrl,
          cropIndex: item.cropIndex,
          scanMode: item.scanMode,
          confidence: item.confidence,
          warnings: item.warnings,
          status: item.status,
          error: item.error,
          extractedRows: item.extractedRows,
          needsReview: item.needsReview,
          index: item.index,
          manualCrop: item.manualCrop,
          manualEntry: item.manualEntry,
          manualCropBounds: item.manualCropBounds,
        };
      }),
    );

    // Mark all image keys as already persisted so they aren't re-uploaded.
    session.batchQueue.forEach((item) => {
      persistedImageKeysRef.current.add(item.front.imageKey);
      if (item.back) persistedImageKeysRef.current.add(item.back.imageKey);
    });

    sessionIdRef.current = session.id;
    sessionCreatedAtRef.current = session.createdAt;

    // Infer scanMode: prefer the stored value; for legacy sessions without it,
    // derive from queue items so a multi-card session is never silently
    // downgraded to single-card mode.
    const inferredScanMode: ScanMode =
      session.scanMode ??
      (rebuiltQueue.some((item) => item.scanMode === 'multi-card') ? 'multi-card' : 'single-card');

    if (import.meta.env.DEV) {
      console.debug('[ScanMode] session-hydration', {
        previousScanMode: 'single-card',
        nextScanMode: inferredScanMode,
        source: 'session-resume',
        storedScanMode: session.scanMode ?? null,
        queueSize: rebuiltQueue.length,
        multiCardItems: rebuiltQueue.filter((i) => i.scanMode === 'multi-card').length,
        sessionId: session.id,
        route: window.location.pathname,
      });
    }

    setBatchQueue(rebuiltQueue);
    setScanMode(inferredScanMode);
    setData(session.data);
    setBatchSessionRows(session.data);
    setDetectedCardCrops(
      rebuiltQueue
        .filter((item) => item.scanMode === 'multi-card')
        .map((item) => ({
          id: crypto.randomUUID(),
          sourceImageId: item.sourceImageId ?? item.id,
          sourceImageName: item.sourceImageName ?? item.front.filename ?? 'photo',
          sourceImageUrl: item.sourceImageUrl,
          cropIndex: item.cropIndex ?? 1,
          cropImageUrl: item.front.previewUrl,
          confidence: item.confidence ?? 0,
          aspectRatio: 0,
          areaPercent: 0,
          warnings: item.warnings ?? [],
          queueItemId: item.id,
          manualCrop: item.manualCrop,
        })),
    );
    setCardBatches(Array.from(new Map(
      rebuiltQueue
        .filter((item) => item.sourceImageId)
        .map((item) => [
          item.sourceImageId as string,
          {
            id: item.sourceImageId as string,
            sourceImageName: item.sourceImageName ?? item.front.filename ?? 'photo',
            sourceImageUrl: item.sourceImageUrl,
            scanMode: item.scanMode ?? 'single-card',
            detectedCount: rebuiltQueue.filter((candidate) => candidate.sourceImageId === item.sourceImageId).length,
            createdAt: session.createdAt,
          } satisfies CardBatch,
        ]),
    ).values()));
    setRapidPendingCardId(session.rapidPendingCardId);
    // Restore to batch-queue step so the user can review before re-processing.
    const restoredStep: Step =
      session.step === 'batch-processing' || session.step === 'processing'
        ? 'batch-queue'
        : session.step;
    setStep(restoredStep);

    toast.success('Session restored. Review your queue and continue.');
  }, [pendingSession]);

  const handleResumeToQueue = useCallback(async () => {
    await handleResumeSession();
    setStep('batch-queue');
  }, [handleResumeSession]);

  const handleDiscardSession = useCallback(async () => {
    setPendingSession(null);
    await clearSession().catch(() => null);
    persistedImageKeysRef.current.clear();
    sessionIdRef.current = crypto.randomUUID();
    sessionCreatedAtRef.current = new Date().toISOString();
    setCardBatches([]);
    setDetectedCardCrops([]);
    setDetectionDebugBySource({});
    sourceCaptureRef.current.clear();
    setBatchSessionRows([]);
  }, []);

  // ── Clear session action ──────────────────────────────────────────────────
  const handleClearSession = useCallback(async () => {
    await clearSession().catch(() => null);
    persistedImageKeysRef.current.clear();
    sessionIdRef.current = crypto.randomUUID();
    sessionCreatedAtRef.current = new Date().toISOString();
    setCardBatches([]);
    setDetectedCardCrops([]);
    setDetectionDebugBySource({});
    sourceCaptureRef.current.clear();
    setBatchSessionRows([]);
    toast.success('Session cleared.');
  }, []);

  const revokeSidePreview = useCallback((side?: CardImageSide) => {
    if (!side?.previewUrl) return;
    try {
      URL.revokeObjectURL(side.previewUrl);
    } catch {
      // Ignore URL cleanup errors.
    }
  }, []);

  const revokeQueuePreviewUrls = useCallback((items: BatchCardItem[]) => {
    items.forEach((item) => {
      revokeSidePreview(item.front);
      revokeSidePreview(item.back);
    });
  }, [revokeSidePreview]);

  const buildReviewRowsFromQueue = useCallback((queue: BatchCardItem[]) => {
    const rows: BusinessCardEntry[] = [];

    queue.forEach((item) => {
      if (item.extractedRows.length > 0) {
        rows.push(...item.extractedRows.map((row) => ({
          ...row,
          sourceLabel: row.sourceLabel ?? item.front.filename ?? `Card ${item.index + 1}`,
          sourceItemId: row.sourceItemId ?? item.id,
          sourceCardId: row.sourceCardId ?? item.id,
          sourceImageId: row.sourceImageId ?? item.sourceImageId,
          sourceImageName: row.sourceImageName ?? item.sourceImageName,
          sourceImageUrl: row.sourceImageUrl ?? item.sourceImageUrl,
          cropIndex: row.cropIndex ?? item.cropIndex,
          cropImageUrl: row.cropImageUrl ?? item.front.previewUrl,
          scanMode: row.scanMode ?? item.scanMode ?? 'single-card',
          confidence: row.confidence ?? item.confidence,
          warnings: [...(item.warnings ?? []), ...(row.warnings ?? [])],
          sourceType: row.sourceType ?? item.front.sourceType,
          hasBack: row.hasBack ?? Boolean(item.back),
          frontPreviewUrl: row.frontPreviewUrl ?? item.front.previewUrl,
          backPreviewUrl: row.backPreviewUrl ?? item.back?.previewUrl,
          manualCrop: row.manualCrop ?? item.manualCrop,
          manualEntry: row.manualEntry ?? item.manualEntry,
          manualCropBounds: row.manualCropBounds ?? item.manualCropBounds,
        })));
        return;
      }

      if (item.status === 'failed') {
        rows.push({
          ...createEmptyBusinessCard(),
          sourceLabel: item.front.filename || `Card ${item.index + 1}`,
          sourceItemId: item.id,
          sourceCardId: item.id,
          sourceImageId: item.sourceImageId,
          sourceImageName: item.sourceImageName,
          sourceImageUrl: item.sourceImageUrl,
          cropIndex: item.cropIndex,
          cropImageUrl: item.front.previewUrl,
          scanMode: item.scanMode ?? 'single-card',
          confidence: item.confidence,
          warnings: item.warnings,
          sourceType: item.front.sourceType,
          hasBack: Boolean(item.back),
          frontPreviewUrl: item.front.previewUrl,
          backPreviewUrl: item.back?.previewUrl,
          needsReview: true,
          status: 'failed',
          error: item.error || 'Extraction failed',
          manualCrop: item.manualCrop,
          manualEntry: item.manualEntry,
          manualCropBounds: item.manualCropBounds,
        });
      }
    });

    return rows;
  }, []);

  const queueMultiCardCapture = useCallback(async (capture: QueuedCapture, sourceImageIdOverride?: string) => {
    const sourceImageId = sourceImageIdOverride ?? crypto.randomUUID();
    setIsDetecting(true);
    sourceCaptureRef.current.set(sourceImageId, capture);

    if (import.meta.env.DEV) {
      console.debug('[ScanMode] before-detection', {
        scanMode,
        file: capture.file.name,
        sourceImageId,
        sessionId: sessionIdRef.current,
        route: window.location.pathname,
      });
    }

    try {
      const detection = await detectBusinessCardCrops(capture.file, {
        maxCards: 6,
        hardMaxCards: 12,
        debug: Boolean(import.meta.env.DEV),
        enableDebugOverlay: showDeveloperDebugOverlay,
      });
      const detectionWarnings = [...detection.warnings];

      setDetectionDebugBySource((current) => ({
        ...current,
        [sourceImageId]: detection.debug,
      }));

      const nextBatch: CardBatch = {
        id: sourceImageId,
        sourceImageName: capture.file.name,
        sourceImageUrl: capture.previewUrl,
        scanMode: 'multi-card',
        detectedCount: Math.max(1, detection.debug.detectedCardCount),
        createdAt: new Date().toISOString(),
      };

      setCardBatches((current) => {
        const withoutExisting = current.filter((batch) => batch.id !== sourceImageId);
        return [...withoutExisting, nextBatch];
      });

      setBatchQueue((current) => current
        .filter((item) => item.sourceImageId !== sourceImageId)
        .map((item, index) => ({ ...item, index })));
      setDetectedCardCrops((current) => current.filter((crop) => crop.sourceImageId !== sourceImageId));

      if (detectionWarnings.length > 0) {
        detectionWarnings.forEach((warning) => toast.warning(warning));
      }

      if (detection.crops.length === 0) {
        const fallbackCardId = crypto.randomUUID();
        setBatchQueue((current) => [
          ...current,
          {
            id: fallbackCardId,
            front: makeCardImageSide(capture),
            sourceImageId,
            sourceImageName: capture.file.name,
            sourceImageUrl: capture.previewUrl,
            cropIndex: 1,
            scanMode: 'multi-card',
            warnings: ['Detection fallback: processed full image as a single card.'],
            confidence: 0.35,
            status: 'queued',
            error: undefined,
            extractedRows: [],
            needsReview: true,
            index: current.length,
          },
        ].map((item, index) => ({ ...item, index })));
        return;
      }

      const queueItems: BatchCardItem[] = detection.crops.map((crop) => ({
        id: crypto.randomUUID(),
        front: {
          file: crop.file,
          previewUrl: crop.previewUrl,
          filename: crop.file.name,
          sourceType: capture.sourceType,
        },
        sourceImageId,
        sourceImageName: capture.file.name,
        sourceImageUrl: capture.previewUrl,
        cropIndex: crop.cropIndex,
        scanMode: 'multi-card',
        warnings: [...detectionWarnings, ...crop.warnings],
        confidence: crop.confidence,
        status: 'queued',
        error: undefined,
        extractedRows: [],
        needsReview: crop.warnings.length > 0,
        index: 0,
        manualCrop: crop.manualCrop,
      }));

      setBatchQueue((current) => [...current, ...queueItems].map((item, index) => ({ ...item, index })));
      setDetectedCardCrops((current) => [
        ...current,
        ...detection.crops.map((crop, index) => ({
          id: crop.id,
          sourceImageId,
          sourceImageName: capture.file.name,
          sourceImageUrl: capture.previewUrl,
          cropIndex: crop.cropIndex,
          cropImageUrl: crop.previewUrl,
          confidence: crop.confidence,
          aspectRatio: crop.aspectRatio,
          areaPercent: crop.areaPercent,
          warnings: [...detectionWarnings, ...crop.warnings],
          queueItemId: queueItems[index].id,
        })),
      ]);
    } catch {
      toast.error(`Unable to detect cards in ${capture.file.name}. Falling back to single-card extraction.`);
      const fallbackCardId = crypto.randomUUID();
      setBatchQueue((current) => [
        ...current,
        {
          id: fallbackCardId,
          front: makeCardImageSide(capture),
          sourceImageId,
          sourceImageName: capture.file.name,
          sourceImageUrl: capture.previewUrl,
          cropIndex: 1,
          scanMode: 'multi-card',
          warnings: ['Detection failed: processed full image as a single card.'],
          confidence: 0.3,
          status: 'queued',
          error: undefined,
          extractedRows: [],
          needsReview: true,
          index: current.length,
        },
      ].map((item, index) => ({ ...item, index })));
      setCardBatches((current) => {
        const withoutExisting = current.filter((batch) => batch.id !== sourceImageId);
        return [
          ...withoutExisting,
          {
            id: sourceImageId,
            sourceImageName: capture.file.name,
            sourceImageUrl: capture.previewUrl,
            scanMode: 'multi-card',
            detectedCount: 1,
            createdAt: new Date().toISOString(),
          },
        ];
      });
    } finally {
      setIsDetecting(false);
    }
  }, [showDeveloperDebugOverlay]);

  const rerunDetectionForSource = useCallback(async (sourceImageId: string) => {
    const capture = sourceCaptureRef.current.get(sourceImageId);
    if (!capture) {
      toast.error('Original image file is not available for re-run in this session.');
      return;
    }

    toast.info(`Re-running detection for ${capture.file.name}...`);
    await queueMultiCardCapture(capture, sourceImageId);
  }, [queueMultiCardCapture]);

  const handleAddManualCrop = useCallback((batchId: string) => {
    const batch = cardBatches.find((b) => b.id === batchId);
    if (!batch) return;

    const crops = detectedCardCrops.filter((c) => c.sourceImageId === batchId) ?? [];
    const nextIndex = Math.max(
      ...(crops.map((c) => c.cropIndex) ?? []),
      -1,
    ) + 1;

    setCropModalSource({
      batchId,
      sourceImageUrl: batch.sourceImageUrl || '',
      sourceImageName: batch.sourceImageName,
      nextCropIndex: nextIndex,
    });
    setCropModalOpen(true);
  }, [cardBatches, detectedCardCrops]);

  const handleConfirmManualCrop = useCallback(
    async (cropData: {
      cropImageBlob: Blob;
      cropIndex: number;
      bounds: { x: number; y: number; width: number; height: number };
    }) => {
      if (!cropModalSource) return;

      setIsAddingManualCrop(true);
      try {
        const cropFile = new File(
          [cropData.cropImageBlob],
          `manual-crop-${cropData.cropIndex}.jpg`,
          { type: 'image/jpeg' },
        );

        const previewUrl = URL.createObjectURL(cropFile);
        const cropId = `manual-crop-${Date.now()}-${Math.random()}`;

        // Add to detected crops
        const newCrop: WorkflowDetectedCardCrop = {
          id: cropId,
          sourceImageId: cropModalSource.batchId,
          sourceImageName: cropModalSource.sourceImageName,
          sourceImageUrl: cropModalSource.sourceImageUrl,
          cropIndex: cropData.cropIndex,
          cropImageUrl: previewUrl,
          confidence: 0, // Manual crops have 0 confidence (user-verified)
          aspectRatio: cropData.bounds.width / cropData.bounds.height,
          areaPercent:
            (cropData.bounds.width * cropData.bounds.height) /
            (100 * 100),
          warnings: ['Manually added crop'],
          queueItemId: `batch-${cropModalSource.batchId}-${cropData.cropIndex}`,
          manualCrop: true,
        };

        setDetectedCardCrops((prev) => [...prev, newCrop]);

        // Queue the crop for extraction
        const queueItem: BatchCardItem = {
          id: newCrop.queueItemId,
          front: {
            file: cropFile,
            previewUrl,
            filename: cropFile.name,
            sourceType: 'upload',
          },
          sourceImageId: cropModalSource.batchId,
          sourceImageName: cropModalSource.sourceImageName,
          sourceImageUrl: cropModalSource.sourceImageUrl,
          cropIndex: cropData.cropIndex,
          scanMode: 'multi-card',
          confidence: 0,
          warnings: ['Manually added crop'],
          manualCrop: true,
          manualCropBounds: cropData.bounds,
          status: 'queued',
          extractedRows: [],
          needsReview: false,
          index: batchQueue.length,
        };

        setBatchQueue((prev) => [...prev, queueItem].map((item, index) => ({ ...item, index })));
        toast.success(
          `Manual crop added as Crop ${cropData.cropIndex}. Ready for processing.`,
        );
      } catch (error) {
        console.error('Error adding manual crop:', error);
        toast.error('Failed to add manual crop');
      } finally {
        setIsAddingManualCrop(false);
        setCropModalOpen(false);
      }
    },
    [cropModalSource, batchQueue.length],
  );

  const handleAddManualEntry = useCallback((batchId: string) => {
    const batch = cardBatches.find((b) => b.id === batchId);
    if (!batch) return;

    setManualEntrySource({
      batchId,
      sourceImageName: batch.sourceImageName,
      sourceImageId: batch.id,
      sourceImageUrl: batch.sourceImageUrl,
    });
    setManualEntryModalOpen(true);
  }, [cardBatches]);

  const handleConfirmManualEntry = useCallback(
    async (entryData: {
      fullName: string;
      firstName: string;
      lastName: string;
      company: string;
      title: string;
      email: string;
      phone: string;
      website: string;
      address: string;
    }) => {
      if (!manualEntrySource) return;

      setIsAddingManualEntry(true);
      try {
        const entryId = `manual-entry-${Date.now()}-${Math.random()}`;
        const nextManualIndex = Math.max(
          ...batchQueue
            .filter((item) => item.sourceImageId === manualEntrySource.sourceImageId)
            .map((item) => item.cropIndex ?? -1),
          -1,
        ) + 1;

        // Create a blank business card entry with manual data
        const newEntry: BusinessCardEntry = {
          id: entryId,
          fullName: entryData.fullName,
          firstName: entryData.firstName,
          lastName: entryData.lastName,
          company: entryData.company,
          title: entryData.title,
          email: entryData.email,
          phone: entryData.phone,
          website: entryData.website,
          address: entryData.address,
          sourceImageId: manualEntrySource.sourceImageId,
          sourceImageName: manualEntrySource.sourceImageName,
          sourceImageUrl: manualEntrySource.sourceImageUrl,
          cropIndex: nextManualIndex,
          scanMode: 'multi-card',
          manualEntry: true,
          status: 'needs_review',
          needsReview: true,
          warnings: ['Manual entry added by user'],
          rawText: '',
          extraFields: {},
          social: '',
          confidence: 0,
        };

        // Create a queue item for the manual entry
        const queueItem: BatchCardItem = {
          id: entryId,
          front: {
            file: new File([], 'manual-entry.txt'),
            previewUrl: '',
            filename: 'manual-entry',
            sourceType: 'upload',
          },
          sourceImageId: manualEntrySource.sourceImageId,
          sourceImageName: manualEntrySource.sourceImageName,
          sourceImageUrl: manualEntrySource.sourceImageUrl,
          cropIndex: nextManualIndex,
          scanMode: 'multi-card',
          manualEntry: true,
          warnings: ['Manual entry added by user'],
          status: 'done', // Manual entries skip extraction
          extractedRows: [newEntry],
          needsReview: true,
          index: batchQueue.length,
        };

        setBatchQueue((prev) => [...prev, queueItem].map((item, index) => ({ ...item, index })));
        toast.success('Manual entry created. Review and edit in the review screen.');
      } catch (error) {
        console.error('Error adding manual entry:', error);
        toast.error('Failed to add manual entry');
      } finally {
        setIsAddingManualEntry(false);
        setManualEntryModalOpen(false);
      }
    },
    [manualEntrySource, batchQueue],
  );

  const addCapturesToQueue = useCallback((captures: QueuedCapture[]) => {
    if (captures.length === 0) return;

    if (mode === 'rapid') {
      let nextPending = rapidPendingCardId;

      setBatchQueue((current) => {
        const next = [...current];

        captures.forEach((capture) => {
          if (nextPending) {
            const pendingIdx = next.findIndex((item) => item.id === nextPending && !item.back);
            if (pendingIdx >= 0) {
              next[pendingIdx] = {
                ...next[pendingIdx],
                back: makeCardImageSide(capture),
              };
              nextPending = null;
              return;
            }
          }

          const newCardId = crypto.randomUUID();
          next.push({
            id: newCardId,
            front: makeCardImageSide(capture),
            status: 'queued',
            error: undefined,
            extractedRows: [],
            needsReview: false,
            index: next.length,
          });
          nextPending = newCardId;
        });

        return next.map((item, index) => ({ ...item, index }));
      });

      setRapidPendingCardId(nextPending);
      return;
    }

    if (mode === 'multi-upload') {
      if (scanMode === 'multi-card') {
        void (async () => {
          for (const capture of captures) {
            // Process each photo in order so crop indices remain stable for review and export.
            // eslint-disable-next-line no-await-in-loop
            await queueMultiCardCapture(capture);
          }
          toast.success(`Detection complete for ${captures.length} photo${captures.length === 1 ? '' : 's'}.`);
        })();
        return;
      }

      const createdBatches = captures.map((capture) => ({
        id: crypto.randomUUID(),
        sourceImageName: capture.file.name,
        sourceImageUrl: capture.previewUrl,
        scanMode: 'single-card' as const,
        detectedCount: 1,
        createdAt: new Date().toISOString(),
      }));

      setCardBatches((current) => ([
        ...current,
        ...createdBatches,
      ]));

      setBatchQueue((current) => {
        const next = [...current];

        captures.forEach((capture, captureIndex) => {
          const side = makeCardImageSide(capture);
          const key = inferPairKey(capture.file.name);
          const isLikelyBack = /(?:^|[_\-\s])(back|sideb|b)(?:[_\-\s]|$)/i.test(capture.file.name);

          if (key && isLikelyBack) {
            const pairIndex = next.findIndex((item) => !item.back && inferPairKey(item.front.filename) === key);
            if (pairIndex >= 0) {
              next[pairIndex] = { ...next[pairIndex], back: side };
              return;
            }
          }

          next.push({
            id: crypto.randomUUID(),
            front: side,
            sourceImageId: createdBatches[captureIndex].id,
            sourceImageName: capture.file.name,
            sourceImageUrl: capture.previewUrl,
            cropIndex: 1,
            scanMode: 'single-card',
            status: 'queued',
            error: undefined,
            extractedRows: [],
            needsReview: false,
            index: next.length,
          });
        });

        return next.map((item, index) => ({ ...item, index }));
      });

      return;
    }

    const capture = captures[0];
    if (!capture) return;
    const card: BatchCardItem = {
      id: crypto.randomUUID(),
      front: makeCardImageSide(capture),
      sourceImageName: capture.file.name,
      sourceImageUrl: capture.previewUrl,
      cropIndex: 1,
      scanMode: 'single-card',
      status: 'queued',
      error: undefined,
      extractedRows: [],
      needsReview: false,
      index: 0,
    };
    setSingleCardDraft(card);
    toast.info('Front captured. Does this card have a back?');
  }, [mode, rapidPendingCardId, scanMode, queueMultiCardCapture]);

  const skipRapidBack = useCallback(() => {
    if (!rapidPendingCardId) return;
    setRapidPendingCardId(null);
    toast.info('Back skipped. Capture next card front.');
  }, [rapidPendingCardId]);

  const removeBatchItem = useCallback((id: string) => {
    setBatchQueue((current) => {
      const target = current.find((item) => item.id === id);
      if (target) {
        revokeSidePreview(target.front);
        revokeSidePreview(target.back);
      }

      const nextQueue = current
        .filter((item) => item.id !== id)
        .map((item, index) => ({ ...item, index }));

      const sourceIds = new Set(
        nextQueue
          .map((item) => item.sourceImageId)
          .filter((value): value is string => Boolean(value)),
      );
      setCardBatches((batches) => batches.filter((batch) => sourceIds.has(batch.id)));
      setDetectionDebugBySource((current) => Object.fromEntries(
        Object.entries(current).filter(([sourceId]) => sourceIds.has(sourceId)),
      ));

      Array.from(sourceCaptureRef.current.keys()).forEach((sourceId) => {
        if (!sourceIds.has(sourceId)) {
          sourceCaptureRef.current.delete(sourceId);
        }
      });

      return nextQueue;
    });

    setDetectedCardCrops((current) => current.filter((crop) => crop.queueItemId !== id));

    if (rapidPendingCardId === id) {
      setRapidPendingCardId(null);
    }
  }, [rapidPendingCardId, revokeSidePreview]);

  const updateCardSideFile = useCallback((cardId: string, side: 'front' | 'back', file: File) => {
    const previewUrl = URL.createObjectURL(file);

    setBatchQueue((current) => current.map((card) => {
      if (card.id !== cardId) return card;
      const existing = side === 'front' ? card.front : card.back;
      revokeSidePreview(existing);

      const nextSide: CardImageSide = {
        file,
        previewUrl,
        filename: file.name,
        sourceType: side === 'front' ? card.front.sourceType : (card.back?.sourceType ?? card.front.sourceType),
      };

      return {
        ...card,
        front: side === 'front' ? nextSide : card.front,
        back: side === 'back' ? nextSide : card.back,
        status: 'queued',
        error: undefined,
        extractedRows: [],
        needsReview: false,
      };
    }));
  }, [revokeSidePreview]);

  const clearBatchQueue = useCallback(() => {
    setBatchQueue((current) => {
      revokeQueuePreviewUrls(current);
      return [];
    });
    setDetectedCardCrops([]);
    setDetectionDebugBySource({});
    sourceCaptureRef.current.clear();
    setCardBatches([]);
    setRapidPendingCardId(null);
    setBatchProgress(emptySnapshot);
    setData([]);
    setBatchSessionRows([]);
    setBusinessCardFilter('all');
  }, [revokeQueuePreviewUrls]);

  const processSingleCardDraft = useCallback(async (draft: BatchCardItem) => {
    setStep('processing');

    try {
      const merged = await extractBusinessCardRecord(draft);
      const row: BusinessCardEntry = {
        ...merged,
        sourceCardId: draft.id,
        sourceItemId: draft.id,
        sourceLabel: draft.front.filename || 'Card 1',
        sourceImageName: draft.sourceImageName || draft.front.filename,
        sourceImageId: draft.sourceImageId,
        sourceImageUrl: draft.sourceImageUrl,
        cropIndex: draft.cropIndex ?? 1,
        cropImageUrl: draft.front.previewUrl,
        scanMode: draft.scanMode ?? 'single-card',
        sourceType: draft.front.sourceType,
        hasBack: Boolean(draft.back),
        frontBackStatus: draft.back ? 'front-and-back' : 'front-only',
        confidence: merged.confidence ?? draft.confidence,
        warnings: [...(draft.warnings ?? []), ...(merged.warnings ?? [])],
        frontPreviewUrl: draft.front.previewUrl,
        backPreviewUrl: draft.back?.previewUrl,
        status: (merged.needsReview || (merged.warnings?.length ?? 0) > 0 || merged.conflictFields?.length)
          ? 'needs_review'
          : 'complete',
        needsReview: Boolean(merged.needsReview || (merged.warnings?.length ?? 0) > 0 || merged.conflictFields?.length),
      };

      // Phase 3: run batch analysis + export validation
      const [analyzedRow] = validateBatch(runBatchAnalysis([row], sessionCorrections));
      setData([analyzedRow]);
      setBusinessCardFilter('all');
      setStep('review');
      setSingleCardDraft(draft);
      toast.success('Card extracted. Review and export when ready.');
    } catch {
      toast.error('Failed to extract business card. Please try again.');
      setStep('capture');
    }
  }, []);

  const processBatch = useCallback(async (itemIds?: string[]) => {
    const targetIds = itemIds ?? batchQueue.map((item) => item.id);
    if (targetIds.length === 0) {
      toast.error('No cards in the queue.');
      return;
    }

    if (import.meta.env.DEV) {
      console.debug('[ScanMode] before-process-batch', {
        scanMode,
        totalItems: batchQueue.length,
        targetIds: targetIds.length,
        sessionId: sessionIdRef.current,
        route: window.location.pathname,
      });
    }

    setStep('batch-processing');
    setIsBatchProcessing(true);

    const resetTargetIds = new Set(targetIds);
    setBatchQueue((current) => current.map((item) => {
      if (!resetTargetIds.has(item.id)) return item;
      if (item.status !== 'failed') return item;
      return {
        ...item,
        status: 'queued',
        error: undefined,
        extractedRows: [],
        needsReview: false,
      };
    }));

    try {
      const queueSnapshot = batchQueue.map((item) => ({ ...item }));
      const result = await extractBusinessCardBatch(queueSnapshot, {
        concurrency: getDefaultBatchConcurrency(),
        itemIds: targetIds,
        onItemUpdate: (id, patch) => {
          setBatchQueue((current) => current.map((item) => {
            if (item.id !== id) return item;
            return { ...item, ...patch };
          }));
        },
        onProgress: setBatchProgress,
      });

      const nextItems = result.items.map((item, index) => ({ ...item, index }));
      setBatchQueue(nextItems);

      const rows = buildReviewRowsFromQueue(nextItems);
      // Phase 3: run batch analysis + export validation
      const analyzedRows = validateBatch(runBatchAnalysis(rows, sessionCorrections));
      setData(analyzedRows);
      setBatchSessionRows(analyzedRows);
      setBusinessCardFilter(analyzedRows.some((row) => row.status === 'failed' || row.status === 'needs_review') ? 'needs_review' : 'all');
      setStep('review');

      if (result.summary.failed > 0) {
        toast.warning(`Processed ${result.summary.total} cards. ${result.summary.failed} failed.`);
      } else {
        toast.success(`Processed ${result.summary.total} cards.`);
      }
    } catch {
      toast.error('Batch processing failed. Please try again.');
      setStep('batch-queue');
    } finally {
      setIsBatchProcessing(false);
    }
  }, [batchQueue, buildReviewRowsFromQueue]);

  const retryFailedFromReview = useCallback(async () => {
    const failedIds = batchQueue.filter((item) => item.status === 'failed').map((item) => item.id);
    if (failedIds.length === 0) {
      toast.info('No failed cards to retry.');
      return;
    }

    await processBatch(failedIds);
  }, [batchQueue, processBatch]);

  const handleImageSelected = async (file: File, previewUrl: string, sourceType: 'camera' | 'upload' = 'upload') => {
    const frontCapture: QueuedCapture = {
      file,
      previewUrl,
      sourceType,
    };

    if (mode === 'single') {
      addCapturesToQueue([frontCapture]);
      return;
    }

    addCapturesToQueue([frontCapture]);
  };

  const handleSingleBackSelected = async (file: File) => {
    if (!singleCardDraft) return;

    const previewUrl = URL.createObjectURL(file);
    const nextDraft: BatchCardItem = {
      ...singleCardDraft,
      back: {
        file,
        previewUrl,
        filename: file.name,
        sourceType: singleCardDraft.front.sourceType,
      },
    };

    setSingleCardDraft(nextDraft);
    await processSingleCardDraft(nextDraft);
  };

  // ── Phase 3 handlers ───────────────────────────────────────────────────────

  const handleAcceptReady = useCallback(() => {
    setData((current) =>
      current.map((card) => {
        const c = card as BusinessCardEntry;
        if (c.exportStatus === 'export_blocked' || c.exportStatus === 'export_warning') return card;
        if (!c.needsReview) return card;
        return { ...c, needsReview: false, status: 'complete' as const };
      }),
    );
    setBusinessCardFilter('needs_review');
    toast.success('Ready cards accepted.');
  }, []);

  const handleReviewNext = useCallback(() => {
    const cards = data as BusinessCardEntry[];
    const problemCards = cards.filter(
      (c) =>
        (c.needsReview || c.exportStatus === 'export_blocked' || c.duplicateStatus === 'possible') &&
        !c.excludeFromExport,
    );
    if (problemCards.length === 0) {
      toast.info('No more problem cards to review.');
      return;
    }
    const currentIdx = focusedCardId
      ? problemCards.findIndex((c) => c.id === focusedCardId)
      : -1;
    const next = problemCards[(currentIdx + 1) % problemCards.length];
    setFocusedCardId(next.id);
    setBusinessCardFilter('all');
  }, [data, focusedCardId]);

  const handleMarkReady = useCallback((cardId: string) => {
    setData((current) =>
      current.map((c) =>
        c.id !== cardId
          ? c
          : {
              ...c,
              needsReview: false,
              status: 'complete' as const,
              exportStatus: 'ready_to_export' as const,
              exportBlockedReasons: [],
              exportWarningReasons: [],
            },
      ),
    );
  }, []);

  const handleExcludeFromExport = useCallback((cardId: string) => {
    setData((current) =>
      current.map((c) =>
        c.id !== cardId ? c : { ...c, excludeFromExport: !((c as BusinessCardEntry).excludeFromExport) },
      ),
    );
  }, []);

  const handleRestoreOriginal = useCallback((cardId: string) => {
    setData((current) => {
      const updated = current.map((c) => {
        const card = c as BusinessCardEntry;
        if (card.id !== cardId || !card.originalOcrValues) return c;
        const restored: BusinessCardEntry = {
          ...card,
          ...card.originalOcrValues,
          userEdited: new Set<keyof BusinessCardEntry>(),
          originalOcrValues: undefined,
        };
        const [revalidated] = validateBatch([restored]);
        return revalidated;
      });
      return updated;
    });
  }, []);

  const handleMergeDuplicate = useCallback((cardId: string) => {
    setData((current) =>
      current.map((c) =>
        c.id !== cardId
          ? c
          : { ...c, excludeFromExport: true, duplicateStatus: 'confirmed' as const },
      ),
    );
    toast.success('Duplicate excluded from export.');
  }, []);

  const handleKeepBoth = useCallback((cardId: string) => {
    setData((current) =>
      current.map((c) =>
        c.id !== cardId
          ? c
          : {
              ...c,
              duplicateStatus: 'ignored' as const,
              duplicateOf: undefined,
              warnings: ((c as BusinessCardEntry).warnings ?? []).filter(
                (w) => !w.startsWith('duplicate_'),
              ),
            },
      ),
    );
  }, []);

  const handleIgnoreDuplicate = useCallback((cardId: string) => {
    setData((current) =>
      current.map((c) => {
        const card = c as BusinessCardEntry;
        if (card.id !== cardId) return c;
        const filteredWarnings = (card.warnings ?? []).filter(
          (w) => !w.startsWith('duplicate_'),
        );
        return {
          ...card,
          duplicateStatus: 'ignored' as const,
          duplicateOf: undefined,
          needsReview: filteredWarnings.length > 0 || card.needsReview
            ? (filteredWarnings.length > 0)
            : false,
          warnings: filteredWarnings,
        };
      }),
    );
  }, []);

  const handleApplyBatchCorrection = useCallback((rule: BatchCorrectionRule) => {
    const newCorrections = addCorrectionRule(sessionCorrections, rule);
    setSessionCorrections(newCorrections);
    setData((current) => {
      const analyzed = runBatchAnalysis(current as BusinessCardEntry[], newCorrections);
      return validateBatch(analyzed);
    });
    // Clear matching suggestions
    setBatchCorrectionSuggestions((prev) => {
      const next = { ...prev };
      for (const cardId of Object.keys(next)) {
        next[cardId] = next[cardId].filter(
          (s) => !(s.rule.type === rule.type && s.rule.pattern === rule.pattern),
        );
        if (next[cardId].length === 0) delete next[cardId];
      }
      return next;
    });
    toast.success(`Correction applied to matching cards.`);
  }, [sessionCorrections]);

  const handleDismissBatchCorrectionSuggestion = useCallback((cardId: string, ruleId: string) => {
    setBatchCorrectionSuggestions((prev) => {
      const filtered = (prev[cardId] ?? []).filter((s) => s.rule.id !== ruleId);
      if (filtered.length === 0) {
        const next = { ...prev };
        delete next[cardId];
        return next;
      }
      return { ...prev, [cardId]: filtered };
    });
  }, []);

  const handleDataChange = useCallback((rows: BusinessCardEntry[]) => {
    const cards = rows;
    setData(cards);
    // Rebuild correction suggestions for any user-edited company fields
    const context = analyzeBatch(cards);
    const suggestions: Record<string, BatchCorrectionSuggestion[]> = {};
    for (const card of cards) {
      if (!card.userEdited?.has('company') || !card.company) continue;
      const cardSuggestions = buildBatchCorrectionSuggestions(
        card,
        card.company,
        cards,
        context,
      );
      if (cardSuggestions.length > 0) {
        suggestions[card.id] = cardSuggestions;
      }
    }
    if (Object.keys(suggestions).length > 0) {
      setBatchCorrectionSuggestions(suggestions);
    }
  }, []);

  // ── Export (Phase 3: preview before download) ─────────────────────────────

  const doExport = useCallback((readyOnly: boolean) => {
    setExportPreviewOpen(false);
    const exportRows = data.filter((row) => row.status !== 'failed');
    const filename = batchQueue.length > 1
      ? `business-cards-batch-${new Date().toISOString().slice(0, 10)}`
      : undefined;

    selectedExportFormats.forEach((format) => {
      exportData(exportRows, 'business-card', format, filename, undefined, {
        includeColumns: selectedExportColumns,
        readyCardsOnly: readyOnly,
      });
    });
    toast.success(
      `Exported ${selectedExportFormats.map((f) => f.toUpperCase()).join(', ')} successfully!`,
    );

    const settings = getSessionSettings();
    if (settings.autoDeletePhotosAfterExport) {
      void clearSession().catch(() => null);
      persistedImageKeysRef.current.clear();
      sessionIdRef.current = crypto.randomUUID();
      sessionCreatedAtRef.current = new Date().toISOString();
      clearBatchQueue();
      setData([]);
      setStep('capture');
    } else {
      toast.info('Export complete. You can continue uploading and keep building this session.');
    }
  }, [data, batchQueue.length, selectedExportFormats, selectedExportColumns, clearBatchQueue]);

  const handleExport = async () => {
    if (data.length === 0) {
      toast.error('No data to export');
      return;
    }

    const exportRows = data.filter((row) => row.status !== 'failed');

    if (exportRows.length === 0) {
      toast.error('No completed rows to export yet.');
      return;
    }

    if (selectedExportFormats.length === 0) {
      toast.error('Select at least one export file type.');
      return;
    }

    // Phase 3: show preview when any blocked cards exist
    const cards = exportRows as BusinessCardEntry[];
    const hasBlocked = cards.some((c) => c.exportStatus === 'export_blocked' && !c.excludeFromExport);
    if (hasBlocked) {
      setExportPreviewOpen(true);
      return;
    }

    doExport(false);
  };

  const queueCounts = useMemo(() => ({
    queued: batchQueue.filter((item) => item.status === 'queued').length,
    processing: batchQueue.filter((item) => item.status === 'processing').length,
    done: batchQueue.filter((item) => item.status === 'done').length,
    failed: batchQueue.filter((item) => item.status === 'failed').length,
    needsReview: batchQueue.filter((item) => item.status === 'needs_review').length,
  }), [batchQueue]);

  const sessionCounts = useMemo(() => {
    const ready = batchSessionRows.filter((row) => row.status !== 'failed').length;
    const needsReview = batchSessionRows.filter((row) => row.status === 'needs_review' || row.needsReview).length;
    const failed = batchSessionRows.filter((row) => row.status === 'failed').length;
    const manualCrops = batchQueue.filter((item) => item.manualCrop).length;
    const manualEntries = batchQueue.filter((item) => item.manualEntry).length;

    return {
      ready,
      photos: cardBatches.length,
      detectedCards: detectedCardCrops.length || batchQueue.length,
      manualCrops,
      manualEntries,
      needsReview,
      failed,
    };
  }, [batchSessionRows, cardBatches.length, detectedCardCrops.length, batchQueue]);

  const detectedBySource = useMemo(() => {
    const grouped: Record<string, WorkflowDetectedCardCrop[]> = {};
    detectedCardCrops.forEach((crop) => {
      if (!grouped[crop.sourceImageId]) {
        grouped[crop.sourceImageId] = [];
      }
      grouped[crop.sourceImageId].push(crop);
    });

    Object.values(grouped).forEach((crops) => {
      crops.sort((a, b) => a.cropIndex - b.cropIndex);
    });

    return grouped;
  }, [detectedCardCrops]);

  const batchProgressPercent = batchProgress.total === 0
    ? 0
    : Math.round(((batchProgress.done + batchProgress.failed + batchProgress.needsReview) / batchProgress.total) * 100);

  const activeBatchCount = batchQueue.length;

  const cardPreviewMap = useMemo(() => {
    const map: Record<string, { front?: string; back?: string; original?: string; sourceImageName?: string }> = {};

    batchQueue.forEach((item) => {
      map[item.id] = {
        front: item.front.previewUrl,
        back: item.back?.previewUrl,
        original: item.sourceImageUrl,
        sourceImageName: item.sourceImageName,
      };

      if (item.sourceImageId && !map[item.sourceImageId]) {
        map[item.sourceImageId] = {
          original: item.sourceImageUrl,
          sourceImageName: item.sourceImageName,
        };
      }
    });

    if (singleCardDraft) {
      map[singleCardDraft.id] = {
        front: singleCardDraft.front.previewUrl,
        back: singleCardDraft.back?.previewUrl,
        original: singleCardDraft.sourceImageUrl,
        sourceImageName: singleCardDraft.sourceImageName,
      };
    }

    return map;
  }, [batchQueue, singleCardDraft]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b border-border">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/business-cards')}
              className="p-1.5 -ml-1.5 rounded-md hover:bg-secondary transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <img src="/Scan%20logo.webp" alt="Scan2Sheet logo" className="w-8 h-8 rounded-lg object-cover" />
              <span className="font-bold text-lg text-foreground">{title}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => navigate('/')}>
              Home
            </Button>
            <SettingsMenu />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        </div>

        {/* Session resume banner */}
        {pendingSession && sessionInitialized && (
          <SessionBanner
            session={pendingSession}
            onResume={handleResumeSession}
            onResumeToQueue={handleResumeToQueue}
            onDiscard={handleDiscardSession}
          />
        )}

        {/* Local-only privacy notice + clear session */}
        {!pendingSession && sessionInitialized && (batchQueue.length > 0 || data.length > 0) && (
          <div className="flex items-center justify-between rounded-md bg-muted/50 border border-border px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-primary" />
              <span>Session stored on this device only.</span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-xs text-destructive hover:text-destructive h-7 px-2"
              onClick={async () => {
                await handleClearSession();
                clearBatchQueue();
                setData([]);
                setStep('capture');
              }}
            >
              Clear Session
            </Button>
          </div>
        )}

        {step === 'capture' && (
          <>
            {mode === 'multi-upload' && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <p className="text-sm font-medium text-foreground">Choose scan mode</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={scanMode === 'single-card' ? 'default' : 'outline'}
                    onClick={() => {
                      if (import.meta.env.DEV) {
                        console.debug('[ScanMode] upload-mode-selection', {
                          previousScanMode: scanMode,
                          nextScanMode: 'single-card',
                          source: 'scan-mode-button',
                          sessionId: sessionIdRef.current,
                          route: window.location.pathname,
                        });
                      }
                      setScanMode('single-card');
                    }}
                    disabled={isDetecting}
                  >
                    Scan as single card
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={scanMode === 'multi-card' ? 'default' : 'outline'}
                    onClick={() => {
                      if (import.meta.env.DEV) {
                        console.debug('[ScanMode] upload-mode-selection', {
                          previousScanMode: scanMode,
                          nextScanMode: 'multi-card',
                          source: 'scan-mode-button',
                          sessionId: sessionIdRef.current,
                          route: window.location.pathname,
                        });
                      }
                      setScanMode('multi-card');
                    }}
                    disabled={isDetecting}
                  >
                    Detect multiple cards in photo
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  For best results, upload photos with up to 6 business cards per image. Place cards on a flat contrasting background with space between each card.
                </p>
                {scanMode === 'multi-card' && (
                  <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      We recommend no more than 6 cards per photo. If detection misses cards, try taking closer photos with fewer cards.
                    </span>
                  </div>
                )}
                {import.meta.env.DEV && scanMode === 'multi-card' && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={showDeveloperDebugOverlay ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setShowDeveloperDebugOverlay((current) => !current)}
                    >
                      {showDeveloperDebugOverlay ? 'Debug Overlay: On' : 'Debug Overlay: Off'}
                    </Button>
                  </div>
                )}
              </div>
            )}

            <ImageCapture
              onImageSelected={handleImageSelected}
              mode={mode}
              onBatchAdd={addCapturesToQueue}
              capturedCount={activeBatchCount}
              rapidAwaitingBack={Boolean(rapidPendingCardId)}
              recentPreviews={batchQueue.slice(-8).reverse().map((item) => item.front.previewUrl)}
              onFinishBatch={() => {
                if (activeBatchCount === 0) {
                  toast.error('Capture at least one card first.');
                  return;
                }
                setStep('batch-queue');
              }}
              onViewQueue={() => setStep('batch-queue')}
              onSkipBack={skipRapidBack}
              onCancelBatch={clearBatchQueue}
              onRetakeLast={() => {
                const lastItem = batchQueue[batchQueue.length - 1];
                if (!lastItem) return;
                removeBatchItem(lastItem.id);
                toast.info('Removed last card.');
              }}
            />

            {isDetecting && mode === 'multi-upload' && scanMode === 'multi-card' && (
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-sm text-muted-foreground">Detecting card regions and preparing crops...</p>
              </div>
            )}

            {mode === 'single' && singleCardDraft && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <p className="text-sm font-medium text-foreground">Does this card have a back?</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => singleBackInputRef.current?.click()}>
                    Scan Back
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => processSingleCardDraft(singleCardDraft)}>
                    Skip Back
                  </Button>
                </div>
                <input
                  ref={singleBackInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleSingleBackSelected(file);
                    }
                    e.currentTarget.value = '';
                  }}
                />
              </div>
            )}

            {mode !== 'single' && activeBatchCount > 0 && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
                <p className="text-sm text-muted-foreground">Queue ready: {activeBatchCount} cards</p>
                <Button size="sm" variant="outline" onClick={() => setStep('batch-queue')}>
                  View Queue
                </Button>
              </div>
            )}
          </>
        )}

        {step === 'batch-queue' && (
          <div className="space-y-4">
            {mode === 'multi-upload' && detectedCardCrops.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-3 space-y-3" data-testid="detection-preview">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">Detection preview</p>
                  <p className="text-xs text-muted-foreground">
                    Detected {detectedCardCrops.length} cards
                    {' | '}Auto detected: {detectedCardCrops.filter((crop) => !crop.manualCrop).length}
                    {' | '}Manual crops: {sessionCounts.manualCrops}
                    {' | '}Manual entries: {sessionCounts.manualEntries}
                    {' | '}Total rows pending/created: {batchQueue.length}
                  </p>
                </div>

                {cardBatches
                  .filter((batch) => batch.scanMode === 'multi-card')
                  .map((batch) => {
                    const crops = detectedBySource[batch.id] ?? [];
                    const debug = detectionDebugBySource[batch.id];

                    return (
                      <div key={batch.id} className="rounded-md border border-border p-3 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-foreground truncate max-w-[340px]">{batch.sourceImageName}</p>
                            <p className="text-xs text-muted-foreground">
                              {debug ? `${debug.imageWidth}x${debug.imageHeight}` : 'Image size unavailable'}
                              {' | '}Auto: {crops.filter((crop) => !crop.manualCrop).length}
                              {' | '}Manual crop: {crops.filter((crop) => crop.manualCrop).length}
                              {' | '}Manual entry: {batchQueue.filter((item) => item.sourceImageId === batch.id && item.manualEntry).length}
                              {' | '}Rejected: {debug?.rejectedCandidateCount ?? 0}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={() => rerunDetectionForSource(batch.id)} disabled={isDetecting}>
                              Re-run detection
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleAddManualCrop(batch.id)}
                              disabled={isDetecting || isAddingManualCrop}
                            >
                              Add manual crop
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleAddManualEntry(batch.id)}
                              disabled={isAddingManualEntry}
                            >
                              Add manual entry
                            </Button>
                            {batch.sourceImageUrl && (
                              <Button type="button" size="sm" variant="outline" asChild>
                                <a href={batch.sourceImageUrl} target="_blank" rel="noreferrer">View original</a>
                              </Button>
                            )}
                            {debug?.overlayUrl && import.meta.env.DEV && (
                              <Button type="button" size="sm" variant="outline" asChild>
                                <a href={debug.overlayUrl} target="_blank" rel="noreferrer">View debug overlay</a>
                              </Button>
                            )}
                          </div>
                        </div>

                        {debug && Object.keys(debug.rejectionReasons).length > 0 && (
                          <p className="text-[11px] text-muted-foreground">
                            Rejections: {Object.entries(debug.rejectionReasons).map(([reason, count]) => `${reason} (${count})`).join(', ')}
                          </p>
                        )}

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {crops.map((crop) => (
                            <div key={crop.id} className="rounded-md border border-border p-2 space-y-2">
                              <img
                                src={crop.cropImageUrl}
                                alt={`${crop.sourceImageName} crop ${crop.cropIndex}`}
                                className="w-full h-20 rounded object-cover border border-border"
                              />
                              <p className="text-[11px] text-muted-foreground">
                                Crop {crop.cropIndex} | {Math.round(crop.confidence * 100)}%
                              </p>
                              {crop.manualCrop && (
                                <Badge variant="secondary" className="text-[10px]">Manual Crop</Badge>
                              )}
                              <p className="text-[11px] text-muted-foreground">
                                x:{crop.aspectRatio.toFixed(2)} | area:{crop.areaPercent.toFixed(2)}%
                              </p>
                              <div className="flex flex-wrap gap-1">
                                <Button type="button" size="sm" variant="outline" asChild>
                                  <a href={crop.cropImageUrl} target="_blank" rel="noreferrer">View</a>
                                </Button>
                                <Button type="button" size="sm" variant="outline" onClick={() => removeBatchItem(crop.queueItemId)}>
                                  Remove
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setStep('capture')}>
                Add More
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => processBatch()}
                disabled={batchQueue.length === 0 || isBatchProcessing}
              >
                Process Batch
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearBatchQueue}
                disabled={batchQueue.length === 0 || isBatchProcessing}
              >
                Clear All
              </Button>
            </div>

            {batchQueue.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No cards in queue yet.
              </div>
            ) : (
              <div className="space-y-3">
                {batchQueue.map((item, index) => (
                  <div key={item.id} className="rounded-lg border border-border p-3 bg-card space-y-3">
                    <div className="flex items-start gap-3">
                      {item.front.previewUrl ? (
                        <img
                          src={item.front.previewUrl}
                          alt={item.front.filename || `Card ${index + 1} front`}
                          className="w-20 h-20 rounded-md object-cover border border-border"
                        />
                      ) : (
                        <div className="w-20 h-20 rounded-md border border-dashed border-border bg-muted/30 flex items-center justify-center text-[10px] text-muted-foreground text-center px-1">
                          Manual entry
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{item.front.filename || `Card ${index + 1}`}</p>
                        <p className="text-xs text-muted-foreground">Card #{index + 1}</p>
                        {item.sourceImageName && (
                          <p className="text-xs text-muted-foreground truncate">
                            Source image: {item.sourceImageName}{item.cropIndex ? ` | Crop ${item.cropIndex}` : ''}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="outline">Front attached</Badge>
                          <Badge variant={item.back ? 'default' : 'secondary'}>{item.back ? 'Back attached' : 'No back'}</Badge>
                          {item.scanMode === 'multi-card' && <Badge variant="secondary">Multi-card</Badge>}
                        </div>
                        <Badge
                          variant={
                            item.status === 'failed'
                              ? 'destructive'
                              : item.status === 'done'
                                ? 'default'
                                : item.status === 'needs_review'
                                  ? 'secondary'
                                  : 'outline'
                          }
                          className="mt-2"
                        >
                          {item.status.replace('_', ' ')}
                        </Badge>
                        {(item.warnings?.length ?? 0) > 0 && (
                          <p className="text-xs text-amber-600 mt-1">{item.warnings?.[0]}</p>
                        )}
                        {item.error && <p className="text-xs text-destructive mt-1">{item.error}</p>}
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => removeBatchItem(item.id)}
                        disabled={isBatchProcessing}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    {item.back && (
                      <div className="flex items-center gap-3 pl-1">
                        <img
                          src={item.back.previewUrl}
                          alt={item.back.filename || `Card ${index + 1} back`}
                          className="w-20 h-20 rounded-md object-cover border border-border"
                        />
                        <p className="text-xs text-muted-foreground">Back image attached</p>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {item.front.previewUrl && (
                        <Button type="button" size="sm" variant="outline" asChild>
                          <a href={item.front.previewUrl} target="_blank" rel="noreferrer">View Crop</a>
                        </Button>
                      )}
                      {item.sourceImageUrl && (
                        <Button type="button" size="sm" variant="outline" asChild>
                          <a href={item.sourceImageUrl} target="_blank" rel="noreferrer">View Original Photo</a>
                        </Button>
                      )}
                      <Button type="button" size="sm" variant="outline" asChild>
                        <label className="cursor-pointer">
                          Replace Front
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) updateCardSideFile(item.id, 'front', file);
                              e.currentTarget.value = '';
                            }}
                          />
                        </label>
                      </Button>
                      <Button type="button" size="sm" variant="outline" asChild>
                        <label className="cursor-pointer">
                          {item.back ? 'Replace Back' : 'Add Back'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) updateCardSideFile(item.id, 'back', file);
                              e.currentTarget.value = '';
                            }}
                          />
                        </label>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'processing' && (
          <ScanToSheetLoadingAnimation
            className="py-10"
            title="Extracting data..."
            subtitle="Analyzing your card record"
          />
        )}

        {step === 'batch-processing' && (
          <div className="space-y-5">
            <ScanToSheetLoadingAnimation
              className="py-4"
              title="Processing Batch"
              subtitle="Front/back cards are being merged now."
            />

            <div className="space-y-2">
              <Progress value={batchProgressPercent} />
              <p className="text-sm text-muted-foreground">{batchProgressPercent}% complete</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <div className="rounded-md border border-border p-2">
                <p className="text-xs text-muted-foreground">Queued</p>
                <p className="text-lg font-semibold">{batchProgress.queued || queueCounts.queued}</p>
              </div>
              <div className="rounded-md border border-border p-2">
                <p className="text-xs text-muted-foreground">Processing</p>
                <p className="text-lg font-semibold">{batchProgress.processing || queueCounts.processing}</p>
              </div>
              <div className="rounded-md border border-border p-2">
                <p className="text-xs text-muted-foreground">Done</p>
                <p className="text-lg font-semibold">{batchProgress.done || queueCounts.done}</p>
              </div>
              <div className="rounded-md border border-border p-2">
                <p className="text-xs text-muted-foreground">Needs Review</p>
                <p className="text-lg font-semibold">{batchProgress.needsReview || queueCounts.needsReview}</p>
              </div>
              <div className="rounded-md border border-border p-2">
                <p className="text-xs text-muted-foreground">Failed</p>
                <p className="text-lg font-semibold">{batchProgress.failed || queueCounts.failed}</p>
              </div>
            </div>

            {!isBatchProcessing && batchProgress.failed > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={retryFailedFromReview}>
                <RotateCw className="w-4 h-4 mr-2" />
                Retry Failed
              </Button>
            )}
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-6">
            {mode === 'multi-upload' && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setStep('capture')}>
                  Back to Upload More Photos
                </Button>
              </div>
            )}

            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm text-foreground font-medium">Ready to export: {sessionCounts.ready} rows</p>
              <p className="text-xs text-muted-foreground mt-1">
                Total uploaded photos: {sessionCounts.photos} | Detected cards: {sessionCounts.detectedCards} | Needs review: {sessionCounts.needsReview} | Failed: {sessionCounts.failed}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border border-border p-3 bg-card">
                <p className="text-xs text-muted-foreground">Complete</p>
                <p className="font-semibold text-foreground flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  {data.filter((row) => row.status === 'complete').length}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3 bg-card">
                <p className="text-xs text-muted-foreground">Needs Review</p>
                <p className="font-semibold text-foreground flex items-center gap-1">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  {data.filter((row) => row.status === 'needs_review' || row.needsReview).length}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3 bg-card">
                <p className="text-xs text-muted-foreground">Failed</p>
                <p className="font-semibold text-foreground flex items-center gap-1">
                  <AlertCircle className="w-4 h-4 text-destructive" />
                  {data.filter((row) => row.status === 'failed').length}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 min-[1200px]:grid-cols-[minmax(720px,1fr)_340px] min-[1200px]:items-start min-[1200px]:gap-8">
              <div className="min-w-0 space-y-6">
                <DataReview
                  docType="business-card"
                  data={data}
                  onChange={(rows) => handleDataChange(rows as BusinessCardEntry[])}
                  businessCardFilter={businessCardFilter}
                  onBusinessCardFilterChange={setBusinessCardFilter}
                  onReviewProblemRows={() => setBusinessCardFilter('needs_review')}
                  onRetryFailed={retryFailedFromReview}
                  cardPreviewMap={cardPreviewMap}
                  focusedCardId={focusedCardId}
                  onAcceptReady={handleAcceptReady}
                  onReviewNext={handleReviewNext}
                  onMarkReady={handleMarkReady}
                  onExcludeFromExport={handleExcludeFromExport}
                  onRestoreOriginal={handleRestoreOriginal}
                  onMergeDuplicate={handleMergeDuplicate}
                  onKeepBoth={handleKeepBoth}
                  onIgnoreDuplicate={handleIgnoreDuplicate}
                  batchCorrectionSuggestions={batchCorrectionSuggestions}
                  onApplyBatchCorrection={handleApplyBatchCorrection}
                  onDismissBatchCorrectionSuggestion={handleDismissBatchCorrectionSuggestion}
                />
              </div>

              <ExportSidebar
                exportFormatSelection={exportFormatSelection}
                onToggleExportFormat={(format, included) => {
                  setExportFormatSelection((prev) => ({
                    ...prev,
                    [format]: included,
                  }));
                }}
                onSelectAllExportFormats={() => {
                  setExportFormatSelection({ xlsx: true, csv: true, tsv: true, json: true, md: true });
                }}
                onClearAllExportFormats={() => {
                  setExportFormatSelection({ xlsx: false, csv: false, tsv: false, json: false, md: false });
                }}
                availableExportColumns={availableExportColumns}
                exportColumnSelection={exportColumnSelection}
                onToggleColumn={(column, included) => {
                  setExportColumnSelection((prev) => ({
                    ...prev,
                    [column]: included,
                  }));
                }}
                onSelectAll={() => {
                  setExportColumnSelection((prev) => {
                    const next = { ...prev };
                    availableExportColumns.forEach((column) => {
                      next[column] = true;
                    });
                    return next;
                  });
                }}
                onClearAll={() => {
                  setExportColumnSelection((prev) => {
                    const next = { ...prev };
                    availableExportColumns.forEach((column) => {
                      next[column] = false;
                    });
                    return next;
                  });
                }}
                onReset={() => {
                  setExportColumnSelection((prev) => {
                    const next = { ...prev };
                    exportColumnGroups.allColumns.forEach((column) => {
                      next[column] = exportColumnGroups.defaultColumns.includes(column);
                    });
                    return next;
                  });
                }}
                showAdvancedColumns={showAdvancedExportColumns}
                onToggleAdvancedColumns={setShowAdvancedExportColumns}
                onExport={() => handleExport()}
                readyCount={sessionCounts.ready}
                exportDisabled={selectedExportColumns.length === 0 || selectedExportFormats.length === 0}
              />
            </div>
          </div>
        )}
      </main>

      {/* Phase 3: export preview modal */}
      <ExportPreviewModal
        open={exportPreviewOpen}
        cards={data as BusinessCardEntry[]}
        onConfirm={(readyOnly) => doExport(readyOnly)}
        onCancel={() => setExportPreviewOpen(false)}
      />

      {cropModalSource && (
        <CropModal
          sourceImageUrl={cropModalSource.sourceImageUrl}
          sourceImageName={cropModalSource.sourceImageName}
          isOpen={cropModalOpen}
          onClose={() => setCropModalOpen(false)}
          onConfirm={handleConfirmManualCrop}
          nextCropIndex={cropModalSource.nextCropIndex}
          isLoading={isAddingManualCrop}
        />
      )}

      {manualEntrySource && (
        <ManualEntryModal
          sourceImageName={manualEntrySource.sourceImageName}
          isOpen={manualEntryModalOpen}
          onClose={() => setManualEntryModalOpen(false)}
          onConfirm={handleConfirmManualEntry}
          isLoading={isAddingManualEntry}
        />
      )}
    </div>
  );
}
