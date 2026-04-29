/**
 * batchBusinessCardResolver.ts
 *
 * Phase 3 batch-level analysis layer. Receives all extracted BusinessCardEntry
 * results and improves accuracy by:
 *   - Building a domain→company map from high-confidence cards
 *   - Boosting low-confidence company fields using batch domain context
 *   - Applying session correction rules (domain→company, normalize, ignore)
 *   - Detecting duplicate cards within the batch
 *   - Building ranked FieldCandidate arrays for per-card review
 *   - Suggesting batch correction rules when the user edits a card
 */

import {
  BusinessCardEntry,
  BatchCorrectionRule,
  BatchCorrectionType,
  ScanSessionCorrections,
  FieldCandidate,
  CardCandidates,
  DuplicateStatus,
} from '@/types/scan';
import { inferCompanyFromDomain } from '@/lib/businessCardResolver';

// ─── Generic email domains: never infer company from these ───────────────────
const GENERIC_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
  'aol.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
  'me.com', 'mac.com', 'comcast.net', 'att.net', 'verizon.net',
  'sbcglobal.net', 'bellsouth.net', 'cox.net', 'earthlink.net',
  'ymail.com', 'inbox.com', 'mail.com', 'zoho.com',
]);

// ─── Minimum company confidence to trust for domain mapping ──────────────────
const DOMAIN_MAP_MIN_CONFIDENCE = 0.70;

// ─── Minimum cards with a domain before we trust the domain map ──────────────
const DOMAIN_MAP_MIN_CARDS = 2;

// ─── Company confidence assigned when boosted from batch domain map ───────────
const BATCH_BOOST_CONFIDENCE = 0.78;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the registered domain (host without www) from an email or URL string.
 * Returns '' for generic domains or unparseable inputs.
 */
export function extractDomain(value: string): string {
  if (!value) return '';
  const trimmed = value.trim().toLowerCase();
  let host = '';
  if (trimmed.includes('@')) {
    host = trimmed.split('@')[1] ?? '';
  } else {
    try {
      const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      host = new URL(normalized).hostname;
    } catch {
      host = trimmed.replace(/^www\./, '').split('/')[0] ?? '';
    }
  }
  // Strip www prefix
  host = host.replace(/^www\./, '');
  return host;
}

function isGenericDomain(domain: string): boolean {
  return !domain || GENERIC_DOMAINS.has(domain.toLowerCase());
}

