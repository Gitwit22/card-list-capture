import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractFromImage, extractBusinessCardRecord, createEmptySignupEntry, createEmptyBusinessCard } from '@/lib/extraction';

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

    it('tries alternate sign-up/sign-in process endpoints before generic fallback', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'table',
        detectedHeaders: ['Name', 'Organization', 'Email', 'Phone'],
        headerMapping: [],
        rows: [
          { id: '1', fullName: 'Casey Nguyen', organization: 'WCNS', email: 'casey@wcns.org', phone: '313-555-0100' },
        ],
        confidence: 0.82,
      };

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockResponse) });

      vi.stubGlobal('fetch', fetchMock);

      const file = new File(['test'], 'sheet.pdf', { type: 'application/pdf' });
      const result = await extractFromImage(file, 'signup-sheet');

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].fullName).toBe('Casey Nguyen');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toBe('https://mock.api/process/signup-sheet');
      expect(fetchMock.mock.calls[1][0]).toBe('https://mock.api/process/signin-sheet');
    });

    it('falls back to /extract when both sign-up/sign-in process endpoints fail', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            status: 'complete',
            fields: [
              { key: 'fullName', value: 'Morgan Tate' },
              { key: 'organization', value: 'NLSM' },
              { key: 'email', value: 'morgan@nlsm.org' },
            ],
          }),
        });

      vi.stubGlobal('fetch', fetchMock);

      const file = new File(['test'], 'sheet-fallback.pdf', { type: 'application/pdf' });
      const result = await extractFromImage(file, 'signup-sheet');

      expect(result.entries).toHaveLength(1);
      const row = result.entries[0] as any;
      expect(row.fullName).toBe('Morgan Tate');
      expect(row.organization).toBe('NLSM');
      expect(row.email).toBe('morgan@nlsm.org');
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[0][0]).toBe('https://mock.api/process/signup-sheet');
      expect(fetchMock.mock.calls[1][0]).toBe('https://mock.api/process/signin-sheet');
      expect(fetchMock.mock.calls[2][0]).toBe('https://mock.api/extract');
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

    it('maps business card alias keys and preserves unknown fields', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'single-entity',
        detectedHeaders: ['Name', 'Company Name', 'Job Title', 'Email Address', 'Phone Number', 'URL', 'Mailing Address', 'Department'],
        headerMapping: [],
        card: {
          id: 'card-1',
          name: 'Taylor Brooks',
          companyName: 'Civic Partners',
          jobTitle: 'Program Director',
          emailAddress: 'taylor@civicpartners.org',
          phoneNumber: '313-555-0147',
          url: 'https://civicpartners.org',
          mailingAddress: '123 Main St, Detroit, MI',
          Department: 'Outreach',
          rawText: 'Taylor Brooks\nCivic Partners',
        },
        confidence: 0.84,
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const file = new File(['test'], 'card-alias.jpg', { type: 'image/jpeg' });
      const result = await extractFromImage(file, 'business-card');

      const card = result.entries[0] as any;
      expect(card.fullName).toBe('Taylor Brooks');
      expect(card.company).toBe('Civic Partners');
      expect(card.title).toBe('Program Director');
      expect(card.email).toBe('taylor@civicpartners.org');
      expect(card.phone).toBe('313-555-0147');
      expect(card.website).toBe('https://civicpartners.org');
      expect(card.address).toBe('123 Main St, Detroit, MI');
      expect(card.firstName).toBe('Taylor');
      expect(card.lastName).toBe('Brooks');
      expect(card.extraFields.Department).toBe('Outreach');
    });

    it('maps business card organization and mobile aliases into canonical fields', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'single-entity',
        detectedHeaders: ['Organization', 'Mobile', 'Contact Name', 'Notes'],
        headerMapping: [],
        card: {
          id: 'card-2',
          contactName: 'Jordan Lee',
          organization: 'Neighborhood Alliance',
          mobile: '313-555-0172',
          Notes: 'Met at annual summit',
          rawText: 'Jordan Lee\nNeighborhood Alliance',
        },
        confidence: 0.79,
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const file = new File(['test'], 'card-mobile.jpg', { type: 'image/jpeg' });
      const result = await extractFromImage(file, 'business-card');

      const card = result.entries[0] as any;
      expect(card.fullName).toBe('Jordan Lee');
      expect(card.firstName).toBe('Jordan');
      expect(card.lastName).toBe('Lee');
      expect(card.company).toBe('Neighborhood Alliance');
      expect(card.phone).toBe('313-555-0172');
      expect(card.extraFields.Notes).toBe('Met at annual summit');
    });

    it('normalizes comma-separated card names into full, first, and last names', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'single-entity',
        detectedHeaders: ['Name', 'Email'],
        headerMapping: [],
        card: {
          id: 'card-3',
          name: 'Fair, Raymond',
          email: 'info@communityclaim.com',
          rawText: 'Fair, Raymond\ninfo@communityclaim.com',
        },
        confidence: 0.81,
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const file = new File(['test'], 'card-comma-name.jpg', { type: 'image/jpeg' });
      const result = await extractFromImage(file, 'business-card');

      const card = result.entries[0] as any;
      expect(card.fullName).toBe('Raymond Fair');
      expect(card.firstName).toBe('Raymond');
      expect(card.lastName).toBe('Fair');
    });

    it('does not map surname-like company values from person name fragments', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'single-entity',
        detectedHeaders: ['Name', 'Company', 'Email'],
        headerMapping: [],
        card: {
          id: 'card-4',
          name: 'Fair, Raymond',
          company: 'FAIR',
          email: 'raymond@communityclaim.com',
          rawText: 'Fair, Raymond\nFAIR\nraymond@communityclaim.com',
        },
        confidence: 0.8,
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const file = new File(['test'], 'card-surname-company.jpg', { type: 'image/jpeg' });
      const result = await extractFromImage(file, 'business-card');

      const card = result.entries[0] as any;
      expect(card.fullName).toBe('Raymond Fair');
      expect(card.lastName).toBe('Fair');
      expect(card.company).toBe('');
    });

    it('keeps valid company names when supported by company/domain signals', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'single-entity',
        detectedHeaders: ['Name', 'Company', 'Email', 'Website'],
        headerMapping: [],
        card: {
          id: 'card-5',
          name: 'Raymond Fair',
          company: 'Community Claim Solutions',
          email: 'raymond@communityclaim.com',
          website: 'https://communityclaim.com',
          rawText: 'Raymond Fair\nCommunity Claim Solutions',
        },
        confidence: 0.83,
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const file = new File(['test'], 'card-valid-company.jpg', { type: 'image/jpeg' });
      const result = await extractFromImage(file, 'business-card');

      const card = result.entries[0] as any;
      expect(card.company).toBe('Community Claim Solutions');
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

    it('maps sign-in alias keys for name and organization', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'table',
        detectedHeaders: ['Name', 'Org', 'Email', 'Phone'],
        headerMapping: [],
        rows: [
          {
            id: '1',
            name: 'Lindsey Blake',
            org: 'WCNS',
            emailAddress: 'lindsey@example.com',
            phoneNumber: '313-555-0199',
            table: 'A4',
          },
        ],
        confidence: 0.75,
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const file = new File(['test'], 'sheet.pdf', { type: 'application/pdf' });
      const result = await extractFromImage(file, 'signup-sheet');

      const row = result.entries[0] as any;
      expect(row.fullName).toBe('Lindsey Blake');
      expect(row.organization).toBe('WCNS');
      expect(row.email).toBe('lindsey@example.com');
      expect(row.phone).toBe('313-555-0199');
      expect(row.extraFields.table).toBe('A4');
    });

    it('hydrates missing structured name and organization from rawRows', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'table',
        detectedHeaders: ['Name', 'Organization', 'Email', 'Phone'],
        headerMapping: [],
        rows: [
          {
            id: '1',
            fullName: '',
            organization: '',
            email: 'jordan@wcns.org',
            phone: '313-555-0142',
          },
        ],
        rawRows: [
          {
            c1: 'Jordan Lee',
            c2: 'WCNS',
            c3: 'jordan@wcns.org',
            c4: '313-555-0142',
          },
        ],
        confidence: 0.78,
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const file = new File(['test'], 'sheet-raw-rows.pdf', { type: 'application/pdf' });
      const result = await extractFromImage(file, 'signup-sheet');

      const row = result.entries[0] as any;
      expect(row.fullName).toBe('Jordan Lee');
      expect(row.organization).toBe('WCNS');
      expect(row.email).toBe('jordan@wcns.org');
      expect(row.phone).toBe('313-555-0142');
    });

    it('skips rows that are actually header labels', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'table',
        detectedHeaders: ['Name', 'Organization', 'Email', 'Phone'],
        headerMapping: [],
        rows: [
          {
            id: 'header-row',
            col1: 'Name',
            col2: 'Organization',
            col3: 'Email',
            col4: 'Phone',
          },
          {
            id: 'data-row',
            col1: 'Alex Carter',
            col2: 'Neighborhood Coalition',
            col3: 'alex@coalition.org',
            col4: '313-555-0110',
          },
        ],
        confidence: 0.88,
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const file = new File(['test'], 'sheet-headers.pdf', { type: 'application/pdf' });
      const result = await extractFromImage(file, 'signup-sheet');

      expect(result.entries).toHaveLength(1);
      const row = result.entries[0] as any;
      expect(row.fullName).toBe('Alex Carter');
      expect(row.organization).toBe('Neighborhood Coalition');
      expect(row.email).toBe('alex@coalition.org');
      expect(row.phone).toBe('313-555-0110');
    });

    it('does not leak header-only rows through the fallback mapper', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'table',
        detectedHeaders: ['Full Name', 'Organization', 'Screening', 'Share Info', 'Date', 'Comments'],
        headerMapping: [],
        rows: [
          {
            id: 'header-row',
            fullName: 'Full Name',
            organization: 'Organization',
            screening: 'Screening',
            shareInfo: 'Share Info',
            date: 'Date',
            comments: 'Comments',
          },
        ],
        confidence: 0.52,
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const file = new File(['test'], 'sheet-fallback-header.pdf', { type: 'application/pdf' });
      const result = await extractFromImage(file, 'signup-sheet');

      expect(result.entries).toHaveLength(0);
    });

    it('infers columns by values when headers are weak', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'table',
        detectedHeaders: ['Contact', 'Info', 'Details', 'Other'],
        headerMapping: [],
        rows: [
          {
            id: 'r1',
            c1: 'Jordan Miles',
            c2: 'jordan@uplift.org',
            c3: '313-555-0113',
            c4: 'Uplift Detroit',
          },
          {
            id: 'r2',
            c1: 'Taylor Reed',
            c2: 'taylor@uplift.org',
            c3: '313-555-0114',
            c4: 'Uplift Detroit',
          },
        ],
        confidence: 0.71,
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const file = new File(['test'], 'sheet-weak-headers.pdf', { type: 'application/pdf' });
      const result = await extractFromImage(file, 'signup-sheet');

      expect(result.entries).toHaveLength(2);

      const first = result.entries[0] as any;
      expect(first.fullName).toBe('Jordan Miles');
      expect(first.email).toBe('jordan@uplift.org');
      expect(first.phone).toBe('313-555-0113');
      expect(first.organization).toBe('Uplift Detroit');

      const second = result.entries[1] as any;
      expect(second.fullName).toBe('Taylor Reed');
      expect(second.email).toBe('taylor@uplift.org');
      expect(second.phone).toBe('313-555-0114');
      expect(second.organization).toBe('Uplift Detroit');
    });

    it('infers short uppercase organization acronyms from weak headers', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'table',
        detectedHeaders: ['Contact', 'Info', 'Details', 'Other'],
        headerMapping: [],
        rows: [
          {
            id: 'r1',
            c1: 'Jordan Miles',
            c2: 'jordan@wcns.org',
            c3: '313-555-0113',
            c4: 'WCNS',
          },
          {
            id: 'r2',
            c1: 'Taylor Reed',
            c2: 'taylor@nlsm.org',
            c3: '313-555-0114',
            c4: 'NLSM',
          },
        ],
        confidence: 0.7,
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const file = new File(['test'], 'sheet-acronyms.pdf', { type: 'application/pdf' });
      const result = await extractFromImage(file, 'signup-sheet');

      const first = result.entries[0] as any;
      expect(first.fullName).toBe('Jordan Miles');
      expect(first.organization).toBe('WCNS');

      const second = result.entries[1] as any;
      expect(second.fullName).toBe('Taylor Reed');
      expect(second.organization).toBe('NLSM');
    });
  });

  describe('extractBusinessCardRecord — front/back merge', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_DOC_INTEL_URL', 'https://mock.api');
      vi.stubEnv('VITE_DOC_INTEL_TOKEN', 'mock-token');
    });

    it('merges front and back into one row and keeps front as primary on conflicts', async () => {
      const frontResponse = {
        status: 'complete',
        structure: 'single-entity',
        detectedHeaders: [],
        headerMapping: [],
        confidence: 0.8,
        card: {
          id: 'front',
          fullName: 'Jordan Blake',
          company: 'Nxt Lvl',
          phone: '313-555-0101',
          email: 'jordan@nxtlvl.com',
          website: '',
          address: '',
          social: '',
          extraFields: {},
          rawText: 'Jordan Blake\nNxt Lvl',
        },
      };

      const backResponse = {
        status: 'complete',
        structure: 'single-entity',
        detectedHeaders: [],
        headerMapping: [],
        confidence: 0.7,
        card: {
          id: 'back',
          fullName: 'Jordan Blake',
          company: 'NXT LEVEL',
          phone: '313-555-0199',
          email: '',
          website: 'https://nxtlvl.com',
          address: 'Detroit, MI',
          social: '@nxtlvl',
          extraFields: { Services: 'AI, Automation' },
          rawText: 'Services: AI, Automation',
        },
      };

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(frontResponse) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(backResponse) }));

      const frontFile = new File(['front'], 'card-front.jpg', { type: 'image/jpeg' });
      const backFile = new File(['back'], 'card-back.jpg', { type: 'image/jpeg' });

      const merged = await extractBusinessCardRecord({
        id: 'card-1',
        front: {
          file: frontFile,
          previewUrl: 'blob:front',
          filename: 'card-front.jpg',
          sourceType: 'camera',
        },
        back: {
          file: backFile,
          previewUrl: 'blob:back',
          filename: 'card-back.jpg',
          sourceType: 'camera',
        },
        status: 'queued',
        error: undefined,
        extractedRows: [],
        needsReview: false,
        index: 0,
      });

      expect(merged.fullName).toBe('Jordan Blake');
      expect(merged.company).toBe('Nxt Lvl');
      expect(merged.phone).toBe('313-555-0101');
      expect(merged.website).toBe('https://nxtlvl.com');
      expect(merged.address).toBe('Detroit, MI');
      expect(merged.extraFields.Services).toBe('AI, Automation');
      expect(merged.extraFields.back_phone).toBe('313-555-0199');
      expect(merged.backText).toContain('Services: AI, Automation');
      expect(merged.conflictFields).toContain('phone');
    });
  });

  describe('business-card normalization regressions', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_DOC_INTEL_URL', 'https://mock.api');
      vi.stubEnv('VITE_DOC_INTEL_TOKEN', 'mock-token');
    });

    it('moves organization-like fullName into company', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'single-entity',
        detectedHeaders: ['Name', 'Email'],
        headerMapping: [],
        confidence: 0.81,
        card: {
          id: 'org-name',
          fullName: 'THAI SPA PAVILION',
          company: '',
          email: 'hello@thaispapavilion.com',
          rawText: 'THAI SPA PAVILION\nhello@thaispapavilion.com',
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResponse) }));

      const file = new File(['test'], 'org-name.jpg', { type: 'image/jpeg' });
      const result = await extractFromImage(file, 'business-card');
      const card = result.entries[0] as any;

      expect(card.company).toBe('THAI SPA PAVILION');
      expect(card.fullName).toBe('');
    });

    it('rejects invalid website junk and keeps raw in extra fields', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'single-entity',
        detectedHeaders: ['Website', 'Email'],
        headerMapping: [],
        confidence: 0.78,
        card: {
          id: 'bad-website',
          fullName: 'Sade Warren',
          website: 'CRIME STOPPERS OF FLINT & GENESEE COUNTY',
          email: 'sade@example.org',
          rawText: 'Sade Warren\nCRIME STOPPERS OF FLINT & GENESEE COUNTY',
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResponse) }));

      const file = new File(['test'], 'bad-website.jpg', { type: 'image/jpeg' });
      const result = await extractFromImage(file, 'business-card');
      const card = result.entries[0] as any;

      expect(card.website).toBe('');
      expect(card.extraFields.websiteRejected).toBe('CRIME STOPPERS OF FLINT & GENESEE COUNTY');
    });

    it('keeps only the clean domain when website includes OCR-merged trailing text', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'single-entity',
        detectedHeaders: ['Website', 'Email'],
        headerMapping: [],
        confidence: 0.8,
        card: {
          id: 'merged-website-text',
          fullName: 'Susan Stoney',
          website: 'https://plymouthlibrary.org Susan Stoney Community Relations Specialist',
          email: 'sstoney@plymouthlibrary.org',
          rawText: 'Susan Stoney\nPLYMOUTH DISTRICT LIBRARY\nhttps://plymouthlibrary.org Susan Stoney',
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResponse) }));

      const file = new File(['test'], 'merged-website.jpg', { type: 'image/jpeg' });
      const result = await extractFromImage(file, 'business-card');
      const card = result.entries[0] as any;

      expect(card.website).toBe('plymouthlibrary.org');
      expect(card.website).not.toMatch(/Susan/i);
      expect(card.website).not.toContain(' ');
    });

    it('sanitizes website in /extract fallback mapping', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            status: 'complete',
            fields: [
              { key: 'fullName', value: 'Susan Stoney' },
              { key: 'email', value: 'sstoney@plymouthlibrary.org' },
              { key: 'website', value: 'PLYMOUTH DISTRICT LIBRARYSusan StoneyC' },
            ],
          }),
        }));

      const file = new File(['test'], 'fallback-website.jpg', { type: 'image/jpeg' });
      const result = await extractFromImage(file, 'business-card');
      const card = result.entries[0] as any;

      expect(card.website).toBe('');
    });

    it('removes phone numbers from address and moves extras into extraFields.additionalPhone', async () => {
      const mockResponse = {
        status: 'complete',
        structure: 'single-entity',
        detectedHeaders: ['Name', 'Address', 'Email'],
        headerMapping: [],
        confidence: 0.8,
        card: {
          id: 'address-phone',
          fullName: 'Sade Warren',
          address: '123 Main St (248) 335-8740\nDetroit, MI 48201',
          phone: '313-555-0101',
          email: 'sade@example.org',
          rawText: 'Sade Warren\n123 Main St (248) 335-8740\nDetroit, MI 48201',
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResponse) }));

      const file = new File(['test'], 'address-phone.jpg', { type: 'image/jpeg' });
      const result = await extractFromImage(file, 'business-card');
      const card = result.entries[0] as any;

      expect(card.address).toBe('123 Main St Detroit, MI 48201');
      expect(card.address).not.toMatch(/248\)?\s*335\s*-?\s*8740/);
      expect(card.extraFields.additionalPhone).toContain('248');
    });
  });
});

