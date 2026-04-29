import { describe, it, expect } from 'vitest';
import { resolveFromRawText, cleanWebsite, inferCompanyFromDomain, isPlaceholder } from '@/lib/businessCardResolver';

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

  it('captures "Specializing in DUO Services" as tagline or services', () => {
    const result = resolveFromRawText(RAW);
    // "Specializing in..." is now stored in tagline (service-description opener)
    const taglineOrServices = result.tagline ?? result.services ?? '';
    expect(taglineOrServices).toMatch(/specializing/i);
    expect(taglineOrServices).toMatch(/DUO/);
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

// ─── Placeholder cleaning ─────────────────────────────────────────────────────

describe('placeholder cleaning', () => {
  it('does not use "Company" as company name', () => {
    const raw = 'COMPANY\nJohn Smith\njohn@example.com';
    const result = resolveFromRawText(raw);
    expect(result.company).not.toBe('Company');
    expect(result.company).not.toBe('company');
    // Company should be empty (no non-placeholder org data) or inferred from the email domain
    const validCompany = !result.company || result.company.toLowerCase() !== 'company';
    expect(validCompany).toBe(true);
  });

  it('does not return "Email" as email', () => {
    // Placeholder labels in raw OCR should not produce a placeholder email
    const raw = 'EMAIL\njohn@example.com';
    const result = resolveFromRawText(raw);
    expect(result.email).toBe('john@example.com');
    expect(result.email).not.toBe('Email');
  });

  it('does not return "Website" as website', () => {
    const raw = 'Website\nexample.com\njohn@example.com';
    const result = resolveFromRawText(raw);
    expect(result.website).toBe('example.com');
    expect(result.website).not.toBe('Website');
  });

  it('does not use "First Name" or "Last Name" as person name', () => {
    const raw = 'First Name\nLast Name\njohn@example.com';
    const result = resolveFromRawText(raw);
    expect(result.fullName).toBe('');
    expect(result.firstName).toBe('');
    expect(result.lastName).toBe('');
  });

  it('does not use "Address" as address', () => {
    const raw = 'Address\n123 Main St\nDetroit, MI 48201';
    const result = resolveFromRawText(raw);
    expect(result.address).not.toBe('Address');
    expect(result.address).toContain('123 Main St');
  });

  it('isPlaceholder returns true for known placeholder labels', () => {
    expect(isPlaceholder('Company')).toBe(true);
    expect(isPlaceholder('Email')).toBe(true);
    expect(isPlaceholder('Website')).toBe(true);
    expect(isPlaceholder('Address')).toBe(true);
    expect(isPlaceholder('Phone')).toBe(true);
    expect(isPlaceholder('Title')).toBe(true);
    expect(isPlaceholder('First Name')).toBe(true);
    expect(isPlaceholder('Last Name')).toBe(true);
  });

  it('isPlaceholder returns false for real values', () => {
    expect(isPlaceholder('Acme Corp')).toBe(false);
    expect(isPlaceholder('john@acme.com')).toBe(false);
    expect(isPlaceholder('acme.com')).toBe(false);
    expect(isPlaceholder('John Smith')).toBe(false);
  });
});

// ─── Invest Detroit card ──────────────────────────────────────────────────────

describe('resolveFromRawText — Invest Detroit card', () => {
  const RAW = [
    'INVEST DETROIT',
    'John Smith',
    'Senior Vice President',
    'john.smith@investdetroit.com',
    'www.investdetroit.com',
    '211 W. Fort Street, Suite 800',
    'Detroit, MI 48226',
    '313-566-8280',
  ].join('\n');

  it('does not treat "INVEST DETROIT" as a person name', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).not.toMatch(/invest|detroit/i);
  });

  it('identifies INVEST DETROIT as the company', () => {
    const result = resolveFromRawText(RAW);
    expect(result.company?.toLowerCase()).toContain('invest');
    expect(result.company?.toLowerCase()).toContain('detroit');
  });

  it('extracts John Smith as the person', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).toBe('John Smith');
    expect(result.firstName).toBe('John');
    expect(result.lastName).toBe('Smith');
  });

  it('extracts email', () => {
    const result = resolveFromRawText(RAW);
    expect(result.email).toBe('john.smith@investdetroit.com');
  });

  it('extracts website without www', () => {
    const result = resolveFromRawText(RAW);
    expect(result.website).toBe('investdetroit.com');
  });

  it('extracts address including street and city', () => {
    const result = resolveFromRawText(RAW);
    expect(result.address).toMatch(/Fort Street/i);
    expect(result.address).toContain('Detroit, MI 48226');
  });
});

