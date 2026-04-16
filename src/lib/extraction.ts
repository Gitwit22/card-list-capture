import { DocumentType, SignupEntry, BusinessCardEntry } from '@/types/scan';
import { getConfig } from '@/config/env';

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

interface SigninProcessResponse {
  status: string;
  rows: Array<{
    fullName?: string;
    phone?: string;
    email?: string;
    date?: string;
    comments?: string;
  }>;
}

interface BusinessCardProcessResponse {
  status: string;
  card?: {
    firstName?: string;
    lastName?: string;
    company?: string;
    title?: string;
    phone?: string;
    email?: string;
    website?: string;
    address?: string;
  };
}

export async function extractFromImage(
  file: File,
  docType: DocumentType
): Promise<SignupEntry[] | BusinessCardEntry[]> {
  const maxSizeMb = getConfig().cardCapture.maxFileSizeMb;
  if (file.size > maxSizeMb * 1024 * 1024) {
    throw new Error(`File exceeds ${maxSizeMb} MB limit.`);
  }

  if (!DOC_INTEL_URL || !DOC_INTEL_TOKEN) {
    console.warn('[Scan2Sheet] DOC_INTEL env vars not set — falling back to empty entries.');
    return docType === 'business-card'
      ? [createEmptyBusinessCard()]
      : [createEmptySignupEntry(), createEmptySignupEntry(), createEmptySignupEntry()];
  }

  const schema = docType === 'business-card' ? BUSINESS_CARD_SCHEMA : SIGNUP_SCHEMA;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('schema', JSON.stringify(schema));

  const processPath = docType === 'business-card'
    ? '/process/business-card'
    : '/process/signin-sheet';

  // Prefer specialized workflow endpoints first, then fallback to generic extract.
  const processRes = await fetch(`${DOC_INTEL_URL}${processPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DOC_INTEL_TOKEN}` },
    body: formData,
  });

  if (processRes.ok) {
    if (docType === 'business-card') {
      const result: BusinessCardProcessResponse = await processRes.json();
      const card = result.card ?? {};
      return [
        {
          id: crypto.randomUUID(),
          firstName: card.firstName ?? '',
          lastName: card.lastName ?? '',
          company: card.company ?? '',
          title: card.title ?? '',
          phone: card.phone ?? '',
          email: card.email ?? '',
          website: card.website ?? '',
          address: card.address ?? '',
        },
      ];
    }

    const result: SigninProcessResponse = await processRes.json();
    if (Array.isArray(result.rows) && result.rows.length > 0) {
      return result.rows.map((row) => ({
        id: crypto.randomUUID(),
        fullName: row.fullName ?? '',
        phone: row.phone ?? '',
        email: row.email ?? '',
        date: row.date ?? '',
        comments: row.comments ?? '',
      }));
    }
  }

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