// ─── Phase 6 — extraction.ts fixes ───────────────────────────────────────────

describe('mapBusinessCard — email fixes (Fix 14, Fix 15)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DOC_INTEL_URL', 'https://mock.api');
    vi.stubEnv('VITE_DOC_INTEL_TOKEN', 'mock-token');
  });

  it('Fix 14 — lowercases email from API', async () => {
    const mockResponse = {
      status: 'complete',
      structure: 'single-entity',
      detectedHeaders: [],
      headerMapping: [],
      confidence: 0.9,
      card: {
        fullName: 'John Smith',
        email: 'JOHN@EXAMPLE.COM',
        phone: '313-555-0000',
        company: 'Acme',
        rawText: 'John Smith\nJOHN@EXAMPLE.COM',
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResponse) }));
    const file = new File(['test'], 'card.jpg', { type: 'image/jpeg' });
    const result = await extractFromImage(file, 'business-card');
    const card = result.entries[0] as any;
    expect(card.email).toBe('john@example.com');
  });

  it('Fix 15 — prefers resolver email when API email is malformed', async () => {
    const mockResponse = {
      status: 'complete',
      structure: 'single-entity',
      detectedHeaders: [],
      headerMapping: [],
      confidence: 0.9,
      card: {
        fullName: 'Jane Doe',
        email: 'not-an-email',
        phone: '313-555-0001',
        company: 'Acme',
        rawText: 'Jane Doe\njane@acme.com\n313-555-0001',
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResponse) }));
    const file = new File(['test'], 'card.jpg', { type: 'image/jpeg' });
    const result = await extractFromImage(file, 'business-card');
    const card = result.entries[0] as any;
    expect(card.email).toBe('jane@acme.com');
  });
});

