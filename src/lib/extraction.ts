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
      const entries = mapSignupRowsWithColumnResolution(result.rows, result.detectedHeaders ?? []);
      const meta: ExtractionMeta = {
        structure: (result.structure as ExtractionMeta['structure']) ?? 'table',
        detectedHeaders: result.detectedHeaders ?? [],
        headerMapping: result.headerMapping ?? [],
        confidence: result.confidence ?? 0,
        rawRows: result.rawRows,
      };
      if (entries.length > 0) {
        return { entries, meta };
      }

      return { entries: result.rows.map(mapSignupRow), meta };
    }
  }

  console.warn('[Scan2Sheet] Specialized endpoint failed or returned no data - trying /extract fallback.');

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
    console.warn('[Scan2Sheet] Extraction returned no fields - returning empty entry.');
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

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNonEmpty(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function asCleanString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function looksLikeWebsite(value: string): boolean {
  const trimmed = value.trim();
  return /^(https?:\/\/|www\.)/i.test(trimmed) || /\.[a-z]{2,}(\/|$)/i.test(trimmed);
}

type CanonicalField =
  | 'fullName'
  | 'organization'
  | 'email'
  | 'phone'
  | 'jobTitle'
  | 'address'
  | 'website'
  | 'comments';

type SignupCanonicalField =
  | 'fullName'
  | 'organization'
  | 'phone'
  | 'email'
  | 'screening'
  | 'shareInfo'
  | 'date'
  | 'comments';

const SIGNUP_FIELD_MAP: Record<SignupCanonicalField, string[]> = {
  fullName: ['full name', 'name', 'participant', 'contact', 'person', 'attendee'],
  organization: ['organization', 'org', 'company', 'agency', 'business', 'employer', 'institution', 'nls'],
  phone: ['phone', 'tel', 'telephone', 'mobile', 'cell', 'contact info', 'number'],
  email: ['email', 'e mail', 'mail', 'email address', 'address'],
  screening: ['screening', 'screened', 'waiver', 'checked in', 'check in'],
  shareInfo: ['share info', 'share information', 'share contact', 'consent', 'opt in'],
  date: ['date', 'signup date', 'sign date', 'timestamp'],
  comments: ['comments', 'comment', 'notes', 'note', 'remarks', 'message'],
};

const ORGANIZATION_HINTS = /\b(llc|inc|corp|co|company|agency|group|foundation|ministries|ministry|church|university|college|school|hospital|center|centre|services|network|association|institute)\b/i;

function isLikelyNameValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || looksLikeEmail(trimmed) || looksLikePhone(trimmed)) return false;
  if (/\d{3,}/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return false;
  return /^[A-Za-z'\-.\s]+$/.test(trimmed);
}

function isLikelyOrganizationValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || looksLikeEmail(trimmed) || looksLikePhone(trimmed)) return false;
  if (ORGANIZATION_HINTS.test(trimmed)) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 6;
}

function isLikelyDateValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/.test(trimmed)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return true;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed);
}

function isLikelyYesNoValue(value: string): boolean {
  const normalized = normalizeHeader(value);
  return ['yes', 'no', 'y', 'n', 'true', 'false', 'checked', 'unchecked', 'x'].includes(normalized);
}

function isLikelyCommentValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return trimmed.length >= 18 || /[,.!?]/.test(trimmed);
}

function looksLikeAliasValue(value: string, aliases: string[]): boolean {
  const normalized = normalizeHeader(value);
  return aliases.some((alias) => normalized === normalizeHeader(alias));
}

function isLikelyHeaderRow(row: string[], headers: string[]): boolean {
  if (row.length === 0 || headers.length === 0) return false;
  const normalizedRow = row.map((v) => normalizeHeader(v));
  const normalizedHeaders = headers.map((v) => normalizeHeader(v));

  let compared = 0;
  let matches = 0;

  for (let i = 0; i < Math.min(normalizedRow.length, normalizedHeaders.length); i += 1) {
    if (!normalizedHeaders[i]) continue;
    compared += 1;
    if (normalizedRow[i] && normalizedRow[i] === normalizedHeaders[i]) {
      matches += 1;
    }
  }

  return compared > 0 && matches === compared;
}

