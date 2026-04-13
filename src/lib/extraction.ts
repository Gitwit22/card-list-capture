import { DocumentType, SignupEntry, BusinessCardEntry } from '@/types/scan';

// Simulated AI extraction - in production this would call an AI vision API
export async function extractFromImage(
  imageFile: File,
  docType: DocumentType
): Promise<SignupEntry[] | BusinessCardEntry[]> {
  // Simulate processing delay
  await new Promise(resolve => setTimeout(resolve, 2000));

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