function normalizeCompany(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizePhone(raw: string): string {
  return (raw ?? '').replace(/\D/g, '');
}

function normalizeName(raw: string): string {
  return (raw ?? '').trim().toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

// ─── BatchContext ─────────────────────────────────────────────────────────────

export interface BatchContext {
  /** domain → best company name (from high-confidence cards with 2+ domain matches) */
  domainCompanyMap: Map<string, string>;
  /** domain → count of cards with this domain */
  domainCounts: Map<string, number>;
  /** normalized company → count */
  companyCounts: Map<string, number>;
  /** normalized address → canonical address string (first seen) */
  addressCanonical: Map<string, string>;
  /** OCR phrases that appear on many cards but contain no useful contact info */
  ocrGarbagePhrases: Set<string>;
  /** total cards in batch */
  totalCards: number;
}

/**
 * Analyze a batch of cards to build shared context for boosting individual fields.
 */
export function analyzeBatch(cards: BusinessCardEntry[]): BatchContext {
  const domainCounts = new Map<string, number>();
  const domainCompanyCandidates = new Map<string, Array<{ company: string; confidence: number }>>(); // domain → [{company, conf}]
  const companyCounts = new Map<string, number>();
  const addressCanonical = new Map<string, string>();
  const lineCounts = new Map<string, number>(); // raw line → count across batch (for OCR garbage detection)

  for (const card of cards) {
    // Domains from email + website
    const domains = new Set<string>();
    const emailDomain = extractDomain(card.email ?? '');
    const websiteDomain = extractDomain(card.website ?? '');
    if (emailDomain && !isGenericDomain(emailDomain)) domains.add(emailDomain);
    if (websiteDomain && !isGenericDomain(websiteDomain)) domains.add(websiteDomain);

    for (const domain of domains) {
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);

      // Candidate for domain→company mapping when company is high-confidence
      const companyConf = card.fieldConfidence?.company ?? 0;
      if (card.company && companyConf >= DOMAIN_MAP_MIN_CONFIDENCE) {
        const existing = domainCompanyCandidates.get(domain) ?? [];
        existing.push({ company: card.company, confidence: companyConf });
        domainCompanyCandidates.set(domain, existing);
      }
    }

    // Company counts
    if (card.company) {
      const norm = normalizeCompany(card.company);
      companyCounts.set(norm, (companyCounts.get(norm) ?? 0) + 1);
    }

    // Address canonical
    if (card.address) {
      const normAddr = card.address.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!addressCanonical.has(normAddr)) {
        addressCanonical.set(normAddr, card.address.trim());
      }
    }

    // OCR line frequency
    if (card.rawText) {
      const lines = card.rawText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 4 && l.length <= 60);
      for (const line of lines) {
        lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
      }
    }
  }

  // Build domain→company map: only domains with 2+ cards AND a clear winner
  const domainCompanyMap = new Map<string, string>();
  for (const [domain, candidates] of domainCompanyCandidates.entries()) {
    if ((domainCounts.get(domain) ?? 0) < DOMAIN_MAP_MIN_CARDS) continue;
    if (candidates.length === 0) continue;

    // Pick the highest-confidence candidate; if tied, pick the most common name
    const grouped = new Map<string, { company: string; totalConf: number; count: number }>();
    for (const { company, confidence } of candidates) {
      const norm = normalizeCompany(company);
      const entry = grouped.get(norm) ?? { company, totalConf: 0, count: 0 };
      entry.totalConf += confidence;
      entry.count += 1;
      // Keep the canonical casing from the first (highest-confidence) entry
      if (confidence > (entry.totalConf - confidence) / entry.count) {
        entry.company = company;
      }
      grouped.set(norm, entry);
    }

    let bestNorm = '';
    let bestScore = -1;
    for (const [norm, entry] of grouped.entries()) {
      const score = entry.totalConf / entry.count + entry.count * 0.1;
      if (score > bestScore) {
        bestScore = score;
        bestNorm = norm;
      }
    }

    const winner = grouped.get(bestNorm);
    if (winner) {
      domainCompanyMap.set(domain, winner.company);
    }
  }

  // OCR garbage: lines appearing on more than 30% of cards that look like junk
  // (not containing typical contact info characters)
  const ocrGarbagePhrases = new Set<string>();
  const threshold = Math.max(2, Math.ceil(cards.length * 0.3));
  for (const [line, count] of lineCounts.entries()) {
    if (count >= threshold) {
      // Skip if it looks like legitimate repeated content (company, title keywords)
      const hasContact = /[@.\d]/.test(line);
      const hasName = /^[A-Z][a-z]+ [A-Z][a-z]+/.test(line);
      if (!hasContact && !hasName) {
        ocrGarbagePhrases.add(line);
      }
    }
  }

  return {
    domainCompanyMap,
    domainCounts,
    companyCounts,
    addressCanonical,
    ocrGarbagePhrases,
    totalCards: cards.length,
  };
}

// ─── Domain-to-company boosting ───────────────────────────────────────────────

/**
 * Apply batch context to a single card.
 * Boosts company when the card's domain appears in the batch domain map
 * and the card has no company or low-confidence company.
 * Does NOT overwrite userEdited fields.
 */
