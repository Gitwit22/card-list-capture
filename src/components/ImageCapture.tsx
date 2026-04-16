import { useState, useCallback } from 'react';
import { Camera, Upload, X, FileText, FileSpreadsheet, File as FileIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  validateFile,
  getAcceptString,
  getSupportedFormatsLabel,
  isImageFile,
  getFileCategory,
} from '@/lib/fileValidation';

interface ImageCaptureProps {
  onImageSelected: (file: File, previewUrl: string) => void;
}

function FilePreview({ file, previewUrl }: { file: File; previewUrl: string | null }) {
  const category = getFileCategory(file);

  if (category === 'image' && previewUrl) {
    return <img src={previewUrl} alt="Captured document" className="w-full max-h-80 object-contain bg-secondary" />;
  }

  const Icon = category === 'spreadsheet' ? FileSpreadsheet : category === 'document' ? FileText : FileIcon;
  const sizeMb = (file.size / (1024 * 1024)).toFixed(1);

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 bg-secondary">
      <Icon className="w-16 h-16 text-muted-foreground" />
      <div className="text-center px-4">
        <p className="font-medium text-foreground text-sm truncate max-w-[250px]">{file.name}</p>
        <p className="text-xs text-muted-foreground mt-1">{sizeMb} MB</p>
      </div>
    </div>
  );
}

export function ImageCapture({ onImageSelected }: ImageCaptureProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback((file: File) => {
    const result = validateFile(file);
    if (!result.valid) {
      toast.error(result.error);
      return;
    }

    const url = isImageFile(file) ? URL.createObjectURL(file) : null;
    setPreview(url);
    setSelectedFile(file);
    onImageSelected(file, url ?? '');
  }, [onImageSelected]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const clear = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setSelectedFile(null);
  };

  const acceptStr = getAcceptString();
  const formatsLabel = getSupportedFormatsLabel();

  if (selectedFile) {
    return (
      <div className="relative rounded-lg overflow-hidden border border-border card-shadow">
        <FilePreview file={selectedFile} previewUrl={preview} />
        <button
          onClick={clear}
          className="absolute top-2 right-2 p-1.5 rounded-full bg-foreground/70 text-background hover:bg-foreground/90 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

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
          <Upload className="w-7 h-7 text-primary" />
        </div>
        <div>
          <p className="font-medium text-foreground">Drop a file here or</p>
          <p className="text-sm text-muted-foreground mt-1">Supports {formatsLabel}</p>
        </div>
        <div className="flex gap-3 flex-wrap justify-center">
          <Button variant="outline" size="sm" asChild>
            <label className="cursor-pointer">
              <Upload className="w-4 h-4 mr-2" />
              Upload File
              <input type="file" accept={acceptStr} className="hidden" onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }} />
            </label>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <label className="cursor-pointer">
              <Camera className="w-4 h-4 mr-2" />
              Take Photo
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }} />
            </label>
          </Button>
        </div>
      </div>
    </div>
  );
}