function isLikelyAliasOnlyRow(row: string[]): boolean {
  const allAliases = new Set(
    Object.values(SIGNUP_FIELD_MAP)
      .flat()
      .map((alias) => normalizeHeader(alias)),
  );

  const nonEmpty = row
    .map((cell) => normalizeHeader(cell))
    .filter(Boolean);

  if (nonEmpty.length === 0) return true;

  const aliasMatches = nonEmpty.filter((cell) => allAliases.has(cell)).length;
  return aliasMatches >= 2 && aliasMatches >= Math.ceil(nonEmpty.length * 0.7);
}

function computeHeaderMatchScore(header: string, aliases: string[]): number {
  const normalizedHeader = normalizeHeader(header);
  if (!normalizedHeader) return 0;

  let best = 0;
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    if (!normalizedAlias) continue;

    if (normalizedHeader === normalizedAlias) {
      best = Math.max(best, 3);
      continue;
    }

    if (
      normalizedHeader.startsWith(`${normalizedAlias} `)
      || normalizedHeader.endsWith(` ${normalizedAlias}`)
      || normalizedHeader.includes(normalizedAlias)
    ) {
      best = Math.max(best, 1);
    }
  }

  return best;
}

function resolveColumnIndices(headers: string[]): Partial<Record<SignupCanonicalField, number>> {
  const resolved: Partial<Record<SignupCanonicalField, number>> = {};
  const bestScores: Partial<Record<SignupCanonicalField, number>> = {};

  headers.forEach((header, index) => {
    (Object.keys(SIGNUP_FIELD_MAP) as SignupCanonicalField[]).forEach((field) => {
      const score = computeHeaderMatchScore(header, SIGNUP_FIELD_MAP[field]);
      if (score <= 0) return;
      const currentScore = bestScores[field] ?? -1;
      if (score > currentScore) {
        resolved[field] = index;
        bestScores[field] = score;
      }
    });
  });

  return resolved;
}

function scoreColumnByValues(values: string[], field: SignupCanonicalField): number {
  const nonEmpty = values.map((v) => v.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return 0;

  let matches = 0;
  for (const value of nonEmpty) {
    if (
      (field === 'email' && looksLikeEmail(value))
      || (field === 'phone' && looksLikePhone(value))
      || (field === 'fullName' && isLikelyNameValue(value))
      || (field === 'organization' && isLikelyOrganizationValue(value))
      || (field === 'date' && isLikelyDateValue(value))
      || ((field === 'screening' || field === 'shareInfo') && isLikelyYesNoValue(value))
      || (field === 'comments' && isLikelyCommentValue(value))
    ) {
      matches += 1;
    }
  }

  return matches / nonEmpty.length;
}

function inferColumnsFromValues(
  rows: string[][],
  existing: Partial<Record<SignupCanonicalField, number>>,
): Partial<Record<SignupCanonicalField, number>> {
  if (rows.length === 0) return existing;

  const next = { ...existing };
  const assigned = new Set<number>(Object.values(next).filter((v): v is number => v !== undefined));
  const width = Math.max(...rows.map((row) => row.length), 0);

  const thresholds: Partial<Record<SignupCanonicalField, number>> = {
    email: 0.65,
    phone: 0.55,
    fullName: 0.5,
    organization: 0.4,
    date: 0.5,
    screening: 0.7,
    shareInfo: 0.7,
    comments: 0.45,
  };

  const fieldsInPriority: SignupCanonicalField[] = [
    'email',
    'phone',
    'fullName',
    'organization',
    'date',
    'screening',
    'shareInfo',
    'comments',
  ];

  for (const field of fieldsInPriority) {
    if (next[field] !== undefined) continue;

    let bestIndex = -1;
    let bestScore = 0;

    for (let col = 0; col < width; col += 1) {
      if (assigned.has(col)) continue;
      const colValues = rows.map((row) => row[col] ?? '');
      const score = scoreColumnByValues(colValues, field);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = col;
      }
    }

    const threshold = thresholds[field] ?? 0.6;
    if (bestIndex >= 0 && bestScore >= threshold) {
      next[field] = bestIndex;
      assigned.add(bestIndex);
    }
  }

  return next;
}

