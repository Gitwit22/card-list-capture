import * as XLSX from 'xlsx';
import { DocumentType, SignupEntry, BusinessCardEntry, ExtractionMeta } from '@/types/scan';
import { buildSignupReviewModel } from '@/lib/reviewModel';
import { humanizeExportReason } from '@/lib/exportValidation';

export type ExportFormat = 'xlsx' | 'csv' | 'tsv' | 'json' | 'md';

export interface ExportOptions {
  includeColumns?: string[];
  /** When true, only export cards with exportStatus === 'ready_to_export' or 'export_warning' (excludes blocked + excluded) */
  readyCardsOnly?: boolean;
}

export interface ExportColumnGroups {
  allColumns: string[];
  defaultColumns: string[];
  advancedColumns: string[];
}

interface ExportPayload {
  rows: Record<string, string>[];
  defaultName: string;
  sheetName: string;
}

function normalizeCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';

  // Keep each exported value on a single logical line so spreadsheet imports
  // do not appear shifted by embedded OCR line breaks or tabs.
  return String(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function getExportPayload(
  data: (SignupEntry | BusinessCardEntry)[],
  docType: DocumentType,
  meta?: ExtractionMeta,
): ExportPayload {
  if (docType === 'signup-sheet') {
    const entries = data as SignupEntry[];
    const reviewModel = buildSignupReviewModel(entries, meta);

    const rows = reviewModel.rows.map((reviewRow) => {
      const row: Record<string, string> = {};
      reviewModel.columns.forEach((column) => {
        row[column.label] = normalizeCellValue(reviewRow.values[column.key]);
      });
      return row;
    });

    return {
      rows,
      defaultName: 'signup-sheet',
      sheetName: 'Sign-Up Sheet',
    };
  }

  const entries = data as BusinessCardEntry[];
  const extraKeys = new Set<string>();
  entries.forEach((entry) => {
    Object.keys(entry.extraFields ?? {}).forEach((key) => extraKeys.add(key));
  });

  const rows = entries.map((entry) => {
    const row: Record<string, string> = {
      'Full Name': normalizeCellValue(entry.fullName),
      'First Name': normalizeCellValue(entry.firstName),
      'Last Name': normalizeCellValue(entry.lastName),
      'Company': normalizeCellValue(entry.company),
      'Title': normalizeCellValue(entry.title),
      'Phone': normalizeCellValue(entry.phone),
      'Email': normalizeCellValue(entry.email),
      'Website': normalizeCellValue(entry.website),
      'Address': normalizeCellValue(entry.address),
      'Tagline': normalizeCellValue(entry.tagline || ''),
      'Additional Contacts': normalizeCellValue(
        (entry.additionalContacts ?? [])
          .map((c) => `${c.name || ''}${c.phone ? `: ${c.phone}` : ''}`.trim())
          .join('; ')
      ),
      'Social': normalizeCellValue(entry.social),
      'Comment': normalizeCellValue(entry.comment || ''),
      'Source': normalizeCellValue(entry.sourceLabel || ''),
      'Source Image': normalizeCellValue(entry.sourceImageName || ''),
      'Crop Number': normalizeCellValue(entry.cropIndex ?? ''),
      'Scan Mode': normalizeCellValue(entry.scanMode || ''),
      'Source Card Id': normalizeCellValue(entry.sourceCardId || entry.sourceItemId || ''),
      'Has Back': entry.hasBack ? 'yes' : 'no',
      'Capture Type': normalizeCellValue(entry.sourceType || ''),
      'Status': normalizeCellValue(entry.status || (entry.needsReview ? 'needs_review' : 'complete')),
      'Review Status': normalizeCellValue(entry.status || (entry.needsReview ? 'needs_review' : 'complete')),
      'Manual Crop': entry.manualCrop ? 'yes' : 'no',
      'Manual Entry': entry.manualEntry ? 'yes' : 'no',
      'Confidence': normalizeCellValue(typeof entry.confidence === 'number' ? `${Math.round(entry.confidence * 100)}%` : ''),
      'Name Confidence': normalizeCellValue(entry.fieldConfidence?.fullName ? `${Math.round(entry.fieldConfidence.fullName * 100)}%` : ''),
      'Company Confidence': normalizeCellValue(entry.fieldConfidence?.company ? `${Math.round(entry.fieldConfidence.company * 100)}%` : ''),
      'Title Confidence': normalizeCellValue(entry.fieldConfidence?.title ? `${Math.round(entry.fieldConfidence.title * 100)}%` : ''),
      'Phone Confidence': normalizeCellValue(entry.fieldConfidence?.phone ? `${Math.round(entry.fieldConfidence.phone * 100)}%` : ''),
      'Email Confidence': normalizeCellValue(entry.fieldConfidence?.email ? `${Math.round(entry.fieldConfidence.email * 100)}%` : ''),
      'Website Confidence': normalizeCellValue(entry.fieldConfidence?.website ? `${Math.round(entry.fieldConfidence.website * 100)}%` : ''),
      'Address Confidence': normalizeCellValue(entry.fieldConfidence?.address ? `${Math.round(entry.fieldConfidence.address * 100)}%` : ''),
      'Conflict Fields': normalizeCellValue((entry.conflictFields ?? []).join(', ')),
      'Warnings': normalizeCellValue((entry.warnings ?? []).join('; ')),
      'Back Text': normalizeCellValue(entry.backText || ''),
      'Notes': normalizeCellValue(entry.error || ''),
      // Phase 3: export readiness
      'Export Status': normalizeCellValue(
        entry.exportStatus === 'ready_to_export' ? 'Ready'
        : entry.exportStatus === 'export_warning' ? 'Warning'
        : entry.exportStatus === 'export_blocked' ? 'Blocked'
        : ''
      ),
      'Export Blocked Reasons': normalizeCellValue(
        (entry.exportBlockedReasons ?? []).map(humanizeExportReason).join('; ')
      ),
      'Export Warnings': normalizeCellValue(
        (entry.exportWarningReasons ?? []).map(humanizeExportReason).join('; ')
      ),
      'Excluded': entry.excludeFromExport ? 'yes' : '',
    };

    for (const key of extraKeys) {
      row[key] = normalizeCellValue(entry.extraFields?.[key] ?? '');
    }

    return row;
  });

  return {
    rows,
    defaultName: 'business-cards',
    sheetName: 'Business Cards',
  };
}

export function getExportColumns(
  data: (SignupEntry | BusinessCardEntry)[],
  docType: DocumentType,
  meta?: ExtractionMeta,
): string[] {
  const { rows } = getExportPayload(data, docType, meta);
  const columns: string[] = [];
  const seen = new Set<string>();

  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (seen.has(key)) return;
      seen.add(key);
      columns.push(key);
    });
  });

  return columns;
}

