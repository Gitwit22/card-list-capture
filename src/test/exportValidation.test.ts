import { describe, expect, it } from 'vitest';
import { validateCardForExport } from '@/lib/exportValidation';
import type { BusinessCardEntry } from '@/types/scan';

function makeCard(overrides: Partial<BusinessCardEntry> = {}): BusinessCardEntry {
  return {
    id: overrides.id || crypto.randomUUID(),
    fullName: 'Sade Warren',
    firstName: 'Sade',
    lastName: 'Warren',
    company: 'West Oakland Mural Project',
    title: 'President',
    phone: '248-335-8740',
    email: 'sade@example.org',
    website: 'example.org',
    address: '123 Main St, Detroit, MI 48201',
    social: '',
    comment: '',
    extraFields: {},
    rawText: '',
    warnings: [],
    needsReview: false,
    ...overrides,
  };
}

describe('exportValidation', () => {
  it('blocks only when website is present and invalid', () => {
    const card = makeCard({ website: 'dayday.warren' });
    const result = validateCardForExport(card);
    expect(result.status).toBe('export_blocked');
    expect(result.blockedReasons).toContain('invalid_website_format');
  });

  it('does not block when website is empty and other contact exists', () => {
    const card = makeCard({ website: '' });
    const result = validateCardForExport(card);
    expect(result.status).not.toBe('export_blocked');
    expect(result.blockedReasons).not.toContain('invalid_website_format');
  });

  it('flags no_contact_method as warning when no phone/email/website', () => {
    const card = makeCard({ phone: '', email: '', website: '' });
    const result = validateCardForExport(card);
    expect(result.status).toBe('export_warning');
    expect(result.warningReasons).toContain('no_contact_method');
  });

  it('blocks when no identifying info exists', () => {
    const card = makeCard({ fullName: '', firstName: '', lastName: '', company: '', title: '' });
    const result = validateCardForExport(card);
    expect(result.status).toBe('export_blocked');
    expect(result.blockedReasons).toContain('no_identifying_info');
  });

  it('does not keep stale OCR paragraph blocker after edited title is short valid text', () => {
    const card = makeCard({
      title: 'President',
      warnings: ['title_contains_ocr_paragraph'],
      needsReview: true,
    });
    const result = validateCardForExport(card);
    expect(result.blockedReasons).not.toContain('title_contains_ocr_paragraph');
  });

  it('deduplicates warning reasons and keeps needs-review as warning-level only', () => {
    const card = makeCard({
      warnings: ['conflicting_name_candidates', 'conflicting_name_candidates'],
      needsReview: true,
      address: '',
    });
    const result = validateCardForExport(card);
    const nameWarnings = result.warningReasons.filter((reason) => reason === 'multiple_name_candidates');
    expect(nameWarnings).toHaveLength(1);
    expect(result.warningReasons).toContain('needs_review');
    expect(result.warningReasons).toContain('missing_address');
    expect(result.status).toBe('export_warning');
  });
});