function buildSignupTableData(
  rows: Array<Record<string, unknown>>,
  detectedHeaders: string[],
): {
  sourceKeys: string[];
  headerLabels: string[];
  matrix: string[][];
} {
  const first = rows[0] ?? {};
  const sourceKeys = Object.keys(first).filter((key) => !['id', 'extraFields'].includes(normalizeKey(key)));
  const headerLabels = detectedHeaders.length === sourceKeys.length
    ? detectedHeaders
    : sourceKeys;

  const matrix = rows.map((row) => sourceKeys.map((key) => asCleanString(row[key])));

  return {
    sourceKeys,
    headerLabels,
    matrix,
  };
}

function mapSignupRowsWithColumnResolution(
  rows: Array<Record<string, unknown>>,
  detectedHeaders: string[],
): SignupEntry[] {
  if (rows.length === 0) return [];

  const { sourceKeys, headerLabels, matrix } = buildSignupTableData(rows, detectedHeaders);

  if (sourceKeys.length === 0) {
    return rows.map(mapSignupRow).filter((entry) => {
      const nonEmptyCore = [entry.fullName, entry.organization, entry.email, entry.phone].filter((v) => v.trim()).length;
      return nonEmptyCore > 0;
    });
  }

  const nonJunkRows = matrix.filter((row) => !isLikelyHeaderRow(row, headerLabels) && !isLikelyAliasOnlyRow(row));
  const resolvedByHeader = resolveColumnIndices(headerLabels);
  const resolved = inferColumnsFromValues(nonJunkRows, resolvedByHeader);

  const usedIndexes = new Set<number>(Object.values(resolved).filter((v): v is number => v !== undefined));

  return rows
    .map((row, rowIndex) => {
      const cells = matrix[rowIndex] ?? [];
      if (isLikelyHeaderRow(cells, headerLabels) || isLikelyAliasOnlyRow(cells)) {
        return null;
      }

      const getByField = (field: SignupCanonicalField): string => {
        const index = resolved[field];
        if (index === undefined) return '';
        return (cells[index] ?? '').trim();
      };

      const fullName = getByField('fullName');
      const organization = getByField('organization');
      const email = getByField('email');
      const phone = getByField('phone');
      const screening = getByField('screening');
      const shareInfo = getByField('shareInfo');
      const date = getByField('date');
      const comments = getByField('comments');

      const looksLikeLabelRow = (
        (!fullName || looksLikeAliasValue(fullName, SIGNUP_FIELD_MAP.fullName))
        && (!organization || looksLikeAliasValue(organization, SIGNUP_FIELD_MAP.organization))
        && (!email || looksLikeAliasValue(email, SIGNUP_FIELD_MAP.email))
        && (!phone || looksLikeAliasValue(phone, SIGNUP_FIELD_MAP.phone))
      );

      if (looksLikeLabelRow) {
        const filledCount = [fullName, organization, email, phone, screening, shareInfo, date, comments]
          .filter((value) => value.trim().length > 0).length;
        if (filledCount >= 2) return null;
      }

      const rowExtra = (row.extraFields ?? {}) as Record<string, unknown>;
      const extraFields: Record<string, string> = {};

      sourceKeys.forEach((sourceKey, index) => {
        if (usedIndexes.has(index)) return;
        const value = (cells[index] ?? '').trim();
        if (!value) return;
        const label = headerLabels[index] || sourceKey;
        extraFields[label] = value;
      });

      for (const [key, value] of Object.entries(rowExtra)) {
        const clean = asCleanString(value);
        if (!clean) continue;
        if (!extraFields[key]) {
          extraFields[key] = clean;
        }
      }

      const hasCore = [fullName, organization, email, phone].some((value) => value.trim().length > 0);
      if (!hasCore) return null;

      return {
        id: String(row.id ?? crypto.randomUUID()),
        fullName,
        organization,
        phone,
        email,
        screening,
        shareInfo,
        date,
        comments,
        extraFields,
      } satisfies SignupEntry;
    })
    .filter((entry): entry is SignupEntry => entry !== null);
}