const CORE_BUSINESS_CARD_COLUMNS = new Set([
  'Full Name',
  'Company',
  'Title',
  'Phone',
  'Email',
  'Website',
  'Address',
  'Tagline',
  'Additional Contacts',
  'Social',
  'Comment',
]);

const ADVANCED_BUSINESS_CARD_COLUMNS = new Set([
  'First Name',
  'Last Name',
  'Source',
  'Source Image',
  'Crop Number',
  'Scan Mode',
  'Source Card Id',
  'Has Back',
  'Capture Type',
  'Status',
  'Review Status',
  'Manual Crop',
  'Manual Entry',
  'Confidence',
  'Name Confidence',
  'Company Confidence',
  'Title Confidence',
  'Phone Confidence',
  'Email Confidence',
  'Website Confidence',
  'Address Confidence',
  'Warnings',
  'Conflict Fields',
  'Back Text',
  'serviceTags',
  // Phase 3
  'Export Status',
  'Export Blocked Reasons',
  'Export Warnings',
  'Excluded',
]);

function getDetectedColumns(rows: Record<string, string>[]): Set<string> {
  const detected = new Set<string>();
  rows.forEach((row) => {
    Object.entries(row).forEach(([column, value]) => {
      if (String(value ?? '').trim().length > 0) {
        detected.add(column);
      }
    });
  });
  return detected;
}

