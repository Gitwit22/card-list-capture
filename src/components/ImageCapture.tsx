import { useCallback, useState } from 'react';
import { Camera, ListChecks, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const MAX_FILE_SIZE_MB = 20;

// ─── Exported types ───────────────────────────────────────────────────────────

export type BusinessCardCaptureMode = 'single' | 'rapid' | 'multi-upload';

export interface QueuedCapture {
  file: File;
  previewUrl: string;
  sourceType: 'camera' | 'upload';
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ImageCaptureProps {
  /**
   * Called when a single file is selected (all modes).
   * For multi-upload mode, prefer onBatchAdd which receives all selected files at once.
   */
  onImageSelected: (file: File, previewUrl: string, sourceType?: 'camera' | 'upload') => void;
  /** Workflow mode controlling capture UI and batch behaviours. */
  mode?: BusinessCardCaptureMode;
  /** Called with all selected / dropped captures (multi-upload and rapid modes). */
  onBatchAdd?: (captures: QueuedCapture[]) => void;
  /** Total number of cards/captures currently in the workflow queue. */
  capturedCount?: number;
  /** True when rapid mode is waiting for the back side of the last card. */
  rapidAwaitingBack?: boolean;
  /** Preview URLs for the most-recently captured cards (rapid mode). */
  recentPreviews?: string[];
  /** Finish the current batch and proceed to queue review (rapid mode). */
  onFinishBatch?: () => void;
  /** Navigate directly to the batch queue. */
  onViewQueue?: () => void;
  /** Skip scanning the back of the current card (rapid mode). */
  onSkipBack?: () => void;
  /** Clear all queued captures and reset. */
  onCancelBatch?: () => void;
  /** Remove the most-recently added capture from the queue. */
  onRetakeLast?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validateFile(file: File): boolean {
  if (!file.type.startsWith('image/')) {
    toast.error('Please select an image file.');
    return false;
  }
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    toast.error(`Image exceeds ${MAX_FILE_SIZE_MB} MB limit.`);
    return false;
  }
  return true;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ImageCapture({
  onImageSelected,
  mode = 'single',
  onBatchAdd,
  capturedCount = 0,
  rapidAwaitingBack = false,
  recentPreviews = [],
  onFinishBatch,
  onViewQueue,
  onSkipBack,
  onCancelBatch,
  onRetakeLast,
}: ImageCaptureProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null, sourceType: 'camera' | 'upload') => {
      if (!files || files.length === 0) return;

      if (mode === 'multi-upload' && onBatchAdd) {
        // Validate all files and build batched captures.
        const captures: QueuedCapture[] = [];
        Array.from(files).forEach((file) => {
          if (!validateFile(file)) return;
          const previewUrl = URL.createObjectURL(file);
          captures.push({ file, previewUrl, sourceType });
        });
        if (captures.length > 0) {
          onBatchAdd(captures);
        }
        return;
      }

      // Single-file path (single / rapid modes).
      const file = files[0];
      if (!file || !validateFile(file)) return;
      const previewUrl = URL.createObjectURL(file);
      onImageSelected(file, previewUrl, sourceType);
    },
    [mode, onBatchAdd, onImageSelected],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files, 'upload');
    },
    [handleFiles],
  );

  const heading =
    mode === 'rapid' && rapidAwaitingBack
      ? 'Scan the back of the last card'
      : mode === 'multi-upload'
        ? 'Upload photos'
        : 'Drop an image here or';

  const subText =
    mode === 'multi-upload'
      ? 'Select multiple at once — JPG, PNG, HEIC'
      : 'Supports JPG, PNG, HEIC';

  const showBatchControls = (mode === 'rapid' || mode === 'multi-upload') && capturedCount > 0;

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
        }`}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Upload className="w-7 h-7 text-primary" />
          </div>
          <div>
            <p className="font-medium text-foreground">{heading}</p>
            <p className="text-sm text-muted-foreground mt-1">{subText}</p>
          </div>
          <div className="flex gap-3 flex-wrap justify-center">
            <Button variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <Upload className="w-4 h-4 mr-2" />
                {mode === 'multi-upload' ? 'Add Photos' : 'Upload File'}
                <input
                  type="file"
                  accept="image/*"
                  multiple={mode === 'multi-upload'}
                  className="hidden"
                  onChange={(e) => {
                    handleFiles(e.target.files, 'upload');
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <Camera className="w-4 h-4 mr-2" />
                Take Photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    handleFiles(e.target.files, 'camera');
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </Button>
          </div>
        </div>
      </div>

      {/* Rapid mode: recent capture thumbnails */}
      {mode === 'rapid' && recentPreviews.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {recentPreviews.map((url, i) => (
            <img
              key={i}
              src={url}
              alt={`Recent capture ${i + 1}`}
              className="w-16 h-16 rounded-md object-cover border border-border shrink-0"
            />
          ))}
        </div>
      )}

      {/* Batch action bar (rapid / multi-upload) */}
      {(showBatchControls || (mode === 'rapid' && rapidAwaitingBack)) && (
        <div className="flex flex-wrap gap-2 items-center">
          {mode === 'rapid' && rapidAwaitingBack && onSkipBack && (
            <Button type="button" size="sm" variant="outline" onClick={onSkipBack}>
              Skip Back
            </Button>
          )}
          {capturedCount > 0 && onViewQueue && (
            <Button type="button" size="sm" variant="outline" onClick={onViewQueue}>
              View Queue ({capturedCount})
            </Button>
          )}
          {mode === 'rapid' && capturedCount > 0 && onFinishBatch && (
            <Button type="button" size="sm" onClick={onFinishBatch}>
              <ListChecks className="w-4 h-4 mr-1.5" />
              Finish Batch
            </Button>
          )}
          {capturedCount > 0 && onRetakeLast && (
            <Button type="button" size="sm" variant="ghost" onClick={onRetakeLast}>
              Undo Last
            </Button>
          )}
          {capturedCount > 0 && onCancelBatch && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={onCancelBatch}
            >
              Cancel All
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
