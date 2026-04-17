import { DocumentType, SignupEntry, BusinessCardEntry, ExtractionMeta, HeaderMapping } from '@/types/scan';
import { getConfig } from '@/config/env';

// ── API response types (match new backend dynamic responses) ───────────────────

interface SigninProcessResponse {
  status: string;
  structure: string;
  detectedHeaders: string[];
  headerMapping: HeaderMapping[];
  rows: Array<Record<string, unknown>>;
  rawRows?: Array<Record<string, string>>;
  confidence: number;
}

interface BusinessCardProcessResponse {
  status: string;
  structure: string;
  detectedHeaders: string[];
  headerMapping: HeaderMapping[];
  card: Record<string, unknown>;
  confidence: number;
}

// ── Legacy generic /extract fallback types ──────────────────────────────────────

interface ExtractionField {
  key: string;
  value: string | null;
  confidence?: number;
}

interface ExtractionResponse {
  status: string;
  fields: ExtractionField[];
}

// ── Extraction result with metadata ────────────────────────────────────────────

export interface ExtractionResult<T> {
  entries: T[];
  meta: ExtractionMeta;
}

// ── Main extraction function ───────────────────────────────────────────────────

export async function extractFromImage(
  file: File,
  docType: DocumentType,
): Promise<ExtractionResult<SignupEntry> | ExtractionResult<BusinessCardEntry>> {
  const maxSizeMb = getConfig().cardCapture.maxFileSizeMb;
  if (file.size > maxSizeMb * 1024 * 1024) {
    throw new Error(`File exceeds ${maxSizeMb} MB limit.`);
  }

  const DOC_INTEL_URL = import.meta.env.VITE_DOC_INTEL_URL as string;
  const DOC_INTEL_TOKEN = import.meta.env.VITE_DOC_INTEL_TOKEN as string;

  if (!DOC_INTEL_URL || !DOC_INTEL_TOKEN) {
    console.warn('[Scan2Sheet] DOC_INTEL env vars not set — falling back to empty entries.');
    return docType === 'business-card'
      ? { entries: [createEmptyBusinessCard()], meta: emptyMeta() }
      : { entries: [createEmptySignupEntry(), createEmptySignupEntry(), createEmptySignupEntry()], meta: emptyMeta() };
  }

  const formData = new FormData();
  formData.append('file', file);

  const processPath = docType === 'business-card'
    ? '/process/business-card'
    : '/process/signin-sheet';

  // Try specialized (structure-first) endpoint
  const processRes = await fetch(`${DOC_INTEL_URL}${processPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DOC_INTEL_TOKEN}` },
    body: formData,
  });

  if (processRes.ok) {
    if (docType === 'business-card') {
      const result: BusinessCardProcessResponse = await processRes.json();
      logExtractionDebug('business-card', result);

      const card = mapBusinessCard(result.card);
      const meta: ExtractionMeta = {
        structure: (result.structure as ExtractionMeta['structure']) ?? 'unstructured',
        detectedHeaders: result.detectedHeaders ?? [],
        headerMapping: result.headerMapping ?? [],
        confidence: result.confidence ?? 0,
      };
      return { entries: [card], meta };
    }

    const result: SigninProcessResponse = await processRes.json();
    logExtractionDebug('signup-sheet', result);

    if (Array.isArray(result.rows) && result.rows.length > 0) {
      const entries = result.rows.map(mapSignupRow);
      const meta: ExtractionMeta = {
        structure: (result.structure as ExtractionMeta['structure']) ?? 'table',
        detectedHeaders: result.detectedHeaders ?? [],
        headerMapping: result.headerMapping ?? [],
        confidence: result.confidence ?? 0,
        rawRows: result.rawRows,
      };
      return { entries, meta };
    }
  }

  // Fallback: generic /extract endpoint
  console.warn('[Scan2Sheet] Specialized endpoint failed or returned no data — trying /extract fallback.');
  const fallbackFormData = new FormData();
  fallbackFormData.append('file', file);

  const schema = docType === 'business-card'
    ? { fields: [
        { key: 'firstName', description: 'First name' },
        { key: 'lastName', description: 'Last name' },
        { key: 'company', description: 'Company or organization name' },
        { key: 'title', description: 'Job title or role' },
        { key: 'phone', description: 'Phone number' },
        { key: 'email', description: 'Email address' },
        { key: 'website', description: 'Website URL' },
        { key: 'address', description: 'Mailing or street address' },
      ] }
    : { fields: [
        { key: 'fullName', description: 'Full name of the person' },
        { key: 'phone', description: 'Phone number' },
        { key: 'email', description: 'Email address' },
        { key: 'date', description: 'Date signed up' },
        { key: 'comments', description: 'Any comments or notes' },
      ] };

  fallbackFormData.append('schema', JSON.stringify(schema));

  const res = await fetch(`${DOC_INTEL_URL}/extract`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DOC_INTEL_TOKEN}` },
    body: fallbackFormData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Extraction failed (${res.status})`);
  }

  const result: ExtractionResponse = await res.json();
  console.warn('[Scan2Sheet] Fallback /extract response:', result);

  if (result.status !== 'complete' || !result.fields?.length) {
    console.warn('[Scan2Sheet] Extraction returned no fields — returning empty entry.');
    return docType === 'business-card'
      ? { entries: [createEmptyBusinessCard()], meta: emptyMeta('fallback') }
      : { entries: [createEmptySignupEntry()], meta: emptyMeta('fallback') };
  }

  const fieldMap = Object.fromEntries(
    result.fields.map((f) => [f.key, f.value ?? '']),
  );

  // Identify extra fields from fallback response
  const knownKeys = new Set(schema.fields.map((f) => f.key));
  const extraFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(fieldMap)) {
    if (!knownKeys.has(key) && value) {
      extraFields[key] = value;
    }
  }

  const meta: ExtractionMeta = {
    structure: 'unstructured',
    detectedHeaders: [],
    headerMapping: [],
    confidence: 0.3,
  };

  if (docType === 'business-card') {
    return {
      entries: [{
        id: crypto.randomUUID(),
        fullName: fieldMap['fullName'] ?? '',
        firstName: fieldMap['firstName'] ?? '',
        lastName: fieldMap['lastName'] ?? '',
        company: fieldMap['company'] ?? '',
        title: fieldMap['title'] ?? '',
        phone: fieldMap['phone'] ?? '',
        email: fieldMap['email'] ?? '',
        website: fieldMap['website'] ?? '',
        address: fieldMap['address'] ?? '',
        social: fieldMap['social'] ?? '',
        extraFields,
        rawText: '',
      }],
      meta,
    };
  }

  return {
    entries: [{
      id: crypto.randomUUID(),
      fullName: fieldMap['fullName'] ?? '',
      organization: fieldMap['organization'] ?? '',
      phone: fieldMap['phone'] ?? '',
      email: fieldMap['email'] ?? '',
      screening: fieldMap['screening'] ?? '',
      shareInfo: fieldMap['shareInfo'] ?? '',
      date: fieldMap['date'] ?? '',
      comments: fieldMap['comments'] ?? '',
      extraFields,
    }],
    meta,
  };
}

