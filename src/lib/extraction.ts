import { DocumentType, SignupEntry, BusinessCardEntry } from '@/types/scan';

const MAX_IMAGE_SIZE_MB = 20;

/**
 * Stub extraction — returns empty entries for manual data entry.
 * Replace this with an AI vision API (e.g. OpenAI Vision, Google Cloud Vision)
 * to enable real OCR extraction.
 */
export async function extractFromImage(
  imageFile: File,
  docType: DocumentType
): Promise<SignupEntry[] | BusinessCardEntry[]> {
  if (imageFile.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
    throw new Error(`Image exceeds ${MAX_IMAGE_SIZE_MB} MB limit.`);
  }

  console.warn('[Scan2Sheet] extractFromImage is a stub — no OCR is performed. Returning empty entries for manual entry.');

  // Simulate processing delay
  await new Promise(resolve => setTimeout(resolve, 1500));

  if (docType === 'business-card') {
    return [createEmptyBusinessCard()];
  }
  
  return [createEmptySignupEntry(), createEmptySignupEntry(), createEmptySignupEntry()];
}

export function createEmptySignupEntry(): SignupEntry {
  return {
    id: crypto.randomUUID(),
    fullName: '',
    phone: '',
    email: '',
    date: '',
    comments: '',
  };
}

export function createEmptyBusinessCard(): BusinessCardEntry {
  return {
    id: crypto.randomUUID(),
    firstName: '',
    lastName: '',
    company: '',
    title: '',
    phone: '',
    email: '',
    website: '',
    address: '',
  };
}
