/**
 * businessCardResolver.ts
 *
 * Pure text-based parser for business card OCR output.
 * Prefers rawText over markdown (markdown can inject <sub>®</sub> and merge lines).
 * Does NOT call any API — operates only on the string passed in.
 */

// ─── Credential suffixes to strip from person names ───────────────────────────
const CREDENTIAL_SUFFIXES = new Set([
  'RDN', 'RN', 'LPN', 'CNA', 'NP', 'APRN', 'CNP', 'NNP', 'CRNA',
  'MD', 'DO', 'DDS', 'DMD', 'OD', 'DVM', 'DPT', 'PharmD',
  'PhD', 'EdD', 'PsyD', 'DNP',
  'PA', 'LCSW', 'LMSW', 'LSW', 'LPC', 'LPCC',
  'CPA', 'CFP', 'MBA', 'JD', 'Esq',
  'PE', 'PMP', 'CISA', 'CISSP',
]);

// ─── US state abbreviations ────────────────────────────────────────────────────
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

// ─── Generic service/category words that are never person names ───────────────
const SERVICE_WORDS = new Set([
  'photography', 'catering', 'consulting', 'construction', 'ministry',
  'ministries', 'services', 'solutions', 'health', 'wellness', 'fitness',
  'media', 'marketing', 'design', 'creative', 'studio', 'group',
  'associates', 'agency', 'network', 'realty', 'insurance', 'financial',
]);

// ─── Organization-line detection ──────────────────────────────────────────────
// Lines matching these patterns should never become person names.
const ORG_LINE_PREFIXES = /^(state of|city of|county of|office of|department of|ministry of|bureau of|university of|republic of|province of)\b/i;
const ORG_LINE_KEYWORDS = /\b(department|county|township|parish|borough|city of|university|ministry|ministries|church|office of|government|bureau|division|authority|commission|tribunal|district)\b/i;

function isOrgLine(line: string): boolean {
  const trimmed = line.trim();
  return ORG_LINE_PREFIXES.test(trimmed) || ORG_LINE_KEYWORDS.test(trimmed);
}

// ─── Honorific detection ──────────────────────────────────────────────────────
// Lines starting with an honorific are strong person-name candidates and should
// outrank any organization or all-caps line.
const HONORIFIC_RE = /^(Mr\.|Ms\.|Mrs\.|Dr\.|Rev\.|Hon\.|Prof\.|Atty\.?|Officer)\s/i;

function hasHonorific(line: string): boolean {
  return HONORIFIC_RE.test(line.trim());
}

// ─── Title role keywords ──────────────────────────────────────────────────────
const TITLE_ROLE_KEYWORDS = /\b(coach|director|manager|officer|coordinator|specialist|consultant|founder|owner|president|representative|agent|advisor|assistant|administrator|supervisor|associate|analyst|engineer|developer|lead|executive|vice|ceo|coo|cfo|cto|vp|partner|secretary|treasurer|liaison|strategist|technician|superintendent|commissioner|inspector)\b/i;

// ─── Suite/floor/unit line pattern ────────────────────────────────────────────
const SUITE_LINE_RE = /^\s*(suite|ste|floor|fl|unit|apt|room|rm|#)\s*[-#]?\s*\d/i;
/** Matches a known building/campus type word — used to identify building name lines. */
const BUILDING_NAME_RE = /\b(building|bldg|tower|center|centre|plaza|hall|house|park|place|complex|campus|annex|square|pavilion|wing)\b/i;
/** Matches a street line that begins with a house/street number. */
const NUMBERED_STREET_RE = /^\d+[A-Za-z]?\s+\S/;

// ─── Street suffix patterns ────────────────────────────────────────────────────
const STREET_SUFFIX_RE = /\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|pl|place|pkwy|parkway|hwy|highway|way|cir|circle|ter|terrace|box|p\.?o\.?\s*box)\b/i;

