/**
 * exportValidation.ts
 *
 * Phase 3 export readiness validation.
 * Validates each BusinessCardEntry before export and assigns:
 *   - ready_to_export: safe to export, has minimum identifying info + contact method
 *   - export_warning: exportable but missing useful fields or low confidence
 *   - export_blocked: must not be exported silently (invalid email, contaminated
 *                     structured field, no identifying info, explicitly excluded)
 *
 * Does NOT mutate input — returns new card objects with exportStatus, etc.
 */

import { BusinessCardEntry, ExportStatus } from '@/types/scan';

// ─── Regex helpers ────────────────────────────────────────────────────────────

/** Loose email format check: must have localpart@domain.tld */
const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const WEBSITE_ALLOWED_TLDS = new Set([
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'io', 'co', 'us', 'ca', 'uk', 'biz',
  'info', 'app', 'dev', 'ai', 'co.uk',
]);

function normalizeWebsiteInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[\s/?#]/)[0] ?? '';
}

/** A website/domain must look like a real domain or URL host. */
function isValidWebsite(value: string): boolean {
  if (!value.trim()) return true;
  const host = normalizeWebsiteInput(value);
  if (!host || host.includes(' ') || host.includes('@')) return false;
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(host)) return false;
  if (/\.\./.test(host) || host.startsWith('.') || host.endsWith('.')) return false;

  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return false;
  const tld = parts.slice(-2).join('.');
  const last = parts[parts.length - 1];
  return WEBSITE_ALLOWED_TLDS.has(tld) || WEBSITE_ALLOWED_TLDS.has(last);
}

/**
 * Detect if a structured field (name, company, title) looks like a raw OCR
 * paragraph — e.g., multiple lines, sentence-length, or more than one period
 * mid-value (not domain dots).
 */
function looksLikeOcrParagraph(value: string): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 3) return true;

  if (trimmed.length >= 180) return true;

  const punctuationSegments = trimmed.split(/[.;:]/).map((part) => part.trim()).filter((part) => part.length >= 20);
  if (punctuationSegments.length >= 3) return true;

  const labelHits = (
    trimmed.match(/\b(name|phone|email|website|address|fax|mobile|office|tel|www|http)\b/gi)
    ?? []
  ).length;
  if (labelHits >= 2 && trimmed.length >= 60) return true;

  const hasEmail = /[^\s@]+@[^\s@]+\.[^\s@]+/.test(trimmed);
  const hasUrl = /(https?:\/\/|www\.|\b[a-z0-9.-]+\.[a-z]{2,}\b)/i.test(trimmed);
  const hasPhone = /\+?\d[\d\s()./-]{8,}\d/.test(trimmed);
  const hasAddressPattern = /\b(ste|suite|street|st\.?|road|rd\.?|avenue|ave\.?|blvd|lane|ln\.?|mi|ca|tx|ny|fl)\b/i.test(trimmed);
  const mixedSignals = [hasEmail, hasUrl, hasPhone, hasAddressPattern].filter(Boolean).length;
  if (mixedSignals >= 2 && trimmed.length >= 45) return true;

  return false;
}

// ─── Per-field validators ─────────────────────────────────────────────────────

interface FieldValidationResult {
  blocked: boolean;
  reasons: string[];
}

function validateEmail(email: string): FieldValidationResult {
  if (!email.trim()) return { blocked: false, reasons: [] };
  // Any non-empty email that doesn't match the full pattern → invalid
  if (!EMAIL_FORMAT_RE.test(email.trim())) {
    return { blocked: true, reasons: ['invalid_email_format'] };
  }
  if (looksLikeOcrParagraph(email)) {
    return { blocked: true, reasons: ['email_contains_ocr_paragraph'] };
  }
  return { blocked: false, reasons: [] };
}

function validateWebsite(website: string): FieldValidationResult {
  if (!website) return { blocked: false, reasons: [] };
  if (!isValidWebsite(website)) {
    return { blocked: true, reasons: ['invalid_website_format'] };
  }
  return { blocked: false, reasons: [] };
}

function validateStructuredField(
  value: string,
  fieldName: string,
): FieldValidationResult {
  if (!value) return { blocked: false, reasons: [] };
  if (looksLikeOcrParagraph(value)) {
    return { blocked: true, reasons: [`${fieldName}_contains_ocr_paragraph`] };
  }
  return { blocked: false, reasons: [] };
}

// ─── Export readiness config ──────────────────────────────────────────────────

export interface ExportValidationConfig {
  /** Fields that must be present to allow export (at least one of name/company required if not overridden) */
  requiredFields?: Array<'name' | 'company' | 'email' | 'phone' | 'website'>;
  /** Overall confidence below this threshold → export_warning */
  warningConfidenceThreshold?: number;
}

const DEFAULT_CONFIG: Required<ExportValidationConfig> = {
  requiredFields: [],
  warningConfidenceThreshold: 0.60,
};

// ─── Main validator ───────────────────────────────────────────────────────────

export interface ExportValidationResult {
  status: ExportStatus;
  blockedReasons: string[];
  warningReasons: string[];
}

/**
 * Validate a single card for export readiness.
 */