export function getBusinessCardExportColumnGroups(data: BusinessCardEntry[]): ExportColumnGroups {
  const { rows } = getExportPayload(data, 'business-card');
  const allColumns = getExportColumns(data, 'business-card');
  const detected = getDetectedColumns(rows);

  // Only expose selectable columns that actually have values in this export.
  // This keeps the UI focused and avoids showing many always-empty fields.
  const populatedColumns = allColumns.filter((column) => detected.has(column));

  const advancedColumns = populatedColumns.filter((column) => ADVANCED_BUSINESS_CARD_COLUMNS.has(column));
  const defaultColumns = populatedColumns.filter((column) => {
    if (ADVANCED_BUSINESS_CARD_COLUMNS.has(column)) return false;
    return CORE_BUSINESS_CARD_COLUMNS.has(column) || detected.has(column);
  });

  return {
    allColumns: populatedColumns,
    defaultColumns,
    advancedColumns,
  };
}

function filterRowsByColumns(rows: Record<string, string>[], includeColumns?: string[]): Record<string, string>[] {
  if (!includeColumns || includeColumns.length === 0) return rows;

  const allowed = new Set(includeColumns);
  return rows.map((row) => {
    const filtered: Record<string, string> = {};
    Object.keys(row).forEach((key) => {
      if (!allowed.has(key)) return;
      filtered[key] = row[key] ?? '';
    });
    return filtered;
  });
}

function quoteCsvCell(value: string, delimiter: ',' | '\t'): string {
  if (!value.includes('"') && !value.includes('\n') && !value.includes('\r') && !value.includes(delimiter)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function toDelimited(rows: Record<string, string>[], delimiter: ',' | '\t'): string {
  const headerSet = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => headerSet.add(key));
  });

  const headers = Array.from(headerSet);
  const lines: string[] = [];
  lines.push(headers.map((header) => quoteCsvCell(header, delimiter)).join(delimiter));

  rows.forEach((row) => {
    const values = headers.map((header) => quoteCsvCell(row[header] ?? '', delimiter));
    lines.push(values.join(delimiter));
  });

  return lines.join('\n');
}

function toMarkdownTable(rows: Record<string, string>[]): string {
  const headerSet = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => headerSet.add(key));
  });
  const headers = Array.from(headerSet);

  const safe = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');

  const headerLine = `| ${headers.map((h) => safe(h)).join(' | ')} |`;
  const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const bodyLines = rows.map((row) => `| ${headers.map((h) => safe(row[h] ?? '')).join(' | ')} |`);

  return [headerLine, separatorLine, ...bodyLines].join('\n');
}

function downloadText(content: string, mimeType: string, fileName: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function exportData(
  data: (SignupEntry | BusinessCardEntry)[],
  docType: DocumentType,
  format: ExportFormat,
  filename?: string,
  meta?: ExtractionMeta,
  options?: ExportOptions,
) {
  // Phase 3: filter to ready/warning cards when readyCardsOnly is set
  const filteredData = (options?.readyCardsOnly && docType === 'business-card')
    ? (data as BusinessCardEntry[]).filter((c) =>
        !c.excludeFromExport &&
        c.exportStatus !== 'export_blocked' &&
        c.exportStatus !== undefined
      )
    : data;

  const { rows: payloadRows, defaultName, sheetName } = getExportPayload(filteredData, docType, meta);
  const rows = filterRowsByColumns(payloadRows, options?.includeColumns);
  const baseName = filename || defaultName;

  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);

    const colWidths = Object.keys(ws).reduce((acc, key) => {
      if (key[0] === '!') return acc;
      const col = key.replace(/[0-9]/g, '');
      const val = ws[key]?.v?.toString() || '';
      acc[col] = Math.max(acc[col] || 10, val.length + 2);
      return acc;
    }, {} as Record<string, number>);

    ws['!cols'] = Object.values(colWidths).map((w) => ({ wch: Math.min(w, 40) }));
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `${baseName}.xlsx`);
    return;
  }

  if (format === 'csv') {
    downloadText(toDelimited(rows, ','), 'text/csv', `${baseName}.csv`);
    return;
  }

  if (format === 'tsv') {
    downloadText(toDelimited(rows, '\t'), 'text/tab-separated-values', `${baseName}.tsv`);
    return;
  }

  if (format === 'json') {
    downloadText(JSON.stringify(rows, null, 2), 'application/json', `${baseName}.json`);
    return;
  }

  downloadText(toMarkdownTable(rows), 'text/markdown', `${baseName}.md`);
}

export function exportToExcel(
  data: (SignupEntry | BusinessCardEntry)[],
  docType: DocumentType,
  filename?: string,
  meta?: ExtractionMeta,
) {
  exportData(data, docType, 'xlsx', filename, meta);
}