type DynamicMappedRow = {
  fullName: string;
  organization: string;
  email: string;
  phone: string;
  jobTitle: string;
  address: string;
  website: string;
  comments: string;
  usedNormalizedKeys: Set<string>;
};

interface DynamicMapOptions {
  includeComments?: boolean;
}

function guessFieldFromHeader(header: string): CanonicalField | null {
  const h = normalizeHeader(header).replace(/\s+/g, '');

  const matchers: Array<[CanonicalField, RegExp[]]> = [
    [
      'fullName',
      [
        /^(name|fullname|contactname|personname|participantname|attendee|contact|person)$/,
        /name/,
      ],
    ],
    [
      'organization',
      [
        /^(organization|org|company|business|affiliation|employer|agency|institution)$/,
        /company|business|organization|affiliation|employer|agency|institution|org/,
      ],
    ],
    [
      'email',
      [
        /^(email|emailaddress|mail|contactemail)$/,
        /email|mail/,
      ],
    ],
    [
      'phone',
      [
        /^(phone|phonenumber|mobile|cell|telephone|tel|contactnumber)$/,
        /phone|mobile|cell|telephone|tel|number/,
      ],
    ],
    [
      'jobTitle',
      [
        /^(title|jobtitle|position|role)$/,
        /title|position|role/,
      ],
    ],
    [
      'address',
      [
        /^(address|street|location|mailingaddress)$/,
        /address|street|location/,
      ],
    ],
    [
      'website',
      [
        /^(website|web|url|site|companywebsite)$/,
        /website|web|url|site/,
      ],
    ],
    [
      'comments',
      [
        /^(comments|comment|notes|note|remarks|message)$/,
        /comment|note|remark|message/,
      ],
    ],
  ];

  for (const [field, patterns] of matchers) {
    if (patterns.some((pattern) => pattern.test(h))) return field;
  }

  return null;
}

function mapDynamicRow(raw: Record<string, unknown>, options: DynamicMapOptions = {}): DynamicMappedRow {
  const includeComments = options.includeComments ?? true;

  const result: DynamicMappedRow = {
    fullName: '',
    organization: '',
    email: '',
    phone: '',
    jobTitle: '',
    address: '',
    website: '',
    comments: '',
    usedNormalizedKeys: new Set<string>(),
  };

  for (const [key, value] of Object.entries(raw)) {
    if (!isNonEmpty(value)) continue;

    const field = guessFieldFromHeader(key);
    if (field === 'comments' && !includeComments) continue;
    if (field && !result[field]) {
      result[field] = asCleanString(value);
      result.usedNormalizedKeys.add(normalizeKey(key));
    }
  }

  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = normalizeKey(key);
    if (result.usedNormalizedKeys.has(normalizedKey) || !isNonEmpty(value)) continue;

    const str = asCleanString(value);

    if (!result.email && looksLikeEmail(str)) {
      result.email = str;
      result.usedNormalizedKeys.add(normalizedKey);
      continue;
    }

    if (!result.phone && looksLikePhone(str)) {
      result.phone = str;
      result.usedNormalizedKeys.add(normalizedKey);
      continue;
    }

    if (!result.website && looksLikeWebsite(str)) {
      result.website = str;
      result.usedNormalizedKeys.add(normalizedKey);
      continue;
    }
  }

  return result;
}

function pickFieldFromUnusedHeaders(
  source: Record<string, unknown>,
  usedKeys: Set<string>,
  aliases: string[],
): string {
  const normalizedAliasSet = new Set(aliases.map(normalizeKey));

  for (const [key, rawValue] of Object.entries(source)) {
    const normalizedKey = normalizeKey(key);
    if (usedKeys.has(normalizedKey)) continue;
    if (!normalizedAliasSet.has(normalizedKey)) continue;
    const value = asCleanString(rawValue);
    if (!value) continue;
    usedKeys.add(normalizedKey);
    return value;
  }

  return '';
}