export function applyBatchBoost(
  card: BusinessCardEntry,
  context: BatchContext,
): BusinessCardEntry {
  // Don't overwrite user edits or already high-confidence company
  const userEditedCompany = card.userEdited?.has('company');
  const companyConf = card.fieldConfidence?.company ?? 0;
  if (userEditedCompany) return card;
  if (card.company && companyConf >= DOMAIN_MAP_MIN_CONFIDENCE) return card;

  const emailDomain = extractDomain(card.email ?? '');
  const websiteDomain = extractDomain(card.website ?? '');
  const domains = [emailDomain, websiteDomain].filter((d) => d && !isGenericDomain(d));

  let boostedCompany = '';
  let boostedFrom = '';
  for (const domain of domains) {
    const mapped = context.domainCompanyMap.get(domain);
    if (mapped) {
      boostedCompany = mapped;
      boostedFrom = domain;
      break;
    }
  }

  // Also try inferring from domain when no company at all and domain is non-generic
  if (!boostedCompany && !card.company) {
    for (const domain of domains) {
      const inferred = inferCompanyFromDomain(domain);
      if (inferred) {
        boostedCompany = inferred;
        boostedFrom = domain;
        break;
      }
    }
  }

  if (!boostedCompany) return card;

  const newFieldConfidence = { ...(card.fieldConfidence ?? {}) };
  newFieldConfidence.company = BATCH_BOOST_CONFIDENCE;

  const newReviewReasons = (card.warnings ?? []).filter((r) => r !== 'company_not_found' && r !== 'low_confidence_company');
  const wasChanged = card.company !== boostedCompany;

  return {
    ...card,
    company: boostedCompany,
    fieldConfidence: newFieldConfidence,
    warnings: wasChanged ? [...newReviewReasons, `company_batch_boosted_from:${boostedFrom}`] : card.warnings,
    inferredCompanySource: 'domain' as const,
  } as BusinessCardEntry;
}

// ─── Session correction rules ─────────────────────────────────────────────────

/**
 * Apply session correction rules to a single card.
 * Preserves userEdited fields unless the rule is explicitly confirmed.
 */
export function applySessionCorrections(
  card: BusinessCardEntry,
  corrections: ScanSessionCorrections,
): BusinessCardEntry {
  if (!corrections.rules.length) return card;

  let updated = { ...card };

  for (const rule of corrections.rules) {
    switch (rule.type) {
      case 'domain_to_company': {
        if (updated.userEdited?.has('company')) break;
        const emailDomain = extractDomain(updated.email ?? '');
        const websiteDomain = extractDomain(updated.website ?? '');
        if (emailDomain === rule.pattern || websiteDomain === rule.pattern) {
          if (rule.replacement && updated.company !== rule.replacement) {
            updated = {
              ...updated,
              company: rule.replacement,
              fieldConfidence: {
                ...(updated.fieldConfidence ?? {}),
                company: 0.90,
              },
            };
          }
        }
        break;
      }

      case 'normalize_company': {
        if (updated.userEdited?.has('company')) break;
        if (updated.company && normalizeCompany(updated.company) === normalizeCompany(rule.pattern)) {
          if (rule.replacement && updated.company !== rule.replacement) {
            updated = { ...updated, company: rule.replacement };
          }
        }
        break;
      }

      case 'normalize_title': {
        if (updated.userEdited?.has('title')) break;
        if (updated.title && normalizeCompany(updated.title) === normalizeCompany(rule.pattern)) {
          if (rule.replacement && updated.title !== rule.replacement) {
            updated = { ...updated, title: rule.replacement };
          }
        }
        break;
      }

      case 'normalize_address': {
        if (updated.userEdited?.has('address')) break;
        if (updated.address && updated.address.trim() === rule.pattern) {
          if (rule.replacement && updated.address !== rule.replacement) {
            updated = { ...updated, address: rule.replacement };
          }
        }
        break;
      }

      case 'ignore_phrase': {
        // Remove the phrase from rawText-derived fields where it appeared as a value
        const fields: Array<keyof BusinessCardEntry> = ['company', 'title', 'address'];
        for (const field of fields) {
          if (updated.userEdited?.has(field)) continue;
          const val = String((updated as Record<string, unknown>)[field] ?? '').trim();
          if (val.toLowerCase() === rule.pattern.toLowerCase()) {
            (updated as Record<string, unknown>)[field] = '';
          }
        }
        break;
      }
    }
  }

  return updated;
}

// ─── Duplicate detection ──────────────────────────────────────────────────────

export interface DuplicateInfo {
  cardId: string;
  duplicateOfId: string;
  status: DuplicateStatus;
  matchReason: 'same_email' | 'same_phone' | 'same_name_company' | 'same_website_phone';
}

/**
 * Detect potential duplicate cards in the batch.
 * Returns a list of pairs where one card is considered duplicate of another.
 * The card with higher confidence is kept as primary; the other is marked duplicate.
 */
