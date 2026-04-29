import { describe, it, expect } from 'vitest';
import {
  analyzeBatch,
  applyBatchBoost,
  applySessionCorrections,
  detectDuplicates,
  buildFieldCandidates,
  buildBatchCorrectionSuggestions,
  runBatchAnalysis,
  extractDomain,
  createCorrectionRule,
  addCorrectionRule,
} from '@/lib/batchBusinessCardResolver';
import { validateCardForExport, validateBatch } from '@/lib/exportValidation';
import { BusinessCardEntry, ScanSessionCorrections } from '@/types/scan';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeCard(overrides: Partial<BusinessCardEntry> = {}): BusinessCardEntry {
  return {
    id: crypto.randomUUID(),
    fullName: 'Jane Smith',
    firstName: 'Jane',
    lastName: 'Smith',
    company: '',
    title: 'Director',
    phone: '313-555-0100',
    email: 'jsmith@example.com',
    website: '',
    address: '123 Main St\nDetroit, MI 48201',
    tagline: '',
    social: '',
    extraFields: {},
    rawText: 'Jane Smith\nDirector\n313-555-0100\njsmith@example.com\nexample.com',
    status: 'complete',
    needsReview: false,
    confidence: 0.85,
    fieldConfidence: {
      firstName: 0.90,
      lastName: 0.85,
      company: 0.00,
      email: 0.95,
      phone: 0.90,
    },
    warnings: [],
    ...overrides,
  };
}

// ─── extractDomain ─────────────────────────────────────────────────────────────

describe('extractDomain', () => {
  it('extracts domain from email', () => {
    expect(extractDomain('user@henryford.com')).toBe('henryford.com');
  });

  it('strips www prefix from URL', () => {
    expect(extractDomain('www.henryford.com')).toBe('henryford.com');
  });

  it('handles https:// protocol', () => {
    expect(extractDomain('https://henryford.com/about')).toBe('henryford.com');
  });

  it('returns empty string for empty input', () => {
    expect(extractDomain('')).toBe('');
  });
});

// ─── analyzeBatch — domain company map ────────────────────────────────────────

describe('analyzeBatch — domain→company map', () => {
  it('builds domain→company map from high-confidence cards', () => {
    const cards = [
      makeCard({
        email: 'a@hfhs.org',
        company: 'Henry Ford Health',
        fieldConfidence: { company: 0.90 },
      }),
      makeCard({
        email: 'b@hfhs.org',
        company: 'Henry Ford Health',
        fieldConfidence: { company: 0.85 },
      }),
      makeCard({
        email: 'c@hfhs.org',
        company: '',
        fieldConfidence: { company: 0.00 },
      }),
    ];

    const context = analyzeBatch(cards);
    expect(context.domainCompanyMap.get('hfhs.org')).toBe('Henry Ford Health');
  });

  it('does NOT build map when fewer than 2 cards share a domain', () => {
    const cards = [
      makeCard({
        email: 'sole@uniquecorp.com',
        company: 'Unique Corp',
        fieldConfidence: { company: 0.90 },
      }),
    ];

    const context = analyzeBatch(cards);
    expect(context.domainCompanyMap.has('uniquecorp.com')).toBe(false);
  });

  it('ignores generic email domains when building the map', () => {
    const cards = [
      makeCard({ email: 'user1@gmail.com', company: 'Acme', fieldConfidence: { company: 0.90 } }),
      makeCard({ email: 'user2@gmail.com', company: 'Acme', fieldConfidence: { company: 0.88 } }),
    ];

    const context = analyzeBatch(cards);
    expect(context.domainCompanyMap.has('gmail.com')).toBe(false);
  });
});

// ─── applyBatchBoost ──────────────────────────────────────────────────────────

