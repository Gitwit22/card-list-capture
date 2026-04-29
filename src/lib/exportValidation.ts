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

/** A phone field should be mostly digits/punctuation, >= 10 digits total */
function isValidPhone(value: string): boolean {
  if (!value.trim()) return true; // empty is not invalid (just missing)
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) return false;
  const alphaCount = (value.match(/[a-zA-Z]/g) ?? []).length;
  return alphaCount <= digits.length; // more digits than alpha chars
}

/** A website/domain should not contain multiple spaces or newlines */
function isValidWebsite(value: string): boolean {
  if (!value.trim()) return true;
  return !(/[\r\n]/.test(value)) && (value.match(/ /g) ?? []).length <= 2;
}

/**
 * Detect if a structured field (name, company, title) looks like a raw OCR
 * paragraph — e.g., multiple lines, sentence-length, or more than one period
 * mid-value (not domain dots).
 */
function looksLikeOcrParagraph(value: string): boolean {
  if (!value) return false;
  // Multiple newlines → likely a multi-field OCR dump
  if (/\r?\n/.test(value)) return true;
  // Very long single-line text in a structured field
  if (value.length > 120) return true;
  // Sentence-ending punctuation followed by text (. word pattern)
  if (/\.\s+[A-Z]/.test(value)) return true;
  return false;
}

/**
 * Known placeholder labels that should never appear as field values.
 */
const PLACEHOLDER_SET = new Set([
  'company', 'email', 'website', 'address', 'phone', 'title',
  'first name', 'last name', 'firstname', 'lastname', 'name',
  'n/a', 'na', 'none', 'tbd', '—', '-',
]);

function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER_SET.has(value.trim().toLowerCase());
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
  if (isPlaceholderValue(email)) {
    return { blocked: true, reasons: ['email_is_placeholder'] };
  }
  return { blocked: false, reasons: [] };
}

function validatePhone(phone: string): FieldValidationResult {
  if (!phone) return { blocked: false, reasons: [] };
  if (!isValidPhone(phone)) {
    return { blocked: true, reasons: ['invalid_phone_format'] };
  }
  if (looksLikeOcrParagraph(phone)) {
    return { blocked: true, reasons: ['phone_contains_ocr_paragraph'] };
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
  if (isPlaceholderValue(value)) {
    return { blocked: true, reasons: [`${fieldName}_is_placeholder`] };
  }
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

  // ── Explicit exclusion ────────────────────────────────────────────────────
  if (card.excludeFromExport) {
    blockedReasons.push('excluded_by_user');
  }

  // ── Field-level validation ────────────────────────────────────────────────
  const emailResult = validateEmail(card.email ?? '');
  if (emailResult.blocked) blockedReasons.push(...emailResult.reasons);

  const phoneResult = validatePhone(card.phone ?? '');
  if (phoneResult.blocked) blockedReasons.push(...phoneResult.reasons);

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

  // ── Required field check ──────────────────────────────────────────────────
  for (const field of cfg.requiredFields) {
    switch (field) {
      case 'name':
        if (!hasName) blockedReasons.push('required_field_missing:name');
        break;
      case 'company':
        if (!hasCompany) blockedReasons.push('required_field_missing:company');
        break;
      case 'email':
        if (!card.email?.trim()) blockedReasons.push('required_field_missing:email');
        break;
      case 'phone':
        if (!card.phone?.trim()) blockedReasons.push('required_field_missing:phone');
        break;
      case 'website':
        if (!card.website?.trim()) blockedReasons.push('required_field_missing:website');
        break;
    }
  }

  // ── Warning conditions ────────────────────────────────────────────────────

  // Failed extraction
  if (card.status === 'failed') {
    warningReasons.push('extraction_failed');
  }

  // Low confidence
  const conf = card.confidence ?? 0;
  if (conf > 0 && conf < cfg.warningConfidenceThreshold) {
    warningReasons.push('low_confidence');
  }

  // Conflict fields
  if ((card.conflictFields?.length ?? 0) > 0) {
    warningReasons.push('has_conflict_fields');
  }

  // Missing contact method (no email + no phone + no website)
  const hasContact = Boolean(card.email?.trim() || card.phone?.trim() || card.website?.trim());
  if (hasIdentifying && !hasContact) {
    warningReasons.push('no_contact_method');
  }

  // Title is a useful field, but less critical when a person name is already present.
  // Only flag missing title when the card has no person name (e.g., org-only or brand cards).
  if (!card.title?.trim() && !hasName) warningReasons.push('missing_title');
  if (!card.address?.trim()) warningReasons.push('missing_address');

  // Unresolved duplicate
  if (card.duplicateOf && card.duplicateStatus !== 'ignored') {
    warningReasons.push('unresolved_duplicate');
  }

  // Needs manual review
  if (card.needsReview && !card.userEdited?.size) {
    warningReasons.push('needs_review');
  }

  // ── Determine status ──────────────────────────────────────────────────────
  if (blockedReasons.length > 0) {
    return { status: 'export_blocked', blockedReasons, warningReasons };
  }

  // Ready: has identifying info (name, company, or title) AND at least one contact method
  const isReady = hasIdentifying && hasContact;
  if (isReady && warningReasons.length === 0) {
    return { status: 'ready_to_export', blockedReasons: [], warningReasons: [] };
  }

  return { status: 'export_warning', blockedReasons: [], warningReasons };
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
    unresolved_duplicate: 'Possible duplicate not resolved',
    needs_review: 'Flagged for review',
  };

  if (reason.startsWith('required_field_missing:')) {
    const field = reason.replace('required_field_missing:', '');
    return `Required field missing: ${field}`;
  }

  return map[reason] ?? reason.replace(/_/g, ' ');
}
