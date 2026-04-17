import * as XLSX from 'xlsx';
import { DocumentType, SignupEntry, BusinessCardEntry } from '@/types/scan';

export function exportToExcel(data: (SignupEntry | BusinessCardEntry)[], docType: DocumentType, filename?: string) {
  const wb = XLSX.utils.book_new();
  
  let ws: XLSX.WorkSheet;
  let sheetName: string;

  if (docType === 'signup-sheet') {
    const entries = data as SignupEntry[];

    // Collect all extra field keys across all entries
    const extraKeys = new Set<string>();
    entries.forEach((e) => {
      if (e.extraFields) {
        Object.keys(e.extraFields).forEach((k) => extraKeys.add(k));
      }
    });

    const rows = entries.map(e => {
      const row: Record<string, string> = {
        'Full Name': e.fullName,
        'Organization': e.organization,
        'Phone': e.phone,
        'Email': e.email,
        'Screening': e.screening,
        'Share Info': e.shareInfo,
        'Date': e.date,
        'Comments': e.comments,
      };
      for (const key of extraKeys) {
        row[key] = e.extraFields?.[key] ?? '';
      }
      return row;
    });
    ws = XLSX.utils.json_to_sheet(rows);
    sheetName = 'Sign-Up Sheet';
  } else {
    const entries = data as BusinessCardEntry[];

    const extraKeys = new Set<string>();
    entries.forEach((e) => {
      if (e.extraFields) {
        Object.keys(e.extraFields).forEach((k) => extraKeys.add(k));
      }
    });

    const rows = entries.map(e => {
      const row: Record<string, string> = {
        'Full Name': e.fullName,
        'First Name': e.firstName,
        'Last Name': e.lastName,
        'Company': e.company,
        'Title': e.title,
        'Phone': e.phone,
        'Email': e.email,
        'Website': e.website,
        'Address': e.address,
        'Social': e.social,
      };
      for (const key of extraKeys) {
        row[key] = e.extraFields?.[key] ?? '';
      }
      return row;
    });
    ws = XLSX.utils.json_to_sheet(rows);
    sheetName = 'Business Cards';
  }

  // Auto-size columns
  const colWidths = Object.keys(ws).reduce((acc, key) => {
    if (key[0] === '!') return acc;
    const col = key.replace(/[0-9]/g, '');
    const val = ws[key]?.v?.toString() || '';
    acc[col] = Math.max(acc[col] || 10, val.length + 2);
    return acc;
  }, {} as Record<string, number>);
  
  ws['!cols'] = Object.values(colWidths).map(w => ({ wch: Math.min(w, 40) }));

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  
  const defaultName = docType === 'signup-sheet' ? 'signup-sheet' : 'business-cards';
  XLSX.writeFile(wb, `${filename || defaultName}.xlsx`);
}
