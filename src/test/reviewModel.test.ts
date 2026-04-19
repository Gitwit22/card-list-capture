import { describe, expect, it } from 'vitest';
import { buildSignupReviewModel } from '@/lib/reviewModel';
import { ExtractionMeta, SignupEntry } from '@/types/scan';

describe('reviewModel', () => {
  it('uses detected headers in order and maps values without forcing canonical labels', () => {
    const entries: SignupEntry[] = [
      {
        id: 'r1',
        fullName: 'Robert Dostle',
        organization: 'Tech Tech',
        phone: '602-254-1404',
        email: 'rdostle@tech.com',
        screening: '',
        shareInfo: '',
        date: '',
        comments: '',
        extraFields: {
          'Access to Website?': 'Y',
          Badge: '1234',
        },
      },
    ];

    const meta: ExtractionMeta = {
      structure: 'table',
      detectedHeaders: ['Name', 'Organization', 'Phone Number', 'Email Address', 'Access to Website?'],
      headerMapping: [
        { original: 'Name', normalized: 'fullName' },
        { original: 'Organization', normalized: 'organization' },
        { original: 'Phone Number', normalized: 'phone' },
        { original: 'Email Address', normalized: 'email' },
        { original: 'Access to Website?', normalized: null },
      ],
      confidence: 0.88,
    };

    const model = buildSignupReviewModel(entries, meta);

    expect(model.columns.map((column) => column.label)).toEqual([
      'Name',
      'Organization',
      'Phone Number',
      'Email Address',
      'Access to Website?',
    ]);

    expect(model.rows).toHaveLength(1);
    const nameColumn = model.columns.find((column) => column.label === 'Name');
    const orgColumn = model.columns.find((column) => column.label === 'Organization');
    const phoneColumn = model.columns.find((column) => column.label === 'Phone Number');
    const emailColumn = model.columns.find((column) => column.label === 'Email Address');
    const accessColumn = model.columns.find((column) => column.label === 'Access to Website?');

    expect(nameColumn).toBeDefined();
    expect(orgColumn).toBeDefined();
    expect(phoneColumn).toBeDefined();
    expect(emailColumn).toBeDefined();
    expect(accessColumn).toBeDefined();
    expect(model.rows[0].values[nameColumn!.key]).toBe('Robert Dostle');
    expect(model.rows[0].values[orgColumn!.key]).toBe('Tech Tech');
    expect(model.rows[0].values[phoneColumn!.key]).toBe('602-254-1404');
    expect(model.rows[0].values[emailColumn!.key]).toBe('rdostle@tech.com');
    expect(model.rows[0].values[accessColumn!.key]).toBe('Y');
  });

  it('prefers rawRows when available so review reflects source parse output', () => {
    const entries: SignupEntry[] = [
      {
        id: 'r1',
        fullName: 'Mismatch Name',
        organization: '',
        phone: '',
        email: '',
        screening: '',
        shareInfo: '',
        date: '',
        comments: '',
        extraFields: { Department: 'Should Not Win' },
      },
    ];

    const model = buildSignupReviewModel(entries, {
      structure: 'table',
      detectedHeaders: ['Name', 'Organization', 'Department'],
      headerMapping: [
        { original: 'Name', normalized: 'fullName' },
        { original: 'Organization', normalized: 'organization' },
        { original: 'Department', normalized: null },
      ],
      confidence: 0.9,
      rawRows: [
        { Name: 'Parsed Name', Organization: 'Parsed Org', Department: 'Parsed Dept' },
      ],
    });

    expect(model.columns.map((column) => column.label)).toEqual([
      'Name',
      'Organization',
      'Department',
    ]);

    expect(model.rows).toHaveLength(1);
    const nameColumn = model.columns.find((column) => column.label === 'Name');
    const orgColumn = model.columns.find((column) => column.label === 'Organization');
    const deptColumn = model.columns.find((column) => column.label === 'Department');

    expect(nameColumn).toBeDefined();
    expect(orgColumn).toBeDefined();
    expect(deptColumn).toBeDefined();
    expect(model.rows[0].values[nameColumn!.key]).toBe('Parsed Name');
    expect(model.rows[0].values[orgColumn!.key]).toBe('Parsed Org');
    expect(model.rows[0].values[deptColumn!.key]).toBe('Parsed Dept');
  });

  it('binds values correctly when rawRows are positional keys and columns are header labels', () => {
    const entries: SignupEntry[] = [
      {
        id: 'r1',
        fullName: 'Robert DeBottille',
        organization: 'Tetra Tech',
        phone: '(810) 225-8404',
        email: 'bob.debottill@tetratech.com',
        screening: '',
        shareInfo: '',
        date: '',
        comments: '',
        extraFields: {
          'ACCESS TO WEBSITE': 'Y',
        },
      },
    ];

    const model = buildSignupReviewModel(entries, {
      structure: 'table',
      detectedHeaders: ['NAME', 'ORGANIZATION', 'PHONE NUMBER', 'EMAIL ADDRESS', 'ACCESS TO WEBSITE?'],
      headerMapping: [
        { original: 'NAME', normalized: 'fullName' },
        { original: 'ORGANIZATION', normalized: 'organization' },
        { original: 'PHONE NUMBER', normalized: 'phone' },
        { original: 'EMAIL ADDRESS', normalized: 'email' },
        { original: 'ACCESS TO WEBSITE?', normalized: null },
      ],
      confidence: 0.92,
      rawRows: [
        {
          c1: 'Robert DeBottille',
          c2: 'Tetra Tech',
          c3: '(810) 225-8404',
          c4: 'bob.debottill@tetratech.com',
          c5: 'Y',
        },
      ],
    });

    expect(model.columns.map((column) => column.label)).toEqual([
      'NAME',
      'ORGANIZATION',
      'PHONE NUMBER',
      'EMAIL ADDRESS',
      'ACCESS TO WEBSITE?',
    ]);

    const nameColumn = model.columns.find((column) => column.label === 'NAME');
    const orgColumn = model.columns.find((column) => column.label === 'ORGANIZATION');
    const phoneColumn = model.columns.find((column) => column.label === 'PHONE NUMBER');
    const emailColumn = model.columns.find((column) => column.label === 'EMAIL ADDRESS');
    const accessColumn = model.columns.find((column) => column.label === 'ACCESS TO WEBSITE?');

    expect(nameColumn).toBeDefined();
    expect(orgColumn).toBeDefined();
    expect(phoneColumn).toBeDefined();
    expect(emailColumn).toBeDefined();
    expect(accessColumn).toBeDefined();

    expect(model.rows[0].values[nameColumn!.key]).toBe('Robert DeBottille');
    expect(model.rows[0].values[orgColumn!.key]).toBe('Tetra Tech');
    expect(model.rows[0].values[phoneColumn!.key]).toBe('(810) 225-8404');
    expect(model.rows[0].values[emailColumn!.key]).toBe('bob.debottill@tetratech.com');
    expect(model.rows[0].values[accessColumn!.key]).toBe('Y');
  });

  it('falls back to canonical labels only when metadata is absent', () => {
    const entries: SignupEntry[] = [
      {
        id: 'r1',
        fullName: 'Fallback Name',
        organization: 'Fallback Org',
        phone: '',
        email: '',
        screening: '',
        shareInfo: '',
        date: '',
        comments: '',
        extraFields: {},
      },
    ];

    const model = buildSignupReviewModel(entries, undefined);

    expect(model.columns.map((column) => column.label)).toEqual([
      'Full Name',
      'Organization',
    ]);
  });
});
