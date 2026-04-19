import { ExtractionMeta, SignupEntry } from '@/types/scan';

export type SignupCanonicalKey =
  | 'fullName'
  | 'organization'
  | 'phone'
  | 'email'
  | 'screening'
  | 'shareInfo'
  | 'date'
  | 'comments';

export interface ReviewColumn {
  key: string;
  label: string;
  sourceKey?: string;
  canonical: boolean;
  canonicalKey?: SignupCanonicalKey;
}

export interface ReviewRow {
  id: string;
  values: Record<string, string>;
  columns: ReviewColumn[];
}

export interface SignupReviewModel {
  columns: ReviewColumn[];
  rows: ReviewRow[];
}

const SIGNUP_CANONICAL_COLUMNS: Array<{ key: SignupCanonicalKey; label: string }> = [
  { key: 'fullName', label: 'Full Name' },
  { key: 'organization', label: 'Organization' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'screening', label: 'Screening' },
  { key: 'shareInfo', label: 'Share Info' },
  { key: 'date', label: 'Date' },
  { key: 'comments', label: 'Comments' },
];

const SIGNUP_CANONICAL_KEYS = new Set<SignupCanonicalKey>(
  SIGNUP_CANONICAL_COLUMNS.map((column) => column.key),
);

const CANONICAL_TO_DYNAMIC_LABEL: Record<SignupCanonicalKey, string> = {
  fullName: 'Full Name',
  organization: 'Organization',
  phone: 'Phone',
  email: 'Email',
  screening: 'Screening',
  shareInfo: 'Share Info',
  date: 'Date',
  comments: 'Comments',
};

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isCanonicalKey(value: string | null | undefined): value is SignupCanonicalKey {
  if (!value) return false;
  return SIGNUP_CANONICAL_KEYS.has(value as SignupCanonicalKey);
}

function getExtraValue(extraFields: Record<string, string>, sourceKey?: string): string {
  if (!sourceKey) return '';
  if (Object.prototype.hasOwnProperty.call(extraFields, sourceKey)) {
    return String(extraFields[sourceKey] ?? '');
  }

  const normalizedSource = normalizeKey(sourceKey);
  for (const [candidateKey, candidateValue] of Object.entries(extraFields)) {
    if (normalizeKey(candidateKey) === normalizedSource) {
      return String(candidateValue ?? '');
    }
  }

  return '';
}

function readRawRows(meta?: ExtractionMeta): Array<Record<string, string>> {
  if (!meta?.rawRows || meta.rawRows.length === 0) return [];
  return meta.rawRows.map((row) => ({ ...row }));
}

function getDynamicColumns(meta: ExtractionMeta | undefined, entries: SignupEntry[]): ReviewColumn[] {
  const columns: ReviewColumn[] = [];
  const usedLabels = new Set<string>();
  const mappedByOriginal = new Map<string, SignupCanonicalKey>();

  (meta?.headerMapping ?? []).forEach((mapping) => {
    if (!isCanonicalKey(mapping.normalized)) return;
    mappedByOriginal.set(normalizeKey(mapping.original), mapping.normalized);
  });

  const pushColumn = (label: string) => {
    const cleanLabel = String(label ?? '').trim();
    if (!cleanLabel) return;

    const normalized = normalizeKey(cleanLabel);
    if (!normalized || usedLabels.has(normalized)) return;

    const mappedCanonical = mappedByOriginal.get(normalized);
    columns.push({
      key: `dynamic:${normalized}:${columns.length}`,
      label: cleanLabel,
      sourceKey: cleanLabel,
      canonical: Boolean(mappedCanonical),
      canonicalKey: mappedCanonical,
    });
    usedLabels.add(normalized);
  };

  (meta?.detectedHeaders ?? []).forEach(pushColumn);

  if (columns.length === 0) {
    (meta?.headerMapping ?? []).forEach((mapping) => pushColumn(mapping.original));
  }

  if (columns.length === 0) {
    entries.forEach((entry) => {
      Object.keys(entry.extraFields ?? {}).forEach(pushColumn);
    });
  }

  if (columns.length === 0) {
    SIGNUP_CANONICAL_COLUMNS.forEach((column) => {
      const hasValue = entries.some((entry) => String(entry[column.key] ?? '').trim().length > 0);
      if (!hasValue) return;
      pushColumn(CANONICAL_TO_DYNAMIC_LABEL[column.key]);
    });
  }

  if (columns.length === 0) {
    return SIGNUP_CANONICAL_COLUMNS.map((column, index) => ({
      key: `dynamic:fallback:${index}`,
      label: CANONICAL_TO_DYNAMIC_LABEL[column.key],
      sourceKey: CANONICAL_TO_DYNAMIC_LABEL[column.key],
      canonical: true,
      canonicalKey: column.key,
    }));
  }

  return columns;
}

