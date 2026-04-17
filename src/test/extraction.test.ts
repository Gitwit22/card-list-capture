import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractFromImage, createEmptySignupEntry, createEmptyBusinessCard } from '@/lib/extraction';

// Mock env vars
vi.stubGlobal('import', { meta: { env: { DEV: true } } });

describe('extraction', () => {
  describe('createEmptySignupEntry', () => {
    it('creates entry with all fields empty and extraFields object', () => {
      const entry = createEmptySignupEntry();
      expect(entry.id).toBeTruthy();
      expect(entry.fullName).toBe('');
      expect(entry.organization).toBe('');
      expect(entry.phone).toBe('');
      expect(entry.email).toBe('');
      expect(entry.screening).toBe('');
      expect(entry.shareInfo).toBe('');
      expect(entry.date).toBe('');
      expect(entry.comments).toBe('');
      expect(entry.extraFields).toEqual({});
    });

    it('generates unique IDs', () => {
      const a = createEmptySignupEntry();
      const b = createEmptySignupEntry();
      expect(a.id).not.toBe(b.id);
    });
  });

  describe('createEmptyBusinessCard', () => {
    it('creates card with all fields empty, extraFields, and rawText', () => {
      const card = createEmptyBusinessCard();
      expect(card.id).toBeTruthy();
      expect(card.fullName).toBe('');
      expect(card.firstName).toBe('');
      expect(card.lastName).toBe('');
      expect(card.company).toBe('');
      expect(card.title).toBe('');
      expect(card.phone).toBe('');
      expect(card.email).toBe('');
      expect(card.website).toBe('');
      expect(card.address).toBe('');
      expect(card.social).toBe('');
      expect(card.extraFields).toEqual({});
      expect(card.rawText).toBe('');
    });
  });

  describe('extractFromImage — fallback when API not configured', () => {
    beforeEach(() => {
      // Ensure no API URL/token set (simulates unconfigured env)
      vi.stubEnv('VITE_DOC_INTEL_URL', '');
      vi.stubEnv('VITE_DOC_INTEL_TOKEN', '');
    });

    it('returns ExtractionResult shape with entries and meta for signup-sheet', async () => {
      const file = new File(['test'], 'test.png', { type: 'image/png' });
      const result = await extractFromImage(file, 'signup-sheet');
      expect(result).toHaveProperty('entries');
      expect(result).toHaveProperty('meta');
      expect(Array.isArray(result.entries)).toBe(true);
      expect(result.entries.length).toBeGreaterThan(0);
      expect(result.meta.structure).toBe('unstructured');
    });

    it('returns ExtractionResult shape with entries and meta for business-card', async () => {
      const file = new File(['test'], 'card.jpg', { type: 'image/jpeg' });
      const result = await extractFromImage(file, 'business-card');
      expect(result).toHaveProperty('entries');
      expect(result).toHaveProperty('meta');
      expect(result.entries).toHaveLength(1);
    });

    it('signup entries have extraFields', async () => {
      const file = new File(['test'], 'test.png', { type: 'image/png' });
      const result = await extractFromImage(file, 'signup-sheet');
      for (const entry of result.entries) {
        expect(entry).toHaveProperty('extraFields');
      }
    });

    it('business card entries have extraFields and rawText', async () => {
      const file = new File(['test'], 'card.jpg', { type: 'image/jpeg' });
      const result = await extractFromImage(file, 'business-card');
      for (const entry of result.entries) {
        expect(entry).toHaveProperty('extraFields');
        expect(entry).toHaveProperty('rawText');
      }
    });
  });

  describe('extractFromImage — API response mapping', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_DOC_INTEL_URL', 'https://mock.api');
      vi.stubEnv('VITE_DOC_INTEL_TOKEN', 'mock-token');
    });

    it('maps multi-row sign-in response correctly', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'table',
        detectedHeaders: ['Name', 'Organization', 'Email', 'Phone'],
        headerMapping: [
          { original: 'Name', normalized: 'fullName' },
          { original: 'Organization', normalized: 'organization' },
          { original: 'Email', normalized: 'email' },
          { original: 'Phone', normalized: 'phone' },
        ],
        rows: [
          { id: '1', fullName: 'Alice', organization: 'NLSM', email: 'alice@test.com', phone: '555-0001', extraFields: {} },
          { id: '2', fullName: 'Bob', organization: 'VAAC', email: 'bob@test.com', phone: '555-0002', extraFields: {} },
        ],
        confidence: 0.9,
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const file = new File(['test'], 'sheet.pdf', { type: 'application/pdf' });
      const result = await extractFromImage(file, 'signup-sheet');

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].fullName).toBe('Alice');
      expect((result.entries[0] as any).organization).toBe('NLSM');
      expect(result.meta.structure).toBe('table');
      expect(result.meta.detectedHeaders).toEqual(['Name', 'Organization', 'Email', 'Phone']);
      expect(result.meta.confidence).toBe(0.9);
    });

    it('maps business card response with extraFields', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'single-entity',
        detectedHeaders: ['Name', 'Company', 'Email', 'Phone', 'Department'],
        headerMapping: [
          { original: 'Name', normalized: 'fullName' },
          { original: 'Company', normalized: 'company' },
          { original: 'Email', normalized: 'email' },
          { original: 'Phone', normalized: 'phone' },
          { original: 'Department', normalized: null },
        ],
        card: {
          id: '1',
          fullName: 'John Doe',
          firstName: 'John',
          lastName: 'Doe',
          company: 'Acme',
          title: '',
          email: 'john@acme.com',
          phone: '555-1234',
          website: '',
          address: '',
          social: '',
          extraFields: { Department: 'Engineering' },
          rawText: 'John Doe\nAcme\njohn@acme.com',
        },
        confidence: 0.8,
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const file = new File(['test'], 'card.jpg', { type: 'image/jpeg' });
      const result = await extractFromImage(file, 'business-card');

      expect(result.entries).toHaveLength(1);
      const card = result.entries[0] as any;
      expect(card.fullName).toBe('John Doe');
      expect(card.company).toBe('Acme');
      expect(card.extraFields.Department).toBe('Engineering');
      expect(card.rawText).toBe('John Doe\nAcme\njohn@acme.com');
    });

    it('maps sign-in response with extra unmapped fields', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'table',
        detectedHeaders: ['Name', 'Email', 'Badge Number'],
        headerMapping: [
          { original: 'Name', normalized: 'fullName' },
          { original: 'Email', normalized: 'email' },
          { original: 'Badge Number', normalized: null },
        ],
        rows: [
          { id: '1', fullName: 'Alice', email: 'alice@test.com', extraFields: { 'Badge Number': '1234' } },
        ],
        confidence: 0.67,
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const file = new File(['test'], 'sheet.pdf', { type: 'application/pdf' });
      const result = await extractFromImage(file, 'signup-sheet');

      expect(result.entries).toHaveLength(1);
      expect((result.entries[0] as any).extraFields['Badge Number']).toBe('1234');
    });
  });
});
