import { AdditionalContact, BusinessCardEntry, FieldConfidenceScores } from '@/types/scan';

interface OCRLine {
  text: string;
  confidence?: number;
  rotation?: number;
}

interface ResolverContext {
  ocrText: string;
  ocrLines: OCRLine[];
  existingExtraction?: Partial<BusinessCardEntry>;
  cropMetadata?: {
    rotation?: number;
    orientation?: 'normal' | 'rotated90' | 'rotated180' | 'rotated270';
  };
  debugOutput?: boolean;
}

interface ResolverResult {
  fullName: string;
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  tagline: string;
  additionalContacts: AdditionalContact[];
  confidence: number;
  fieldConfidence: FieldConfidenceScores;
  warnings: string[];
}

type ScoredLine = {
  line: string;
  index: number;
  personScore: number;
  companyScore: number;
  titleScore: number;
  addressScore: number;
  taglineScore: number;
  hasEmail: boolean;
  hasPhone: boolean;
  hasWebsite: boolean;
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?\d[\d().\s-]{8,}\d)/g;
const DOMAIN_RE = /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|gov|io|co|us|biz|info))/gi;

const STATE_SET = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]);

const COMPANY_WORDS = [
  'LLC', 'INC', 'CORP', 'COMPANY', 'CO', 'FOUNDATION', 'ORGANIZATION', 'AGENCY', 'DEPARTMENT', 'MINISTRIES',
  'SERVICES', 'SERVICE', 'STUDIO', 'FILMS', 'FILM', 'PHOTOGRAPHY', 'SHOP', 'CENTER', 'RENTAL', 'GROUP',
];

const TITLE_WORDS = [
  'DIRECTOR', 'MANAGER', 'PRESIDENT', 'FOUNDER', 'CEO', 'COO', 'CFO', 'CTO', 'OWNER', 'SPECIALIST',
  'COORDINATOR', 'OFFICER', 'CONSULTANT', 'REPRESENTATIVE', 'LEGISLATIVE', 'POLITICAL', 'DIETITIAN',
  'FILMMAKER', 'PHOTOGRAPHER', 'ENGINEER', 'DEVELOPER', 'DESIGNER',
];

const SERVICE_WORDS = [
  'FILM', 'PHOTOGRAPHY', 'RENTAL', 'CATERING', 'BARTENDER', 'REPAIR', 'APPLIANCE', 'LUXURY', 'SPECIALIZING',
  'SERVICES', 'SERVICE', 'YACHT',
];

const KNOWN_ACRONYMS = new Set(['LLC', 'INC', 'CO', 'CEO', 'COO', 'CFO', 'CTO', 'VP', 'USA']);

