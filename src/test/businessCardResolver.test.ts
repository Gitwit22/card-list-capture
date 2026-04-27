import { describe, it, expect } from 'vitest';
import { resolveFromRawText, cleanWebsite } from '@/lib/businessCardResolver';

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