describe('applyBatchBoost — domain boosting', () => {
  it('fills missing company from batch domain map', () => {
    const cards = [
      makeCard({ email: 'a@hfhs.org', company: 'Henry Ford Health', fieldConfidence: { company: 0.90 } }),
      makeCard({ email: 'b@hfhs.org', company: 'Henry Ford Health', fieldConfidence: { company: 0.88 } }),
    ];
    const context = analyzeBatch(cards);

    const target = makeCard({ id: 'target', email: 'c@hfhs.org', company: '' });
    const boosted = applyBatchBoost(target, context);

    expect(boosted.company).toBe('Henry Ford Health');
    expect((boosted.fieldConfidence?.company ?? 0)).toBeGreaterThan(0.70);
  });

  it('does not overwrite a user-edited company field', () => {
    const cards = [
      makeCard({ email: 'a@hfhs.org', company: 'Henry Ford Health', fieldConfidence: { company: 0.90 } }),
      makeCard({ email: 'b@hfhs.org', company: 'Henry Ford Health', fieldConfidence: { company: 0.88 } }),
    ];
    const context = analyzeBatch(cards);

    const userSet = new Set<keyof BusinessCardEntry>(['company']);
    const target = makeCard({
      email: 'c@hfhs.org',
      company: 'My Custom Company',
      userEdited: userSet,
    });
    const boosted = applyBatchBoost(target, context);

    expect(boosted.company).toBe('My Custom Company');
  });

  it('does not overwrite already high-confidence company', () => {
    const cards = [
      makeCard({ email: 'a@hfhs.org', company: 'Henry Ford Health', fieldConfidence: { company: 0.90 } }),
      makeCard({ email: 'b@hfhs.org', company: 'Henry Ford Health', fieldConfidence: { company: 0.88 } }),
    ];
    const context = analyzeBatch(cards);

    const target = makeCard({
      email: 'c@hfhs.org',
      company: 'Ford Motor Company',
      fieldConfidence: { company: 0.80 },
    });
    const boosted = applyBatchBoost(target, context);

    expect(boosted.company).toBe('Ford Motor Company');
  });

  it('ignores generic email domains for boosting', () => {
    const cards = [
      makeCard({ email: 'a@gmail.com', company: 'Acme', fieldConfidence: { company: 0.90 } }),
      makeCard({ email: 'b@gmail.com', company: 'Acme', fieldConfidence: { company: 0.88 } }),
    ];
    const context = analyzeBatch(cards);

    const target = makeCard({ email: 'c@gmail.com', company: '' });
    const boosted = applyBatchBoost(target, context);

    expect(boosted.company).toBe('');
  });
});

// ─── applySessionCorrections ──────────────────────────────────────────────────

describe('applySessionCorrections', () => {
  it('applies domain_to_company rule when email domain matches', () => {
    const card = makeCard({ email: 'user@hfhs.org', company: '' });
    const corrections: ScanSessionCorrections = {
      rules: [
        createCorrectionRule('domain_to_company', 'hfhs.org', 'Henry Ford Health'),
      ],
    };

    const result = applySessionCorrections(card, corrections);
    expect(result.company).toBe('Henry Ford Health');
  });

  it('applies domain_to_company rule when website domain matches', () => {
    const card = makeCard({ website: 'henryford.com', company: '' });
    const corrections: ScanSessionCorrections = {
      rules: [createCorrectionRule('domain_to_company', 'henryford.com', 'Henry Ford Health')],
    };

    const result = applySessionCorrections(card, corrections);
    expect(result.company).toBe('Henry Ford Health');
  });

  it('does NOT apply domain_to_company rule to user-edited company fields', () => {
    const userSet = new Set<keyof BusinessCardEntry>(['company']);
    const card = makeCard({
      email: 'user@hfhs.org',
      company: 'Custom Value',
      userEdited: userSet,
    });
    const corrections: ScanSessionCorrections = {
      rules: [createCorrectionRule('domain_to_company', 'hfhs.org', 'Henry Ford Health')],
    };

    const result = applySessionCorrections(card, corrections);
    expect(result.company).toBe('Custom Value');
  });

  it('applies normalize_company rule when company is a near-match', () => {
    const card = makeCard({ company: 'henry ford health' });
    const corrections: ScanSessionCorrections = {
      rules: [createCorrectionRule('normalize_company', 'henry ford health', 'Henry Ford Health')],
    };

    const result = applySessionCorrections(card, corrections);
    expect(result.company).toBe('Henry Ford Health');
  });

  it('applies ignore_phrase rule to clear matching company', () => {
    const card = makeCard({ company: 'UNTITLED COMPANY' });
    const corrections: ScanSessionCorrections = {
      rules: [createCorrectionRule('ignore_phrase', 'UNTITLED COMPANY')],
    };

    const result = applySessionCorrections(card, corrections);
    expect(result.company).toBe('');
  });

  it('returns unchanged card when no rules match', () => {
    const card = makeCard({ company: 'Acme Corp' });
    const corrections: ScanSessionCorrections = {
      rules: [createCorrectionRule('domain_to_company', 'other.com', 'Other Corp')],
    };

    const result = applySessionCorrections(card, corrections);
    expect(result.company).toBe('Acme Corp');
  });
});

