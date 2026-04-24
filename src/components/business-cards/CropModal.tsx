import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';

export interface CropModalProps {
  sourceImageUrl: string;
  sourceImageName: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (cropData: {
    cropImageBlob: Blob;
    cropIndex: number;
    bounds: { x: number; y: number; width: number; height: number };
  }) => Promise<void>;
  nextCropIndex: number;
  isLoading?: boolean;
}

export function CropModal({
  sourceImageUrl,
  sourceImageName,
  isOpen,
  onClose,
  onConfirm,
  nextCropIndex,
  isLoading,
}: CropModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentRect, setCurrentRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 0 });

  // Load and display source image
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;

    const img = new Image();
    img.src = sourceImageUrl;
    img.onload = () => {
      setImage(img);
      setCanvasDimensions({ width: img.width, height: img.height });
      setZoom(1);
      setRotation(0);
      setPan({ x: 0, y: 0 });
      setCurrentRect(null);
      redrawCanvas(img, null, 1, 0, { x: 0, y: 0 });
    };
  }, [isOpen, sourceImageUrl]);

  const redrawCanvas = (
    img: HTMLImageElement,
    rect: typeof currentRect,
    z: number,
    rot: number,
    p: typeof pan,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = img.width;
    canvas.height = img.height;

    ctx.save();
    ctx.translate(img.width / 2 + p.x, img.height / 2 + p.y);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.scale(z, z);
    ctx.translate(-img.width / 2, -img.height / 2);
    ctx.drawImage(img, 0, 0);
    ctx.restore();

    // Draw selection rectangle
    if (rect) {
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 3;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      ctx.fillStyle = 'rgba(0, 255, 0, 0.1)';
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    setStartPoint({ x, y });
    setIsDrawing(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint || !image) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const currentX = (e.clientX - rect.left) * scaleX;
    const currentY = (e.clientY - rect.top) * scaleY;

    const cropRect = {
      x: Math.min(startPoint.x, currentX),
      y: Math.min(startPoint.y, currentY),
      width: Math.abs(currentX - startPoint.x),
      height: Math.abs(currentY - startPoint.y),
    };

    setCurrentRect(cropRect);
    redrawCanvas(image, cropRect, zoom, rotation, pan);
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
  };

  const handleConfirm = async () => {
    if (!currentRect) {
      toast.error('Please select a crop area first.');
      return;
    }

    const sourceCanvas = canvasRef.current;
    if (!sourceCanvas) return;

    const canvas = document.createElement('canvas');
    canvas.width = currentRect.width;
    canvas.height = currentRect.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(
      sourceCanvas,
      currentRect.x,
      currentRect.y,
      currentRect.width,
      currentRect.height,
      0,
      0,
      currentRect.width,
      currentRect.height,
    );

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      await onConfirm({
        cropImageBlob: blob,
        cropIndex: nextCropIndex,
        bounds: currentRect,
      });
      onClose();
    }, 'image/jpeg', 0.95);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Manual Crop: {sourceImageName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div
            ref={containerRef}
            className="relative bg-black rounded-md overflow-auto max-h-[500px] flex items-center justify-center"
          >
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className="cursor-crosshair max-w-full h-auto"
            />
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Zoom: {zoom.toFixed(2)}x</label>
              <Slider
                value={[zoom]}
                onValueChange={(value) => {
                  setZoom(value[0]);
                  if (image) redrawCanvas(image, currentRect, value[0], rotation, pan);
                }}
                min={0.5}
                max={3}
                step={0.1}
                className="w-full"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Rotate: {rotation}°</label>
              <Slider
                value={[rotation]}
                onValueChange={(value) => {
                  setRotation(value[0]);
                  if (image) redrawCanvas(image, currentRect, zoom, value[0], pan);
                }}
                min={-45}
                max={45}
                step={5}
                className="w-full"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Pan X: {Math.round(pan.x)}px</label>
              <Slider
                value={[pan.x]}
                onValueChange={(value) => {
                  const nextPan = { ...pan, x: value[0] };
                  setPan(nextPan);
                  if (image) redrawCanvas(image, currentRect, zoom, rotation, nextPan);
                }}
                min={-Math.max(100, canvasDimensions.width / 2)}
                max={Math.max(100, canvasDimensions.width / 2)}
                step={2}
                className="w-full"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Pan Y: {Math.round(pan.y)}px</label>
              <Slider
                value={[pan.y]}
                onValueChange={(value) => {
                  const nextPan = { ...pan, y: value[0] };
                  setPan(nextPan);
                  if (image) redrawCanvas(image, currentRect, zoom, rotation, nextPan);
                }}
                min={-Math.max(100, canvasDimensions.height / 2)}
                max={Math.max(100, canvasDimensions.height / 2)}
                step={2}
                className="w-full"
              />
            </div>

            {currentRect && (
              <p className="text-xs text-muted-foreground">
                Selection: {currentRect.width.toFixed(0)}×{currentRect.height.toFixed(0)}px
                {' | '}Aspect: {(currentRect.width / currentRect.height).toFixed(2)}:1
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!currentRect || isLoading}
          >
            {isLoading ? 'Processing...' : 'Confirm Crop'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
