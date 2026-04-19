import {
  BatchCardItem,
  BatchProgressSnapshot,
  BusinessCardEntry,
  CardImageSide,
  DocumentType,
  ExtractionMeta,
  HeaderMapping,
  SignupEntry,
} from '@/types/scan';
import { getConfig } from '@/config/env';

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

interface ExtractionField {
  key: string;
  value: string | null;
  confidence?: number;
}

interface ExtractionResponse {
  status: string;
  fields: ExtractionField[];
}

export interface ExtractionResult<T> {
  entries: T[];
  meta: ExtractionMeta;
}

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
    console.warn('[Scan2Sheet] DOC_INTEL env vars not set � falling back to empty entries.');
    return docType === 'business-card'
      ? { entries: [createEmptyBusinessCard()], meta: emptyMeta() }
      : { entries: [createEmptySignupEntry(), createEmptySignupEntry(), createEmptySignupEntry()], meta: emptyMeta() };
  }

  const formData = new FormData();
  formData.append('file', file);

  const processPath = docType === 'business-card'
    ? '/process/business-card'
    : '/process/signin-sheet';

  const processRes = await fetch(`${DOC_INTEL_URL}${processPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DOC_INTEL_TOKEN}` },
    body: formData,
  });

  if (processRes.ok) {
    if (docType === 'business-card') {
      const result: BusinessCardProcessResponse = await processRes.json();
      logExtractionDebug('business-card', result);

      const card = mapBusinessCard(result.card ?? {});
      const meta: ExtractionMeta = {
        structure: (result.structure as ExtractionMeta['structure']) ?? 'single-entity',
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

  console.warn('[Scan2Sheet] Specialized endpoint failed or returned no data � trying /extract fallback.');

  const fallbackFormData = new FormData();
  fallbackFormData.append('file', file);

  const schema = docType === 'business-card'
    ? {
        fields: [
          { key: 'fullName', description: 'Full name' },
          { key: 'firstName', description: 'First name' },
          { key: 'lastName', description: 'Last name' },
          { key: 'company', description: 'Company or organization name' },
          { key: 'title', description: 'Job title or role' },
          { key: 'phone', description: 'Phone number' },
          { key: 'email', description: 'Email address' },
          { key: 'website', description: 'Website URL' },
          { key: 'address', description: 'Mailing or street address' },
          { key: 'social', description: 'Social media handle or URL' },
        ],
      }
    : {
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

  if (result.status !== 'complete' || !result.fields?.length) {
    console.warn('[Scan2Sheet] Extraction returned no fields � returning empty entry.');
    return docType === 'business-card'
      ? { entries: [createEmptyBusinessCard()], meta: emptyMeta('fallback') }
      : { entries: [createEmptySignupEntry()], meta: emptyMeta('fallback') };
  }

  const fieldMap = Object.fromEntries(result.fields.map((f) => [f.key, f.value ?? '']));

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
      entries: [
        {
          ...createEmptyBusinessCard(),
          fullName: fieldMap.fullName ?? '',
          firstName: fieldMap.firstName ?? '',
          lastName: fieldMap.lastName ?? '',
          company: fieldMap.company ?? '',
          title: fieldMap.title ?? '',
          phone: fieldMap.phone ?? '',
          email: fieldMap.email ?? '',
          website: fieldMap.website ?? '',
          address: fieldMap.address ?? '',
          social: fieldMap.social ?? '',
          extraFields,
          rawText: '',
        },
      ],
      meta,
    };
  }

  return {
    entries: [
      {
        ...createEmptySignupEntry(),
        fullName: fieldMap.fullName ?? '',
        organization: fieldMap.organization ?? '',
        phone: fieldMap.phone ?? '',
        email: fieldMap.email ?? '',
        screening: fieldMap.screening ?? '',
        shareInfo: fieldMap.shareInfo ?? '',
        date: fieldMap.date ?? '',
        comments: fieldMap.comments ?? '',
        extraFields,
      },
    ],
    meta,
  };
}

export interface BatchExtractionOptions {
  concurrency?: number;
  itemIds?: string[];
  onItemUpdate?: (id: string, patch: Partial<BatchCardItem>) => void;
  onProgress?: (snapshot: BatchProgressSnapshot) => void;
}

export interface BatchExtractionResult {
  items: BatchCardItem[];
  combinedRows: BusinessCardEntry[];
  summary: BatchProgressSnapshot;
}

const DEFAULT_BATCH_CONCURRENCY = 3;

function getBatchSnapshot(items: BatchCardItem[]): BatchProgressSnapshot {
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

function withBusinessCardMetadata(item: BatchCardItem, rows: BusinessCardEntry[]): BusinessCardEntry[] {
  const sourceLabel = item.front.filename || `Card ${item.index + 1}`;
  return rows.map((row) => {
    const hasCoreFields = [row.fullName, row.firstName, row.lastName, row.company, row.email, row.phone]
      .some((value) => (value ?? '').trim().length > 0);
    const hasConflicts = (row.conflictFields?.length ?? 0) > 0;
    const rowNeedsReview = item.needsReview || !hasCoreFields || hasConflicts;

    return {
      ...row,
      sourceLabel,
      sourceItemId: item.id,
      sourceCardId: item.id,
      sourceType: item.front.sourceType,
      hasBack: Boolean(item.back),
      frontPreviewUrl: item.front.previewUrl,
      backPreviewUrl: item.back?.previewUrl,
      needsReview: rowNeedsReview,
      status: rowNeedsReview ? 'needs_review' : 'complete',
    };
  });
}

async function extractCardSide(side: CardImageSide): Promise<BusinessCardEntry> {
  const result = await extractFromImage(side.file, 'business-card');
  const rows = result.entries as BusinessCardEntry[];
  if (!rows.length) {
    return createEmptyBusinessCard();
  }
  return rows[0];
}

function mergeBusinessCardSides(front: BusinessCardEntry, back?: BusinessCardEntry): BusinessCardEntry {
  if (!back) {
    return front;
  }

  const primaryFields: Array<keyof BusinessCardEntry> = [
    'fullName',
    'firstName',
    'lastName',
    'company',
    'title',
    'phone',
    'email',
    'website',
    'address',
    'social',
  ];

  const conflicts: string[] = [];
  const merged = {
    ...front,
    id: front.id || crypto.randomUUID(),
    extraFields: { ...(front.extraFields ?? {}) },
  } as BusinessCardEntry;

  for (const field of primaryFields) {
    const frontValue = String(front[field] ?? '').trim();
    const backValue = String(back[field] ?? '').trim();

    if (!frontValue && backValue) {
      (merged[field] as string) = backValue;
      continue;
    }

    if (frontValue && backValue && frontValue.toLowerCase() !== backValue.toLowerCase()) {
      conflicts.push(String(field));
      merged.extraFields[`back_${String(field)}`] = backValue;
    }
  }

  for (const [key, value] of Object.entries(back.extraFields ?? {})) {
    if (!value) continue;
    if (!merged.extraFields[key]) {
      merged.extraFields[key] = value;
      continue;
    }
    if (merged.extraFields[key] !== value) {
      merged.extraFields[`back_${key}`] = value;
      if (!conflicts.includes(key)) {
        conflicts.push(key);
      }
    }
  }

  if (back.rawText?.trim()) {
    merged.backText = back.rawText;
    merged.rawText = [front.rawText, back.rawText].filter(Boolean).join('\n\n--- BACK ---\n\n');
  }

  if (conflicts.length > 0) {
    merged.conflictFields = conflicts;
  }

  return merged;
}

export async function extractBusinessCardRecord(item: BatchCardItem): Promise<BusinessCardEntry> {
  const frontEntry = await extractCardSide(item.front);
  const backEntry = item.back ? await extractCardSide(item.back) : undefined;
  return mergeBusinessCardSides(frontEntry, backEntry);
}

export async function extractBusinessCardBatch(
  items: BatchCardItem[],
  options: BatchExtractionOptions = {},
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
        const mergedEntry = await extractBusinessCardRecord(item);
        const rows = [mergedEntry];
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

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function asCleanString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function pickFieldValue(
  source: Record<string, unknown>,
  aliases: string[],
): { value: string; matchedKey: string | null } {
  const normalizedAliasSet = new Set(aliases.map(normalizeKey));

  for (const [key, rawValue] of Object.entries(source)) {
    if (!normalizedAliasSet.has(normalizeKey(key))) continue;
    const value = asCleanString(rawValue);
    if (!value) continue;
    return { value, matchedKey: key };
  }

  return { value: '', matchedKey: null };
}

function mapSignupRow(row: Record<string, unknown>): SignupEntry {
  const rowExtra = (row.extraFields ?? {}) as Record<string, unknown>;
  const mergedSource: Record<string, unknown> = {
    ...rowExtra,
    ...row,
  };

  const fullName = pickFieldValue(mergedSource, [
    'fullName',
    'name',
    'participantName',
    'attendeeName',
    'contactName',
    'personName',
    'signature',
  ]);
  const organization = pickFieldValue(mergedSource, [
    'organization',
    'org',
    'company',
    'business',
    'affiliation',
    'organizationName',
    'companyName',
    'employer',
    'agency',
  ]);
  const phone = pickFieldValue(mergedSource, [
    'phone',
    'phoneNumber',
    'mobile',
    'cell',
    'telephone',
  ]);
  const email = pickFieldValue(mergedSource, [
    'email',
    'emailAddress',
    'e-mail',
  ]);
  const screening = pickFieldValue(mergedSource, [
    'screening',
    'screeningStatus',
    'screened',
    'waiver',
  ]);
  const shareInfo = pickFieldValue(mergedSource, [
    'shareInfo',
    'shareInformation',
    'shareContact',
    'consentToShare',
    'optIn',
  ]);
  const date = pickFieldValue(mergedSource, [
    'date',
    'signupDate',
    'signDate',
    'timestamp',
  ]);
  const comments = pickFieldValue(mergedSource, [
    'comments',
    'comment',
    'notes',
    'note',
    'message',
  ]);

  const reservedNormalized = new Set([
    'id',
    'extrafields',
    ...(fullName.matchedKey ? [normalizeKey(fullName.matchedKey)] : []),
    ...(organization.matchedKey ? [normalizeKey(organization.matchedKey)] : []),
    ...(phone.matchedKey ? [normalizeKey(phone.matchedKey)] : []),
    ...(email.matchedKey ? [normalizeKey(email.matchedKey)] : []),
    ...(screening.matchedKey ? [normalizeKey(screening.matchedKey)] : []),
    ...(shareInfo.matchedKey ? [normalizeKey(shareInfo.matchedKey)] : []),
    ...(date.matchedKey ? [normalizeKey(date.matchedKey)] : []),
    ...(comments.matchedKey ? [normalizeKey(comments.matchedKey)] : []),
  ]);

  const extraFields: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(mergedSource)) {
    if (reservedNormalized.has(normalizeKey(key))) continue;
    const value = asCleanString(rawValue);
    if (!value) continue;
    extraFields[key] = value;
  }

  return {
    id: String(row.id ?? crypto.randomUUID()),
    fullName: fullName.value,
    organization: organization.value,
    phone: phone.value,
    email: email.value,
    screening: screening.value,
    shareInfo: shareInfo.value,
    date: date.value,
    comments: comments.value,
    extraFields,
  };
}

function mapBusinessCard(card: Record<string, unknown>): BusinessCardEntry {
  const cardExtra = (card.extraFields ?? {}) as Record<string, unknown>;
  const mergedSource: Record<string, unknown> = {
    ...cardExtra,
    ...card,
  };

  const fullName = pickFieldValue(mergedSource, [
    'fullName',
    'name',
    'contactName',
    'personName',
    'cardholderName',
  ]);
  const company = pickFieldValue(mergedSource, [
    'company',
    'organization',
    'org',
    'business',
    'companyName',
    'organizationName',
    'employer',
  ]);
  const title = pickFieldValue(mergedSource, [
    'title',
    'jobTitle',
    'position',
    'role',
  ]);
  const email = pickFieldValue(mergedSource, [
    'email',
    'emailAddress',
    'workEmail',
    'contactEmail',
  ]);
  const phone = pickFieldValue(mergedSource, [
    'phone',
    'phoneNumber',
    'mobile',
    'cell',
    'workPhone',
    'officePhone',
    'telephone',
  ]);
  const website = pickFieldValue(mergedSource, [
    'website',
    'url',
    'web',
    'companyWebsite',
  ]);
  const address = pickFieldValue(mergedSource, [
    'address',
    'streetAddress',
    'mailingAddress',
    'location',
  ]);

  const reservedNormalized = new Set([
    'id',
    'extrafields',
    'firstname',
    'lastname',
    'social',
    'rawtext',
    ...(fullName.matchedKey ? [normalizeKey(fullName.matchedKey)] : []),
    ...(company.matchedKey ? [normalizeKey(company.matchedKey)] : []),
    ...(title.matchedKey ? [normalizeKey(title.matchedKey)] : []),
    ...(email.matchedKey ? [normalizeKey(email.matchedKey)] : []),
    ...(phone.matchedKey ? [normalizeKey(phone.matchedKey)] : []),
    ...(website.matchedKey ? [normalizeKey(website.matchedKey)] : []),
    ...(address.matchedKey ? [normalizeKey(address.matchedKey)] : []),
  ]);

  const extraFields: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(mergedSource)) {
    if (reservedNormalized.has(normalizeKey(key))) continue;
    const value = asCleanString(rawValue);
    if (!value) continue;
    extraFields[key] = value;
  }

  return {
    id: String(card.id ?? crypto.randomUUID()),
    fullName: fullName.value,
    firstName: asCleanString(card.firstName),
    lastName: asCleanString(card.lastName),
    company: company.value,
    title: title.value,
    phone: phone.value,
    email: email.value,
    website: website.value,
    address: address.value,
    social: asCleanString(card.social),
    extraFields,
    rawText: asCleanString(card.rawText),
  };
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

function emptyMeta(_note?: string): ExtractionMeta {
  return {
    structure: 'unstructured',
    detectedHeaders: [],
    headerMapping: [],
    confidence: 0,
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