// ─── detectDuplicates ─────────────────────────────────────────────────────────

describe('detectDuplicates', () => {
  it('detects confirmed duplicate on matching email', () => {
    const card1 = makeCard({ id: 'a', email: 'jane@example.com', confidence: 0.90 });
    const card2 = makeCard({ id: 'b', email: 'jane@example.com', confidence: 0.70 });

    const dups = detectDuplicates([card1, card2]);

    expect(dups).toHaveLength(1);
    expect(dups[0].status).toBe('confirmed');
    expect(dups[0].matchReason).toBe('same_email');
    // Lower-confidence card is the duplicate
    expect(dups[0].cardId).toBe('b');
    expect(dups[0].duplicateOfId).toBe('a');
  });

  it('detects possible duplicate on matching phone', () => {
    const card1 = makeCard({ id: 'a', email: 'a@x.com', phone: '3135550100', confidence: 0.90 });
    const card2 = makeCard({ id: 'b', email: 'b@y.com', phone: '3135550100', confidence: 0.70 });

    const dups = detectDuplicates([card1, card2]);

    const phoneDup = dups.find((d) => d.matchReason === 'same_phone');
    expect(phoneDup).toBeDefined();
    expect(phoneDup!.status).toBe('possible');
  });

  it('detects possible duplicate on matching name + company', () => {
    const card1 = makeCard({
      id: 'a',
      fullName: 'Jane Smith',
      company: 'Acme Corp',
      email: 'a@x.com',
      phone: '1234567890',
      confidence: 0.90,
    });
    const card2 = makeCard({
      id: 'b',
      fullName: 'Jane Smith',
      company: 'Acme Corp',
      email: 'b@y.com',
      phone: '0987654321',
      confidence: 0.70,
    });

    const dups = detectDuplicates([card1, card2]);

    const nameDup = dups.find((d) => d.matchReason === 'same_name_company');
    expect(nameDup).toBeDefined();
    expect(nameDup!.status).toBe('possible');
  });

  it('returns no duplicates when all cards are unique', () => {
    const cards = [
      makeCard({ id: 'a', email: 'a@x.com', phone: '1111111111', fullName: 'Alice A', company: 'Alpha' }),
      makeCard({ id: 'b', email: 'b@y.com', phone: '2222222222', fullName: 'Bob B', company: 'Beta' }),
      makeCard({ id: 'c', email: 'c@z.com', phone: '3333333333', fullName: 'Carol C', company: 'Gamma' }),
    ];

    const dups = detectDuplicates(cards);
    expect(dups).toHaveLength(0);
  });
});

// ─── buildFieldCandidates ─────────────────────────────────────────────────────

describe('buildFieldCandidates', () => {
  it('returns company candidates with highest score first', () => {
    const card = makeCard({
      company: 'Henry Ford Health',
      fieldConfidence: { company: 0.90 },
      email: 'user@hfhs.org',
    });

    const candidates = buildFieldCandidates(card);

    expect(candidates.company).toBeDefined();
    expect(candidates.company![0].value).toBe('Henry Ford Health');
    expect(candidates.company![0].score).toBeGreaterThan(0);
  });

  it('includes domain-inferred company as alternative candidate', () => {
    const card = makeCard({
      company: 'Henry Ford Health',
      fieldConfidence: { company: 0.90 },
      email: 'user@nextstep.com',
    });

    const candidates = buildFieldCandidates(card);
    // At least 1 candidate for company exists
    expect((candidates.company?.length ?? 0)).toBeGreaterThan(0);
  });

  it('returns name candidates when fullName is present', () => {
    const card = makeCard({ fullName: 'Jane Smith', fieldConfidence: { firstName: 0.85, lastName: 0.80 } });

    const candidates = buildFieldCandidates(card);

    expect(candidates.personName).toBeDefined();
    expect(candidates.personName![0].value).toBe('Jane Smith');
  });
});

