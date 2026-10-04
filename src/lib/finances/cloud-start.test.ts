import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock('./files', () => ({ putObject: vi.fn(), getObject: vi.fn(), deleteObject: vi.fn(), filesDir: () => '/tmp' }));
vi.mock('./audit', () => ({ auditFinance: vi.fn() }));

import { effectiveStartUrl, isSiteRoot } from './cloud-statements';

const DRIVERS = [
  { key: 'americanexpress', statements: 'https://global.americanexpress.com/activity/statements' },
  { key: 'chase', statements: 'https://secure.chase.com/web/auth/dashboard#/dashboard/documents/myDocs/index;mode=documents' },
  { key: 'citi' },
];

describe('where a cloud fetch starts', () => {
  it('replaces a saved front page with the known statements page (the Amex case)', () => {
    expect(isSiteRoot('https://www.americanexpress.com/?inav=en_us_menu_navlogo')).toBe(true);
    expect(effectiveStartUrl('americanexpress', 'https://www.americanexpress.com/?inav=en_us_menu_navlogo', DRIVERS)).toBe('https://global.americanexpress.com/activity/statements');
  });

  it('keeps a saved page that is not the front page', () => {
    const chase = 'https://secure.chase.com/web/auth/dashboard#/dashboard/documents/myDocs/index;documentType=STATEMENTS;mode=documents';
    expect(isSiteRoot(chase)).toBe(false);
    expect(effectiveStartUrl('chase', chase, DRIVERS)).toBe(chase);
  });

  it('keeps a front page when no statements page is known, and falls back to the known one when nothing was saved', () => {
    expect(effectiveStartUrl('citi', 'https://online.citi.com/', DRIVERS)).toBe('https://online.citi.com/');
    expect(effectiveStartUrl('americanexpress', null, DRIVERS)).toBe('https://global.americanexpress.com/activity/statements');
    expect(effectiveStartUrl('tinycu', null, DRIVERS)).toBeNull();
    expect(isSiteRoot('not a url')).toBe(false);
  });
});
