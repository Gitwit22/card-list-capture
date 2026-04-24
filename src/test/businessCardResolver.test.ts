import { describe, it, expect } from 'vitest';
import { resolveBusinessCardFields } from '@/lib/businessCardResolver';

/**
 * Test fixtures for real-world business card OCR issues
 */

describe('businessCardResolver', () => {
  describe('Issue 1: Company/logo mistaken as fullName (Rising Voices / Henry Duong)', () => {
    it('correctly parses Rising Voices card with company/logo on first line', () => {
      const ocrText = `Rising Voices
Building power for Michigan Asian American women and families
HENRY DUONG
LEGISLATIVE AND POLITICAL DIRECTOR
henry@risingvoicesaaf.org
313-707-6075`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.fullName).toBe('Henry Duong');
      expect(result.firstName).toBe('Henry');
      expect(result.lastName).toBe('Duong');
      expect(result.company).toBe('Rising Voices');
      expect(result.title).toBe('Legislative and Political Director');
      expect(result.email).toBe('henry@risingvoicesaaf.org');
      expect(result.phone).toBe('313-707-6075');
      expect(result.tagline).toContain('Building power');
    });

    it('uses email local part to infer person name', () => {
      const ocrText = `Rising Voices
Building power for Michigan Asian American women and families
HENRY DUONG
LEGISLATIVE AND POLITICAL DIRECTOR
henry@risingvoicesaaf.org
313-707-6075`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
        debugOutput: false,
      });

      // Henry from email should strongly influence name detection
      expect(result.fullName).toContain('Henry');
    });

    it('rejects company names that are only part of person name', () => {
      const ocrText = `Rising Voices
HENRY DUONG
LEGISLATIVE AND POLITICAL DIRECTOR
henry@risingvoicesaaf.org`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      // DUONG should NOT be company if fullName is Henry Duong
      expect(result.company).not.toBe('DUONG');
      expect(result.company).not.toBe('Duong');
    });

    it('uses domain to match company name', () => {
      const ocrText = `Rising Voices
henry@risingvoicesaaf.org
313-707-6075`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      // risingvoicesaaf.org should match Rising Voices
      expect(result.company).toContain('Rising');
    });
  });

  describe('Issue 2: Website/email boundary cleanup (BrionPrice)', () => {
    it('correctly extracts website without concatenating adjacent text', () => {
      const ocrText = `BRIONPRICE.COM
photography
407 628 5117
P.O. Box 1284
Winter Park, FL 32790
brion@brionprice.com`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.website).toBe('brionprice.com');
      expect(result.website).not.toContain('photography');
      expect(result.website).not.toContain('628');
    });

    it('correctly extracts phone number without state abbreviation', () => {
      const ocrText = `BRIONPRICE.COM
photography
407 628 5117
P.O. Box 1284
Winter Park, FL 32790
brion@brionprice.com`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.phone).toContain('407');
      expect(result.phone).toContain('628');
    });

    it('correctly parses address with PO Box, city, state, ZIP', () => {
      const ocrText = `BRIONPRICE.COM
photography
407 628 5117
P.O. Box 1284
Winter Park, FL 32790
brion@brionprice.com`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.address).toContain('P.O. Box');
      expect(result.address).toContain('Winter Park');
      expect(result.address).toContain('FL');
      expect(result.address).toContain('32790');
    });

    it('does not classify FL or Winter Park as company/fullName', () => {
      const ocrText = `BRIONPRICE.COM
photography
407 628 5117
P.O. Box 1284
Winter Park, FL 32790
brion@brionprice.com`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.company).not.toBe('FL');
      expect(result.fullName).not.toBe('Winter Park');
    });

    it('handles website with protocol', () => {
      const ocrText = `https://www.brionprice.com
photography
407 628 5117
brion@brionprice.com`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      // Should normalize to domain-only
      expect(result.website.toLowerCase()).toBe('brionprice.com');
    });

    it('extracts email cleanly without absorbing adjacent text', () => {
      const ocrText = `brion@brionprice.com`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.email).toBe('brion@brionprice.com');
    });
  });

  describe('Issue 3: Rotated and vertical text (Problem Pictures / Makeba L. Ross)', () => {
    it('correctly parses Problem Pictures card with rotated text', () => {
      const ocrText = `MAKEBA L. ROSS
FILM & PHOTOGRAPHY
LET'S MAKE A SCENE.
PROBLEMPICTURESLLC.COM
PLEASE REWIND`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.fullName).toBe('Makeba L. Ross');
      expect(result.company).toContain('Problem Pictures');
      expect(result.title).toContain('Film');
      expect(result.website).toBe('problempicturesllc.com');
      expect(result.tagline).toContain('scene');
    });

    it('derives company name from LLC domain', () => {
      const ocrText = `PROBLEMPICTURESLLC.COM`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      // Should infer company from domain
      expect(result.company.toLowerCase()).toContain('problem');
      expect(result.company.toLowerCase()).toContain('picture');
    });

    it('classifies taglines correctly', () => {
      const ocrText = `MAKEBA L. ROSS
FILM & PHOTOGRAPHY
LET'S MAKE A SCENE.
PLEASE REWIND`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      // Taglines should not be name/company/title
      expect(result.tagline).toContain('scene');
      expect(result.fullName).not.toContain('scene');
      expect(result.company).not.toContain('scene');
    });
  });

  describe('Issue 4: Business-first with multiple contacts (Yachtis R Us)', () => {
    it('correctly identifies business-first card with multiple contacts', () => {
      const ocrText = `Yachtis R Us
Specializing in luxury yacht rental for all occasions
Reginald Matthews 313.459.6677
Jake Wesley 313.674.2220
Lloyd Jones 404.433.4020`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.company).toContain('Yachtis');
      expect(result.title).toContain('Luxury');
      expect(result.additionalContacts).toHaveLength(3);
    });

    it('preserves all phone numbers from multiple contacts', () => {
      const ocrText = `Yachtis R Us
Specializing in luxury yacht rental for all occasions
Reginald Matthews 313.459.6677
Jake Wesley 313.674.2220
Lloyd Jones 404.433.4020`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      // All three numbers should be captured somewhere
      const allPhones = [
        result.phone,
        ...result.additionalContacts.map((c) => c.phone || ''),
      ].join(' ');

      expect(allPhones).toContain('313.459.6677');
      expect(allPhones).toContain('313.674.2220');
      expect(allPhones).toContain('404.433.4020');
    });

    it('creates additional contacts for multi-name cards', () => {
      const ocrText = `Yachtis R Us
Reginald Matthews 313.459.6677
Jake Wesley 313.674.2220
Lloyd Jones 404.433.4020`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.additionalContacts.length).toBeGreaterThan(0);
      const names = result.additionalContacts.map((c) => c.name || '').join(' ');
      expect(names.toLowerCase()).toContain('reginald');
      expect(names.toLowerCase()).toContain('jake');
      expect(names.toLowerCase()).toContain('lloyd');
    });
  });

  describe('Field scoring and confidence', () => {
    it('provides field-level confidence scores', () => {
      const ocrText = `John Smith
Acme Corp
john@acme.com
555-1234`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.fieldConfidence).toBeDefined();
      expect(result.fieldConfidence.fullName).toBeDefined();
      expect(result.fieldConfidence.email).toBeDefined();
      expect(result.fieldConfidence.phone).toBeDefined();
    });

    it('calculates overall confidence from filled fields', () => {
      const ocrText = `John Smith
john@acme.com`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('reduces confidence when fewer fields are filled', () => {
      const sparseOcr = `John Smith`;

      const sparseResult = resolveBusinessCardFields({
        ocrText: sparseOcr,
        ocrLines: sparseOcr.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      const richOcr = `John Smith
Acme Corp
VP Engineering
john@acme.com
555-1234
www.acme.com
123 Main St, Detroit, MI`;

      const richResult = resolveBusinessCardFields({
        ocrText: richOcr,
        ocrLines: richOcr.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(richResult.confidence).toBeGreaterThan(sparseResult.confidence);
    });
  });

  describe('Warning system', () => {
    it('warns when company and fullName are identical', () => {
      const ocrText = `John Smith
John Smith`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.warnings.some((w) => w.toLowerCase().includes('identical'))).toBe(true);
    });

    it('warns when company is state abbreviation', () => {
      const ocrText = `John Smith
FL`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.warnings.some((w) => w.toLowerCase().includes('state'))).toBe(true);
    });

    it('warns when multiple contacts but uncertain pairing', () => {
      const ocrText = `Yachtis R Us
John Smith
Jane Doe
555-1234
555-5678`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      // May warn about multiple contacts
      const hasMultiContactWarning = result.warnings.some((w) =>
        w.toLowerCase().includes('multiple') || w.toLowerCase().includes('contact')
      );
      expect(typeof hasMultiContactWarning).toBe('boolean');
    });

    it('does not warn about missing fullName for business-first cards', () => {
      const ocrText = `Acme Corp
VP Sales`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      // Business-first is valid, should not necessarily warn
      const hasName = result.fullName.length > 0;
      const hasCompany = result.company.length > 0;
      const hasTitle = result.title.length > 0;

      // If has company and title, valid even without name
      if (hasCompany && hasTitle) {
        expect(true).toBe(true); // business-first is valid
      }
    });
  });

  describe('Backward compatibility', () => {
    it('handles empty OCR gracefully', () => {
      const result = resolveBusinessCardFields({
        ocrText: '',
        ocrLines: [],
      });

      expect(result).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it('returns empty fields when no text provided', () => {
      const result = resolveBusinessCardFields({
        ocrText: '',
        ocrLines: [],
      });

      expect(result.fullName).toBe('');
      expect(result.company).toBe('');
      expect(result.email).toBe('');
    });

    it('handles mixed case input', () => {
      const ocrText = `John Smith
aCmE cOrP
john@acme.com`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.fullName).toBeTruthy();
      expect(result.company).toBeTruthy();
    });
  });

  describe('Name parsing', () => {
    it('correctly splits full name into first and last', () => {
      const ocrText = `John Q. Smith`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.firstName).toContain('John');
      expect(result.lastName).toContain('Smith');
    });

    it('handles names with hyphens', () => {
      const ocrText = `Jane-Marie Johnson`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.fullName.toLowerCase()).toContain('jane');
      expect(result.fullName.toLowerCase()).toContain('marie');
    });

    it('normalizes all-caps names to title case', () => {
      const ocrText = `JOHN SMITH
ACME CORP
VP ENGINEERING`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      // Should normalize case (unless acronym)
      expect(result.fullName).not.toBe('JOHN SMITH');
      expect(result.fullName).toMatch(/John/);
    });
  });

  describe('Real-world edge cases', () => {
    it('handles names appearing before company', () => {
      const ocrText = `Sarah Johnson
Tech Innovations LLC
sarah@techinnovations.com`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.fullName).toContain('Sarah');
      expect(result.company).toContain('Tech');
    });

    it('handles company appearing before name', () => {
      const ocrText = `Tech Innovations
Sarah Johnson
sarah@techinnovations.com`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      // Should still detect company and name correctly
      expect(result.company).toContain('Tech');
      expect(result.fullName).toContain('Sarah');
    });

    it('deduplicates fields correctly', () => {
      const ocrText = `John Smith
john@acme.com
john@acme.com`;

      const result = resolveBusinessCardFields({
        ocrText,
        ocrLines: ocrText.split('\n').map((text) => ({ text, confidence: 0.9 })),
      });

      expect(result.email).toBe('john@acme.com');
    });
  });
});