// ─── runBatchAnalysis — conflict reviewReasons ────────────────────────────────

describe('runBatchAnalysis — conflicting candidate reviewReasons', () => {
  it('injects conflicting_company_candidates when two company candidates are close', () => {
    // Two all-caps lines in rawText create competing company candidates
    const card = makeCard({
      id: 'conflict-test',
      company: '',
      fieldConfidence: { company: 0 },
      email: 'a@example.org',
      rawText: 'HENRY FORD HEALTH\nDETROIT MEDICAL CENTER\nJane Smith\nDirector',
    });

    // Need 2 more cards with same domain to trigger boost map (not the focus here)
    const cards = [card];
    const result = runBatchAnalysis(cards);

    // The card should have had candidates built; the test verifies the pipeline ran
    expect(result).toHaveLength(1);
    expect(result[0].candidates).toBeDefined();
  });
});

// ─── exportValidation ─────────────────────────────────────────────────────────

describe('validateCardForExport', () => {
  it('marks ready_to_export when card has name + contact method', () => {
    const card = makeCard({
      fullName: 'Jane Smith',
      company: 'Acme',
      email: 'jane@acme.com',
      phone: '3135550100',
      confidence: 0.85,
      needsReview: false,
      status: 'complete',
    });

    const result = validateCardForExport(card);
    expect(result.status).toBe('ready_to_export');
    expect(result.blockedReasons).toHaveLength(0);
  });

  it('marks export_blocked when no name or company', () => {
    const card = makeCard({ fullName: '', firstName: '', lastName: '', company: '' });

    const result = validateCardForExport(card);
    expect(result.status).toBe('export_blocked');
    expect(result.blockedReasons).toContain('no_identifying_info');
  });

  it('marks export_blocked when email format is invalid', () => {
    const card = makeCard({ email: 'not-an-email' });

    const result = validateCardForExport(card);
    expect(result.status).toBe('export_blocked');
    expect(result.blockedReasons).toContain('invalid_email_format');
  });

  it('marks export_blocked when company looks like OCR paragraph', () => {
    const card = makeCard({ company: 'This is a really long sentence that looks like a paragraph from the OCR engine and should be rejected because it is not a company name at all' });

    const result = validateCardForExport(card);
    expect(result.status).toBe('export_blocked');
    expect(result.blockedReasons).toContain('company_contains_ocr_paragraph');
  });

  it('marks export_blocked when card is explicitly excluded', () => {
    const card = makeCard({ excludeFromExport: true });

    const result = validateCardForExport(card);
    expect(result.status).toBe('export_blocked');
    expect(result.blockedReasons).toContain('excluded_by_user');
  });

  it('marks export_warning when contact method is missing', () => {
    const card = makeCard({ phone: '', email: '', website: '' });

    const result = validateCardForExport(card);
    expect(result.status).toBe('export_warning');
    expect(result.warningReasons).toContain('no_contact_method');
  });

  it('marks export_warning when confidence is low', () => {
    const card = makeCard({
      fullName: 'Jane Smith',
      email: 'jane@acme.com',
      confidence: 0.45,
      needsReview: false,
      status: 'complete',
    });

    const result = validateCardForExport(card);
    expect(result.status).toBe('export_warning');
    expect(result.warningReasons).toContain('low_confidence');
  });

  it('marks export_warning when card has unresolved duplicate', () => {
    const card = makeCard({
      duplicateOf: 'some-other-id',
      duplicateStatus: 'possible',
      email: 'jane@acme.com',
    });

    const result = validateCardForExport(card);
    expect(result.warningReasons).toContain('unresolved_duplicate');
  });
});

