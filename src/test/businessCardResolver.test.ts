import { describe, it, expect } from 'vitest';
import { resolveFromRawText, cleanWebsite, inferCompanyFromDomain } from '@/lib/businessCardResolver';

// ─── cleanWebsite ─────────────────────────────────────────────────────────────

describe('cleanWebsite', () => {
  it('extracts clean domain from plain URL', () => {
    expect(cleanWebsite('henryford.com')).toBe('henryford.com');
  });

  it('strips www prefix', () => {
    expect(cleanWebsite('www.henryford.com')).toBe('henryford.com');
  });

  it('strips https protocol', () => {
    expect(cleanWebsite('https://henryford.com/about')).toBe('henryford.com/about');
  });

  it('returns empty string for HTML-merged junk with no valid TLD', () => {
    // "HENRYFORDHEALTH<sub>®</sub>Leah Oldham..." has no real domain → empty
    expect(cleanWebsite('HENRYFORDHEALTH<sub>®</sub>Leah Oldham...')).toBe('');
  });

  it('removes OCR-merged trailing words after domain', () => {
    expect(cleanWebsite('brionprice.com photography')).toBe('brionprice.com');
  });

  it('normalizes to lowercase', () => {
    expect(cleanWebsite('BRIONPRICE.COM')).toBe('brionprice.com');
  });

  it('returns empty string for phone numbers', () => {
    expect(cleanWebsite('407 628 5117')).toBe('');
  });

  it('returns empty string for email addresses', () => {
    expect(cleanWebsite('brion@brionprice.com')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(cleanWebsite('')).toBe('');
  });
});

// ─── resolveFromRawText — Henry Ford Health card ─────────────────────────────

describe('resolveFromRawText — Henry Ford Health card', () => {
  const RAW = [
    'HENRY',
    'FORD',
    'HEALTH®',
    'Leah Oldham, RDN',
    'Community Dietitian - Generation with Promise (GWP)',
    'Community Health, Equity, Wellness & Diversity (CHEWD)',
    'One Ford Place',
    'Detroit, MI 48202',
    '248.535.8558 Mobile',
    '313.874.4681 Office',
    'henryford.com',
    'loldham1@hfhs.org',
  ].join('\n');

  it('extracts full name without credential', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).toBe('Leah Oldham');
  });

  it('strips RDN credential from fullName', () => {
    const result = resolveFromRawText(RAW);
    expect(result.credentials).toBe('RDN');
  });

  it('puts credential in title', () => {
    const result = resolveFromRawText(RAW);
    expect(result.title).toMatch(/RDN/);
  });

  it('assembles company from stacked all-caps lines', () => {
    const result = resolveFromRawText(RAW);
    expect(result.company).toBe('Henry Ford Health');
  });

  it('extracts email', () => {
    const result = resolveFromRawText(RAW);
    expect(result.email).toBe('loldham1@hfhs.org');
  });

  it('extracts website as clean domain', () => {
    const result = resolveFromRawText(RAW);
    expect(result.website).toBe('henryford.com');
  });

  it('extracts office phone as primary', () => {
    const result = resolveFromRawText(RAW);
    expect(result.phone).toBe('313.874.4681');
  });

  it('puts mobile number in otherPhones', () => {
    const result = resolveFromRawText(RAW);
    expect(result.otherPhones?.some((p) => p.includes('248.535.8558'))).toBe(true);
  });

  it('assembles address from street + city/state/ZIP', () => {
    const result = resolveFromRawText(RAW);
    expect(result.address).toContain('One Ford Place');
    expect(result.address).toContain('Detroit, MI 48202');
  });
});

// ─── resolveFromRawText — BrionPrice.com photography card ────────────────────

describe('resolveFromRawText — BrionPrice.com photography card', () => {
  const RAW = [
    'BRIONPRICE.COM',
    'photography',
    '407 628 5117',
    'P.O.Box 1284',
    'Winter Park, FL 32790',
    'brion@brionprice.com',
  ].join('\n');

  it('returns empty fullName when no human name present', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).toBe('');
  });

  it('combines domain + service word into company', () => {
    const result = resolveFromRawText(RAW);
    expect(result.company?.toLowerCase()).toContain('brionprice');
    expect(result.company?.toLowerCase()).toContain('photography');
  });

  it('extracts website as clean domain only', () => {
    const result = resolveFromRawText(RAW);
    expect(result.website).toBe('brionprice.com');
    expect(result.website).not.toContain('photography');
    expect(result.website).not.toContain(' ');
  });

  it('extracts phone', () => {
    const result = resolveFromRawText(RAW);
    expect(result.phone?.replace(/\D/g, '')).toBe('4076285117');
  });

  it('extracts email', () => {
    const result = resolveFromRawText(RAW);
    expect(result.email).toBe('brion@brionprice.com');
  });

  it('includes P.O. Box in address', () => {
    const result = resolveFromRawText(RAW);
    expect(result.address).toMatch(/P\.?O\.?\s*Box\s*1284/i);
  });

  it('includes city/state/ZIP in address', () => {
    const result = resolveFromRawText(RAW);
    expect(result.address).toContain('Winter Park, FL 32790');
  });
});

