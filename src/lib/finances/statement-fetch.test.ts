import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock('./summary', () => ({ listAccounts: vi.fn() }));
vi.mock('./statements', () => ({ listStatements: vi.fn() }));
vi.mock('./audit', () => ({ auditFinance: vi.fn() }));

import {
  buildStatementCoverage,
  closingMonth,
  FetchRunError,
  institutionKey,
  latestByInstitution,
  parseFetchRun,
  recentMonths,
} from './statement-fetch';

const run = {
  institutionKey: 'chase',
  institutionLabel: 'Chase',
  status: 'ok',
  candidates: 14,
  filed: 2,
  duplicates: 12,
  unmatched: 0,
  silent: 0,
  startedAt: '2026-10-04T12:00:00Z',
  finishedAt: '2026-10-04T12:01:30Z',
};

describe('institutionKey', () => {
  it('matches the CLI: the name the bank site goes by', () => {
    expect(institutionKey('secure.chase.com', 'Chase')).toBe('chase');
    expect(institutionKey('https://card.apple.com', null)).toBe('apple');
    expect(institutionKey('www.barclays.co.uk', null)).toBe('barclays');
    expect(institutionKey(null, 'Bay Federal Credit Union')).toBe('bay-federal-credit-union');
  });
});

describe('parseFetchRun', () => {
  const now = new Date('2026-10-04T12:05:00Z');

  it('accepts a well-formed report and normalises timestamps', () => {
    expect(parseFetchRun(run, now)).toMatchObject({ institutionKey: 'chase', status: 'ok', filed: 2, finishedAt: '2026-10-04T12:01:30.000Z', message: null });
  });

  it('refuses keys, statuses and counts it would have to trust', () => {
    expect(() => parseFetchRun({ ...run, institutionKey: 'Chase Bank' }, now)).toThrow(FetchRunError);
    expect(() => parseFetchRun({ ...run, status: 'great' }, now)).toThrow(/status/);
    expect(() => parseFetchRun({ ...run, filed: -1 }, now)).toThrow(/filed/);
    expect(() => parseFetchRun({ ...run, filed: 1.5 }, now)).toThrow(/filed/);
    expect(() => parseFetchRun({ ...run, finishedAt: '2026-10-04T11:00:00Z' }, now)).toThrow(/before/);
    expect(() => parseFetchRun({ ...run, finishedAt: '2026-10-05T00:00:00Z' }, now)).toThrow(/future/);
    expect(() => parseFetchRun([run], now)).toThrow(/object/);
  });

  it('trims the message to 500 characters', () => {
    expect(parseFetchRun({ ...run, message: 'x'.repeat(900) }, now).message).toHaveLength(500);
  });
});

describe('coverage', () => {
  it('files a statement under the month it closed in', () => {
    expect(closingMonth('2026-09-01')).toBe('2026-08');
    expect(closingMonth('2026-08-16')).toBe('2026-08');
  });

  it('lists the window oldest first, across a year boundary', () => {
    expect(recentMonths(3, new Date('2026-02-10T00:00:00Z'))).toEqual(['2025-12', '2026-01', '2026-02']);
  });

  it('marks have, missing, and the current month open', () => {
    const accounts = [{ id: 'a1', name: 'SAPPHIRE (6496)', org_name: 'Chase', org_domain: 'chase.com' }];
    const statements = [
      { id: 's-aug', account_id: 'a1', period_end: '2026-08-16' },
      { id: 's-other', account_id: 'zz', period_end: '2026-07-16' },
    ];
    const [coverage] = buildStatementCoverage(accounts, statements, { months: 3, now: new Date('2026-10-04T00:00:00Z') });
    expect(coverage).toMatchObject({ institutionKey: 'chase', missing: 1 });
    expect(coverage!.months).toEqual([
      { month: '2026-08', statementId: 's-aug', state: 'have' },
      { month: '2026-09', statementId: null, state: 'missing' },
      { month: '2026-10', statementId: null, state: 'open' },
    ]);
  });
});

describe('latestByInstitution', () => {
  it('keeps the newest run per bank', () => {
    const runs = [
      { id: '3', institution_key: 'chase' },
      { id: '2', institution_key: 'citi' },
      { id: '1', institution_key: 'chase' },
    ];
    expect(latestByInstitution(runs).map((r) => r.id)).toEqual(['3', '2']);
  });
});
