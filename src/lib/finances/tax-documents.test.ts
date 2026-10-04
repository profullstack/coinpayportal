import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tax documents into the library (createDocument with source/tax fields and
 * sha256 dedupe) and the server's attempt ledger for tax sources.
 */

vi.mock('server-only', () => ({}));

const db = vi.hoisted(() => ({
  existing: null as Record<string, unknown> | null,
  inserted: [] as Array<Record<string, unknown>>,
  attempts: [] as Array<Record<string, unknown>>,
}));

function documentsTable() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: self,
    eq: self,
    order: self,
    limit: self,
    maybeSingle: async () => ({ data: db.existing, error: null }),
    insert: (row: Record<string, unknown>) => {
      db.inserted.push(row);
      return { select: () => ({ single: async () => ({ data: { id: 'doc-new', ...row, created_at: '2026-10-04T00:00:00Z' }, error: null }) }) };
    },
  });
  return chain;
}

function attemptsTable() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: self,
    eq: self,
    gte: self,
    order: self,
    limit: async () => ({ data: db.attempts, error: null }),
    insert: async (row: Record<string, unknown>) => {
      db.attempts.push({ ...row, created_at: row.created_at ?? new Date().toISOString(), locked_until: row.locked_until ?? null, note: row.note ?? null });
      return { error: null };
    },
  });
  return chain;
}

vi.mock('../supabase/server', () => ({
  getSupabaseAdmin: () => ({ from: (table: string) => (table === 'finance_site_attempts' ? attemptsTable() : documentsTable()) }),
}));
vi.mock('./files', () => ({
  putObject: vi.fn(async (_kind: string, merchant: string, bytes: Buffer) => ({ objectKey: `documents/${merchant}/obj`, bytes: bytes.length, sha256: 'sha-of-bytes', keyVersion: 1 })),
  getObject: vi.fn(),
  deleteObject: vi.fn(async () => undefined),
  sha256Hex: vi.fn(() => 'sha-of-bytes'),
}));
vi.mock('./audit', () => ({ audit: vi.fn(async () => undefined) }));
vi.mock('./cloud-browser', () => ({ loadEngine: () => import('../../../packages/sdk/src/statements-fetch.js') }));

import { createDocument, taxFields } from './documents';
import { checkSiteThrottle, ledgerFromRows, takeSiteAttempt, recordSiteLockout, lockoutWatcher } from './site-attempts';
import { institutionKey } from './statement-fetch';

const pdf = Buffer.from('%PDF-1.7\nfake notice');

beforeEach(() => {
  db.existing = null;
  db.inserted = [];
  db.attempts = [];
});

describe('filing a tax document', () => {
  it('stores the source, the agency key, tax year and type', async () => {
    const doc = await createDocument({
      merchantId: 'm-1', uploadedBy: 'm-1', title: 'Notice of Proposed Assessment', category: 'tax', periodLabel: '2023',
      filename: 'notice.pdf', declaredType: 'application/pdf', bytes: pdf, source: 'cloud', institutionKey: 'ftb', taxYear: 2023, docType: 'notice', dedupe: true,
    });
    expect(doc.duplicate).toBeUndefined();
    expect(db.inserted[0]).toMatchObject({ category: 'tax', source: 'cloud', institution_key: 'ftb', tax_year: 2023, doc_type: 'notice', period_label: '2023' });
  });

  it('returns the stored copy instead of keeping the same file twice', async () => {
    db.existing = { id: 'doc-old', title: 'Earlier copy', sha256: 'sha-of-bytes' };
    const doc = await createDocument({ merchantId: 'm-1', uploadedBy: 'm-1', title: 'Again', category: 'tax', filename: 'n.pdf', declaredType: 'application/pdf', bytes: pdf, source: 'fetch', dedupe: true });
    expect(doc).toMatchObject({ id: 'doc-old', duplicate: true });
    expect(db.inserted).toHaveLength(0);
  });

  it('normalises the optional tax fields and refuses unknown sources', async () => {
    expect(taxFields({ institutionKey: 'irs-business', taxYear: '2024', docType: 'transcript' })).toEqual({ institution_key: 'irs-business', tax_year: 2024, doc_type: 'transcript' });
    expect(taxFields({ institutionKey: 'IRS!', taxYear: '24', docType: 'secret' })).toEqual({ institution_key: null, tax_year: null, doc_type: null });
    await createDocument({ merchantId: 'm-1', uploadedBy: 'm-1', title: 'x', filename: 'x.pdf', declaredType: 'application/pdf', bytes: pdf, source: 'bogus' as never });
    expect(db.inserted[0].source).toBe('upload');
  });
});

