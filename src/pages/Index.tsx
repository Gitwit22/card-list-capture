import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  CreditCard,
  Download,
  FileSpreadsheet,
  History,
  Images,
  ListChecks,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { BusinessCardCaptureMode, ImageCapture, QueuedCapture } from '@/components/ImageCapture';
import { DataReview } from '@/components/DataReview';
import { ScanHistory } from '@/components/ScanHistory';
import {
  BatchCardItem,
  BatchProgressSnapshot,
  BusinessCardEntry,
  CardImageSide,
  DocumentType,
  ExtractedData,
  ExtractionMeta,
  ScanRecord,
  SignupEntry,
} from '@/types/scan';
import {
  createEmptyBusinessCard,
  extractBusinessCardBatch,
  extractBusinessCardRecord,
  extractFromImage,
  getDefaultBatchConcurrency,
} from '@/lib/extraction';
import { exportToExcel } from '@/lib/export';
import { getScanHistory, saveScanRecord, getStorageStatus, clearStorageStatus } from '@/lib/storage';
import { getSessionSettings, saveSessionSettings } from '@/lib/sessionSettings';
import { isSafariPrivateMode, estimateSessionSize, formatBytes, shouldWarnAboutStoragePressure, cleanupObjectUrls } from '@/lib/storageUtils';
import { toast } from 'sonner';
import { AlertTriangle, Clock } from 'lucide-react';

type Step = 'home' | 'capture' | 'batch-queue' | 'processing' | 'batch-processing' | 'review' | 'history';
type BusinessCardFilter = 'all' | 'needs_review' | 'complete' | 'failed';

const emptySnapshot: BatchProgressSnapshot = {
  total: 0,
  queued: 0,
  processing: 0,
  done: 0,
  failed: 0,
  needsReview: 0,
};

const businessCardModes: Array<{
  key: BusinessCardCaptureMode;
  title: string;
  description: string;
  icon: typeof Camera;
}> = [
  {
    key: 'single',
    title: 'Scan One Card',
    description: 'Capture front, then optionally back, then process as one card.',
    icon: Camera,
  },
  {
    key: 'rapid',
    title: 'Scan a Stack Fast',
    description: 'Front, optional back, next card. Repeat rapidly.',
    icon: ListChecks,
  },
  {
    key: 'multi-upload',
    title: 'Upload Multiple Photos',
    description: 'Upload photos and pair front/back in queue.',
    icon: Images,
  },
];

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