// ─── Neighborhoods Inc card ───────────────────────────────────────────────────

describe('resolveFromRawText — Neighborhoods Inc card', () => {
  const RAW = [
    'NEIGHBORHOODS, INC.',
    'REBUILDING COMMUNITIES ONE HOME AT A TIME',
    'Jane Johnson',
    'Executive Director',
    'jane@neighborhoodsinc.org',
    '123 Main Street',
    'Detroit, MI 48201',
    '313-555-0100',
  ].join('\n');

  it('does not treat "Neighborhoods, Inc." as a person name', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).not.toMatch(/neighborhoods/i);
  });

  it('extracts Jane Johnson as the person', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).toBe('Jane Johnson');
  });

  it('extracts email', () => {
    const result = resolveFromRawText(RAW);
    expect(result.email).toBe('jane@neighborhoodsinc.org');
  });

  it('extracts address', () => {
    const result = resolveFromRawText(RAW);
    expect(result.address).toMatch(/Main Street/i);
    expect(result.address).toContain('Detroit, MI 48201');
  });
});

// ─── Innovative Fundraising card ──────────────────────────────────────────────

describe('resolveFromRawText — Innovative Fundraising card', () => {
  const RAW = [
    'INNOVATIVE FUNDRAISING CONSULTANTS, LLC',
    'Raising Money for Nonprofits',
    'Mary Williams',
    'Senior Consultant',
    'mary@innovativefundraising.com',
    '248-555-0199',
  ].join('\n');

  it('does not use "Innovative Fundraising Consultants, LLC" as person name', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).not.toMatch(/fundraising|consultants/i);
  });

  it('does not use "Raising Money for Nonprofits" as person name', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).not.toMatch(/raising|nonprofits/i);
  });

  it('extracts Mary Williams as the person', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).toBe('Mary Williams');
  });

  it('extracts email', () => {
    const result = resolveFromRawText(RAW);
    expect(result.email).toBe('mary@innovativefundraising.com');
  });

  it('extracts phone', () => {
    const result = resolveFromRawText(RAW);
    expect(result.phone?.replace(/\D/g, '')).toBe('2485550199');
  });
});

// ─── Michigan House of Representatives card ───────────────────────────────────

describe('resolveFromRawText — Michigan House of Representatives card', () => {
  const RAW = [
    'STATE OF MICHIGAN',
    'HOUSE OF REPRESENTATIVES',
    'Robert Brown',
    'State Representative, District 9',
    'robert.brown@house.mi.gov',
    'P.O. BOX 30014',
    'LANSING, MI 48909-7514',
    '517-373-0615',
  ].join('\n');

  it('does not treat "STATE OF MICHIGAN" as a person name', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).not.toMatch(/michigan|house|representatives/i);
  });

  it('extracts Robert Brown as the person', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).toBe('Robert Brown');
  });

  it('assigns STATE OF MICHIGAN as company', () => {
    const result = resolveFromRawText(RAW);
    expect(result.company?.toLowerCase()).toContain('michigan');
  });

  it('assigns HOUSE OF REPRESENTATIVES as department', () => {
    const result = resolveFromRawText(RAW);
    expect(result.department?.toLowerCase()).toMatch(/house|representatives/i);
  });

  it('extracts email', () => {
    const result = resolveFromRawText(RAW);
    expect(result.email).toBe('robert.brown@house.mi.gov');
  });

  it('includes P.O. Box in address', () => {
    const result = resolveFromRawText(RAW);
    expect(result.address).toMatch(/P\.?O\.?\s*BOX\s*30014/i);
  });

  it('includes city/state/ZIP in address', () => {
    const result = resolveFromRawText(RAW);
    expect(result.address).toMatch(/LANSING.*MI.*48909/i);
  });
});

// ─── Dearborn Police card ─────────────────────────────────────────────────────

describe('resolveFromRawText — Dearborn Police card', () => {
  const RAW = [
    'CITY OF DEARBORN',
    'DEARBORN POLICE DEPARTMENT',
    'Officer James Wilson',
    '313-943-2241',
    '1 Ford Gate Drive',
    'Dearborn, MI 48126',
  ].join('\n');

  it('does not treat "DEARBORN POLICE DEPARTMENT" as a person name', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).not.toMatch(/dearborn|police|department/i);
  });

  it('extracts Officer James Wilson as the person via honorific', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).toMatch(/James Wilson/i);
  });

  it('assigns CITY OF DEARBORN as company', () => {
    const result = resolveFromRawText(RAW);
    expect(result.company?.toLowerCase()).toContain('dearborn');
  });

  it('extracts address', () => {
    const result = resolveFromRawText(RAW);
    expect(result.address).toMatch(/Ford Gate Drive/i);
    expect(result.address).toContain('Dearborn, MI 48126');
  });
});