// ── Row/card mappers ───────────────────────────────────────────────────────────

function mapSignupRow(row: Record<string, unknown>): SignupEntry {
  const extra = (row.extraFields ?? {}) as Record<string, string>;
  return {
    id: String(row.id ?? crypto.randomUUID()),
    fullName: String(row.fullName ?? ''),
    organization: String(row.organization ?? ''),
    phone: String(row.phone ?? ''),
    email: String(row.email ?? ''),
    screening: String(row.screening ?? ''),
    shareInfo: String(row.shareInfo ?? ''),
    date: String(row.date ?? ''),
    comments: String(row.comments ?? ''),
    extraFields: extra,
  };
}

function mapBusinessCard(card: Record<string, unknown>): BusinessCardEntry {
  const extra = (card.extraFields ?? {}) as Record<string, string>;
  return {
    id: String(card.id ?? crypto.randomUUID()),
    fullName: String(card.fullName ?? ''),
    firstName: String(card.firstName ?? ''),
    lastName: String(card.lastName ?? ''),
    company: String(card.company ?? ''),
    title: String(card.title ?? ''),
    phone: String(card.phone ?? ''),
    email: String(card.email ?? ''),
    website: String(card.website ?? ''),
    address: String(card.address ?? ''),
    social: String(card.social ?? ''),
    extraFields: extra,
    rawText: String(card.rawText ?? ''),
  };
}

// ── Empty entry factories ──────────────────────────────────────────────────────

export function createEmptySignupEntry(): SignupEntry {
  return {
    id: crypto.randomUUID(),
    fullName: '',
    organization: '',
    phone: '',
    email: '',
    screening: '',
    shareInfo: '',
    date: '',
    comments: '',
    extraFields: {},
  };
}

export function createEmptyBusinessCard(): BusinessCardEntry {
  return {
    id: crypto.randomUUID(),
    fullName: '',
    firstName: '',
    lastName: '',
    company: '',
    title: '',
    phone: '',
    email: '',
    website: '',
    address: '',
    social: '',
    extraFields: {},
    rawText: '',
  };
}

// ── Debug logging ──────────────────────────────────────────────────────────────

function emptyMeta(note?: string): ExtractionMeta {
  return {
    structure: 'unstructured',
    detectedHeaders: [],
    headerMapping: [],
    confidence: 0,
    ...(note ? {} : {}),
  };
}

function logExtractionDebug(docType: string, response: unknown): void {
  if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_EXTRACTION === 'true') {
    const data = response as Record<string, unknown>;
    console.group(`[Scan2Sheet] ${docType} extraction result`);
    console.log('structure:', data.structure);
    console.log('detectedHeaders:', data.detectedHeaders);
    console.log('headerMapping:', data.headerMapping);
    console.log('confidence:', data.confidence);
    console.log('rows/card:', data.rows ?? data.card);
    console.log('rawRows:', data.rawRows);
    console.groupEnd();
  }
}