const ADDRESS_WORDS = [
  'STREET', 'ST', 'ROAD', 'RD', 'AVENUE', 'AVE', 'BOULEVARD', 'BLVD', 'LANE', 'LN', 'DRIVE', 'DR', 'SUITE',
  'STE', 'FLOOR', 'FL', 'BUILDING', 'BLDG', 'CENTER', 'APT', 'APARTMENT', 'P.O. BOX', 'PO BOX', 'P O BOX',
];

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function toTitleCasePreserveAcronyms(value: string): string {
  const words = normalizeWhitespace(value).split(' ').filter(Boolean);
  const lowerWords = new Set(['and', 'or', 'for', 'of', 'the', 'a', 'an', 'to', 'in']);
  return words
    .map((word, index) => {
      if (KNOWN_ACRONYMS.has(word.toUpperCase())) return word.toUpperCase();
      if (/^[A-Z]\.$/.test(word)) return word;
      const lower = word.toLowerCase();
      if (index > 0 && lowerWords.has(lower)) return lower;
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(' ');
}

function toSentenceCase(value: string): string {
  const clean = normalizeWhitespace(value).toLowerCase();
  if (!clean) return '';
  return `${clean.charAt(0).toUpperCase()}${clean.slice(1)}`;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const name = normalizeWhitespace(fullName);
  if (!name) return { firstName: '', lastName: '' };

  const comma = /^([^,]+),\s*(.+)$/.exec(name);
  if (comma) {
    const first = toTitleCasePreserveAcronyms(comma[2]);
    const last = toTitleCasePreserveAcronyms(comma[1]);
    return { firstName: first, lastName: last };
  }

  const tokens = name.split(' ');
  if (tokens.length === 1) return { firstName: toTitleCasePreserveAcronyms(tokens[0]), lastName: '' };

  return {
    firstName: toTitleCasePreserveAcronyms(tokens[0]),
    lastName: toTitleCasePreserveAcronyms(tokens.slice(1).join(' ')),
  };
}

function extractEmails(text: string): string[] {
  const matches = text.match(EMAIL_RE) ?? [];
  return Array.from(new Set(matches.map((m) => m.toLowerCase())));
}

function extractDomains(text: string): string[] {
  const domains: string[] = [];
  for (const match of text.matchAll(DOMAIN_RE)) {
    const domain = (match[1] || '').toLowerCase();
    if (domain) domains.push(domain);
  }
  return Array.from(new Set(domains));
}

function extractPhones(text: string): string[] {
  const matches = text.match(PHONE_RE) ?? [];
  const formatted = matches
    .map((m) => normalizePhone(m))
    .filter(Boolean) as string[];
  return Array.from(new Set(formatted));
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) return normalizeWhitespace(value);
  const local = digits.length > 10 ? digits.slice(digits.length - 10) : digits;
  return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
}

function domainRoot(domain: string): string {
  const host = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  return parts[parts.length - 2];
}

function isStateOnlyLine(line: string): boolean {
  const cleaned = normalizeWhitespace(line).toUpperCase();
  return cleaned.length === 2 && STATE_SET.has(cleaned);
}

function hasCityStateZip(line: string): boolean {
  return /\b[A-Za-z][A-Za-z\s'.-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(line);
}

function isAddressLike(line: string): boolean {
  const upper = line.toUpperCase();
  if (hasCityStateZip(line)) return true;
  if (/\b\d{5}(?:-\d{4})?\b/.test(line) && /,\s*[A-Z]{2}\b/.test(line)) return true;
  return ADDRESS_WORDS.some((word) => upper.includes(word));
}

function looksLikeTagline(line: string): boolean {
  const cleaned = normalizeWhitespace(line);
  if (cleaned.length < 6 || cleaned.length > 120) return false;
  if (/^(LET'?S|PLEASE)\b/i.test(cleaned)) return true;
  if (/\b(BUILDING|SPECIALIZING|SERVING|CREATING|DELIVERING|POWER|FOR ALL)\b/i.test(cleaned)) return true;
  if (/[.!?]$/.test(cleaned)) return true;
  return false;
}

function tokenizeName(line: string): string[] {
  return normalizeWhitespace(line)
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => /^[A-Za-z][A-Za-z'.-]*$/.test(t) || /^[A-Za-z]\.?$/.test(t));
}

function scorePersonName(line: string, emailLocalPart: string): number {
  const clean = normalizeWhitespace(line);
  const upper = clean.toUpperCase();
  const tokens = tokenizeName(clean);

  if (!clean || clean.includes('@') || extractDomains(clean).length > 0) return -10;
  if (isAddressLike(clean) || isStateOnlyLine(clean)) return -10;
  if (tokens.length < 2 || tokens.length > 4) return -8;
  if (/\d/.test(clean)) return -8;
  if (COMPANY_WORDS.some((w) => upper.includes(w))) return -6;
  if (TITLE_WORDS.some((w) => upper.includes(w))) return -4;
  if (SERVICE_WORDS.some((w) => upper.includes(w))) return -4;

  let score = 5;
  const localTokens = emailLocalPart.split(/[._-]+/).filter(Boolean);
  if (localTokens.length > 0) {
    const normTokens = tokens.map((t) => normalizeToken(t));
    if (localTokens.some((lt) => normTokens.includes(normalizeToken(lt)))) score += 4;
  }
  if (/^[A-Z\s.'-]+$/.test(clean)) score += 1;
  if (/^[A-Za-z]+,\s*[A-Za-z]/.test(clean)) score += 2;

  return score;
}

function scoreCompany(line: string, emailDomainRoot: string, websiteDomainRoot: string): number {
  const clean = normalizeWhitespace(line);
  const upper = clean.toUpperCase();
  if (!clean) return -10;
  if (clean.includes('@')) return -10;
  if (extractPhones(clean).length > 0) return -10;
  if (isAddressLike(clean) || isStateOnlyLine(clean)) return -10;
  if (looksLikeTagline(clean)) return -3;

  let score = 1;
  if (extractDomains(clean).length > 0) score += 4;
  if (COMPANY_WORDS.some((w) => upper.includes(w))) score += 3;
  if (/^[A-Z0-9&.'\-\s]{3,}$/.test(clean) && clean.split(' ').length <= 5) score += 2;
  if (SERVICE_WORDS.some((w) => upper.includes(w))) score += 1;

  const norm = normalizeToken(clean);
  if (emailDomainRoot && (norm.includes(emailDomainRoot) || emailDomainRoot.includes(norm))) score += 3;
  if (websiteDomainRoot && (norm.includes(websiteDomainRoot) || websiteDomainRoot.includes(norm))) score += 3;

  if (scorePersonName(clean, '') >= 7) score -= 6;

  return score;
}

function scoreTitle(line: string): number {
  const clean = normalizeWhitespace(line);
  const upper = clean.toUpperCase();
  if (!clean || clean.includes('@') || extractDomains(clean).length > 0) return -10;
  if (isAddressLike(clean)) return -10;
  if (scorePersonName(clean, '') >= 7) return -8;

  let score = 0;
  if (TITLE_WORDS.some((w) => upper.includes(w))) score += 5;
  if (SERVICE_WORDS.some((w) => upper.includes(w))) score += 4;
  if (clean.split(' ').length >= 2) score += 1;
  return score;
}

function scoreAddress(line: string): number {
  if (!isAddressLike(line)) return 0;
  let score = 4;
  if (/P\.?\s*O\.?\s*BOX/i.test(line)) score += 2;
  if (hasCityStateZip(line)) score += 3;
  return score;
}

function scoreTagline(line: string): number {
  if (!looksLikeTagline(line)) return 0;
  let score = 3;
  if (/[.!?]$/.test(normalizeWhitespace(line))) score += 1;
  if (/\b(BUILDING|SPECIALIZING|LET'?S|PLEASE|POWER)\b/i.test(line)) score += 2;
  return score;
}

function inferCompanyFromDomain(domain: string): string {
  const root = domainRoot(domain);
  if (!root) return '';
  let candidate = root;

  if (candidate.endsWith('llc')) {
    candidate = `${candidate.slice(0, -3)} LLC`;
  } else if (candidate.endsWith('inc')) {
    candidate = `${candidate.slice(0, -3)} Inc`;
  } else if (candidate.endsWith('corp')) {
    candidate = `${candidate.slice(0, -4)} Corp`;
  }

  // Light heuristic for common concatenated nouns used in cards.
  candidate = candidate
    .replace(/pictures/gi, ' pictures')
    .replace(/voices/gi, ' voices')
    .replace(/price/gi, ' price')
    .replace(/claim/gi, ' claim')
    .replace(/\s+/g, ' ')
    .trim();

  return toTitleCasePreserveAcronyms(candidate);
}

function parseNamePhonePair(line: string): { name: string; phone: string } | null {
  const match = /^\s*([A-Za-z'.-]+(?:\s+[A-Za-z'.-]+){1,3})\s+(\+?\d[\d().\s-]{8,}\d)\s*$/.exec(line);
  if (!match) return null;

  const name = toTitleCasePreserveAcronyms(match[1]);
  const phone = normalizeWhitespace(match[2]);
  if (!phone || phone.replace(/\D/g, '').length < 10) return null;
  return { name, phone };
}

function hasReasonableDomainCompanyRelation(company: string, email: string, website: string): boolean {
  const companyNorm = normalizeToken(company);
  if (!companyNorm) return true;

  const emailRoot = domainRoot(email.includes('@') ? email.split('@')[1] : '');
  const siteRoot = domainRoot(website);

  const roots = [emailRoot, siteRoot].filter(Boolean);
  if (roots.length === 0) return true;

  return roots.some((root) => {
    const rootNorm = normalizeToken(root);
    return companyNorm.includes(rootNorm.slice(0, Math.min(rootNorm.length, 6)))
      || rootNorm.includes(companyNorm.slice(0, Math.min(companyNorm.length, 6)));
  });
}

function applyUserEditedValue(
  key: keyof BusinessCardEntry,
  nextValue: string,
  existing: Partial<BusinessCardEntry> | undefined,
): string {
  if (!existing) return nextValue;
  const edited = existing.userEdited;
  if (!edited) return nextValue;

  const editedSet = Array.isArray(edited)
    ? new Set(edited)
    : edited;

  if (editedSet.has(key)) {
    const current = (existing[key] ?? '') as string;
    return current || nextValue;
  }

  return nextValue;
}

export function resolveBusinessCardFields(context: ResolverContext): ResolverResult {
  const debug = (message: string, payload?: unknown) => {
    if (!context.debugOutput) return;
    if (payload === undefined) {
      console.log(`[BizCardResolver] ${message}`);
      return;
    }
    console.log(`[BizCardResolver] ${message}`, payload);
  };

  const rawLines = context.ocrLines.length > 0
    ? context.ocrLines.map((l) => l.text)
    : context.ocrText.split(/\r?\n/);

  const lines = rawLines
    .map((l) => normalizeWhitespace(l))
    .filter(Boolean);

  const fullText = lines.join('\n') || context.ocrText;

  const emails = extractEmails(fullText);
  const websites = extractDomains(fullText);
  const phones = extractPhones(fullText);
  const email = emails[0] || '';
  const website = websites[0] || '';

  const emailLocal = email.split('@')[0] || '';
  const emailDomainRoot = domainRoot(email.includes('@') ? email.split('@')[1] : '');
  const websiteDomainRoot = domainRoot(website);

  const scored: ScoredLine[] = lines.map((line, index) => ({
    line,
    index,
    personScore: scorePersonName(line, emailLocal),
    companyScore: scoreCompany(line, emailDomainRoot, websiteDomainRoot),
    titleScore: scoreTitle(line),
    addressScore: scoreAddress(line),
    taglineScore: scoreTagline(line),
    hasEmail: extractEmails(line).length > 0,
    hasPhone: extractPhones(line).length > 0,
    hasWebsite: extractDomains(line).length > 0,
  }));

  debug('OCR raw text', fullText);
  debug('OCR lines', lines);
  debug('Candidate scores', scored);

  const used = new Set<number>();

  const pickBest = (field: keyof Pick<ScoredLine, 'personScore' | 'companyScore' | 'titleScore' | 'addressScore' | 'taglineScore'>, minScore = 1) => {
    const best = [...scored]
      .filter((row) => !used.has(row.index))
      .sort((a, b) => b[field] - a[field])[0];

    if (!best || best[field] < minScore) return null;
    used.add(best.index);
    return best;
  };

  const namePhonePairs = lines
    .map((line, idx) => {
      const pair = parseNamePhonePair(line);
      if (!pair) return null;
      return { ...pair, index: idx };
    })
    .filter(Boolean) as Array<{ name: string; phone: string; index: number }>;

  const businessFirstLikely = namePhonePairs.length >= 2;

  const bestPerson = pickBest('personScore', 4);
  const bestCompany = pickBest('companyScore', 2);
  const bestTitle = pickBest('titleScore', 4);

  const addressRows = [...scored]
    .filter((row) => row.addressScore > 0)
    .sort((a, b) => a.index - b.index);

  let address = '';
  if (addressRows.length > 0) {
    const parts: string[] = [];
    for (const row of addressRows) {
      const value = row.line;
      if (!parts.some((p) => normalizeToken(p) === normalizeToken(value))) {
        parts.push(value);
      }
    }
    address = parts.join(', ');
  }

  const taglineRows = [...scored]
    .filter((row) => row.taglineScore > 0 && !row.hasEmail && !row.hasWebsite && !row.hasPhone)
    .sort((a, b) => b.taglineScore - a.taglineScore || a.index - b.index)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index);
  const tagline = taglineRows.map((row) => toSentenceCase(row.line)).join(' / ');

  let fullName = bestPerson ? toTitleCasePreserveAcronyms(bestPerson.line) : '';
  let company = bestCompany ? toTitleCasePreserveAcronyms(bestCompany.line) : '';
  const title = bestTitle ? toTitleCasePreserveAcronyms(bestTitle.line) : '';

  if (bestCompany?.hasWebsite) {
    const domainFromLine = extractDomains(bestCompany.line)[0] || '';
    company = inferCompanyFromDomain(domainFromLine || website || emailDomainRoot || '');
  }

  if (businessFirstLikely && !company) {
    const nonPairCandidates = lines.filter((line, idx) => !namePhonePairs.some((pair) => pair.index === idx));
    const candidate = nonPairCandidates.find((line) => scoreCompany(line, emailDomainRoot, websiteDomainRoot) >= 2);
    if (candidate) company = toTitleCasePreserveAcronyms(candidate);
  }

  if (!company && website) {
    company = inferCompanyFromDomain(website);
  }

  if (!company && emailDomainRoot) {
    company = inferCompanyFromDomain(emailDomainRoot);
  }

  if (namePhonePairs.length > 0) {
    if (!fullName && !businessFirstLikely) {
      fullName = namePhonePairs[0].name;
    }
  }

  if (businessFirstLikely && fullName) {
    // For business-first multi-contact cards without clear primary contact, keep fullName blank.
    const nameMentionCount = namePhonePairs.filter((pair) => normalizeToken(pair.name) === normalizeToken(fullName)).length;
    if (nameMentionCount === 0) {
      fullName = '';
    }
  }

  // Convert "Last, First" into "First Last".
  if (/^[^,]+,\s*.+$/.test(fullName)) {
    const split = splitName(fullName);
    fullName = `${split.firstName} ${split.lastName}`.trim();
  }

  // Reject company that is just a surname token from the chosen person.
  if (company && fullName) {
    const companyNorm = normalizeToken(company);
    const personTokens = tokenizeName(fullName).map((t) => normalizeToken(t));
    if (personTokens.includes(companyNorm)) {
      company = '';
    }
  }

  // Company should not be a state abbreviation.
  const companyWasStateOnly = Boolean(company) && isStateOnlyLine(company);
  if (companyWasStateOnly) {
    company = '';
  }

  const allPhones = Array.from(new Set([
    ...phones,
    ...namePhonePairs.map((pair) => pair.phone),
  ])).filter(Boolean);

  const additionalContacts: AdditionalContact[] = namePhonePairs.map((pair) => ({
    name: pair.name,
    phone: pair.phone,
  }));

  const phone = allPhones.join(', ');

  const nameParts = splitName(fullName);

  const fieldConfidence: FieldConfidenceScores = {};
  if (fullName) fieldConfidence.fullName = Math.min(0.99, (bestPerson?.personScore || 7) / 10);
  if (company) fieldConfidence.company = Math.min(0.99, Math.max(0.55, (bestCompany?.companyScore || 3) / 8));
  if (title) fieldConfidence.title = Math.min(0.99, (bestTitle?.titleScore || 4) / 8);
  if (phone) fieldConfidence.phone = 0.95;
  if (!phone && /\d{3}[\s.-]?\d{4}/.test(fullText)) fieldConfidence.phone = 0.65;
  if (email) fieldConfidence.email = 0.98;
  if (website) fieldConfidence.website = 0.9;
  if (address) fieldConfidence.address = Math.min(0.95, 0.6 + addressRows.length * 0.15);
  if (tagline) fieldConfidence.tagline = 0.75;

  const warnings: string[] = [];

  if (fullName && company && normalizeToken(fullName) === normalizeToken(company)) {
    warnings.push('fullName and company conflict; verify fields.');
  }

  const duplicateNameLike = [...new Set(lines)]
    .filter((line) => lines.filter((l) => normalizeToken(l) === normalizeToken(line)).length > 1)
    .some((line) => scorePersonName(line, emailLocal) >= 4);
  if (duplicateNameLike) {
    warnings.push('Company and full name are identical; verify classification.');
  }

  if (companyWasStateOnly || lines.some((line) => isStateOnlyLine(line))) {
    warnings.push('Company appears to be a state abbreviation; verify classification.');
  }

  if (!hasReasonableDomainCompanyRelation(company, email, website)) {
    warnings.push('Email domain appears inconsistent with company name.');
  }

  if (namePhonePairs.length >= 2 && additionalContacts.length < namePhonePairs.length) {
    warnings.push('Multiple contacts detected; verify contact mapping.');
  }

  const lineConfidence = context.ocrLines.length > 0
    ? context.ocrLines.reduce((sum, l) => sum + (l.confidence ?? 0.8), 0) / context.ocrLines.length
    : 0.8;

  const rotations = new Set((context.ocrLines ?? []).map((line) => line.rotation).filter((v): v is number => typeof v === 'number'));
  if ((rotations.size > 1 || (context.cropMetadata?.rotation ?? 0) % 90 !== 0) && lineConfidence < 0.72) {
    warnings.push('Rotated text detected; verify fields');
  }

  if (lineConfidence < 0.55) {
    warnings.push('OCR confidence is low.');
  }

  const populatedCount = [fullName, company, title, phone, email, website, address].filter(Boolean).length;
  const confidence = Math.max(0.35, Math.min(0.99, 0.35 + populatedCount * 0.09 + (lineConfidence - 0.5) * 0.2 - warnings.length * 0.03));

  const finalFullName = applyUserEditedValue('fullName', fullName, context.existingExtraction);
  const finalCompany = applyUserEditedValue('company', company, context.existingExtraction);
  const finalTitle = applyUserEditedValue('title', title, context.existingExtraction);
  const finalPhone = applyUserEditedValue('phone', phone, context.existingExtraction);
  const finalEmail = applyUserEditedValue('email', email, context.existingExtraction);
  const finalWebsite = applyUserEditedValue('website', website, context.existingExtraction);
  const finalAddress = applyUserEditedValue('address', address, context.existingExtraction);

  debug('Selected fields', {
    fullName: finalFullName,
    company: finalCompany,
    title: finalTitle,
    phone: finalPhone,
    email: finalEmail,
    website: finalWebsite,
    address: finalAddress,
    tagline,
  });
  debug('Rejected candidates', scored.filter((row) => row.personScore <= 0 && row.companyScore <= 0));
  debug('Domain-derived company candidates', {
    fromWebsite: website ? inferCompanyFromDomain(website) : '',
    fromEmailDomain: emailDomainRoot ? inferCompanyFromDomain(emailDomainRoot) : '',
  });
  debug('Detected additional contacts', additionalContacts);

  return {
    fullName: finalFullName,
    firstName: nameParts.firstName,
    lastName: nameParts.lastName,
    company: finalCompany,
    title: finalTitle,
    phone: finalPhone,
    email: finalEmail,
    website: finalWebsite,
    address: finalAddress,
    tagline,
    additionalContacts,
    confidence,
    fieldConfidence,
    warnings,
  };
}