// ─── Name guardrails ──────────────────────────────────────────────────────────

describe('name candidate guardrails', () => {
  it('does not use city/state/ZIP line as fullName', () => {
    const raw = 'Winter Park, FL 32790\nbrion@brionprice.com';
    const result = resolveFromRawText(raw);
    expect(result.fullName).toBe('');
  });

  it('does not use bare state abbreviation as company', () => {
    const raw = 'FL\nbrion@brionprice.com';
    const result = resolveFromRawText(raw);
    expect(result.company).toBe('');
  });

  it('does not treat single service word as person name', () => {
    const raw = 'photography\n407 628 5117\nbrion@brionprice.com';
    const result = resolveFromRawText(raw);
    expect(result.fullName).toBe('');
  });
});

// ─── Stacked caps → company ───────────────────────────────────────────────────

describe('stacked uppercase logo lines → company', () => {
  it('combines two consecutive all-caps lines', () => {
    const raw = 'NXT\nLVL\nJohn Doe\njohn@nxtlvl.com';
    const result = resolveFromRawText(raw);
    expect(result.company).toBe('Nxt Lvl');
  });

  it('combines three consecutive all-caps lines', () => {
    const raw = 'HENRY\nFORD\nHEALTH\nJane Smith\njane@hfhs.org';
    const result = resolveFromRawText(raw);
    expect(result.company).toBe('Henry Ford Health');
  });

  it('does not use only the first all-caps word when more follow', () => {
    const raw = 'HENRY\nFORD\nHEALTH\nJane Smith';
    const result = resolveFromRawText(raw);
    expect(result.company).not.toBe('Henry');
    expect(result.company).toBe('Henry Ford Health');
  });
});

// ─── Website junk rejection ───────────────────────────────────────────────────

describe('website extraction rejects junk', () => {
  it('rejects HTML-merged OCR output', () => {
    const raw = 'HENRYFORDHEALTH<sub>®</sub>Leah Oldham\nloldham1@hfhs.org';
    const result = resolveFromRawText(raw);
    // website should not contain person names or HTML artifacts
    expect(result.website ?? '').not.toMatch(/Leah/i);
    expect(result.website ?? '').not.toMatch(/<sub>/);
  });

  it('prefers a clean real domain over merged OCR text', () => {
    const raw = 'henryford.com\nloldham1@hfhs.org';
    const result = resolveFromRawText(raw);
    expect(result.website).toBe('henryford.com');
  });
});

// ─── resolveFromRawText — Michigan DHHS card ──────────────────────────────────

describe('resolveFromRawText — Michigan DHHS card', () => {
  const RAW = [
    'STATE OF MICHIGAN',
    'DEPARTMENT OF HEALTH AND HUMAN SERVICES',
    'WAYNE COUNTY',
    '',
    'Ms. L. Norfleet',
    'SUCCESS COACH',
    'PATHWAYS TO POTENTIAL',
    '',
    'Cadillac Place',
    '3040 W. Grand Blvd.',
    'Suite 6-350',
    'Detroit, MI 48202-6040',
    '',
    'PHONE: 313.859.2560',
    'FAX: 517.346.9888',
    'NorfleetL@michigan.gov',
    'www.michigan.gov/dhs',
  ].join('\n');

  it('extracts fullName via honorific fast-path', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).toBe('Ms. L. Norfleet');
  });

  it('does not use an org/agency line as the person name', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).not.toMatch(/michigan|department|wayne|county/i);
  });

  it('assigns company to the first stacked caps line', () => {
    const result = resolveFromRawText(RAW);
    expect(result.company?.toLowerCase()).toContain('michigan');
  });

  it('assigns department to the second stacked caps line', () => {
    const result = resolveFromRawText(RAW);
    expect(result.department?.toLowerCase()).toContain('health');
  });

  it('assigns organizationUnit to the third stacked caps line', () => {
    const result = resolveFromRawText(RAW);
    expect(result.organizationUnit?.toLowerCase()).toContain('wayne');
  });

  it('extracts title as SUCCESS COACH', () => {
    const result = resolveFromRawText(RAW);
    expect(result.title).toContain('SUCCESS COACH');
  });

  it('extracts subtitle as PATHWAYS TO POTENTIAL', () => {
    const result = resolveFromRawText(RAW);
    expect(result.subtitle).toBe('PATHWAYS TO POTENTIAL');
  });

  it('extracts primary phone (PHONE label)', () => {
    const result = resolveFromRawText(RAW);
    expect(result.phone?.replace(/\D/g, '')).toBe('3138592560');
  });

  it('separates fax from primary phone', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fax?.replace(/\D/g, '')).toBe('5173469888');
    expect(result.phone?.replace(/\D/g, '')).not.toBe('5173469888');
  });

  it('extracts email (lowercased)', () => {
    const result = resolveFromRawText(RAW);
    expect(result.email).toBe('norfleetl@michigan.gov');
  });

  it('extracts website without www prefix', () => {
    const result = resolveFromRawText(RAW);
    expect(result.website).toBe('michigan.gov/dhs');
  });

  it('includes building name in address', () => {
    const result = resolveFromRawText(RAW);
    expect(result.address).toMatch(/Cadillac Place/i);
  });

  it('includes numbered street in address', () => {
    const result = resolveFromRawText(RAW);
    expect(result.address).toMatch(/3040 W\.\s*Grand Blvd/i);
  });

  it('includes suite in address', () => {
    const result = resolveFromRawText(RAW);
    expect(result.address).toMatch(/Suite 6-350/i);
  });

  it('includes city/state/ZIP in address', () => {
    const result = resolveFromRawText(RAW);
    expect(result.address).toContain('Detroit, MI 48202-6040');
  });

  it('emits no warnings (fully resolved card)', () => {
    const result = resolveFromRawText(RAW);
    expect(result.warnings).not.toContain('name_not_found');
    expect(result.warnings).not.toContain('company_not_found');
    expect(result.warnings).not.toContain('fax_promoted_as_phone');
  });
});