function collectExtraFields(
  source: Record<string, unknown>,
  usedKeys: Set<string>,
  reservedNormalized: string[] = [],
): Record<string, string> {
  const reserved = new Set(reservedNormalized);
  const extraFields: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(source)) {
    const normalizedKey = normalizeKey(key);
    if (usedKeys.has(normalizedKey) || reserved.has(normalizedKey)) continue;

    const value = asCleanString(rawValue);
    if (!value) continue;

    extraFields[key] = value;
  }

  return extraFields;
}

function mapSignupRow(row: Record<string, unknown>): SignupEntry {
  const rowExtra = (row.extraFields ?? {}) as Record<string, unknown>;
  const mergedSource: Record<string, unknown> = {
    ...rowExtra,
    ...row,
  };

  const mapped = mapDynamicRow(mergedSource);
  const usedKeys = new Set(mapped.usedNormalizedKeys);

  const screening = pickFieldFromUnusedHeaders(mergedSource, usedKeys, [
    'screening',
    'screeningStatus',
    'screened',
    'waiver',
  ]);
  const shareInfo = pickFieldFromUnusedHeaders(mergedSource, usedKeys, [
    'shareInfo',
    'shareInformation',
    'shareContact',
    'consentToShare',
    'optIn',
  ]);
  const date = pickFieldFromUnusedHeaders(mergedSource, usedKeys, [
    'date',
    'signupDate',
    'signDate',
    'timestamp',
  ]);
  const comments = mapped.comments || pickFieldFromUnusedHeaders(mergedSource, usedKeys, [
    'comments',
    'comment',
    'notes',
    'note',
    'message',
    'remarks',
  ]);

  const extraFields = collectExtraFields(mergedSource, usedKeys, ['id', 'extrafields']);

  return {
    id: String(row.id ?? crypto.randomUUID()),
    fullName: mapped.fullName,
    organization: mapped.organization,
    phone: mapped.phone,
    email: mapped.email,
    screening,
    shareInfo,
    date,
    comments,
    extraFields,
  };
}

function mapBusinessCard(card: Record<string, unknown>): BusinessCardEntry {
  const cardExtra = (card.extraFields ?? {}) as Record<string, unknown>;
  const mergedSource: Record<string, unknown> = {
    ...cardExtra,
    ...card,
  };

  const mapped = mapDynamicRow(mergedSource, { includeComments: false });
  const usedKeys = new Set(mapped.usedNormalizedKeys);

  const fallbackFullName =
    asCleanString(card.fullName)
    || asCleanString(card.name)
    || asCleanString(card.contactName)
    || asCleanString(card.person);
  const fallbackCompany =
    asCleanString(card.company)
    || asCleanString(card.organization)
    || asCleanString(card.org)
    || asCleanString(card.companyName)
    || asCleanString(card.business);
  const fallbackTitle =
    asCleanString(card.title)
    || asCleanString(card.jobTitle)
    || asCleanString(card.position)
    || asCleanString(card.role);
  const fallbackPhone =
    asCleanString(card.phone)
    || asCleanString(card.phoneNumber)
    || asCleanString(card.mobile)
    || asCleanString(card.tel);
  const fallbackEmail =
    asCleanString(card.email)
    || asCleanString(card.emailAddress)
    || asCleanString(card.mail);
  const fallbackWebsite =
    asCleanString(card.website)
    || asCleanString(card.url)
    || asCleanString(card.web);
  const fallbackAddress =
    asCleanString(card.address)
    || asCleanString(card.mailingAddress)
    || asCleanString(card.streetAddress);

  const extraFields = collectExtraFields(mergedSource, usedKeys, [
    'id',
    'extrafields',
    'firstname',
    'lastname',
    'social',
    'rawtext',
  ]);

  return {
    id: String(card.id ?? crypto.randomUUID()),
    fullName: mapped.fullName || fallbackFullName,
    firstName: asCleanString(card.firstName),
    lastName: asCleanString(card.lastName),
    company: mapped.organization || fallbackCompany,
    title: mapped.jobTitle || fallbackTitle,
    phone: mapped.phone || fallbackPhone,
    email: mapped.email || fallbackEmail,
    website: mapped.website || fallbackWebsite,
    address: mapped.address || fallbackAddress,
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