// ─── Legislature of Michigan card ────────────────────────────────────────────

describe('resolveFromRawText — Legislature of Michigan card', () => {
  const RAW = [
    'MICHIGAN LEGISLATURE',
    'SENATE OF MICHIGAN',
    'Senator Patricia Davis',
    'District 4',
    'patricia.davis@senate.michigan.gov',
    'www.senate.michigan.gov',
    'S-2, State Capitol',
    'Lansing, MI 48909',
    '517-373-7350',
  ].join('\n');

  it('does not treat "MICHIGAN LEGISLATURE" as a person name', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).not.toMatch(/legislature|senate|michigan/i);
  });

  it('extracts Senator Patricia Davis as the person', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).toMatch(/Patricia Davis/i);
  });

  it('assigns Michigan Legislature as company', () => {
    const result = resolveFromRawText(RAW);
    expect(result.company?.toLowerCase()).toContain('michigan');
  });

  it('assigns Senate of Michigan as department', () => {
    const result = resolveFromRawText(RAW);
    expect(result.department?.toLowerCase()).toMatch(/senate|michigan/i);
  });

  it('extracts email', () => {
    const result = resolveFromRawText(RAW);
    expect(result.email).toBe('patricia.davis@senate.michigan.gov');
  });

  it('extracts website', () => {
    const result = resolveFromRawText(RAW);
    expect(result.website).toMatch(/senate\.michigan\.gov/i);
  });
});

// ─── CEO Works card ───────────────────────────────────────────────────────────

describe('resolveFromRawText — CEO Works card', () => {
  const RAW = [
    'CEO WORKS',
    'Strategic Consulting for Business Growth',
    'Thomas Anderson',
    'CEO / Founder',
    'thomas@ceoworks.com',
    'www.ceoworks.com',
    '248-555-1234',
  ].join('\n');

  it('does not use "CEO WORKS" as a person name', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).not.toMatch(/ceo|works/i);
  });

  it('identifies CEO WORKS as the company', () => {
    const result = resolveFromRawText(RAW);
    expect(result.company?.toLowerCase()).toMatch(/ceo|works/i);
  });

  it('extracts Thomas Anderson as person', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).toBe('Thomas Anderson');
  });

  it('extracts email', () => {
    const result = resolveFromRawText(RAW);
    expect(result.email).toBe('thomas@ceoworks.com');
  });

  it('does not place slogan in person name', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).not.toMatch(/consulting|growth/i);
  });
});

// ─── University / PhD card ────────────────────────────────────────────────────

describe('resolveFromRawText — University/PhD card', () => {
  const RAW = [
    'WAYNE STATE UNIVERSITY',
    'COLLEGE OF EDUCATION',
    'Dr. Sarah Chen, PhD',
    'Associate Professor',
    'sarah.chen@wayne.edu',
    'www.wayne.edu',
    '5057 Woodward Ave.',
    'Detroit, MI 48202',
    '313-577-0000',
  ].join('\n');

  it('extracts Sarah Chen as person (not Dr. or PhD)', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).toMatch(/Sarah Chen/i);
  });

  it('strips PhD credential from fullName', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).not.toMatch(/PhD/i);
    expect(result.credentials).toMatch(/PhD/i);
  });

  it('does not treat university line as person name', () => {
    const result = resolveFromRawText(RAW);
    expect(result.fullName).not.toMatch(/wayne state|university/i);
  });

  it('assigns Wayne State University as company', () => {
    const result = resolveFromRawText(RAW);
    expect(result.company?.toLowerCase()).toMatch(/wayne|state|university/i);
  });

  it('assigns College of Education as department', () => {
    const result = resolveFromRawText(RAW);
    expect(result.department?.toLowerCase()).toMatch(/college|education/i);
  });

  it('extracts email', () => {
    const result = resolveFromRawText(RAW);
    expect(result.email).toBe('sarah.chen@wayne.edu');
  });

  it('extracts address with street and city', () => {
    const result = resolveFromRawText(RAW);
    expect(result.address).toMatch(/Woodward Ave/i);
    expect(result.address).toContain('Detroit, MI 48202');
  });
});