describe('the server attempt ledger', () => {
  it('folds rows into visits and the latest lockout', () => {
    expect(ledgerFromRows([
      { kind: 'connect', locked_until: null, note: null, created_at: '2026-10-04T10:00:00Z' },
      { kind: 'lockout', locked_until: '2026-10-04T11:00:00Z', note: 'a', created_at: '2026-10-04T10:25:00Z' },
      { kind: 'lockout', locked_until: '2026-10-04T10:40:00Z', note: 'b', created_at: '2026-10-04T10:05:00Z' },
    ])).toEqual({ attempts: ['2026-10-04T10:00:00Z'], lockedUntil: '2026-10-04T11:00:00Z', lockReason: 'a' });
  });

  it('allows two visits per 30 minutes, then refuses without recording', async () => {
    const now = new Date('2026-10-04T12:00:00Z');
    expect((await takeSiteAttempt('m-1', 'ftb', 'connect', now)).ok).toBe(true);
    expect((await takeSiteAttempt('m-1', 'ftb', 'fetch', new Date(now.getTime() + 60_000))).ok).toBe(true);
    const third = await takeSiteAttempt('m-1', 'ftb', 'fetch', new Date(now.getTime() + 120_000));
    expect(third).toMatchObject({ ok: false, reason: 'window_limit' });
    expect(db.attempts).toHaveLength(2);
  });

  it('refuses during a recorded lockout, and the live watcher records one', async () => {
    await recordSiteLockout('m-1', 'ftb', new Date(Date.now() + 35 * 60_000).toISOString(), 'lockout page');
    expect(await checkSiteThrottle('m-1', 'ftb')).toMatchObject({ ok: false, reason: 'locked' });
    db.attempts = [];
    const watch = await lockoutWatcher('m-1', 'ftb', 35);
    watch('Your notices');
    expect(db.attempts).toHaveLength(0);
    watch('Account Locked. You have exceeded the allowed number of attempts. Try again in 30 minutes.');
    watch('Account Locked. You have exceeded the allowed number of attempts. Try again in 30 minutes.');
    await new Promise((r) => setTimeout(r, 10));
    expect(db.attempts).toEqual([expect.objectContaining({ kind: 'lockout', institution_key: 'ftb' })]);
  });

  it('throttles banks too, not only tax sources', async () => {
    // The connect route now takes an attempt for every institution, so a bank
    // key hits the same visit cap a credit union needs to avoid being locked.
    const now = new Date('2026-10-04T12:00:00Z');
    expect((await takeSiteAttempt('m-1', 'alliant', 'connect', now)).ok).toBe(true);
    expect((await takeSiteAttempt('m-1', 'alliant', 'connect', new Date(now.getTime() + 60_000))).ok).toBe(true);
    const third = await takeSiteAttempt('m-1', 'alliant', 'connect', new Date(now.getTime() + 120_000));
    expect(third).toMatchObject({ ok: false, reason: 'window_limit' });
    expect(db.attempts).toHaveLength(2);
  });

  it('reports a recorded bank lockout as locked', async () => {
    await recordSiteLockout('m-1', 'alliant', new Date(Date.now() + 30 * 60_000).toISOString(), 'bank lockout page');
    expect(await checkSiteThrottle('m-1', 'alliant')).toMatchObject({ ok: false, reason: 'locked' });
  });
});

describe('server institution keys for agencies', () => {
  it('match the CLI', () => {
    expect(institutionKey('webapp.ftb.ca.gov', null)).toBe('ftb');
    expect(institutionKey('sa.www4.irs.gov', null)).toBe('irs');
  });
});