export function validateCardForExport(
  card: BusinessCardEntry,
  config: ExportValidationConfig = {},
): ExportValidationResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const blockedReasons: string[] = [];
  const warningReasons: string[] = [];

  // ── Field-level validation ────────────────────────────────────────────────
  const emailResult = validateEmail(card.email ?? '');
  if (emailResult.blocked) blockedReasons.push(...emailResult.reasons);

  const websiteResult = validateWebsite(card.website ?? '');
  if (websiteResult.blocked) blockedReasons.push(...websiteResult.reasons);

  const nameResult = validateStructuredField(card.fullName ?? '', 'name');
  if (nameResult.blocked) blockedReasons.push(...nameResult.reasons);

  const companyResult = validateStructuredField(card.company ?? '', 'company');
  if (companyResult.blocked) blockedReasons.push(...companyResult.reasons);

  const titleResult = validateStructuredField(card.title ?? '', 'title');
  if (titleResult.blocked) blockedReasons.push(...titleResult.reasons);

  // ── No identifying info ───────────────────────────────────────────────────
  const hasName = Boolean(card.fullName?.trim() || card.firstName?.trim() || card.lastName?.trim());
  const hasCompany = Boolean(card.company?.trim());
  const hasTitle = Boolean(card.title?.trim());
  const hasIdentifying = hasName || hasCompany || hasTitle;
  if (!hasIdentifying) {
    blockedReasons.push('no_identifying_info');
  }

  // ── Warning conditions ────────────────────────────────────────────────────

  // Low confidence
  const conf = card.confidence ?? 0;
  if (conf > 0 && conf < cfg.warningConfidenceThreshold) {
    warningReasons.push('low_confidence');
  }

  // Missing contact method (no email + no phone + no website)
  const hasContact = Boolean(card.email?.trim() || card.phone?.trim() || card.website?.trim());
  if (hasIdentifying && !hasContact) {
    warningReasons.push('no_contact_method');
  }

  if (!card.address?.trim()) warningReasons.push('missing_address');

  // Needs manual review
  if (card.needsReview) {
    warningReasons.push('needs_review');
  }

  // Multiple likely candidates should stay warning-level, not blocked.
  if (card.warnings?.includes('conflicting_name_candidates')) {
    warningReasons.push('multiple_name_candidates');
  }
  if (card.warnings?.includes('conflicting_company_candidates')) {
    warningReasons.push('multiple_company_candidates');
  }

  const uniqueBlockedReasons = Array.from(new Set(blockedReasons));
  const uniqueWarningReasons = Array.from(new Set(warningReasons));

  // ── Determine status ──────────────────────────────────────────────────────
  if (uniqueBlockedReasons.length > 0) {
    return { status: 'export_blocked', blockedReasons: uniqueBlockedReasons, warningReasons: uniqueWarningReasons };
  }

  if (uniqueWarningReasons.length === 0) {
    return { status: 'ready_to_export', blockedReasons: [], warningReasons: [] };
  }

  return { status: 'export_warning', blockedReasons: [], warningReasons: uniqueWarningReasons };
}

/**
 * Run export validation on an entire batch.
 * Returns updated cards with exportStatus, exportBlockedReasons, exportWarningReasons populated.
 */
export function validateBatch(
  cards: BusinessCardEntry[],
  config: ExportValidationConfig = {},
): BusinessCardEntry[] {
  return cards.map((card) => {
    const result = validateCardForExport(card, config);
    return {
      ...card,
      exportStatus: result.status,
      exportBlockedReasons: result.blockedReasons,
      exportWarningReasons: result.warningReasons,
    };
  });
}

// ─── Batch export summary ─────────────────────────────────────────────────────

export interface ExportSummary {
  total: number;
  readyToExport: number;
  exportWarning: number;
  exportBlocked: number;
  excluded: number;
}

export function getExportSummary(cards: BusinessCardEntry[]): ExportSummary {
  const summary: ExportSummary = {
    total: cards.length,
    readyToExport: 0,
    exportWarning: 0,
    exportBlocked: 0,
    excluded: 0,
  };

  for (const card of cards) {
    if (card.excludeFromExport) {
      summary.excluded += 1;
      continue;
    }
    switch (card.exportStatus) {
      case 'ready_to_export': summary.readyToExport += 1; break;
      case 'export_warning': summary.exportWarning += 1; break;
      case 'export_blocked': summary.exportBlocked += 1; break;
      default:
        // No export status set: treat as warning if it needs review, else ready
        if (card.needsReview) summary.exportWarning += 1;
        else summary.readyToExport += 1;
    }
  }

  return summary;
}

/**
 * Humanize an export blocked/warning reason for display.
 */
export function humanizeExportReason(reason: string): string {
  const map: Record<string, string> = {
    excluded_by_user: 'Excluded from export',
    invalid_email_format: 'Invalid email address',
    email_contains_ocr_paragraph: 'Email field contains OCR paragraph',
    email_is_placeholder: 'Email is a placeholder value',
    invalid_phone_format: 'Phone number format invalid',
    phone_contains_ocr_paragraph: 'Phone field contains OCR paragraph',
    invalid_website_format: 'Website URL contains junk',
    name_contains_ocr_paragraph: 'Name field contains OCR paragraph',
    name_is_placeholder: 'Name is a placeholder value',
    company_contains_ocr_paragraph: 'Company field contains OCR paragraph',
    company_is_placeholder: 'Company is a placeholder value',
    title_contains_ocr_paragraph: 'Title field contains OCR paragraph',
    title_is_placeholder: 'Title is a placeholder value',
    no_identifying_info: 'No name, company, or title found',
    extraction_failed: 'Extraction failed',
    low_confidence: 'Low OCR confidence',
    has_conflict_fields: 'Front/back card fields conflict',
    no_contact_method: 'No email, phone, or website',
    missing_title: 'No job title',
    missing_address: 'No address',
    multiple_name_candidates: 'Multiple likely person names — verify',
    multiple_company_candidates: 'Multiple likely company candidates — verify',
    unresolved_duplicate: 'Possible duplicate not resolved',
    needs_review: 'Flagged for review',
  };

  if (reason.startsWith('required_field_missing:')) {
    const field = reason.replace('required_field_missing:', '');
    return `Required field missing: ${field}`;
  }

  return map[reason] ?? reason.replace(/_/g, ' ');
}