// ─── City/state/ZIP line pattern ───────────────────────────────────────────────
// e.g. "Detroit, MI 48202" or "Winter Park, FL 32790"
const CITY_STATE_ZIP_RE = /^[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(-\d{4})?$/;

// ─── Bare state abbreviation line ─────────────────────────────────────────────
const BARE_STATE_RE = /^[A-Z]{2}$/;

// ─── ZIP code token ───────────────────────────────────────────────────────────
const ZIP_RE = /\b\d{5}(-\d{4})?\b/;

// ─── Phone number pattern ─────────────────────────────────────────────────────
const PHONE_RE = /(?:\+?\d[\d\s()./-]{7,}\d)/g;
// Labels that identify the phone type; fax is handled separately
const PHONE_LABEL_RE = /\b(mobile|cell|office|work|fax|direct|main|hq|toll\s*free|phone|tel|telephone)\b/i;
const FAX_LABEL_RE = /\bfax\b/i;

// ─── Generic email domains (domain name ≠ company name) ──────────────────────
const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
  'aol.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
  'me.com', 'mac.com', 'comcast.net', 'att.net', 'verizon.net',
  'sbcglobal.net', 'bellsouth.net', 'cox.net', 'earthlink.net',
  'ymail.com', 'inbox.com', 'mail.com', 'zoho.com',
]);

// ─── Service adjectives: pair with a service noun → category heading ──────────
const SERVICE_ADJECTIVES = new Set([
  'professional', 'commercial', 'residential', 'mobile', 'expert', 'certified',
  'licensed', 'general', 'premier', 'custom', 'advanced', 'elite', 'specialized',
  'independent', 'private', 'affordable', 'trusted', 'reliable', 'quality',
]);

// ─── Service activity words: gerunds, trade nouns, activity descriptors ───────
const SERVICE_ACTIVITY_WORDS = new Set([
  // Gerunds
  'organizing', 'cleaning', 'landscaping', 'painting', 'roofing', 'plumbing',
  'consulting', 'accounting', 'bookkeeping', 'tutoring', 'bartending',
  'catering', 'mowing', 'hauling', 'moving', 'remodeling', 'renovating',
  'designing', 'recruiting', 'staffing', 'planning', 'decorating', 'styling',
  'transporting', 'delivering', 'coaching', 'training', 'counseling',
  'barbering', 'installing', 'repairing', 'maintaining', 'notarizing',
  'appraising', 'staging', 'waxing', 'grooming', 'baking', 'brewing',
  'dispatching', 'contracting', 'facilitating', 'mediating',
  // Service nouns
  'photography', 'videography', 'notary', 'construction', 'carpentry',
  'electrical', 'flooring', 'massage', 'esthetics', 'cosmetology',
  'transportation', 'logistics',
]);

// ─── Domain segmentation word list ────────────────────────────────────────────
// Used to split concatenated domain names into readable words.
// e.g., "wonderworkingquarters" → ["wonder", "working", "quarters"]
const DOMAIN_SEGMENT_WORDS = new Set([
  'a', 'able', 'ace', 'act', 'active', 'add', 'advance', 'aerial', 'after',
  'ahead', 'aid', 'air', 'all', 'alliance', 'alpha', 'am', 'amp', 'an',
  'angle', 'apex', 'app', 'art', 'artisan', 'arts', 'at', 'auto', 'avenue',
  'back', 'balance', 'bank', 'base', 'bay', 'bear', 'beauty', 'best', 'better',
  'beyond', 'big', 'black', 'blue', 'bold', 'bond', 'brand', 'bridge',
  'bright', 'build', 'business', 'call', 'capital', 'card', 'care', 'cash',
  'center', 'central', 'chief', 'choice', 'city', 'clean', 'clear', 'close',
  'cloud', 'co', 'coast', 'com', 'connect', 'core', 'corner', 'craft',
  'create', 'creative', 'cross', 'custom', 'data', 'day', 'deal', 'deck',
  'deep', 'delta', 'design', 'digital', 'direct', 'do', 'down', 'dream',
  'drive', 'duo', 'east', 'easy', 'edge', 'elite', 'embrace', 'empire',
  'enable', 'energy', 'engage', 'enterprise', 'envision', 'era', 'estate',
  'ever', 'expert', 'express', 'fair', 'finance', 'fine', 'first', 'fit',
  'flex', 'flow', 'focus', 'ford', 'force', 'forge', 'forward', 'foundation',
  'fresh', 'frontier', 'full', 'gem', 'global', 'goal', 'gold', 'good',
  'grace', 'grand', 'great', 'green', 'grid', 'group', 'grow', 'guide',
  'gulf', 'haven', 'health', 'heart', 'help', 'heritage', 'high', 'home',
  'horizon', 'house', 'hub', 'idea', 'ideal', 'impact', 'in', 'insight',
  'inspire', 'it', 'key', 'kind', 'lab', 'lane', 'leap', 'level', 'light',
  'link', 'lion', 'live', 'local', 'logic', 'long', 'main', 'make', 'market',
  'max', 'media', 'metro', 'mid', 'mind', 'mix', 'mobile', 'modern', 'motion',
  'net', 'network', 'new', 'next', 'north', 'nxt', 'oak', 'office', 'one',
  'open', 'out', 'over', 'peak', 'people', 'pinnacle', 'place', 'plan',
  'play', 'plus', 'point', 'potential', 'power', 'premier', 'prime', 'pro',
  'profile', 'progress', 'provide', 'pure', 'quarters', 'quest', 'quality',
  'reach', 'realty', 'red', 'rise', 'river', 'road', 'rock', 'safe', 'sage',
  'scale', 'set', 'sharp', 'shine', 'sky', 'smart', 'smile', 'south',
  'space', 'spark', 'spirit', 'square', 'star', 'start', 'step', 'sterling',
  'stone', 'stream', 'stride', 'strong', 'style', 'summit', 'swift', 'sys',
  'system', 'systems', 'tech', 'team', 'the', 'thrive', 'tide', 'tip', 'top',
  'total', 'touch', 'trust', 'two', 'united', 'up', 'urban', 'us', 'value',
  'venture', 'view', 'vision', 'water', 'way', 'well', 'west', 'wild', 'wing',
  'wonder', 'wonderful', 'working', 'world', 'worth', 'work', 'works',
  'solutions', 'services', 'henry', 'price', 'miller', 'johnson', 'clark',
  'xcel', 'yard', 'year', 'your', 'zeal', 'zen', 'zone',
]);