// ─── Wonder Working Quarters card ─────────────────────────────────────────────

describe('resolveFromRawText — Wonder Working Quarters card', () => {
  const RAW = [
    'Professional Organizing',
    'Specializing in DUO Services -',
    'Donations, Unpacking, & Organizing',
    '',
    'Christine Smith-Johnson',
    'Owner/Organizing Strategist',
    '',
    'Phone (313) 433-5452',
    'christine@wonderworkingquarters.com',
    'www.wonderworkingquarters.com',
  ].join('\n');

  it('extracts Christine Smith-Johnson as fullName', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).toBe('Christine Smith-Johnson');
  });

  it('splits first and last name correctly', () => {
    const result = resolveFromRawText(RAW);
    expect(result.firstName).toBe('Christine');
    expect(result.lastName).toBe('Smith-Johnson');
  });

  it('does NOT use "Professional Organizing" as person name', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).not.toMatch(/professional|organizing/i);
  });

  it('extracts phone containing area code 313', () => {
    const result = resolveFromRawText(RAW);
    expect(result.phone).toMatch(/313/);
  });

  it('extracts email', () => {
    const result = resolveFromRawText(RAW);
    expect(result.email).toBe('christine@wonderworkingquarters.com');
  });

  it('extracts website', () => {
    const result = resolveFromRawText(RAW);
    expect(result.website).toBe('wonderworkingquarters.com');
  });

  it('infers company from domain', () => {
    const result = resolveFromRawText(RAW);
    // Domain "wonderworkingquarters.com" should segment to "Wonder Working Quarters"
    expect(result.company).toMatch(/wonder|working|quarters/i);
  });

  it('marks inferredCompanySource as domain', () => {
    const result = resolveFromRawText(RAW);
    expect(result.inferredCompanySource).toBe('domain');
  });

  it('captures serviceCategory as "Professional Organizing"', () => {
    const result = resolveFromRawText(RAW);
    expect(result.serviceCategory).toBe('Professional Organizing');
  });

  it('captures services containing "Specializing" and "DUO"', () => {
    const result = resolveFromRawText(RAW);
    expect(result.services).toMatch(/specializing/i);
    expect(result.services).toMatch(/DUO/);
  });

  it('emits no name_not_found warning', () => {
    const result = resolveFromRawText(RAW);
    expect(result.warnings).not.toContain('name_not_found');
  });
});

// ─── inferCompanyFromDomain unit tests ───────────────────────────────────────

describe('inferCompanyFromDomain', () => {
  it('segments wonderworkingquarters.com → Wonder Working Quarters', () => {
    expect(inferCompanyFromDomain('wonderworkingquarters.com')).toBe('Wonder Working Quarters');
  });

  it('handles hyphenated domains', () => {
    expect(inferCompanyFromDomain('wonder-working-quarters.com')).toBe('Wonder Working Quarters');
  });

  it('returns empty string for generic gmail domain', () => {
    expect(inferCompanyFromDomain('gmail.com')).toBe('');
  });

  it('returns empty string for yahoo.com', () => {
    expect(inferCompanyFromDomain('yahoo.com')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(inferCompanyFromDomain('')).toBe('');
  });

  it('segments nxttechsolutions.com using known words', () => {
    const result = inferCompanyFromDomain('nxttechsolutions.com');
    expect(result).toMatch(/nxt|tech|solutions/i);
  });
});