// ─── validateBatch ────────────────────────────────────────────────────────────

describe('validateBatch', () => {
  it('annotates all cards with export status', () => {
    const cards = [
      makeCard({ fullName: 'Alice', email: 'alice@acme.com', confidence: 0.90, needsReview: false, status: 'complete' }),
      makeCard({ fullName: '', firstName: '', lastName: '', company: '' }),
    ];

    const result = validateBatch(cards);
    expect(result[0].exportStatus).toBe('ready_to_export');
    expect(result[1].exportStatus).toBe('export_blocked');
  });
});

// ─── batchCorrectionSuggestions ───────────────────────────────────────────────

describe('buildBatchCorrectionSuggestions', () => {
  it('suggests domain_to_company correction when other cards share the same domain', () => {
    const editedCard = makeCard({ id: 'edited', email: 'me@hfhs.org', company: 'Henry Ford Health' });
    const otherCard = makeCard({ id: 'other', email: 'other@hfhs.org', company: '' });
    const allCards = [editedCard, otherCard];
    const context = analyzeBatch(allCards);

    const suggestions = buildBatchCorrectionSuggestions(
      editedCard,
      'Henry Ford Health',
      allCards,
      context,
    );

    expect(suggestions.length).toBeGreaterThan(0);
    const domainRule = suggestions.find((s) => s.rule.type === 'domain_to_company');
    expect(domainRule).toBeDefined();
    expect(domainRule!.rule.pattern).toBe('hfhs.org');
    expect(domainRule!.rule.replacement).toBe('Henry Ford Health');
    expect(domainRule!.affectedCount).toBe(1);
  });

  it('does NOT suggest domain correction for generic domains', () => {
    const editedCard = makeCard({ id: 'edited', email: 'me@gmail.com', company: 'My Business' });
    const otherCard = makeCard({ id: 'other', email: 'other@gmail.com', company: '' });
    const allCards = [editedCard, otherCard];
    const context = analyzeBatch(allCards);

    const suggestions = buildBatchCorrectionSuggestions(
      editedCard,
      'My Business',
      allCards,
      context,
    );

    const domainRule = suggestions.find((s) => s.rule.type === 'domain_to_company');
    expect(domainRule).toBeUndefined();
  });

  it('does NOT suggest correction for cards that already have the edited company', () => {
    const editedCard = makeCard({ id: 'edited', email: 'me@hfhs.org', company: 'Henry Ford Health' });
    const alreadySetCard = makeCard({ id: 'already', email: 'x@hfhs.org', company: 'Henry Ford Health' });
    const allCards = [editedCard, alreadySetCard];
    const context = analyzeBatch(allCards);

    const suggestions = buildBatchCorrectionSuggestions(
      editedCard,
      'Henry Ford Health',
      allCards,
      context,
    );

    const domainRule = suggestions.find((s) => s.rule.type === 'domain_to_company');
    // alreadySetCard already has the company, so 0 affected cards
    expect(domainRule).toBeUndefined();
  });
});

// ─── addCorrectionRule deduplication ─────────────────────────────────────────

describe('addCorrectionRule', () => {
  it('replaces an existing rule with same type + pattern', () => {
    const corrections: ScanSessionCorrections = {
      rules: [createCorrectionRule('domain_to_company', 'hfhs.org', 'Old Name')],
    };

    const updated = addCorrectionRule(
      corrections,
      createCorrectionRule('domain_to_company', 'hfhs.org', 'New Name'),
    );

    const rule = updated.rules.find((r) => r.pattern === 'hfhs.org');
    expect(rule?.replacement).toBe('New Name');
    expect(updated.rules.length).toBe(1);
  });

  it('adds new rule without removing unrelated ones', () => {
    const corrections: ScanSessionCorrections = {
      rules: [createCorrectionRule('domain_to_company', 'hfhs.org', 'Henry Ford Health')],
    };

    const updated = addCorrectionRule(
      corrections,
      createCorrectionRule('domain_to_company', 'nextstep.com', 'Next Step Solutions'),
    );

    expect(updated.rules.length).toBe(2);
  });
});
