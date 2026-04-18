import { BatchItem, BatchProgressSnapshot, DocumentType, SignupEntry, BusinessCardEntry } from '@/types/scan';

const MAX_IMAGE_SIZE_MB = 20;

const DOC_INTEL_URL = import.meta.env.VITE_DOC_INTEL_URL as string;
const DOC_INTEL_TOKEN = import.meta.env.VITE_DOC_INTEL_TOKEN as string;

const SIGNUP_SCHEMA = {
  fields: [
    { key: 'fullName', description: 'Full name of the person' },
    { key: 'organization', description: 'Organization or company affiliation' },
    { key: 'phone', description: 'Phone number' },
    { key: 'email', description: 'Email address' },
    { key: 'screening', description: 'Screening or waiver checkbox' },
    { key: 'shareInfo', description: 'Consent to share contact information' },
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
    organization?: string;
    phone?: string;
    email?: string;
    screening?: string;
    shareInfo?: string;
    date?: string;
    comments?: string;
  }>;
  structure?: string;
  detectedHeaders?: string[];
  headerMapping?: Record<string, string>;
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
  structure?: string;
  detectedHeaders?: string[];
  headerMapping?: Record<string, string>;
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
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[Scan2Sheet] business-card response:', {
          structure: result.structure,
          detectedHeaders: result.detectedHeaders,
          headerMapping: result.headerMapping,
        });
      }
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
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[Scan2Sheet] signin-sheet response:', {
        structure: result.structure,
        detectedHeaders: result.detectedHeaders,
        headerMapping: result.headerMapping,
        rowCount: result.rows?.length,
      });
    }
    if (Array.isArray(result.rows) && result.rows.length > 0) {
      return result.rows.map((row) => ({
        id: crypto.randomUUID(),
        fullName: row.fullName ?? '',
        organization: row.organization ?? '',
        phone: row.phone ?? '',
        email: row.email ?? '',
        screening: row.screening ?? '',
        shareInfo: row.shareInfo ?? '',
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
      organization: fieldMap['organization'] ?? '',
      phone: fieldMap['phone'] ?? '',
      email: fieldMap['email'] ?? '',
      screening: fieldMap['screening'] ?? '',
      shareInfo: fieldMap['shareInfo'] ?? '',
      date: fieldMap['date'] ?? '',
      comments: fieldMap['comments'] ?? '',
    },
  ];
}

export interface BatchExtractionOptions {
  concurrency?: number;
  itemIds?: string[];
  onItemUpdate?: (id: string, patch: Partial<BatchItem>) => void;
  onProgress?: (snapshot: BatchProgressSnapshot) => void;
}

export interface BatchExtractionResult {
  items: BatchItem[];
  combinedRows: BusinessCardEntry[];
  summary: BatchProgressSnapshot;
}

const DEFAULT_BATCH_CONCURRENCY = 3;

function getBatchSnapshot(items: BatchItem[]): BatchProgressSnapshot {
  const snapshot: BatchProgressSnapshot = {
    total: items.length,
    queued: 0,
    processing: 0,
    done: 0,
    failed: 0,
    needsReview: 0,
  };

  for (const item of items) {
    if (item.status === 'queued') snapshot.queued += 1;
    if (item.status === 'processing') snapshot.processing += 1;
    if (item.status === 'done') snapshot.done += 1;
    if (item.status === 'failed') snapshot.failed += 1;
    if (item.status === 'needs_review') snapshot.needsReview += 1;
  }

  return snapshot;
}

function withBusinessCardMetadata(item: BatchItem, rows: BusinessCardEntry[]): BusinessCardEntry[] {
  const sourceLabel = item.filename || `Image ${item.index + 1}`;
  return rows.map((row) => {
    const hasCoreFields = [row.firstName, row.lastName, row.company, row.email, row.phone]
      .some((value) => (value ?? '').trim().length > 0);
    const rowNeedsReview = item.needsReview || !hasCoreFields;

    return {
      ...row,
      sourceLabel,
      sourceItemId: item.id,
      sourceType: item.sourceType,
      needsReview: rowNeedsReview,
      status: rowNeedsReview ? 'needs_review' : 'complete',
    };
  });
}

export async function extractBusinessCardBatch(
  items: BatchItem[],
  options: BatchExtractionOptions = {}
): Promise<BatchExtractionResult> {
  const targetIds = new Set(options.itemIds ?? items.map((item) => item.id));
  const targetItems = items.filter((item) => targetIds.has(item.id));
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_BATCH_CONCURRENCY);

  for (const item of targetItems) {
    if (item.status === 'failed') {
      item.status = 'queued';
      item.error = undefined;
      item.extractedRows = [];
      item.needsReview = false;
    }
  }

  options.onProgress?.(getBatchSnapshot(items));

  let cursor = 0;

  const runWorker = async () => {
    while (cursor < targetItems.length) {
      const currentIndex = cursor;
      cursor += 1;
      const item = targetItems[currentIndex];

      item.status = 'processing';
      options.onItemUpdate?.(item.id, { status: 'processing', error: undefined });
      options.onProgress?.(getBatchSnapshot(items));

      try {
        const rows = await extractFromImage(item.file, 'business-card') as BusinessCardEntry[];
        const normalizedRows = withBusinessCardMetadata(item, rows);
        const needsReview = normalizedRows.some((row) => row.needsReview);

        item.extractedRows = normalizedRows;
        item.needsReview = needsReview;
        item.status = needsReview ? 'needs_review' : 'done';
        item.error = undefined;

        options.onItemUpdate?.(item.id, {
          status: item.status,
          extractedRows: normalizedRows,
          needsReview,
          error: undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Extraction failed';
        item.extractedRows = [];
        item.status = 'failed';
        item.needsReview = true;
        item.error = message;

        options.onItemUpdate?.(item.id, {
          status: 'failed',
          extractedRows: [],
          needsReview: true,
          error: message,
        });
      }

      options.onProgress?.(getBatchSnapshot(items));
    }
  };

  const workerCount = Math.min(concurrency, targetItems.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  const combinedRows = items.flatMap((item) => item.extractedRows);
  const summary = getBatchSnapshot(items);

  return {
    items,
    combinedRows,
    summary,
  };
}

export function getDefaultBatchConcurrency() {
  return DEFAULT_BATCH_CONCURRENCY;
}

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
