import { describe, it, expect } from 'vitest';
import { getBusinessCardExportColumnGroups, getExportColumns } from '@/lib/export';
import type { BusinessCardEntry } from '@/types/scan';

function makeRow(partial: Partial<BusinessCardEntry>): BusinessCardEntry {
  return {
    id: partial.id || crypto.randomUUID(),
    fullName: partial.fullName || '',
    firstName: partial.firstName || '',
    lastName: partial.lastName || '',
    company: partial.company || '',
    title: partial.title || '',
    phone: partial.phone || '',
    email: partial.email || '',
    website: partial.website || '',
    address: partial.address || '',
    social: partial.social || '',
    comment: partial.comment || '',
    extraFields: partial.extraFields || {},
    rawText: partial.rawText || '',
    ...partial,
  };
}

describe('export multi-card source tracking columns', () => {
  it('includes source tracking columns in available business card exports', () => {
    const rows: BusinessCardEntry[] = [
      makeRow({
        fullName: 'A Person',
        company: 'A Co',
        sourceImageName: '1000002308.jpg',
        cropIndex: 1,
        scanMode: 'multi-card',
        status: 'complete',
        confidence: 0.91,
        warnings: ['Potential overlap'],
      }),
    ];

    const allColumns = getExportColumns(rows, 'business-card');
    expect(allColumns).toContain('Source Image');
    expect(allColumns).toContain('Crop Number');
    expect(allColumns).toContain('Scan Mode');
    expect(allColumns).toContain('Review Status');
    expect(allColumns).toContain('Confidence');

    const groups = getBusinessCardExportColumnGroups(rows);
    expect(groups.advancedColumns).toContain('Source Image');
    expect(groups.advancedColumns).toContain('Crop Number');
    expect(groups.advancedColumns).toContain('Scan Mode');
    expect(groups.advancedColumns).toContain('Review Status');
    expect(groups.advancedColumns).toContain('Confidence');
  });
});