// ─── Email pattern ────────────────────────────────────────────────────────────
const EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;

// ─── Domain/URL pattern ───────────────────────────────────────────────────────
// Matches things like "example.com", "www.example.com", "https://example.com/path"
const DOMAIN_LIKE_RE = /(?:https?:\/\/)?(?:www\.)?([A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}(?:\/[^\s<>"]*)?\b/g;

// ─── HTML junk ────────────────────────────────────────────────────────────────
const HTML_TAG_RE = /<[^>]+>/g;

// ─── All-caps word check (logo/brand line) ────────────────────────────────────
// No lowercase letters, at least one uppercase letter, allow brand chars.
function isAllCapsWord(word: string): boolean {
  return word.length >= 1 && /[A-Z]/.test(word) && !/[a-z]/.test(word);
}

// Word limit raised to 10 so long agency names like
// "DEPARTMENT OF HEALTH AND HUMAN SERVICES" (7 words) are still recognised.
function isAllCapsLine(line: string): boolean {
  const words = line.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 10 && words.every(isAllCapsWord);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(text: string): string {
  // Replace tags/entities with space but preserve newlines for line splitting.
  return text
    .replace(HTML_TAG_RE, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[^\S\n]+/g, ' ');  // collapse non-newline whitespace only
}

function looksLikePhone(line: string): boolean {
  const digits = line.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function looksLikeEmail(line: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line.trim());
}

function looksLikeDomain(line: string): boolean {
  const cleaned = line.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return /^[a-z0-9][a-z0-9\-]*\.[a-z]{2,}(\/|$)/i.test(cleaned);
}

function looksLikeAddress(line: string): boolean {
  return STREET_SUFFIX_RE.test(line) || /^P\.?\s*O\.?\s*Box/i.test(line) || ZIP_RE.test(line) || CITY_STATE_ZIP_RE.test(line);
}

function looksLikeCityStateZip(line: string): boolean {
  return CITY_STATE_ZIP_RE.test(line.trim());
}

function isBareState(line: string): boolean {
  return BARE_STATE_RE.test(line.trim()) && US_STATES.has(line.trim());
}

/**
 * Strip trailing credential tokens from a name string.
 * "Leah Oldham, RDN" → { name: "Leah Oldham", credentials: ["RDN"] }
 */
function stripCredentials(raw: string): { name: string; credentials: string[] } {
  // Remove commas and check each trailing token
  const parts = raw.split(/[\s,]+/).filter(Boolean);
  const credentials: string[] = [];

  while (parts.length > 0) {
    const last = parts[parts.length - 1];
    if (CREDENTIAL_SUFFIXES.has(last)) {
      credentials.unshift(last);
      parts.pop();
    } else {
      break;
    }
  }

  return { name: parts.join(' '), credentials };
}

/**
 * Title-case a string that is all-uppercase (e.g. "HENRY FORD HEALTH" → "Henry Ford Health").
 * Leaves mixed-case strings alone.
 */
function toTitleCase(str: string): string {
  if (str !== str.toUpperCase()) return str; // already mixed
  return str
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (c) => c.toUpperCase())
    .replace(/®|™/g, '');
}

/**
 * Clean a raw website string to just the domain.
 * Strips HTML tags, OCR junk, merged trailing words, phone numbers, emails.
 */
export function cleanWebsite(raw: string): string {
  if (!raw) return '';

  // Strip HTML tags and entities
  let cleaned = stripHtml(raw);

  // Remove email addresses
  cleaned = cleaned.replace(EMAIL_RE, ' ');

  // Remove phone-like digit runs
  cleaned = cleaned.replace(/\b\d[\d\s()./-]{6,}\d\b/g, ' ');

  // Remove ®, ™ junk
  cleaned = cleaned.replace(/[®™]/g, '');

  // Find first domain-like token
  const domainMatch = cleaned.match(DOMAIN_LIKE_RE);
  if (!domainMatch) return '';

  const raw_domain = domainMatch[0].trim();

  // Normalize: strip protocol, www, trailing path for cleanliness
  const domain = raw_domain
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/\s/)[0]  // cut at any whitespace (OCR merged words)
    ?? '';

  // Reject if contains spaces (OCR junk merged in)
  if (domain.includes(' ')) return '';

  return domain.toLowerCase();
}

/**
 * Returns true when a line looks like a service/category heading or marketing
 * copy — something that should never be treated as a person name.
 *
 * Catches patterns such as:
 *   "Professional Organizing"      — service adjective + service gerund
 *   "Mobile Bartending"            — service adjective + service gerund
 *   "Photography"                  — single service word
 *   "Specializing in DUO Services" — service description opener
 *   "Cleaning Services"            — service gerund + "services"
 */
function isServiceOrCategoryLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;

  // Service description openers
  if (/^(specializing\s+in|providing\b|offering\b|serving\b|focusing\s+on|dedicated\s+to|committed\s+to)\b/i.test(t)) return true;

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6) return false;
  const lowers = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, ''));

  // Single service/activity word
  if (words.length === 1) {
    return SERVICE_WORDS.has(lowers[0]) || SERVICE_ACTIVITY_WORDS.has(lowers[0]);
  }

  // 2-word: service-adjective + service-word, or service-word + service-word
  if (words.length === 2) {
    const [w0, w1] = lowers;
    if (SERVICE_ADJECTIVES.has(w0) && (SERVICE_ACTIVITY_WORDS.has(w1) || SERVICE_WORDS.has(w1))) return true;
    if (SERVICE_ACTIVITY_WORDS.has(w0) && (SERVICE_WORDS.has(w1) || SERVICE_ACTIVITY_WORDS.has(w1))) return true;
  }

  // Multi-word: ≥ 60 % service/activity words
  const serviceHits = lowers.filter(
    (w) => SERVICE_WORDS.has(w) || SERVICE_ACTIVITY_WORDS.has(w) || SERVICE_ADJECTIVES.has(w),
  ).length;
  if (words.length >= 2 && serviceHits >= Math.ceil(words.length * 0.6)) return true;

  return false;
}

