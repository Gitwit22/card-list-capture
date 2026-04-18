import { useState, useCallback } from 'react';
import { Camera, Images, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const MAX_FILE_SIZE_MB = 20;

export type BusinessCardCaptureMode = 'single' | 'rapid' | 'multi-upload';

export interface QueuedCapture {
  file: File;
  previewUrl: string;
  sourceType: 'camera' | 'upload';
}

interface ImageCaptureProps {
  onImageSelected: (file: File, previewUrl: string) => void;
  mode?: BusinessCardCaptureMode;
  onBatchAdd?: (captures: QueuedCapture[]) => void;
  capturedCount?: number;
  recentPreviews?: string[];
  onFinishBatch?: () => void;
  onViewQueue?: () => void;
  onCancelBatch?: () => void;
  onRetakeLast?: () => void;
}

export function ImageCapture({
  onImageSelected,
  mode = 'single',
  onBatchAdd,
  capturedCount = 0,
  recentPreviews = [],
  onFinishBatch,
  onViewQueue,
  onCancelBatch,
  onRetakeLast,
}: ImageCaptureProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const validateFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file.');
      return false;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast.error(`Image exceeds ${MAX_FILE_SIZE_MB} MB limit.`);
      return false;
    }
    return true;
  }, []);

  const handleSingleFile = useCallback((file: File) => {
    if (!validateFile(file)) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    onImageSelected(file, url);
  }, [onImageSelected, validateFile]);

  const queueFiles = useCallback((files: FileList | File[], sourceType: 'camera' | 'upload') => {
    const valid: QueuedCapture[] = [];
    Array.from(files).forEach((file) => {
      if (!validateFile(file)) return;
      valid.push({
        file,
        previewUrl: URL.createObjectURL(file),
        sourceType,
      });
    });

    if (valid.length === 0) return;
    onBatchAdd?.(valid);
    toast.success(`${valid.length} ${valid.length === 1 ? 'photo' : 'photos'} added to queue.`);
  }, [onBatchAdd, validateFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (mode === 'single') {
      const file = e.dataTransfer.files[0];
      if (file) handleSingleFile(file);
      return;
    }
    queueFiles(e.dataTransfer.files, 'upload');
  }, [handleSingleFile, mode, queueFiles]);

  const clear = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
  };

  if (mode === 'single' && preview) {
    return (
      <div className="relative rounded-lg overflow-hidden border border-border card-shadow">
        <img src={preview} alt="Captured document" className="w-full max-h-80 object-contain bg-secondary" />
        <button
          onClick={clear}
          className="absolute top-2 right-2 p-1.5 rounded-full bg-foreground/70 text-background hover:bg-foreground/90 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const isRapidMode = mode === 'rapid';
  const isMultiUploadMode = mode === 'multi-upload';

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
        dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
      }`}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          {isRapidMode ? (
            <Camera className="w-7 h-7 text-primary" />
          ) : isMultiUploadMode ? (
            <Images className="w-7 h-7 text-primary" />
          ) : (
            <Upload className="w-7 h-7 text-primary" />
          )}
        </div>
        <div>
          {mode === 'single' && (
            <>
              <p className="font-medium text-foreground">Drop an image here or</p>
              <p className="text-sm text-muted-foreground mt-1">Supports JPG, PNG, HEIC</p>
            </>
          )}
          {isRapidMode && (
            <>
              <p className="font-medium text-foreground">{capturedCount} captured</p>
              <p className="text-sm text-muted-foreground mt-1">Take photos quickly, then process them together.</p>
            </>
          )}
          {isMultiUploadMode && (
            <>
              <p className="font-medium text-foreground">Select many photos at once</p>
              <p className="text-sm text-muted-foreground mt-1">Add existing card photos to the queue.</p>
            </>
          )}
        </div>

        {mode === 'single' && (
          <div className="flex gap-3">
            <Button variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <Upload className="w-4 h-4 mr-2" />
                Upload File
                <input type="file" accept="image/*" className="hidden" onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleSingleFile(f);
                }} />
              </label>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <Camera className="w-4 h-4 mr-2" />
                Take Photo
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleSingleFile(f);
                }} />
              </label>
            </Button>
          </div>
        )}

        {isRapidMode && (
          <>
            <div className="flex gap-2 flex-wrap justify-center">
              <Button size="sm" asChild>
                <label className="cursor-pointer">
                  <Camera className="w-4 h-4 mr-2" />
                  Capture
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => {
                    if (e.target.files?.length) queueFiles(e.target.files, 'camera');
                    e.currentTarget.value = '';
                  }} />
                </label>
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onFinishBatch}>
                Finish Batch
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onViewQueue}>
                View Queue
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onCancelBatch}>
                Cancel
              </Button>
              {capturedCount > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={onRetakeLast}>
                  Retake Last
                </Button>
              )}
            </div>
            {recentPreviews.length > 0 && (
              <div className="w-full">
                <p className="text-xs text-muted-foreground mb-2">Recent captures</p>
                <div className="grid grid-cols-4 gap-2">
                  {recentPreviews.slice(0, 8).map((url, index) => (
                    <img
                      key={`${url}-${index}`}
                      src={url}
                      alt={`Recent capture ${index + 1}`}
                      className="h-16 w-full object-cover rounded-md border border-border"
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {isMultiUploadMode && (
          <div className="flex gap-2 flex-wrap justify-center">
            <Button size="sm" asChild>
              <label className="cursor-pointer">
                <Images className="w-4 h-4 mr-2" />
                Choose Photos
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={e => {
                    if (e.target.files?.length) queueFiles(e.target.files, 'upload');
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onViewQueue}>
              View Queue
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onCancelBatch}>
              Cancel
            </Button>
          </div>
        )}

        {mode !== 'single' && (
          <p className="text-xs text-muted-foreground">Drag and drop works here too.</p>
        )}
        {mode !== 'single' && (
          <p className="text-xs text-muted-foreground">Supports JPG, PNG, HEIC</p>
        )}
        {mode !== 'single' && (
          <p className="text-xs text-muted-foreground">Queue size: {capturedCount}</p>
        )}
      </div>
    </div>
  );
}
