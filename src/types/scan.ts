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
}

export interface BusinessCardEntry {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  sourceLabel?: string;
  sourceItemId?: string;
  sourceType?: 'camera' | 'upload';
  needsReview?: boolean;
  status?: 'complete' | 'needs_review' | 'failed';
  error?: string;
}

export type ExtractedData = SignupEntry[] | BusinessCardEntry[];

export interface ScanRecord {
  id: string;
  type: DocumentType;
  imageUrl: string;
  data: ExtractedData;
  createdAt: Date;
}

export type BatchItemStatus = 'queued' | 'processing' | 'done' | 'failed' | 'needs_review';

export interface BatchItem {
  id: string;
  file: File;
  previewUrl: string;
  status: BatchItemStatus;
  error?: string;
  extractedRows: BusinessCardEntry[];
  sourceType: 'camera' | 'upload';
  needsReview: boolean;
  filename?: string;
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