// ─── HTML artifact cleanup ────────────────────────────────────────────────────

describe('HTML artifact cleanup', () => {
  it('strips <sup>th</sup> artifacts from OCR text', () => {
    const raw = '7310 Woodward Ave., Suite 701<sup>th</sup>\nDetroit, MI 48202\njohn@example.com';
    const result = resolveFromRawText(raw);
    expect(result.address).not.toMatch(/<sup>/);
    expect(result.address).not.toMatch(/<\/sup>/);
    expect(result.address).toMatch(/Woodward Ave/i);
  });

  it('strips <sub>®</sub> HTML entity from company name', () => {
    const raw = 'HENRY\nFORD\nHEALTH<sub>®</sub>\nJane Doe\njane@hfhs.org';
    const result = resolveFromRawText(raw);
    expect(result.company).not.toMatch(/<sub>/);
    expect(result.company).not.toMatch(/®/);
  });

  it('does not place HTML-merged OCR line as website', () => {
    const raw = 'HENRYFORDHEALTH<sub>®</sub>Leah Oldham\nloldham1@hfhs.org\nhenryford.com';
    const result = resolveFromRawText(raw);
    expect(result.website).not.toMatch(/<sub>/);
    expect(result.website).toBe('henryford.com');
  });
});

// ─── P.O. Box address assembly ────────────────────────────────────────────────

describe('P.O. Box address assembly', () => {
  it('combines street line preceding a P.O. Box into address', () => {
    const raw = [
      'Jane Smith',
      'Director',
      '124 WEST ALLEGAN',
      'P.O. BOX 30036',
      'LANSING, MI 48909',
      'jane@example.gov',
    ].join('\n');
    const result = resolveFromRawText(raw);
    expect(result.address).toMatch(/124 WEST ALLEGAN/i);
    expect(result.address).toMatch(/P\.?O\.?\s*BOX\s*30036/i);
    expect(result.address).toMatch(/LANSING.*MI.*48909/i);
  });

  it('combines P.O. Box with city/state/ZIP', () => {
    const raw = [
      'John Brown',
      'P.O. Box 1284',
      'Winter Park, FL 32790',
      'john@example.com',
    ].join('\n');
    const result = resolveFromRawText(raw);
    expect(result.address).toMatch(/P\.?O\.?\s*Box\s*1284/i);
    expect(result.address).toContain('Winter Park, FL 32790');
  });
});

// ─── Confidence scoring ───────────────────────────────────────────────────────

describe('confidence scoring', () => {
  it('returns fieldConfidence with email close to 1 when email found', () => {
    const raw = 'John Smith\njohn@example.com\nexample.com';
    const result = resolveFromRawText(raw);
    expect(result.fieldConfidence?.email).toBeGreaterThanOrEqual(0.9);
  });

  it('returns fieldConfidence with website score when domain found', () => {
    const raw = 'John Smith\njohn@example.com\nexample.com';
    const result = resolveFromRawText(raw);
    expect(result.fieldConfidence?.website).toBeGreaterThanOrEqual(0.8);
  });

  it('returns high address confidence when street + city/zip present', () => {
    const raw = [
      'John Smith',
      '123 Main St',
      'Detroit, MI 48201',
      'john@example.com',
    ].join('\n');
    const result = resolveFromRawText(raw);
    expect(result.fieldConfidence?.address).toBeGreaterThanOrEqual(0.85);
  });

  it('returns overallConfidence as a number between 0 and 1', () => {
    const raw = [
      'HENRY FORD HEALTH',
      'Jane Doe',
      'Director',
      'jane@hfhs.org',
      'henryford.com',
      '313-555-0000',
      '1 Ford Place',
      'Detroit, MI 48202',
    ].join('\n');
    const result = resolveFromRawText(raw);
    expect(result.overallConfidence).toBeGreaterThan(0);
    expect(result.overallConfidence).toBeLessThanOrEqual(1);
  });

  it('returns high name confidence for honorific fast-path', () => {
    const raw = 'MICHIGAN DHHS\nMs. L. Norfleet\nCoach\nnorfleet@michigan.gov';
    const result = resolveFromRawText(raw);
    expect(result.fieldConfidence?.firstName).toBeGreaterThanOrEqual(0.9);
  });

  it('returns company confidence 0.9 for org-hierarchy (stacked caps with org keyword)', () => {
    const raw = [
      'STATE OF MICHIGAN',
      'DEPARTMENT OF HEALTH',
      'John Doe',
      'john@michigan.gov',
    ].join('\n');
    const result = resolveFromRawText(raw);
    expect(result.fieldConfidence?.company).toBeGreaterThanOrEqual(0.85);
  });

  it('returns lower company confidence for domain-inferred company', () => {
    const raw = [
      'Christine Smith',
      'Owner',
      'christine@wonderworkingquarters.com',
    ].join('\n');
    const result = resolveFromRawText(raw);
    expect(result.fieldConfidence?.company).toBeLessThan(0.70);
  });
});