function getCanonicalValueByColumnLabel(entry: SignupEntry, label: string): string {
  const normalizedLabel = normalizeKey(label);
  const table: Array<[SignupCanonicalKey, string[]]> = [
    ['fullName', ['name', 'fullname', 'attendee', 'participant', 'person', 'contact']],
    ['organization', ['organization', 'org', 'company', 'agency', 'business']],
    ['phone', ['phone', 'phonenumber', 'mobile', 'cell', 'telephone', 'tel']],
    ['email', ['email', 'emailaddress', 'mail']],
    ['screening', ['screening', 'screened', 'waiver']],
    ['shareInfo', ['shareinfo', 'shareinformation', 'sharecontact', 'consent', 'optin']],
    ['date', ['date', 'signdate', 'signupdate', 'timestamp']],
    ['comments', ['comment', 'comments', 'notes', 'remarks', 'message']],
  ];

  for (const [canonicalKey, aliases] of table) {
    if (!aliases.some((alias) => normalizedLabel === normalizeKey(alias))) continue;
    return String(entry[canonicalKey] ?? '');
  }

  return '';
}

function buildRowsFromRawRows(rawRows: Array<Record<string, string>>, columns: ReviewColumn[]): ReviewRow[] {
  return rawRows.map((row, index) => {
    const values: Record<string, string> = {};

    columns.forEach((column) => {
      values[column.key] = getExtraValue(row, column.sourceKey);
    });

    return {
      id: row.id || `raw-row-${index + 1}`,
      values,
      columns,
    };
  });
}

function getRawRowValueByPosition(rawRow: Record<string, string>, columnIndex: number): string {
  const positionalCandidates = [
    `c${columnIndex + 1}`,
    `col${columnIndex + 1}`,
    `column${columnIndex + 1}`,
    `field${columnIndex + 1}`,
  ];

  for (const key of positionalCandidates) {
    const direct = getExtraValue(rawRow, key);
    if (direct) return direct;
  }

  // Last fallback: use object key order for positional rows.
  const values = Object.values(rawRow).map((value) => String(value ?? ''));
  return values[columnIndex] ?? '';
}

function getEntryBackedColumnValue(entry: SignupEntry | undefined, column: ReviewColumn): string {
  if (!entry) return '';

  if (column.canonical && column.canonicalKey) {
    return String(entry[column.canonicalKey] ?? '');
  }

  const directExtraValue = getExtraValue(entry.extraFields ?? {}, column.sourceKey);
  if (directExtraValue) return directExtraValue;

  return getCanonicalValueByColumnLabel(entry, column.label);
}

function buildRowsFromMetaAndEntries(
  rawRows: Array<Record<string, string>>,
  entries: SignupEntry[],
  columns: ReviewColumn[],
): ReviewRow[] {
  const maxRows = Math.max(rawRows.length, entries.length);
  const rows: ReviewRow[] = [];

  for (let index = 0; index < maxRows; index += 1) {
    const rawRow = rawRows[index];
    const entry = entries[index];
    const values: Record<string, string> = {};

    columns.forEach((column, columnIndex) => {
      const entryValue = getEntryBackedColumnValue(entry, column);
      const rawByLabel = rawRow ? getExtraValue(rawRow, column.sourceKey) : '';
      const rawByPosition = rawRow ? getRawRowValueByPosition(rawRow, columnIndex) : '';

      values[column.key] = rawByLabel || entryValue || rawByPosition || '';
    });

    rows.push({
      id: entry?.id || rawRow?.id || `row-${index + 1}`,
      values,
      columns,
    });
  }

  return rows;
}

export function buildSignupReviewModel(entries: SignupEntry[], meta?: ExtractionMeta): SignupReviewModel {
  const columns = getDynamicColumns(meta, entries);
  const rawRows = readRawRows(meta);

  if (rawRows.length > 0) {
    return {
      columns,
      rows: buildRowsFromMetaAndEntries(rawRows, entries, columns),
    };
  }

  const rows: ReviewRow[] = entries.map((entry, index) => {
    const values: Record<string, string> = {};

    columns.forEach((column) => {
      if (column.canonical && column.canonicalKey) {
        values[column.key] = String(entry[column.canonicalKey] ?? '');
        return;
      }

      const directExtraValue = getExtraValue(entry.extraFields ?? {}, column.sourceKey);
      if (directExtraValue) {
        values[column.key] = directExtraValue;
        return;
      }

      values[column.key] = getCanonicalValueByColumnLabel(entry, column.label);
    });

    return {
      id: entry.id || `entry-${index + 1}`,
      values,
      columns,
    };
  });

  return {
    columns,
    rows,
  };
}
