import * as XLSX from 'xlsx';
import { DocumentType, SignupEntry, BusinessCardEntry } from '@/types/scan';

export function exportToExcel(data: (SignupEntry | BusinessCardEntry)[], docType: DocumentType, filename?: string) {
  const wb = XLSX.utils.book_new();
  
  let ws: XLSX.WorkSheet;
  let sheetName: string;

  if (docType === 'signup-sheet') {
    const rows = (data as SignupEntry[]).map(e => ({
      'Full Name': e.fullName,
      'Organization': e.organization,
      'Phone': e.phone,
      'Email': e.email,
      'Screening': e.screening,
      'Share Info': e.shareInfo,
      'Date': e.date,
      'Comments': e.comments,
    }));
    ws = XLSX.utils.json_to_sheet(rows);
    sheetName = 'Sign-Up Sheet';
  } else {
    const rows = (data as BusinessCardEntry[]).map(e => ({
      'First Name': e.firstName,
      'Last Name': e.lastName,
      'Company': e.company,
      'Title': e.title,
      'Phone': e.phone,
      'Email': e.email,
      'Website': e.website,
      'Address': e.address,
    }));
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
