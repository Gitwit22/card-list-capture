import * as XLSX from 'xlsx';
import { DocumentType, SignupEntry, BusinessCardEntry, ExtractionMeta } from '@/types/scan';
import { buildSignupReviewModel } from '@/lib/reviewModel';

export function exportToExcel(
  data: (SignupEntry | BusinessCardEntry)[],
  docType: DocumentType,
  filename?: string,
  meta?: ExtractionMeta,
) {
  const wb = XLSX.utils.book_new();

  let ws: XLSX.WorkSheet;
  let sheetName: string;

  if (docType === 'signup-sheet') {
    const entries = data as SignupEntry[];
    const reviewModel = buildSignupReviewModel(entries, meta);

    const rows = reviewModel.rows.map((reviewRow) => {
      const row: Record<string, string> = {};
      reviewModel.columns.forEach((column) => {
        row[column.label] = reviewRow.values[column.key] ?? '';
      });
      return row;
    });

    ws = XLSX.utils.json_to_sheet(rows);
    sheetName = 'Sign-Up Sheet';
  } else {
    const entries = data as BusinessCardEntry[];

    const extraKeys = new Set<string>();
    entries.forEach((entry) => {
      Object.keys(entry.extraFields ?? {}).forEach((key) => extraKeys.add(key));
    });

    const rows = entries.map((entry) => {
      const row: Record<string, string> = {
        'Full Name': entry.fullName,
        'First Name': entry.firstName,
        'Last Name': entry.lastName,
        'Company': entry.company,
        'Title': entry.title,
        'Phone': entry.phone,
        'Email': entry.email,
        'Website': entry.website,
        'Address': entry.address,
        'Social': entry.social,
        'Source': entry.sourceLabel || '',
        'Source Card Id': entry.sourceCardId || entry.sourceItemId || '',
        'Has Back': entry.hasBack ? 'yes' : 'no',
        'Capture Type': entry.sourceType || '',
        'Status': entry.status || (entry.needsReview ? 'needs_review' : 'complete'),
        'Conflict Fields': (entry.conflictFields ?? []).join(', '),
        'Back Text': entry.backText || '',
        'Notes': entry.error || '',
      };

      for (const key of extraKeys) {
        row[key] = entry.extraFields?.[key] ?? '';
      }

      return row;
    });

    ws = XLSX.utils.json_to_sheet(rows);
    sheetName = 'Business Cards';
  }

  const colWidths = Object.keys(ws).reduce((acc, key) => {
    if (key[0] === '!') return acc;
    const col = key.replace(/[0-9]/g, '');
    const val = ws[key]?.v?.toString() || '';
    acc[col] = Math.max(acc[col] || 10, val.length + 2);
    return acc;
  }, {} as Record<string, number>);

  ws['!cols'] = Object.values(colWidths).map((w) => ({ wch: Math.min(w, 40) }));

  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const defaultName = docType === 'signup-sheet' ? 'signup-sheet' : 'business-cards';
  XLSX.writeFile(wb, `${filename || defaultName}.xlsx`);
}