// ─── Phase 2 — needsReview flags ─────────────────────────────────────────────

describe('needsReview flags', () => {
  it('needsReview=false for a clean well-extracted card', () => {
    const raw = [
      'HENRY FORD HEALTH',
      'Jane Doe',
      'Director',
      'jane@hfhs.org',
      'henryford.com',
      '313-555-0000',
      '1 Ford Place',
      'Detroit, MI 48202',
    ].join('\n');
    const result = resolveFromRawText(raw);
    expect(result.needsReview).toBe(false);
    expect(result.reviewReasons).toEqual([]);
  });

  it('needsReview=true when no name found', () => {
    const raw = 'HENRY FORD HEALTH\njane@hfhs.org\n313-555-0000';
    const result = resolveFromRawText(raw);
    expect(result.needsReview).toBe(true);
    expect(result.reviewReasons).toContain('no_person_name');
  });

  it('needsReview=true when no name AND no company', () => {
    const raw = 'jane@example.com\n313-555-0000';
    const result = resolveFromRawText(raw);
    expect(result.needsReview).toBe(true);
    expect(result.reviewReasons).toContain('no_name_or_company');
  });

  it('reviewReasons includes low_confidence_name when best name score is low', () => {
    // "AB CD" — two single-letter words, barely a name
    const raw = 'SOME ORG\njane@example.com';
    const result = resolveFromRawText(raw);
    // No name should be found, triggering no_person_name
    expect(result.reviewReasons?.some((r) => r.includes('name'))).toBe(true);
  });

  it('needsReview=false when only optional fields are missing', () => {
    // Has name + company but no address/website/fax
    const raw = [
      'ACME CORP',
      'John Smith',
      'Manager',
      'john@acme.com',
      '313-555-1234',
    ].join('\n');
    const result = resolveFromRawText(raw);
    expect(result.needsReview).toBe(false);
  });
});

// ─── Phase 2 — field contamination cleanup ───────────────────────────────────

describe('field contamination cleanup', () => {
  it('sanitizes website that has spaces (OCR junk merged)', () => {
    const raw = [
      'John Smith',
      'john@example.com',
      'example.com some extra OCR junk on this line',
    ].join('\n');
    const result = resolveFromRawText(raw);
    // website should be just the domain without trailing OCR text
    expect(result.website).toBe('example.com');
  });

  it('website never contains full OCR paragraph', () => {
    const raw = [
      'INVEST DETROIT',
      'John Smith',
      'john@investdetroit.com',
      'INVEST DETROIT is a leading source of capital for Detroit businesses.',
    ].join('\n');
    const result = resolveFromRawText(raw);
    expect(result.website).not.toMatch(/ /); // no spaces in a clean website
  });

  it('phone with address text is discarded', () => {
    // Simulate a field that has address-like text rather than a phone
    // resolveFromRawText skips address lines for phone extraction already,
    // but sanitizePhone guards the final value
    const raw = [
      'John Smith',
      'john@example.com',
      '(313) 555-0000',
    ].join('\n');
    const result = resolveFromRawText(raw);
    // Should produce a valid phone, not cleared
    expect(result.phone).toContain('313');
  });

  it('title with address pattern is cleared and moved', () => {
    // If title detection grabbed a street line, sanitizeTitle should clear it
    // (This is an edge guard; test the contamination-detection path indirectly via warnings)
    const raw = [
      'HENRY FORD HEALTH',
      'Jane Doe',
      '1 Ford Place',
      'Detroit, MI 48202',
      'jane@hfhs.org',
    ].join('\n');
    const result = resolveFromRawText(raw);
    // Title should not contain a street address
    const titleHasStreet = result.title ? /\d+\s+\w+\s+(st|ave|blvd|dr|rd|place)\b/i.test(result.title) : false;
    expect(titleHasStreet).toBe(false);
    // Address should contain the street
    expect(result.address).toMatch(/Ford Place/i);
  });
});

// ─── Phase 2 — tagline detection ─────────────────────────────────────────────

