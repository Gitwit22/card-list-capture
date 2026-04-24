export type DocumentType = 'signup-sheet' | 'business-card';

export interface SignupEntry {
  id: string;
  fullName: string;
  organization: string;
  phone: string;
  email: string;
  screening: string;
  shareInfo: string;
  date: string;
  comments: string;
  extraFields: Record<string, string>;
}

export interface BusinessCardEntry {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  namePartsExtracted?: boolean;
  company: string;
  title: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  sourceLabel?: string;
  sourceItemId?: string;
  sourceCardId?: string;
  sourceImageId?: string;
  sourceImageName?: string;
  sourceImageUrl?: string;
  cropIndex?: number;
  cropImageUrl?: string;
  scanMode?: ScanMode;
  frontBackStatus?: 'front-only' | 'front-and-back';
  sourceType?: 'camera' | 'upload';
  hasBack?: boolean;
  frontPreviewUrl?: string;
  backPreviewUrl?: string;
  backText?: string;
  conflictFields?: string[];
  warnings?: string[];
  confidence?: number;
  needsReview?: boolean;
  status?: 'complete' | 'needs_review' | 'failed';
  error?: string;
  social: string;
  comment?: string;
  extraFields: Record<string, string>;
  rawText: string;
}

export type ScanMode = 'single-card' | 'multi-card';

export interface HeaderMapping {
  original: string;
  normalized: string | null;
}

export interface ExtractionMeta {
  structure: 'table' | 'single-entity' | 'unstructured';
  detectedHeaders: string[];
  headerMapping: HeaderMapping[];
  confidence: number;
  rawRows?: Array<Record<string, string>>;
}

export type ExtractedData = SignupEntry[] | BusinessCardEntry[];

export interface ScanRecord {
  id: string;
  type: DocumentType;
  imageUrl: string;
  data: ExtractedData;
  meta?: ExtractionMeta;
  createdAt: Date;
}

export type BatchItemStatus = 'queued' | 'processing' | 'done' | 'failed' | 'needs_review';

export interface CardImageSide {
  file: File;
  previewUrl: string;
  filename?: string;
  sourceType: 'camera' | 'upload';
}

export interface BatchCardItem {
  id: string;
  front: CardImageSide;
  back?: CardImageSide;
  sourceImageId?: string;
  sourceImageName?: string;
  sourceImageUrl?: string;
  cropIndex?: number;
  scanMode?: ScanMode;
  confidence?: number;
  warnings?: string[];
  status: BatchItemStatus;
  error?: string;
  extractedRows: BusinessCardEntry[];
  needsReview: boolean;
  index: number;
}

export interface BatchProgressSnapshot {
  total: number;
  queued: number;
  processing: number;
  done: number;
  failed: number;
  needsReview: number;
}
