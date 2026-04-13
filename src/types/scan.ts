export type DocumentType = 'signup-sheet' | 'business-card';

export interface SignupEntry {
  id: string;
  fullName: string;
  phone: string;
  email: string;
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
}

export type ExtractedData = SignupEntry[] | BusinessCardEntry[];

export interface ScanRecord {
  id: string;
  type: DocumentType;
  imageUrl: string;
  data: ExtractedData;
  createdAt: Date;
}