/** Returns true for marketing-description openers ("Specializing in…", etc.). */
function isServiceDescriptionLine(line: string): boolean {
  return /^(specializing\s+in|providing\b|offering\b|serving\b|focusing\s+on|dedicated\s+to|committed\s+to)\b/i.test(line.trim());
}

/**
 * Segment a concatenated domain-name segment into component words using DP.
 * "wonderworkingquarters" → ["wonder", "working", "quarters"]
 * Returns null when clean segmentation is not possible.
 */
function segmentDomainName(domain: string): string[] | null {
  const s = domain.toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return null;
  const n = s.length;
  const dp: (string[] | null)[] = new Array(n + 1).fill(null);
  dp[0] = [];
  for (let i = 1; i <= n; i++) {
    for (let len = Math.min(i, 15); len >= 3; len--) {
      const word = s.slice(i - len, i);
      if (DOMAIN_SEGMENT_WORDS.has(word) && dp[i - len] !== null) {
        dp[i] = [...dp[i - len]!, word];
        break;
      }
    }
  }
  return dp[n];
}

/**
 * Attempt to derive a readable company name from a domain string.
 * "wonderworkingquarters.com" → "Wonder Working Quarters"
 * Returns '' for generic email domains or unresolvable inputs.
 */
export function inferCompanyFromDomain(domain: string): string {
  if (!domain) return '';
  const d = domain.trim().toLowerCase();
  if (GENERIC_EMAIL_DOMAINS.has(d)) return '';
  const base = d.split('.')[0] ?? '';
  if (!base || base.length < 4) return '';
  // Hyphenated domain: "wonder-working-quarters" → "Wonder Working Quarters"
  if (base.includes('-')) {
    return base.split('-').filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');
  }
  // Word segmentation: only use result when ≥ 2 recognisable words are found.
  // Skip the fallback title-case path — single-word or unrecognised domains
  // (e.g. "brionprice", "fair") should not produce a company name.
  const words = segmentDomainName(base);
  if (words && words.length >= 2) {
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  return '';
}

/**
 * Score a person-name candidate line. Higher = more likely to be a real person.
 * Used to select the best name when multiple lines pass candidate checks.
 */
function scoreNameCandidate(name: string, emailLocalPart: string): number {
  const words = name.trim().split(/\s+/).filter(Boolean);
  let score = 1; // base for passing all checks

  // Hyphenated last-name format (e.g., Smith-Johnson)
  if (words.some((w) => /^[A-Z][a-z]+-[A-Z][a-z]+$/.test(w))) score += 4;

  // Every word is properly capitalised
  if (words.every((w) => /^[A-Z][a-z.'-]*$/.test(w) || /^[A-Z][a-z]+-[A-Z][a-z]+$/.test(w))) score += 2;

  // Email local part overlaps with a name word (e.g., "christine" matches "Christine")
  if (emailLocalPart) {
    const emailNorm = emailLocalPart.toLowerCase().replace(/[^a-z]/g, '');
    const nameParts = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, ''));
    if (
      emailNorm.length >= 3
      && nameParts.some(
        (p) => p.length >= 3 && (emailNorm.startsWith(p) || emailNorm.includes(p) || p.includes(emailNorm)),
      )
    ) {
      score += 5;
    }
  }

  // Penalise lines containing service words
  const lowers = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, ''));
  const serviceHits = lowers.filter((w) => SERVICE_WORDS.has(w) || SERVICE_ACTIVITY_WORDS.has(w)).length;
  score -= serviceHits * 2;

  // Penalise lines containing job-title keywords (likely a title, not a name)
  if (TITLE_ROLE_KEYWORDS.test(name)) score -= 3;

  return score;
}