export function detectDuplicates(cards: BusinessCardEntry[]): DuplicateInfo[] {
  const results: DuplicateInfo[] = [];
  const seen = new Set<string>(); // set of ids already assigned as duplicates

  // Build lookup maps
  const byEmail = new Map<string, BusinessCardEntry[]>();
  const byPhone = new Map<string, BusinessCardEntry[]>();
  const byNameCompany = new Map<string, BusinessCardEntry[]>();
  const byWebsitePhone = new Map<string, BusinessCardEntry[]>();

  for (const card of cards) {
    if (card.email) {
      const key = card.email.trim().toLowerCase();
      if (!byEmail.has(key)) byEmail.set(key, []);
      byEmail.get(key)!.push(card);
    }

    const phone = normalizePhone(card.phone ?? '');
    if (phone.length >= 10) {
      if (!byPhone.has(phone)) byPhone.set(phone, []);
      byPhone.get(phone)!.push(card);
    }

    const name = normalizeName(card.fullName ?? '');
    const company = normalizeCompany(card.company ?? '');
    if (name.length >= 4 && company.length >= 3) {
      const key = `${name}|${company}`;
      if (!byNameCompany.has(key)) byNameCompany.set(key, []);
      byNameCompany.get(key)!.push(card);
    }

    const website = extractDomain(card.website ?? '');
    if (website && !isGenericDomain(website) && phone.length >= 10) {
      const key = `${website}|${phone}`;
      if (!byWebsitePhone.has(key)) byWebsitePhone.set(key, []);
      byWebsitePhone.get(key)!.push(card);
    }
  }

  function addDuplicates(
    groups: Map<string, BusinessCardEntry[]>,
    status: DuplicateStatus,
    reason: DuplicateInfo['matchReason'],
  ) {
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      // Primary = highest confidence card in group
      const sorted = [...group].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
      const primary = sorted[0];
      for (let i = 1; i < sorted.length; i++) {
        const dup = sorted[i];
        if (seen.has(dup.id)) continue;
        seen.add(dup.id);
        results.push({ cardId: dup.id, duplicateOfId: primary.id, status, matchReason: reason });
      }
    }
  }

  addDuplicates(byEmail, 'confirmed', 'same_email');
  addDuplicates(byPhone, 'possible', 'same_phone');
  addDuplicates(byNameCompany, 'possible', 'same_name_company');
  addDuplicates(byWebsitePhone, 'possible', 'same_website_phone');

  return results;
}

// ─── Candidate ranking ────────────────────────────────────────────────────────

/**
 * Build ranked field candidates from a card's rawText and resolved fields.
 * Used to expose conflicting candidates in the review UI.
 */