describe('mapBusinessCard — tagline top-level field (Fix 16)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DOC_INTEL_URL', 'https://mock.api');
    vi.stubEnv('VITE_DOC_INTEL_TOKEN', 'mock-token');
  });

  it('Fix 16 — tagline is written to the top-level field', async () => {
    const mockResponse = {
      status: 'complete',
      structure: 'single-entity',
      detectedHeaders: [],
      headerMapping: [],
      confidence: 0.9,
      card: {
        fullName: 'Christine Smith',
        email: 'christine@ww.com',
        phone: '313-433-5452',
        rawText: [
          'Professional Organizing',
          'Specializing in DUO Services',
          'Christine Smith',
          'Owner',
          'christine@ww.com',
        ].join('\n'),
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResponse) }));
    const file = new File(['test'], 'card.jpg', { type: 'image/jpeg' });
    const result = await extractFromImage(file, 'business-card');
    const card = result.entries[0] as any;
    // tagline should be on the top-level field, not only in extraFields
    expect(card.tagline).toBeTruthy();
    expect(typeof card.tagline).toBe('string');
  });
});

describe('mapBusinessCard — social handle fallback (Fix 17)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DOC_INTEL_URL', 'https://mock.api');
    vi.stubEnv('VITE_DOC_INTEL_TOKEN', 'mock-token');
  });

  it('Fix 17 — uses resolved.social when card.social is empty', async () => {
    const mockResponse = {
      status: 'complete',
      structure: 'single-entity',
      detectedHeaders: [],
      headerMapping: [],
      confidence: 0.9,
      card: {
        fullName: 'Jane Artist',
        email: 'jane@art.com',
        rawText: [
          'Jane Artist',
          'jane@art.com',
          'instagram.com/janeartist',
        ].join('\n'),
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResponse) }));
    const file = new File(['test'], 'card.jpg', { type: 'image/jpeg' });
    const result = await extractFromImage(file, 'business-card');
    const card = result.entries[0] as any;
    expect(card.social).toContain('instagram');
  });
});

describe('mapBusinessCard — secondary email merging (Fix 13)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DOC_INTEL_URL', 'https://mock.api');
    vi.stubEnv('VITE_DOC_INTEL_TOKEN', 'mock-token');
  });

  it('Fix 13 — secondary email from resolver is in extraFields', async () => {
    const mockResponse = {
      status: 'complete',
      structure: 'single-entity',
      detectedHeaders: [],
      headerMapping: [],
      confidence: 0.9,
      card: {
        fullName: 'John Smith',
        email: 'john@primary.com',
        rawText: 'John Smith\njohn@primary.com\njohn@secondary.com',
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResponse) }));
    const file = new File(['test'], 'card.jpg', { type: 'image/jpeg' });
    const result = await extractFromImage(file, 'business-card');
    const card = result.entries[0] as any;
    expect(card.extraFields.secondaryEmail).toBe('john@secondary.com');
  });
});