/**
 * Check if a line is a valid person name candidate.
 *
 *  - Organization lines (STATE OF, DEPARTMENT, COUNTY, etc.) are rejected.
 *  - All-caps lines that also contain org keywords are rejected.
 *  - Lines with honorifics are NOT routed through here — the honorific fast-path
 *    in resolveFromRawText promotes them directly.
 */
function isPersonNameCandidate(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (looksLikeEmail(trimmed)) return false;
  if (looksLikePhone(trimmed)) return false;
  if (looksLikeDomain(trimmed)) return false;
  if (looksLikeAddress(trimmed)) return false;
  if (looksLikeCityStateZip(trimmed)) return false;
  if (isBareState(trimmed)) return false;
  if (ZIP_RE.test(trimmed)) return false;
  if (/^P\.?\s*O\.?\s*Box/i.test(trimmed)) return false;
  // Organization lines must never become person names
  if (isOrgLine(trimmed)) return false;
  // Service/category lines must never become person names
  if (isServiceOrCategoryLine(trimmed)) return false;

  // Strip credentials first to get just the name part
  const { name } = stripCredentials(trimmed);
  const words = name.split(/\s+/).filter(Boolean);

  if (words.length < 2 || words.length > 5) return false;

  // Reject single service/category words
  if (words.length === 1 && SERVICE_WORDS.has(words[0].toLowerCase())) return false;

  // Must look like human name tokens — allow mixed case, no digits
  if (/\d/.test(name)) return false;
  if (!/^[A-Za-z'\-. ]+$/.test(name)) return false;

  // Reject if ALL tokens are service words
  if (words.every((w) => SERVICE_WORDS.has(w.toLowerCase()))) return false;

  // Reject if bare all-caps with only 1-2 chars (state abbrev leaking)
  if (isBareState(name)) return false;

  return true;
}

export interface ResolvedCard {
  fullName: string;
  firstName: string;
  lastName: string;
  credentials: string;
  company: string;
  department?: string;
  organizationUnit?: string;
  title: string;
  subtitle?: string;
  serviceCategory?: string;
  services?: string;
  inferredCompanySource?: 'domain';
  phone: string;
  fax?: string;
  otherPhones: string[];
  email: string;
  website: string;
  address: string;
  extraFields: Record<string, string>;
  warnings: string[];
}

/**
 * Resolve structured fields from raw OCR text of a business card.
 * This is the main export used by mapBusinessCard in extraction.ts.
 */
export function resolveFromRawText(rawText: string): Partial<ResolvedCard> {
  if (!rawText || !rawText.trim()) return {};

  // Strip HTML artifacts first (markdown can produce <sub>®</sub> etc.)
  const cleaned = stripHtml(rawText);

  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return {};

  // ── 1. Extract emails ─────────────────────────────────────────────────────
  const emails: string[] = [];
  for (const line of lines) {
    const found = line.match(EMAIL_RE);
    if (found) emails.push(...found.map((e) => e.toLowerCase()));
  }
  const email = emails[0] ?? '';

  // ── 2. Extract phones ─────────────────────────────────────────────────────
  // Collect (phone, label) pairs
  const phonePairs: Array<{ number: string; label: string }> = [];
  for (const line of lines) {
    if (looksLikeEmail(line)) continue;
    if (looksLikeAddress(line)) continue;       // skip street lines
    if (looksLikeCityStateZip(line)) continue;  // skip "City, ST ZIP"
    if (ZIP_RE.test(line) && !PHONE_LABEL_RE.test(line)) continue; // skip standalone ZIP
    const matches = [...line.matchAll(PHONE_RE)];
    for (const m of matches) {
      const number = m[0].trim();
      // Require >= 10 digits (real phone, not a ZIP fragment)
      if (number.replace(/\D/g, '').length < 10) continue;
      const labelMatch = line.match(PHONE_LABEL_RE);
      const label = labelMatch ? labelMatch[1].toLowerCase() : '';
      phonePairs.push({ number, label });
    }
  }

  // Separate fax from non-fax phone pairs
  const faxPairs = phonePairs.filter((p) => FAX_LABEL_RE.test(p.label));
  const nonFaxPairs = phonePairs.filter((p) => !FAX_LABEL_RE.test(p.label));
  const fax = faxPairs[0]?.number ?? '';

  // Priority: direct/phone/tel > office/work > mobile/cell > unlabeled
  const directPhone = nonFaxPairs.find((p) => /^(phone|tel|telephone|direct)$/.test(p.label))?.number ?? '';
  const officePhone = nonFaxPairs.find((p) => /^(office|work)$/.test(p.label))?.number ?? '';
  const mobilePhone = nonFaxPairs.find((p) => /^(mobile|cell)$/.test(p.label))?.number ?? '';
  const firstNonFax = nonFaxPairs[0]?.number ?? '';

  const phone = directPhone || officePhone || (nonFaxPairs.length === 1 ? firstNonFax : '') || mobilePhone || firstNonFax;
  const otherPhones = nonFaxPairs
    .map((p) => (p.label ? `${p.number} ${p.label}` : p.number).trim())
    .filter((p) => p.replace(/\s*(phone|tel|telephone|direct|office|work)$/i, '').trim() !== phone.trim());

  // ── 3. Extract website ────────────────────────────────────────────────────
  let website = '';
  for (const line of lines) {
    if (looksLikeEmail(line)) continue;
    if (looksLikePhone(line)) continue;
    const candidate = cleanWebsite(line);
    if (candidate) {
      website = candidate;
      break;
    }
  }

  // ── 4. Extract address ────────────────────────────────────────────────────
  // Prefer a NUMBERED street line (digits + street suffix) as the anchor.
  // If none exists, fall back to any STREET_SUFFIX_RE match.
  // Look back one line for a building name (must contain a known building word).
  // Look forward for a suite/floor line then city/state/ZIP.
  let address = '';
  {
    let streetIdx = -1;

    // First pass: numbered street (e.g. "3040 W. Grand Blvd.")
    for (let i = 0; i < lines.length; i++) {
      if (NUMBERED_STREET_RE.test(lines[i]) && STREET_SUFFIX_RE.test(lines[i])) {
        streetIdx = i;
        break;
      }
    }

    // Second pass: any street suffix match (e.g. P.O. Box, "Elm Place")
    if (streetIdx < 0) {
      for (let i = 0; i < lines.length; i++) {
        if (/^P\.?\s*O\.?\s*Box/i.test(lines[i]) || STREET_SUFFIX_RE.test(lines[i])) {
          streetIdx = i;
          break;
        }
      }
    }

    if (streetIdx >= 0) {
      const parts: string[] = [];

      // Look back one line for a building/place name.
      // We only include it if it contains a known building-type word, so that
      // person names like "Jane Smith" (before the street) are not captured.
      const prev = lines[streetIdx - 1] ?? '';
      if (
        prev &&
        BUILDING_NAME_RE.test(prev) &&
        !isAllCapsLine(prev) &&
        !looksLikeEmail(prev) &&
        !looksLikePhone(prev) &&
        !looksLikeCityStateZip(prev) &&
        !PHONE_LABEL_RE.test(prev) &&
        !looksLikeDomain(prev)
      ) {
        parts.push(prev);
      }

      parts.push(lines[streetIdx]);

      // Look forward for suite / floor line then city/state/ZIP
      const next1 = lines[streetIdx + 1] ?? '';
      const next2 = lines[streetIdx + 2] ?? '';
      if (SUITE_LINE_RE.test(next1)) {
        parts.push(next1);
        if (CITY_STATE_ZIP_RE.test(next2) || ZIP_RE.test(next2)) {
          parts.push(next2);
        }
      } else if (CITY_STATE_ZIP_RE.test(next1) || ZIP_RE.test(next1)) {
        parts.push(next1);
      } else if (next1 && CITY_STATE_ZIP_RE.test(next2)) {
        // next1 is a continued address line (e.g. second street line)
        parts.push(next1);
        parts.push(next2);
      }

      address = parts.join('\n');
    } else {
      // No street suffix found — fall back to city/state/ZIP line alone
      for (let i = 0; i < lines.length; i++) {
        if (CITY_STATE_ZIP_RE.test(lines[i])) {
          address = lines[i];
          break;
        }
      }
    }
  }

  // ── 5. Detect stacked brand/logo lines → company + department hierarchy ──
  // Consecutive all-caps lines near the top form the org hierarchy:
  //   line 1 = company, line 2 = department, line 3 = organizationUnit
  let company = '';
  let department: string | undefined;
  let organizationUnit: string | undefined;
  let companyEndIndex = -1;

  {
    const stackedCaps: string[] = [];
    let i = 0;

    // Scan the first 10 lines for all-caps stacks
    for (; i < Math.min(lines.length, 10); i++) {
      const line = lines[i];
      // Stop at phones/emails/domains
      if (looksLikeEmail(line) || looksLikePhone(line)) break;

      if (isAllCapsLine(line)) {
        stackedCaps.push(line.replace(/[®™]/g, '').trim());
        companyEndIndex = i;
      } else if (stackedCaps.length > 0) {
        // Stack broken — stop collecting
        break;
      }
    }

    if (stackedCaps.length >= 2 && stackedCaps.some((s) => isOrgLine(s))) {
      // Org hierarchy: line 1 = company, line 2 = department, optional line 3 = orgUnit
      company = toTitleCase(stackedCaps[0]);
      department = toTitleCase(stackedCaps[1]);
      if (stackedCaps.length >= 3) organizationUnit = toTitleCase(stackedCaps[2]);
    } else if (stackedCaps.length >= 2) {
      // Logo/brand name split across multiple short lines — join all into company
      company = toTitleCase(stackedCaps.join(' '));
    } else if (stackedCaps.length === 1) {
      // Single all-caps line — may be company if it looks like a brand/domain
      const lineRaw = stackedCaps[0];
      const single = toTitleCase(lineRaw);
      if (looksLikeDomain(lineRaw.toLowerCase())) {
        // It's a domain-as-company (e.g. BRIONPRICE.COM)
        const nextLineRaw = lines[companyEndIndex + 1] ?? '';
        const nextWords = nextLineRaw.trim().toLowerCase().split(/\s+/);
        if (nextWords.length >= 1 && nextWords.every((w) => SERVICE_WORDS.has(w) || /^[a-z]+$/.test(w))) {
          company = `${single} ${toTitleCase(nextLineRaw)}`;
          companyEndIndex += 1;
        } else {
          company = single;
        }
        if (!website) {
          website = cleanWebsite(lineRaw.toLowerCase()) || lineRaw.toLowerCase().replace(/[®™]/g, '');
        }
      } else if (!isBareState(lineRaw) && !SERVICE_WORDS.has(lineRaw.toLowerCase())) {
        company = single;
      }
    }
  }

  // ── Domain-derived company fallback ─────────────────────────────────────
  let inferredCompanySource: 'domain' | undefined;
  if (!company) {
    const domainToTry = website || (email ? email.split('@')[1] ?? '' : '');
    const inferred = inferCompanyFromDomain(domainToTry);
    if (inferred) {
      company = inferred;
      inferredCompanySource = 'domain';
    }
  }

  // ── 6. Find person name (scored collection) ───────────────────────────────
  // Collect ALL passing candidates, score them, pick the best.
  // Service/category lines are captured for serviceCategory/services fields.
  let fullName = '';
  let credentials = '';
  let nameLineIndex = -1;

  const searchStart = companyEndIndex + 1;
  const emailLocalPart = email ? email.split('@')[0] : '';

  const nameCandidates: Array<{
    credParsed: ReturnType<typeof stripCredentials>;
    score: number;
    index: number;
  }> = [];
  const serviceLines: string[] = [];

  for (let i = searchStart; i < lines.length; i++) {
    const line = lines[i];
    if (looksLikeEmail(line)) continue;
    if (looksLikePhone(line)) continue;
    if (looksLikeDomain(line)) continue;
    if (looksLikeAddress(line)) continue;
    if (looksLikeCityStateZip(line)) continue;
    if (isBareState(line)) continue;
    if (PHONE_LABEL_RE.test(line) && looksLikePhone(line.replace(PHONE_LABEL_RE, '').trim())) continue;
    if (FAX_LABEL_RE.test(line) && looksLikePhone(line.replace(FAX_LABEL_RE, '').trim())) continue;

    // Service/category lines → captured for output, never used as name
    if (isServiceOrCategoryLine(line)) {
      serviceLines.push(line);
      continue;
    }

    // Honorific fast-path: unambiguous person name
    if (hasHonorific(line)) {
      const credParsed = stripCredentials(line);
      nameCandidates.push({ credParsed, score: 10, index: i });
      continue;
    }

    if (isPersonNameCandidate(line)) {
      const credParsed = stripCredentials(line);
      const score = scoreNameCandidate(credParsed.name, emailLocalPart);
      if (score >= 0) {
        nameCandidates.push({ credParsed, score, index: i });
      }
    }
  }

  if (nameCandidates.length > 0) {
    nameCandidates.sort((a, b) => b.score - a.score);
    const best = nameCandidates[0];
    fullName = best.credParsed.name;
    credentials = best.credParsed.credentials.join(', ');
    nameLineIndex = best.index;
  }

  // Categorise captured service lines
  const serviceCategory = serviceLines.find((l) => !isServiceDescriptionLine(l) && !/[,&]/.test(l)) ?? '';
  const services = serviceLines.filter((l) => isServiceDescriptionLine(l) || /[,&]/.test(l)).join(' ').trim();

  // ── 7. Split first/last name ──────────────────────────────────────────────
  const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? '';
  const lastName = nameParts.slice(1).join(' ');

  // ── 8. Find title and subtitle (lines immediately after name) ────────────
  let title = credentials; // credentials go into title if not a separate field
  let subtitle: string | undefined;
  const warnings: string[] = [];

  if (nameLineIndex >= 0) {
    let titleFound = false;
    for (let i = nameLineIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (looksLikeEmail(line)) continue;
      if (looksLikePhone(line)) break;
      if (looksLikeAddress(line)) break;
      if (looksLikeDomain(line)) break;
      if (looksLikeCityStateZip(line)) break;
      if (isOrgLine(line)) break;
      // A title/subtitle line has alphabetic words
      if (/^[A-Za-z]/.test(line) && !/^\d/.test(line)) {
        if (!titleFound) {
          const withCredential = credentials ? `${credentials} / ${line}` : line;
          title = withCredential;
          titleFound = true;
        } else {
          subtitle = line;
          break;
        }
      }
    }
  }

  // ── 9. Resolver warnings ──────────────────────────────────────────────────
  if (!fullName) warnings.push('name_not_found');
  if (!company) warnings.push('company_not_found');
  if (fax && phone === fax) warnings.push('fax_promoted_as_phone');

  return {
    fullName,
    firstName,
    lastName,
    credentials,
    company,
    ...(department !== undefined && { department }),
    ...(organizationUnit !== undefined && { organizationUnit }),
    title,
    ...(subtitle !== undefined && { subtitle }),
    ...(serviceCategory ? { serviceCategory } : {}),
    ...(services ? { services } : {}),
    ...(inferredCompanySource ? { inferredCompanySource } : {}),
    phone,
    ...(fax ? { fax } : {}),
    otherPhones,
    email,
    website,
    address,
    extraFields: {},
    warnings,
  };
}
