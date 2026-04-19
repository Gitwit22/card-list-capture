import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Download, RotateCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { DataReview } from '@/components/DataReview';
import { ImageCapture, BusinessCardCaptureMode, QueuedCapture } from '@/components/ImageCapture';
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
} from '@/types/scan';
import {
  createEmptyBusinessCard,
  extractBusinessCardBatch,
  extractBusinessCardRecord,
  getDefaultBatchConcurrency,
} from '@/lib/extraction';
import { exportToExcel } from '@/lib/export';
import { toast } from 'sonner';

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
  const [data, setData] = useState<BusinessCardEntry[]>([]);
  const [batchQueue, setBatchQueue] = useState<BatchCardItem[]>([]);
  const [batchProgress, setBatchProgress] = useState<BatchProgressSnapshot>(emptySnapshot);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [singleCardDraft, setSingleCardDraft] = useState<BatchCardItem | null>(null);
  const [rapidPendingCardId, setRapidPendingCardId] = useState<string | null>(null);
  const [businessCardFilter, setBusinessCardFilter] = useState<BusinessCardFilter>('all');

  // ── Session persistence ───────────────────────────────────────────────────
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const sessionCreatedAtRef = useRef<string>(new Date().toISOString());
  const persistedImageKeysRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pendingSession, setPendingSession] = useState<LocalDraftSession | null>(null);
  const [sessionInitialized, setSessionInitialized] = useState(false);

  const singleBackInputRef = useRef<HTMLInputElement | null>(null);

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
                status: item.status,
                error: item.error,
                extractedRows: item.extractedRows,
                needsReview: item.needsReview,
                index: item.index,
              };
            }),
          );

          const draft: LocalDraftSession = {
            id: sessionIdRef.current,
            mode,
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
  }, [sessionInitialized, step, batchQueue, data, rapidPendingCardId, isBatchProcessing]);

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
          status: item.status,
          error: item.error,
          extractedRows: item.extractedRows,
          needsReview: item.needsReview,
          index: item.index,
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

    setBatchQueue(rebuiltQueue);
    setData(session.data);
    setRapidPendingCardId(session.rapidPendingCardId);
    // Restore to batch-queue step so the user can review before re-processing.
    const restoredStep: Step =
      session.step === 'batch-processing' || session.step === 'processing'
        ? 'batch-queue'
        : session.step;
    setStep(restoredStep);

    toast.success('Session restored. Review your queue and continue.');
  }, [pendingSession]);

  const handleDiscardSession = useCallback(async () => {
    setPendingSession(null);
    await clearSession().catch(() => null);
    persistedImageKeysRef.current.clear();
    sessionIdRef.current = crypto.randomUUID();
    sessionCreatedAtRef.current = new Date().toISOString();
  }, []);

  // ── Clear session action ──────────────────────────────────────────────────
  const handleClearSession = useCallback(async () => {
    await clearSession().catch(() => null);
    persistedImageKeysRef.current.clear();
    sessionIdRef.current = crypto.randomUUID();
    sessionCreatedAtRef.current = new Date().toISOString();
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
    toast.info('Front captured. Does this card have a back?');
  }, [mode, rapidPendingCardId]);

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

    const filename = batchQueue.length > 1
      ? `business-cards-batch-${new Date().toISOString().slice(0, 10)}`
      : undefined;

    exportToExcel(exportRows, 'business-card', filename);
    toast.success('Exported to Excel!');

    const settings = getSessionSettings();
    if (settings.autoDeletePhotosAfterExport) {
      await clearSession().catch(() => null);
      persistedImageKeysRef.current.clear();
      sessionIdRef.current = crypto.randomUUID();
      sessionCreatedAtRef.current = new Date().toISOString();
    }

    setStep('capture');
    setData([]);
  };

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
                        <p className="text-sm font-medium text-foreground truncate">{item.front.filename || `Card ${index + 1}`}</p>
                        <p className="text-xs text-muted-foreground">Card #{index + 1}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="outline">Front attached</Badge>
                          <Badge variant={item.back ? 'default' : 'secondary'}>{item.back ? 'Back attached' : 'No back'}</Badge>
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
            <img src="/Scan%20logo.webp" alt="Scan2Sheet logo" className="w-16 h-16 rounded-full object-cover animate-pulse" />
            <div className="text-center">
              <p className="font-medium text-foreground">Extracting data...</p>
              <p className="text-sm text-muted-foreground mt-1">Analyzing your card record</p>
            </div>
          </div>
        )}

        {step === 'batch-processing' && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <img src="/Scan%20logo.webp" alt="Scan2Sheet logo" className="w-10 h-10 rounded-full object-cover animate-pulse" />
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

            <DataReview
              docType="business-card"
              data={data}
              onChange={(rows) => setData(rows as BusinessCardEntry[])}
              businessCardFilter={businessCardFilter}
              onBusinessCardFilterChange={setBusinessCardFilter}
              onReviewProblemRows={() => setBusinessCardFilter('needs_review')}
              onRetryFailed={retryFailedFromReview}
              cardPreviewMap={cardPreviewMap}
            />

            <div className="rounded-md border border-border p-3 bg-card flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Ready to export: {data.filter((row) => row.status !== 'failed').length} rows
              </p>
              <Button type="button" size="sm" variant="outline" onClick={retryFailedFromReview}>
                Retry Failed
              </Button>
            </div>

            <Button onClick={handleExport} className="w-full scan-gradient scan-shadow h-12 text-primary-foreground font-medium">
              <Download className="w-5 h-5 mr-2" />
              Export to Excel
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
