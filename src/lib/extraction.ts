import { DocumentType, SignupEntry, BusinessCardEntry } from '@/types/scan';

const MAX_IMAGE_SIZE_MB = 20;

const DOC_INTEL_URL = import.meta.env.VITE_DOC_INTEL_URL as string;
const DOC_INTEL_TOKEN = import.meta.env.VITE_DOC_INTEL_TOKEN as string;

const SIGNUP_SCHEMA = {
  fields: [
    { key: 'fullName', description: 'Full name of the person' },
    { key: 'phone', description: 'Phone number' },
    { key: 'email', description: 'Email address' },
    { key: 'date', description: 'Date signed up' },
    { key: 'comments', description: 'Any comments or notes' },
  ],
};

const BUSINESS_CARD_SCHEMA = {
  fields: [
    { key: 'firstName', description: 'First name' },
    { key: 'lastName', description: 'Last name' },
    { key: 'company', description: 'Company or organization name' },
    { key: 'title', description: 'Job title or role' },
    { key: 'phone', description: 'Phone number' },
    { key: 'email', description: 'Email address' },
    { key: 'website', description: 'Website URL' },
    { key: 'address', description: 'Mailing or street address' },
  ],
};

interface ExtractionField {
  key: string;
  value: string | null;
  confidence?: number;
}

interface ExtractionResponse {
  status: string;
  fields: ExtractionField[];
}

export async function extractFromImage(
  imageFile: File,
  docType: DocumentType
): Promise<SignupEntry[] | BusinessCardEntry[]> {
  if (imageFile.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
    throw new Error(`Image exceeds ${MAX_IMAGE_SIZE_MB} MB limit.`);
  }

  if (!DOC_INTEL_URL || !DOC_INTEL_TOKEN) {
    console.warn('[Scan2Sheet] DOC_INTEL env vars not set — falling back to empty entries.');
    return docType === 'business-card'
      ? [createEmptyBusinessCard()]
      : [createEmptySignupEntry(), createEmptySignupEntry(), createEmptySignupEntry()];
  }

  const schema = docType === 'business-card' ? BUSINESS_CARD_SCHEMA : SIGNUP_SCHEMA;

  const formData = new FormData();
  formData.append('file', imageFile);
  formData.append('schema', JSON.stringify(schema));

  const res = await fetch(`${DOC_INTEL_URL}/extract`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DOC_INTEL_TOKEN}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Extraction failed (${res.status})`);
  }

  const result: ExtractionResponse = await res.json();

  if (result.status !== 'complete' || !result.fields?.length) {
    console.warn('[Scan2Sheet] Extraction returned no fields — returning empty entry.');
    return docType === 'business-card'
      ? [createEmptyBusinessCard()]
      : [createEmptySignupEntry()];
  }

  const fieldMap = Object.fromEntries(
    result.fields.map((f) => [f.key, f.value ?? ''])
  );

  if (docType === 'business-card') {
    return [
      {
        id: crypto.randomUUID(),
        firstName: fieldMap['firstName'] ?? '',
        lastName: fieldMap['lastName'] ?? '',
        company: fieldMap['company'] ?? '',
        title: fieldMap['title'] ?? '',
        phone: fieldMap['phone'] ?? '',
        email: fieldMap['email'] ?? '',
        website: fieldMap['website'] ?? '',
        address: fieldMap['address'] ?? '',
      },
    ];
  }

  return [
    {
      id: crypto.randomUUID(),
      fullName: fieldMap['fullName'] ?? '',
      phone: fieldMap['phone'] ?? '',
      email: fieldMap['email'] ?? '',
      date: fieldMap['date'] ?? '',
      comments: fieldMap['comments'] ?? '',
    },
  ];
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