const Index = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('home');
  const [docType, setDocType] = useState<DocumentType>('business-card');
  const [captureMode, setCaptureMode] = useState<BusinessCardCaptureMode>('single');
  const [filePreviewUrl, setFilePreviewUrl] = useState<string>('');
  const [data, setData] = useState<(SignupEntry | BusinessCardEntry)[]>([]);
  const [extractionMeta, setExtractionMeta] = useState<ExtractionMeta | undefined>();
  const [businessCardFilter, setBusinessCardFilter] = useState<BusinessCardFilter>('all');
  const [history, setHistory] = useState<ScanRecord[]>([]);
  const [batchQueue, setBatchQueue] = useState<BatchCardItem[]>([]);
  const [batchProgress, setBatchProgress] = useState<BatchProgressSnapshot>(emptySnapshot);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [singleCardDraft, setSingleCardDraft] = useState<BatchCardItem | null>(null);
  const [rapidPendingCardId, setRapidPendingCardId] = useState<string | null>(null);

  const singleBackInputRef = useRef<HTMLInputElement | null>(null);
  const activeObjectUrlsRef = useRef<Set<string>>(new Set());
  const [storageStatus, setStorageStatus] = useState({ lastSavedAt: null as Date | null, saveFailed: false, failureReason: null as string | null });
  const [sessionSettings, setSessionSettings] = useState(getSessionSettings());
  const [safariPrivateMode, setSafariPrivateMode] = useState(false);
  const [estimatedSessionBytes, setEstimatedSessionBytes] = useState(0);

  const refreshHistory = useCallback(() => {
    setHistory(getScanHistory());
    setStorageStatus(getStorageStatus());
  }, []);

  useEffect(() => {
    setHistory(getScanHistory());
    setSafariPrivateMode(isSafariPrivateMode());
    setStorageStatus(getStorageStatus());
  }, [refreshHistory]);

  const selectType = (type: DocumentType) => {
    if (type === 'business-card') {
      navigate('/business-cards');
      return;
    }

    setDocType(type);
    setStep('capture');
  };

  const revokeSidePreview = useCallback((side?: CardImageSide) => {
    if (!side?.previewUrl) return;
    try {
      URL.revokeObjectURL(side.previewUrl);
      activeObjectUrlsRef.current.delete(side.previewUrl);
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

  const trackObjectUrl = useCallback((url: string) => {
    if (url && url.startsWith('blob:')) {
      activeObjectUrlsRef.current.add(url);
      // Estimate session size
      const sessionSize = estimateSessionSize({
        batchQueueLength: batchQueue.length,
        dataRowsLength: data.length,
        previewUrlCount: activeObjectUrlsRef.current.size,
      });
      setEstimatedSessionBytes(sessionSize);
    }
  }, [batchQueue.length, data.length]);

  const buildReviewRowsFromQueue = useCallback((queue: BatchCardItem[]) => {
    const rows: BusinessCardEntry[] = [];

    queue.forEach((item) => {
      if (item.extractedRows.length > 0) {
        rows.push(...item.extractedRows);
        return;
      }

      if (item.status === 'failed') {
        rows.push({
          ...createEmptyBusinessCard(),
          sourceLabel: item.front.filename || `Card ${item.index + 1}`,
          sourceItemId: item.id,
          sourceCardId: item.id,
          sourceType: item.front.sourceType,
          hasBack: Boolean(item.back),
          frontPreviewUrl: item.front.previewUrl,
          backPreviewUrl: item.back?.previewUrl,
          needsReview: true,
          status: 'failed',
          error: item.error || 'Extraction failed',
        });
      }
    });

    return rows;
  }, []);

  const addCapturesToQueue = useCallback((captures: QueuedCapture[]) => {
    if (captures.length === 0) return;

    // Track object URLs for cleanup later
    captures.forEach((capture) => trackObjectUrl(capture.previewUrl));

    if (captureMode === 'rapid') {
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

    if (captureMode === 'multi-upload') {
      setBatchQueue((current) => {
        const next = [...current];

        captures.forEach((capture) => {
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
      status: 'queued',
      error: undefined,
      extractedRows: [],
      needsReview: false,
      index: 0,
    };
    setSingleCardDraft(card);
    setFilePreviewUrl(capture.previewUrl);
    toast.info('Front captured. Does this card have a back?');
  }, [captureMode, rapidPendingCardId]);

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

      return current
        .filter((item) => item.id !== id)
        .map((item, index) => ({ ...item, index }));
    });

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
    setRapidPendingCardId(null);
    setBatchProgress(emptySnapshot);
    setData([]);
    setExtractionMeta(undefined);
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
        sourceType: draft.front.sourceType,
        hasBack: Boolean(draft.back),
        frontPreviewUrl: draft.front.previewUrl,
        backPreviewUrl: draft.back?.previewUrl,
        status: merged.conflictFields?.length ? 'needs_review' : 'complete',
        needsReview: Boolean(merged.conflictFields?.length),
      };

      setData([row]);
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

    setStep('batch-processing');
    setIsBatchProcessing(true);
    setExtractionMeta(undefined);

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
      setData(rows);
      setBusinessCardFilter(rows.some((row) => row.status === 'failed' || row.status === 'needs_review') ? 'needs_review' : 'all');
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
    if (docType === 'business-card') {
      const frontCapture: QueuedCapture = {
        file,
        previewUrl,
        sourceType,
      };

      if (captureMode === 'single') {
        addCapturesToQueue([frontCapture]);
        return;
      }

      addCapturesToQueue([frontCapture]);
      return;
    }

    setFilePreviewUrl(previewUrl);
    setStep('processing');

    try {
      const result = await extractFromImage(file, docType);
      setData(result.entries);
      setExtractionMeta(result.meta);
      setBusinessCardFilter('all');
      setStep('review');
      toast.info(`Data extracted (${result.entries.length} ${result.entries.length === 1 ? 'entry' : 'entries'}) - please review before exporting.`);
    } catch {
      toast.error('Failed to extract data. Please try again.');
      setStep('capture');
    }
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
    setFilePreviewUrl(nextDraft.front.previewUrl);
    await processSingleCardDraft(nextDraft);
  };

  const handleExport = (clearSessionAfter = false) => {
    if (data.length === 0) {
      toast.error('No data to export');
      return;
    }

    const exportRows = docType === 'business-card'
      ? (data as BusinessCardEntry[]).filter((row) => row.status !== 'failed')
      : data;

    if (exportRows.length === 0) {
      toast.error('No completed rows to export yet.');
      return;
    }

    const typedData: ExtractedData = docType === 'business-card'
      ? (exportRows as BusinessCardEntry[])
      : (exportRows as SignupEntry[]);

    const record: ScanRecord = {
      id: crypto.randomUUID(),
      type: docType,
      imageUrl: filePreviewUrl || singleCardDraft?.front.previewUrl || batchQueue[0]?.front.previewUrl || '',
      data: typedData,
      meta: extractionMeta,
      createdAt: new Date(),
    };

    const saved = saveScanRecord(record);
    clearStorageStatus();
    refreshHistory();

    const filename = docType === 'business-card' && batchQueue.length > 1
      ? `business-cards-batch-${new Date().toISOString().slice(0, 10)}`
      : undefined;

    exportToExcel(typedData, docType, filename);
    toast.success(`Exported to Excel!${clearSessionAfter ? ' Session cleared.' : ''}`);

    if (clearSessionAfter) {
      clearSessionAfter ? reset() : undefined;
    } else {
      reset();
    }
  };

  const reset = useCallback(() => {
    setStep('home');
    setFilePreviewUrl('');
    setData([]);
    setExtractionMeta(undefined);
    setBusinessCardFilter('all');
    setCaptureMode('single');
    setSingleCardDraft((current) => {
      if (current) {
        revokeSidePreview(current.front);
        revokeSidePreview(current.back);
      }
      return null;
    });
    setRapidPendingCardId(null);
    setBatchProgress(emptySnapshot);
    setBatchQueue((current) => {
      revokeQueuePreviewUrls(current);
      return [];
    });
    // Clean up any remaining ObjectURLs
    cleanupObjectUrls(activeObjectUrlsRef.current);
    setEstimatedSessionBytes(0);
  }, [revokeQueuePreviewUrls, revokeSidePreview]);

  const queueCounts = useMemo(() => ({
    queued: batchQueue.filter((item) => item.status === 'queued').length,
    processing: batchQueue.filter((item) => item.status === 'processing').length,
    done: batchQueue.filter((item) => item.status === 'done').length,
    failed: batchQueue.filter((item) => item.status === 'failed').length,
    needsReview: batchQueue.filter((item) => item.status === 'needs_review').length,
  }), [batchQueue]);

  const batchProgressPercent = batchProgress.total === 0
    ? 0
    : Math.round(((batchProgress.done + batchProgress.failed + batchProgress.needsReview) / batchProgress.total) * 100);

  const activeBatchCount = batchQueue.length;

  const cardPreviewMap = useMemo(() => {
    const map: Record<string, { front?: string; back?: string }> = {};

    batchQueue.forEach((item) => {
      map[item.id] = {
        front: item.front.previewUrl,
        back: item.back?.previewUrl,
      };
    });

    if (singleCardDraft) {
      map[singleCardDraft.id] = {
        front: singleCardDraft.front.previewUrl,
        back: singleCardDraft.back?.previewUrl,
      };
    }

    return map;
  }, [batchQueue, singleCardDraft]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b border-border">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {step !== 'home' && (
              <button onClick={reset} className="p-1.5 -ml-1.5 rounded-md hover:bg-secondary transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <img
                src="/Scan%20logo.webp"
                alt="Scan2Sheet logo"
                className="w-8 h-8 rounded-lg object-cover"
              />
              <span className="font-bold text-lg text-foreground">Scan2Sheet</span>
            </div>
          </div>
          {step === 'home' && (
            <button
              onClick={() => setStep('history')}
              className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors relative"
            >
              <History className="w-5 h-5" />
              {history.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-medium">
                  {history.length}
                </span>
              )}
            </button>
          )}
        </div>
      </header>

      {(storageStatus.saveFailed || safariPrivateMode || shouldWarnAboutStoragePressure(estimatedSessionBytes)) && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
          <div className="max-w-2xl mx-auto space-y-2 text-sm">
            {storageStatus.saveFailed && (
              <div className="flex items-start gap-2 text-amber-900">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Local recovery unavailable in this browser session</p>
                  {storageStatus.failureReason && <p className="text-xs opacity-75">{storageStatus.failureReason}</p>}
                </div>
              </div>
            )}
            {safariPrivateMode && (
              <div className="flex items-start gap-2 text-amber-900">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p className="font-medium">Safari private browsing mode: session data not stored locally</p>
              </div>
            )}
            {shouldWarnAboutStoragePressure(estimatedSessionBytes) && (
              <div className="flex items-start gap-2 text-amber-900">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p className="font-medium">Large session detected ({formatBytes(estimatedSessionBytes)}). Consider exporting and clearing.</p>
              </div>
            )}
            {storageStatus.lastSavedAt && !storageStatus.saveFailed && (
              <div className="flex items-center gap-2 text-amber-700 text-xs">
                <Clock className="w-3.5 h-3.5" />
                <p>Last saved: {storageStatus.lastSavedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <main className="max-w-2xl mx-auto px-4 py-8">
        {step === 'home' && (
          <div className="space-y-8">
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-bold text-foreground">Scan to Spreadsheet</h1>
              <p className="text-muted-foreground">
                Capture sign-up sheets or business cards and export clean data to Excel.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={() => selectType('signup-sheet')}
                className="group p-6 rounded-xl bg-card border border-border card-shadow hover:card-shadow-hover hover:border-primary/30 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/15 transition-colors">
                  <FileSpreadsheet className="w-6 h-6 text-primary" />
                </div>
                <h2 className="font-semibold text-foreground mb-1">Sign-Up Sheet</h2>
                <p className="text-sm text-muted-foreground">
                  Extract names, phones, emails from paper sign-up lists.
                </p>
              </button>

              <button
                onClick={() => selectType('business-card')}
                className="group p-6 rounded-xl bg-card border border-border card-shadow hover:card-shadow-hover hover:border-primary/30 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-4 group-hover:bg-accent/15 transition-colors">
                  <CreditCard className="w-6 h-6 text-accent" />
                </div>
                <h2 className="font-semibold text-foreground mb-1">Business Card</h2>
                <p className="text-sm text-muted-foreground">
                  Pull contact details from business or visiting cards.
                </p>
              </button>
            </div>
          </div>
        )}

        {step === 'capture' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                {docType === 'signup-sheet' ? 'Scan Sign-Up Sheet' : 'Scan Business Card'}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {docType === 'signup-sheet'
                  ? 'Take a photo or upload a file (image, PDF, Excel, Word, etc.).'
                  : 'Capture business cards as front + optional back records.'}
              </p>
            </div>

            {docType === 'business-card' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {businessCardModes.map((modeOption) => {
                  const Icon = modeOption.icon;
                  const active = modeOption.key === captureMode;
                  return (
                    <button
                      key={modeOption.key}
                      type="button"
                      onClick={() => setCaptureMode(modeOption.key)}
                      className={cn(
                        'rounded-lg border p-4 text-left transition-colors',
                        active ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40',
                      )}
                    >
                      <Icon className="w-4 h-4 mb-2 text-primary" />
                      <p className="font-medium text-sm text-foreground">{modeOption.title}</p>
                      <p className="text-xs text-muted-foreground mt-1">{modeOption.description}</p>
                    </button>
                  );
                })}
              </div>
            )}

            <ImageCapture
              onImageSelected={handleImageSelected}
              mode={docType === 'business-card' ? captureMode : 'single'}
              onBatchAdd={docType === 'business-card' ? addCapturesToQueue : undefined}
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
              onCancelBatch={() => {
                clearBatchQueue();
                if (docType === 'business-card') {
                  setCaptureMode('single');
                }
              }}
              onRetakeLast={() => {
                const lastItem = batchQueue[batchQueue.length - 1];
                if (!lastItem) return;
                removeBatchItem(lastItem.id);
                toast.info('Removed last card.');
              }}
            />

            {docType === 'business-card' && captureMode === 'single' && singleCardDraft && (
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

            {docType === 'business-card' && activeBatchCount > 0 && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
                <p className="text-sm text-muted-foreground">Queue ready: {activeBatchCount} cards</p>
                <Button size="sm" variant="outline" onClick={() => setStep('batch-queue')}>
                  View Queue
                </Button>
              </div>
            )}
          </div>
        )}

        {step === 'batch-queue' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Batch Queue</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Each queue item is one card with front and optional back.
              </p>
            </div>

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
                      <img
                        src={item.front.previewUrl}
                        alt={item.front.filename || `Card ${index + 1} front`}
                        className="w-20 h-20 rounded-md object-cover border border-border"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {item.front.filename || `Card ${index + 1}`}
                        </p>
                        <p className="text-xs text-muted-foreground">Card #{index + 1}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="outline">Front attached</Badge>
                          <Badge variant={item.back ? 'default' : 'secondary'}>
                            {item.back ? 'Back attached' : 'No back'}
                          </Badge>
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
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <img
              src="/Scan%20logo.webp"
              alt="Scan2Sheet logo"
              className="w-16 h-16 rounded-full object-cover animate-pulse"
            />
            <div className="text-center">
              <p className="font-medium text-foreground">Extracting data...</p>
              <p className="text-sm text-muted-foreground mt-1">Analyzing your card record</p>
            </div>
          </div>
        )}

        {step === 'batch-processing' && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <img
                src="/Scan%20logo.webp"
                alt="Scan2Sheet logo"
                className="w-10 h-10 rounded-full object-cover animate-pulse"
              />
              <div>
                <h2 className="text-xl font-semibold text-foreground">Processing Batch</h2>
                <p className="text-sm text-muted-foreground">Front/back cards are being merged now.</p>
              </div>
            </div>

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
            <div>
              <h2 className="text-xl font-semibold text-foreground">Review & Edit</h2>
              <p className="text-sm text-muted-foreground mt-1">
                One row per card. Front/back data is merged for export.
              </p>
            </div>

            {docType === 'business-card' && batchQueue.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-border p-3 bg-card">
                  <p className="text-xs text-muted-foreground">Complete</p>
                  <p className="font-semibold text-foreground flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4 text-primary" />
                    {(data as BusinessCardEntry[]).filter((row) => row.status === 'complete').length}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3 bg-card">
                  <p className="text-xs text-muted-foreground">Needs Review</p>
                  <p className="font-semibold text-foreground flex items-center gap-1">
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    {(data as BusinessCardEntry[]).filter((row) => row.status === 'needs_review' || row.needsReview).length}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3 bg-card">
                  <p className="text-xs text-muted-foreground">Failed</p>
                  <p className="font-semibold text-foreground flex items-center gap-1">
                    <AlertCircle className="w-4 h-4 text-destructive" />
                    {(data as BusinessCardEntry[]).filter((row) => row.status === 'failed').length}
                  </p>
                </div>
              </div>
            )}

            {filePreviewUrl && (
              <div className="rounded-lg overflow-hidden border border-border">
                <img src={filePreviewUrl} alt="Scanned document" className="w-full max-h-48 object-contain bg-secondary" />
              </div>
            )}

            <DataReview
              docType={docType}
              data={data}
              onChange={setData}
              meta={extractionMeta}
              businessCardFilter={businessCardFilter}
              onBusinessCardFilterChange={setBusinessCardFilter}
              onReviewProblemRows={() => setBusinessCardFilter('needs_review')}
              onRetryFailed={retryFailedFromReview}
              cardPreviewMap={cardPreviewMap}
            />

            {docType === 'business-card' && (
              <div className="rounded-md border border-border p-3 bg-card flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Ready to export: {(data as BusinessCardEntry[]).filter((row) => row.status !== 'failed').length} rows
                </p>
                <Button type="button" size="sm" variant="outline" onClick={retryFailedFromReview}>
                  Retry Failed
                </Button>
              </div>
            )}

            <Button onClick={handleExport} className="w-full scan-gradient scan-shadow h-12 text-primary-foreground font-medium">
              <Download className="w-5 h-5 mr-2" />
              Export to Excel
            </Button>

            <Button 
              onClick={() => handleExport(true)} 
              variant="outline" 
              className="w-full h-11"
            >
              <Download className="w-5 h-5 mr-2" />
              Export and Clear Session
            </Button>
          </div>
        )}

        {step === 'history' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-foreground">Scan History</h2>
            <ScanHistory records={history} onRefresh={refreshHistory} />
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;