export function buildFieldCandidates(card: BusinessCardEntry): CardCandidates {
  const candidates: CardCandidates = {};

  // Company candidates: resolved company + domain-inferred name
  {
    const companyCands: FieldCandidate[] = [];
    if (card.company) {
      const conf = card.fieldConfidence?.company ?? 0.70;
      companyCands.push({
        value: card.company,
        score: conf,
        sourceLine: card.company,
        reasons: card.inferredCompanySource === 'domain' ? ['inferred_from_domain'] : ['ocr_detected'],
        rejected: false,
        rejectedReasons: [],
      });
    }

    // Try domain-based inference as an alternative
    const emailDomain = extractDomain(card.email ?? '');
    const websiteDomain = extractDomain(card.website ?? '');
    for (const domain of [emailDomain, websiteDomain]) {
      if (!domain || isGenericDomain(domain)) continue;
      const inferred = inferCompanyFromDomain(domain);
      if (inferred && inferred !== card.company) {
        companyCands.push({
          value: inferred,
          score: 0.50,
          sourceLine: domain,
          reasons: ['inferred_from_domain'],
          rejected: false,
          rejectedReasons: [],
        });
      }
    }

    // Look for all-caps lines in rawText that might be company alternatives
    if (card.rawText) {
      const lines = card.rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const isAllCaps = line.length >= 3 && /^[A-Z0-9 &.,'-]+$/.test(line) && /[A-Z]{2,}/.test(line);
        if (isAllCaps && line !== card.company?.toUpperCase() && line.length <= 60) {
          // Convert to title case
          const titled = line.toLowerCase().replace(/(?:^|\s)\S/g, (c) => c.toUpperCase());
          if (!companyCands.some((c) => c.value === titled)) {
            companyCands.push({
              value: titled,
              score: 0.45,
              sourceLine: line,
              reasons: ['all_caps_line'],
              rejected: false,
              rejectedReasons: [],
            });
          }
        }
      }
    }

    if (companyCands.length > 0) {
      candidates.company = companyCands.sort((a, b) => b.score - a.score).slice(0, 3);
    }
  }

  // Name candidates: resolved name + any other name-like lines in rawText
  {
    const nameCands: FieldCandidate[] = [];
    if (card.fullName) {
      const conf = Math.max(card.fieldConfidence?.firstName ?? 0, card.fieldConfidence?.lastName ?? 0);
      nameCands.push({
        value: card.fullName,
        score: conf || 0.70,
        sourceLine: card.fullName,
        reasons: ['resolver_selected'],
        rejected: false,
        rejectedReasons: [],
      });
    }

    // Look for other name-like lines in rawText
    if (card.rawText) {
      const lines = card.rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const words = line.split(/\s+/).filter(Boolean);
        if (words.length >= 2 && words.length <= 4 && !/\d/.test(line)) {
          const isMixedCase = words.every((w) => /^[A-Z][a-z'.-]+$/.test(w));
          if (isMixedCase && line !== card.fullName && !nameCands.some((c) => c.value === line)) {
            nameCands.push({
              value: line,
              score: 0.55,
              sourceLine: line,
              reasons: ['mixed_case_name_line'],
              rejected: false,
              rejectedReasons: [],
            });
          }
        }
      }
    }

    if (nameCands.length > 0) {
      candidates.personName = nameCands.sort((a, b) => b.score - a.score).slice(0, 3);
    }
  }

  return candidates;
}

// ─── Batch correction suggestions ─────────────────────────────────────────────

export interface BatchCorrectionSuggestion {
  rule: BatchCorrectionRule;
  affectedCount: number;
  affectedCardIds: string[];
  label: string;
}

/**
 * When the user edits a company field, suggest corrections to apply across similar cards.
 * Returns an empty array if there are no actionable suggestions.
 */
export function buildBatchCorrectionSuggestions(
  editedCard: BusinessCardEntry,
  editedCompany: string,
  allCards: BusinessCardEntry[],
  context: BatchContext,
): BatchCorrectionSuggestion[] {
  const suggestions: BatchCorrectionSuggestion[] = [];
  if (!editedCompany.trim()) return suggestions;

  const emailDomain = extractDomain(editedCard.email ?? '');
  const websiteDomain = extractDomain(editedCard.website ?? '');
  const domains = [emailDomain, websiteDomain].filter((d) => d && !isGenericDomain(d));

  for (const domain of domains) {
    // Find other cards with this domain that have a different or missing company
    const affected = allCards.filter((c) => {
      if (c.id === editedCard.id) return false;
      if (c.userEdited?.has('company')) return false;
      const cEmail = extractDomain(c.email ?? '');
      const cWeb = extractDomain(c.website ?? '');
      if (cEmail !== domain && cWeb !== domain) return false;
      return !c.company || c.company !== editedCompany;
    });

    if (affected.length > 0) {
      const rule: BatchCorrectionRule = {
        id: crypto.randomUUID(),
        type: 'domain_to_company',
        pattern: domain,
        replacement: editedCompany,
        appliedCount: 0,
        createdAt: new Date().toISOString(),
      };
      suggestions.push({
        rule,
        affectedCount: affected.length,
        affectedCardIds: affected.map((c) => c.id),
        label: `Apply "${editedCompany}" to all ${affected.length} card${affected.length === 1 ? '' : 's'} with domain @${domain}`,
      });
    }
  }

  // Also suggest normalizing company if there are near-matches in the batch
  const normEdited = normalizeCompany(editedCompany);
  const nearMatches = allCards.filter((c) => {
    if (c.id === editedCard.id) return false;
    if (c.userEdited?.has('company')) return false;
    if (!c.company) return false;
    const norm = normalizeCompany(c.company);
    return norm !== normEdited && levenshteinDistance(norm, normEdited) <= 2;
  });

  if (nearMatches.length > 0) {
    const rule: BatchCorrectionRule = {
      id: crypto.randomUUID(),
      type: 'normalize_company',
      pattern: nearMatches[0].company, // The variant to normalize
      replacement: editedCompany,
      appliedCount: 0,
      createdAt: new Date().toISOString(),
    };
    suggestions.push({
      rule,
      affectedCount: nearMatches.length,
      affectedCardIds: nearMatches.map((c) => c.id),
      label: `Normalize "${nearMatches[0].company}" → "${editedCompany}" on ${nearMatches.length} card${nearMatches.length === 1 ? '' : 's'}`,
    });
  }

  return suggestions;
}

/** Simple Levenshtein distance for near-match detection (short strings only). */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ─── Review reason injection for conflicting candidates ───────────────────────

/**
 * Add reviewReasons for conflicting candidates (when top two candidates are close).
 */
function injectConflictReasons(card: BusinessCardEntry, candidates: CardCandidates): BusinessCardEntry {
  const reasons = [...(card.warnings ?? [])];

  const addConflictIfClose = (cands: typeof candidates.company, reason: string) => {
    if (!cands || cands.length < 2) return;
    const [first, second] = cands;
    // Consider "close" when score difference is < 0.15 and both are non-rejected
    if (!first.rejected && !second.rejected && first.score - second.score < 0.15) {
      if (!reasons.includes(reason)) reasons.push(reason);
    }
  };

  addConflictIfClose(candidates.company, 'conflicting_company_candidates');
  addConflictIfClose(candidates.personName, 'conflicting_name_candidates');

  return { ...card, warnings: reasons, needsReview: reasons.length > 0 || card.needsReview };
}

// ─── Main batch analysis entry point ─────────────────────────────────────────

/**
 * Run the full Phase 3 batch analysis pipeline:
 * 1. Analyze batch context (domain maps, company counts, etc.)
 * 2. Apply batch domain boosts to low-confidence cards
 * 3. Apply session correction rules
 * 4. Detect duplicates and annotate cards
 * 5. Build per-card candidate rankings
 * 6. Inject conflict review reasons
 *
 * Returns the updated card array. Does NOT mutate input.
 */
export function runBatchAnalysis(
  cards: BusinessCardEntry[],
  corrections: ScanSessionCorrections = { rules: [] },
): BusinessCardEntry[] {
  if (cards.length === 0) return cards;

  const context = analyzeBatch(cards);

  // Step 1: Apply batch boost + session corrections
  let updated = cards.map((card) => {
    let c = applyBatchBoost(card, context);
    c = applySessionCorrections(c, corrections);
    return c;
  });

  // Step 2: Detect duplicates and annotate
  const duplicates = detectDuplicates(updated);
  const dupMap = new Map<string, DuplicateInfo>(duplicates.map((d) => [d.cardId, d]));

  updated = updated.map((card) => {
    const dup = dupMap.get(card.id);
    if (!dup) return card;
    // Don't overwrite user-resolved duplicate status
    if (card.duplicateStatus === 'ignored') return card;
    return {
      ...card,
      duplicateOf: dup.duplicateOfId,
      duplicateStatus: card.duplicateStatus ?? dup.status,
      needsReview: true,
      warnings: [...(card.warnings ?? []), `duplicate_${dup.matchReason}`].filter(
        (v, i, arr) => arr.indexOf(v) === i,
      ),
    };
  });

  // Step 3: Build candidate rankings and inject conflict reasons
  updated = updated.map((card) => {
    const candidates = buildFieldCandidates(card);
    const withCandidates = { ...card, candidates };
    return injectConflictReasons(withCandidates, candidates);
  });

  return updated;
}

// ─── Session correction factory helpers ──────────────────────────────────────

export function createCorrectionRule(
  type: BatchCorrectionType,
  pattern: string,
  replacement?: string,
): BatchCorrectionRule {
  return {
    id: crypto.randomUUID(),
    type,
    pattern,
    replacement,
    appliedCount: 0,
    createdAt: new Date().toISOString(),
  };
}

export function addCorrectionRule(
  corrections: ScanSessionCorrections,
  rule: BatchCorrectionRule,
): ScanSessionCorrections {
  // Deduplicate: same type + pattern replaces old rule
  const filtered = corrections.rules.filter(
    (r) => !(r.type === rule.type && r.pattern === rule.pattern),
  );
  return { rules: [...filtered, rule] };
}

export function removeCorrectionRule(
  corrections: ScanSessionCorrections,
  ruleId: string,
): ScanSessionCorrections {
  return { rules: corrections.rules.filter((r) => r.id !== ruleId) };
}