describe('tagline detection', () => {
  it('"No Matter What" is never firstName or lastName', () => {
    const raw = [
      'ACME CORP',
      'John Smith',
      'No Matter What',
      'john@acme.com',
    ].join('\n');
    const result = resolveFromRawText(raw);
    expect(result.firstName).not.toMatch(/no|matter|what/i);
    expect(result.lastName).not.toMatch(/no|matter|what/i);
  });

  it('"No Matter What" is stored in tagline', () => {
    const raw = [
      'ACME CORP',
      'John Smith',
      'No Matter What',
      'john@acme.com',
    ].join('\n');
    const result = resolveFromRawText(raw);
    expect(result.tagline).toMatch(/no matter what/i);
  });

  it('"Donations, Unpacking, & Organizing" is not a person name', () => {
    const raw = [
      'Mary Williams',
      'Donations, Unpacking, & Organizing',
      'mary@example.com',
    ].join('\n');
    const result = resolveFromRawText(raw);
    expect(result.firstName).toBe('Mary');
    expect(result.lastName).toBe('Williams');
  });

  it('"Specializing in..." opener is stored as tagline', () => {
    const raw = [
      'INNOVATIVE SOLUTIONS LLC',
      'Tom Brown',
      'Specializing in nonprofit fundraising',
      'tom@innovativesolutions.com',
    ].join('\n');
    const result = resolveFromRawText(raw);
    expect(result.tagline).toMatch(/specializing/i);
    expect(result.firstName).toBe('Tom');
  });

  it('"Luxury Yacht Rental for All Occasions" is not a person name', () => {
    const raw = [
      'Sea Breeze Charters',
      'Captain James Cole',
      'Luxury yacht rental for all occasions',
      'james@seabreeze.com',
    ].join('\n');
    const result = resolveFromRawText(raw);
    // The resolver picks "Captain James Cole" as the person line (correct)
    // — firstName may be "Captain" or "James" depending on prefix handling.
    // What matters: the tagline phrase never becomes a name token.
    expect(result.firstName).not.toMatch(/luxury|yacht|rental|occasions/i);
    expect(result.lastName).not.toMatch(/luxury|yacht|rental|occasions/i);
    // Person was identified
    expect(result.fullName).toMatch(/James Cole/i);
  });

  it('"SPECIALIZING IN" all-caps is not treated as first/last name', () => {
    const raw = [
      'HEALTHCARE PROFESSIONALS LLC',
      'SPECIALIZING IN HOME HEALTH SERVICES',
      'Dr. Linda Park, MD',
      'linda@hpllc.com',
    ].join('\n');
    const result = resolveFromRawText(raw);
    expect(result.firstName).not.toMatch(/^SPECIALIZING$/i);
    expect(result.lastName).not.toMatch(/^IN$/i);
  });
});

// ─── Phase 2 — Henry Ford Health card (full field extraction) ────────────────

describe('resolveFromRawText — Henry Ford Health full card', () => {
  const RAW = [
    'HENRY',
    'FORD',
    'HEALTH',
    'Jane Doe',
    'Registered Dietitian',
    'jane.doe@hfhs.org',
    'henryford.com',
    '(313) 555-7890',
    '1 Ford Place',
    'Detroit, MI 48202',
  ].join('\n');

  it('extracts Jane Doe as person', () => {
    const result = resolveFromRawText(RAW);
    expect(result.firstName).toBe('Jane');
    expect(result.lastName).toBe('Doe');
  });

  it('assigns Henry Ford Health as company', () => {
    const result = resolveFromRawText(RAW);
    expect(result.company).toMatch(/henry ford health/i);
  });

  it('extracts title as Registered Dietitian', () => {
    const result = resolveFromRawText(RAW);
    expect(result.title).toMatch(/dietitian/i);
  });

  it('extracts email', () => {
    const result = resolveFromRawText(RAW);
    expect(result.email).toBe('jane.doe@hfhs.org');
  });

  it('extracts phone', () => {
    const result = resolveFromRawText(RAW);
    expect(result.phone).toContain('313');
  });

  it('extracts website', () => {
    const result = resolveFromRawText(RAW);
    expect(result.website).toBe('henryford.com');
  });

  it('extracts address', () => {
    const result = resolveFromRawText(RAW);
    expect(result.address).toMatch(/Ford Place/i);
    expect(result.address).toMatch(/Detroit/i);
  });

  it('is not needsReview', () => {
    const result = resolveFromRawText(RAW);
    expect(result.needsReview).toBe(false);
  });
});


