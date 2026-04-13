import { useState, useCallback } from 'react';
import { Camera, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ImageCaptureProps {
  onImageSelected: (file: File, previewUrl: string) => void;
}

export function ImageCapture({ onImageSelected }: ImageCaptureProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    onImageSelected(file, url);
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
  };

  if (preview) {
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
          <p className="font-medium text-foreground">Drop an image here or</p>
          <p className="text-sm text-muted-foreground mt-1">Supports JPG, PNG, HEIC</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" size="sm" asChild>
            <label className="cursor-pointer">
              <Upload className="w-4 h-4 mr-2" />
              Upload File
              <input type="file" accept="image/*" className="hidden" onChange={e => {
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
