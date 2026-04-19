import { useState, useEffect, useCallback, useMemo } from 'react';
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
  Loader2,
  RotateCw,
  ScanLine,
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
  BatchItem,
  BatchProgressSnapshot,
  BusinessCardEntry,
  DocumentType,
  ExtractedData,
  ExtractionMeta,
  ScanRecord,
  SignupEntry,
} from '@/types/scan';
import {
  createEmptyBusinessCard,
  extractBusinessCardBatch,
  extractFromImage,
  getDefaultBatchConcurrency,
} from '@/lib/extraction';
import { exportToExcel } from '@/lib/export';
import { getScanHistory, saveScanRecord } from '@/lib/storage';
import { toast } from 'sonner';

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
    description: 'Capture one photo and parse immediately.',
    icon: Camera,
  },
  {
    key: 'rapid',
    title: 'Scan a Stack Fast',
    description: 'Capture a backlog quickly, then process all cards together.',
    icon: ListChecks,
  },
  {
    key: 'multi-upload',
    title: 'Upload Multiple Photos',
    description: 'Choose many existing card photos and process them together.',
    icon: Images,
  },
];

const Index = () => {
  const [step, setStep] = useState<Step>('home');
  const [docType, setDocType] = useState<DocumentType>('business-card');
  const [captureMode, setCaptureMode] = useState<BusinessCardCaptureMode>('single');
  const [filePreviewUrl, setFilePreviewUrl] = useState<string>('');
  const [data, setData] = useState<(SignupEntry | BusinessCardEntry)[]>([]);
  const [extractionMeta, setExtractionMeta] = useState<ExtractionMeta | undefined>();
  const [businessCardFilter, setBusinessCardFilter] = useState<BusinessCardFilter>('all');
  const [history, setHistory] = useState<ScanRecord[]>([]);
  const [batchQueue, setBatchQueue] = useState<BatchItem[]>([]);
  const [batchProgress, setBatchProgress] = useState<BatchProgressSnapshot>(emptySnapshot);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);

  const refreshHistory = useCallback(() => {
    setHistory(getScanHistory());
  }, []);

  useEffect(() => {
    setHistory(getScanHistory());
  }, [refreshHistory]);

  const selectType = (type: DocumentType) => {
    setDocType(type);
    if (type === 'business-card') {
      setCaptureMode('single');
      setBusinessCardFilter('all');
    }
    setStep('capture');
  };

  const revokeQueuePreviewUrls = useCallback((items: BatchItem[]) => {
    items.forEach((item) => {
      try {
        URL.revokeObjectURL(item.previewUrl);
      } catch {
        // Ignore URL cleanup errors.
      }
    });
  }, []);

  const buildReviewRowsFromQueue = useCallback((queue: BatchItem[]) => {
    const rows: BusinessCardEntry[] = [];

    queue.forEach((item) => {
      if (item.extractedRows.length > 0) {
        rows.push(...item.extractedRows);
        return;
      }

      if (item.status === 'failed') {
        rows.push({
          ...createEmptyBusinessCard(),
          sourceLabel: item.filename || `Image ${item.index + 1}`,
          sourceItemId: item.id,
          sourceType: item.sourceType,
          needsReview: true,
          status: 'failed',
          error: item.error || 'Extraction failed',
        });
      }
    });

    return rows;
  }, []);

  const addCapturesToQueue = useCallback((captures: QueuedCapture[]) => {
    setBatchQueue((current) => {
      const nextIndexStart = current.length;
      const newItems: BatchItem[] = captures.map((capture, idx) => ({
        id: crypto.randomUUID(),
        file: capture.file,
        previewUrl: capture.previewUrl,
        status: 'queued',
        error: undefined,
        extractedRows: [],
        sourceType: capture.sourceType,
        needsReview: false,
        filename: capture.file.name,
        index: nextIndexStart + idx,
      }));

      return [...current, ...newItems];
    });
  }, []);

  const removeBatchItem = useCallback((id: string) => {
    setBatchQueue((current) => {
      const target = current.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }

      return current
        .filter((item) => item.id !== id)
        .map((item, index) => ({ ...item, index }));
    });
  }, []);

  const clearBatchQueue = useCallback(() => {
    setBatchQueue((current) => {
      revokeQueuePreviewUrls(current);
      return [];
    });
    setBatchProgress(emptySnapshot);
    setData([]);
    setExtractionMeta(undefined);
    setBusinessCardFilter('all');
  }, [revokeQueuePreviewUrls]);

  const processBatch = useCallback(async (itemIds?: string[]) => {
    const targetIds = itemIds ?? batchQueue.map((item) => item.id);
    if (targetIds.length === 0) {
      toast.error('No images in the queue.');
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
        toast.warning(`Processed ${result.summary.total} images. ${result.summary.failed} failed.`);
      } else {
        toast.success(`Processed ${result.summary.total} images.`);
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
      toast.info('No failed items to retry.');
      return;
    }

    await processBatch(failedIds);
  }, [batchQueue, processBatch]);

  const handleImageSelected = async (file: File, previewUrl: string) => {
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

  const handleExport = () => {
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
      imageUrl: filePreviewUrl || batchQueue[0]?.previewUrl || '',
      data: typedData,
      meta: extractionMeta,
      createdAt: new Date(),
    };

    saveScanRecord(record);

    const filename = docType === 'business-card' && batchQueue.length > 1
      ? `business-cards-batch-${new Date().toISOString().slice(0, 10)}`
      : undefined;

    exportToExcel(typedData, docType, filename);
    refreshHistory();
    toast.success('Exported to Excel!');
    reset();
  };

  const reset = useCallback(() => {
    setStep('home');
    setFilePreviewUrl('');
    setData([]);
    setExtractionMeta(undefined);
    setBusinessCardFilter('all');
    setCaptureMode('single');
    setBatchProgress(emptySnapshot);
    setBatchQueue((current) => {
      revokeQueuePreviewUrls(current);
      return [];
    });
  }, [revokeQueuePreviewUrls]);

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
              <div className="w-8 h-8 rounded-lg scan-gradient flex items-center justify-center">
                <ScanLine className="w-4 h-4 text-primary-foreground" />
              </div>
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
                  : 'Choose how you want to capture business cards.'}
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
              recentPreviews={batchQueue.slice(-8).reverse().map((item) => item.previewUrl)}
              onFinishBatch={() => {
                if (activeBatchCount === 0) {
                  toast.error('Capture at least one image first.');
                  return;
                }
                setStep('batch-queue');
              }}
              onViewQueue={() => setStep('batch-queue')}
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
                toast.info('Removed last capture.');
              }}
            />

            {docType === 'business-card' && activeBatchCount > 0 && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
                <p className="text-sm text-muted-foreground">Queue ready: {activeBatchCount} images</p>
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
                Remove bad shots before you process this batch.
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
                No images in queue yet.
              </div>
            ) : (
              <div className="space-y-3">
                {batchQueue.map((item, index) => (
                  <div key={item.id} className="rounded-lg border border-border p-3 bg-card flex gap-3">
                    <img
                      src={item.previewUrl}
                      alt={item.filename || `Queued image ${index + 1}`}
                      className="w-20 h-20 rounded-md object-cover border border-border"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {item.filename || `Image ${index + 1}`}
                      </p>
                      <p className="text-xs text-muted-foreground">#{index + 1} - {item.sourceType === 'camera' ? 'Camera' : 'Upload'}</p>
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
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'processing' && (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="w-16 h-16 rounded-full scan-gradient flex items-center justify-center animate-pulse">
              <Loader2 className="w-7 h-7 text-primary-foreground animate-spin" />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">Extracting data...</p>
              <p className="text-sm text-muted-foreground mt-1">Analyzing your document</p>
            </div>
          </div>
        )}

        {step === 'batch-processing' && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full scan-gradient flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-primary-foreground animate-spin" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">Processing Batch</h2>
                <p className="text-sm text-muted-foreground">Your cards are being parsed now.</p>
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
                Correct any errors before exporting to Excel.
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