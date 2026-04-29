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

export interface NameParts {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  prefix?: string;
  suffix?: string;
  credentials?: string[];
}

export interface AdditionalContact {
  name?: string;
  phone?: string;
  email?: string;
  title?: string;
}

export interface FieldConfidenceScores {
  fullName?: number;
  firstName?: number;
  lastName?: number;
  company?: number;
  title?: number;
  phone?: number;
  email?: number;
  website?: number;
  address?: number;
  tagline?: number;
}

export interface BusinessCardEntry {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  namePartsExtracted?: boolean;
  nameParts?: NameParts;
  company: string;
  title: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  tagline?: string;
  additionalContacts?: AdditionalContact[];
  fieldConfidence?: FieldConfidenceScores;
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
  manualCrop?: boolean;
  manualEntry?: boolean;
  manualCropBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  userEdited?: Set<keyof BusinessCardEntry>;
  // Phase 3: Export readiness
  exportStatus?: ExportStatus;
  exportBlockedReasons?: string[];
  exportWarningReasons?: string[];
  excludeFromExport?: boolean;
  // Phase 3: Candidate ranking
  candidates?: CardCandidates;
  // Phase 3: Duplicate detection
  duplicateOf?: string;
  duplicateStatus?: DuplicateStatus;
  // Phase 3: Restore original OCR values (populated before first user edit)
  originalOcrValues?: Partial<Pick<BusinessCardEntry, 'fullName' | 'firstName' | 'lastName' | 'company' | 'title' | 'phone' | 'email' | 'website' | 'address' | 'tagline'>>;
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

// ─── Phase 3: Candidate ranking ───────────────────────────────────────────────
export interface FieldCandidate {
  value: string;
  score: number;
  sourceLine: string;
  reasons: string[];
  rejected: boolean;
  rejectedReasons: string[];
}

export interface CardCandidates {
  personName?: FieldCandidate[];
  company?: FieldCandidate[];
  title?: FieldCandidate[];
  address?: FieldCandidate[];
  website?: FieldCandidate[];
  phone?: FieldCandidate[];
  tagline?: FieldCandidate[];
}

// ─── Phase 3: Export readiness ────────────────────────────────────────────────
export type ExportStatus = 'ready_to_export' | 'export_warning' | 'export_blocked';

// ─── Phase 3: Batch correction memory ─────────────────────────────────────────
export type BatchCorrectionType =
  | 'domain_to_company'
  | 'ignore_phrase'
  | 'normalize_company'
  | 'normalize_address'
  | 'normalize_title';

export interface BatchCorrectionRule {
  id: string;
  type: BatchCorrectionType;
  pattern: string;
  replacement?: string;
  appliedCount: number;
  createdAt: string;
}

export interface ScanSessionCorrections {
  rules: BatchCorrectionRule[];
}

// ─── Phase 3: Duplicate tracking ──────────────────────────────────────────────
export type DuplicateStatus = 'possible' | 'confirmed' | 'ignored';

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
  manualCrop?: boolean;
  manualEntry?: boolean;
  manualCropBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface BatchProgressSnapshot {
  total: number;
  queued: number;
  processing: number;
  done: number;
  failed: number;
  needsReview: number;
}
