import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'crypto';

vi.mock('server-only', () => ({}));

/**
 * The opt-in business report and Connect CrawlProof: off by default and never
 * backfilled, a one-click off link in every email, CrawlProof connect and
 * disconnect (read-only tokens only, stored encrypted), the report with and
 * without CrawlProof, and that one merchant never sees another's data.
 */

type Row = Record<string, unknown>;

/** A tiny in-memory PostgREST: enough of select/eq/neq/in/upsert/update/delete for these modules. */
function makeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const conflictKeys: Record<string, string[]> = {
    finance_email_schedules: ['merchant_id', 'kind'],
    finance_email_preferences: ['merchant_id'],
    merchant_crawlproof_connections: ['merchant_id'],
  };
  let nextId = 1;

  const from = (table: string) => {
    tables[table] ??= [];
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'update' | 'delete' | 'upsert' = 'select';
    let patch: Row = {};
    let upserted: Row[] = [];

    const run = (): Row[] => {
      const rows = tables[table];
      if (op === 'upsert') return upserted;
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') for (const r of hit) Object.assign(r, patch);
      if (op === 'delete') tables[table] = rows.filter((r) => !hit.includes(r));
      return hit;
    };

    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.order = () => b;
    b.limit = () => b;
    b.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; };
    b.neq = (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return b; };
    b.in = (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; };
    b.lte = () => b;
    b.gte = () => b;
    b.lt = () => b;
    b.or = () => b;
    b.update = (p: Row) => { op = 'update'; patch = p; return b; };
    b.delete = () => { op = 'delete'; return b; };
    b.insert = (r: Row | Row[]) => { for (const row of [r].flat()) tables[table].push({ ...row }); return b; };
    b.upsert = (input: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => {
      op = 'upsert';
      const keys = opts.onConflict ? opts.onConflict.split(',') : conflictKeys[table] ?? ['id'];
      upserted = [];
      for (const row of [input].flat()) {
        const existing = tables[table].find((r) => keys.every((k) => r[k] === row[k]));
        if (existing) {
          if (opts.ignoreDuplicates) continue;
          Object.assign(existing, row);
          upserted.push(existing);
        } else {
          const created = { id: `row-${nextId++}`, ...row };
          tables[table].push(created);
          upserted.push(created);
        }
      }
      return b;
    };
    b.maybeSingle = () => Promise.resolve({ data: run()[0] ?? null, error: null });
    b.single = () => { const r = run(); return Promise.resolve(r[0] ? { data: r[0], error: null } : { data: null, error: { message: 'No rows' } }); };
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(resolve, reject);
    return b;
  };
  return { client: { from }, tables };
}

let db: ReturnType<typeof makeDb>;
const sent: Array<{ to: string; subject: string; html: string; headers?: Record<string, string> }> = [];
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => db.client }));
vi.mock('./audit', () => ({ audit: async () => {} }));
vi.mock('@/lib/email', () => ({
  sendEmail: async (m: { to: string; subject: string; html: string; headers?: Record<string, string> }) => {
    sent.push(m);
    return { success: true };
  },
}));

process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
process.env.NEXT_PUBLIC_APP_URL = 'https://coinpayportal.test';

const subs = await import('./daily-subscriptions');
const { upsertSchedule, deleteSchedule, getSchedule, OPT_IN_KINDS } = await import('./schedules');
const biz = await import('./business-report');
const cp = await import('../integrations/crawlproof');
const { verifyUnsubscribe } = await import('./unsubscribe-token');

const A = 'merchant-aaa';
const B = 'merchant-bbb';
const TOKEN_A = `crp_${'a'.repeat(43)}`;
const TOKEN_B = `crp_${'b'.repeat(43)}`;
const NOW = new Date('2026-10-19T12:00:00.000Z');

function report(scope: string | null, sites = [{ id: 's1', name: 'alice.example', url: 'https://alice.example/' }]) {
  return {
    range: '1w',
    generated_at: NOW.toISOString(),
    truncated: 0,
    token_scope: scope,
    totals: { visitors: 420, pageviews: 900, humans: 1000, bots: 5000, ai: 250 },
    sites: sites.map((s) => ({
      ...s,
      visitors: 420,
      pageviews: 900,
      hits: { humans: 1000, bots: 5000, ai: 250 },
      top_pages: [{ label: '/pricing', value: 120 }],
      top_sources: [{ label: 'google', value: 80 }],
      trend: { first_half: 400, second_half: 600, change_pct: 50 },
    })),
  };
}

/** A fake CrawlProof: each token sees only its own owner's sites. */
const calls: string[] = [];
function fakeCrawlProof({ fail = false, scope = 'stats:read' }: { fail?: boolean; scope?: string | null } = {}): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
    calls.push(auth);
    if (fail) throw new Error('connect ECONNREFUSED');
    if (auth === `Bearer ${TOKEN_A}`) return new Response(JSON.stringify(report(scope)), { status: 200 });
    if (auth === `Bearer ${TOKEN_B}`) return new Response(JSON.stringify(report(scope, [{ id: 's9', name: 'bob.example', url: 'https://bob.example/' }])), { status: 200 });
    return new Response(JSON.stringify({ error: 'Invalid or revoked token.' }), { status: 401 });
  }) as unknown as typeof fetch;
}

function seed() {
  return makeDb({
    merchants: [
      { id: A, email: 'alice@example.com' },
      { id: B, email: 'bob@example.com' },
    ],
    finance_connections: [
      { id: 'c1', merchant_id: A, lifecycle_state: 'active' },
      { id: 'c2', merchant_id: B, lifecycle_state: 'active' },
    ],
    finance_settings: [],
    finance_email_schedules: [],
    finance_email_preferences: [],
    finance_accounts: [],
    businesses: [
      { id: 'biz-a', merchant_id: A },
      { id: 'biz-b', merchant_id: B },
    ],
    payments: [
      { business_id: 'biz-a', status: 'confirmed', amount: '25.00', created_at: '2026-10-14T10:00:00.000Z', confirmed_at: '2026-10-14T10:05:00.000Z' },
      { business_id: 'biz-a', status: 'expired', amount: '9.00', created_at: '2026-10-15T10:00:00.000Z', confirmed_at: null },
      { business_id: 'biz-b', status: 'forwarded', amount: '9999.00', created_at: '2026-10-14T10:00:00.000Z', confirmed_at: '2026-10-14T10:05:00.000Z' },
    ],
    invoices: [
      { business_id: 'biz-a', status: 'paid', amount: '100.00', currency: 'USD', created_at: '2026-10-13T10:00:00.000Z', paid_at: '2026-10-16T10:00:00.000Z' },
      { business_id: 'biz-a', status: 'overdue', amount: '40.00', currency: 'USD', created_at: '2026-09-01T10:00:00.000Z', paid_at: null },
      { business_id: 'biz-b', status: 'sent', amount: '5000.00', currency: 'USD', created_at: '2026-10-14T10:00:00.000Z', paid_at: null },
    ],
    merchant_crawlproof_connections: [],
  });
}

beforeEach(() => {
  db = seed();
  sent.length = 0;
  calls.length = 0;
});

const bizRows = () => db.tables.finance_email_schedules.filter((r) => r.kind === 'business_report');

describe('opt-in, off by default', () => {
  it('is never created by the default-report backfill or by linking a bank', async () => {
    await subs.backfillDefaultSchedules('weekly_digest', { now: NOW });
    await subs.backfillDefaultSchedules('daily_summary', { now: NOW });
    await subs.ensureDefaultReports(A);
    expect(subs.DEFAULT_KINDS).not.toContain('business_report');
    expect(OPT_IN_KINDS).toEqual(['business_report', 'goals_digest']);
    expect(bizRows()).toEqual([]);
    expect(await getSchedule(A, 'business_report')).toBeNull();
  });

  it('turning it on gives Monday 08:00, business scope, to the owner only; off deletes it and records no opt-out', async () => {
    const row = await upsertSchedule(A, { active: true, timezone: 'America/Los_Angeles' }, { timezone: 'UTC', email: 'alice@example.com' }, 'business_report');
    expect(row).toMatchObject({ kind: 'business_report', weekdays: [1], hour: 8, scope: 'business', recipients: ['alice@example.com'], active: true });
    expect(await deleteSchedule(A, 'business_report')).toBe(true);
    expect(bizRows()).toEqual([]);
    expect(db.tables.finance_email_preferences).toEqual([]);
    // And the backfill still does not bring it back.
    await subs.backfillDefaultSchedules('weekly_digest', { now: NOW });
    expect(bizRows()).toEqual([]);
  });
});

describe('one-click off link', () => {
  it('every email carries a signed per-recipient link and List-Unsubscribe headers', async () => {
    await upsertSchedule(A, { active: true, recipients: ['alice@example.com', 'cpa@example.com'] }, { timezone: 'UTC', email: 'alice@example.com' }, 'business_report');
    const schedule = (await getSchedule(A, 'business_report'))!;
    const out = await biz.sendBusinessReport(schedule, NOW);
    expect(out.sent).toEqual(['alice@example.com', 'cpa@example.com']);
    for (const mail of sent) {
      const url = mail.headers!['List-Unsubscribe'].slice(1, -1);
      expect(mail.headers!['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(mail.html).toContain('Turn off business report');
      const claim = verifyUnsubscribe(new URL(url).searchParams.get('t'));
      expect(claim).toEqual({ merchantId: A, kind: 'business_report', email: mail.to });
    }
  });

  it('the link removes that address, then the last one deletes the report; a second click is a no-op', async () => {
    await upsertSchedule(A, { active: true, recipients: ['alice@example.com', 'cpa@example.com'] }, { timezone: 'UTC', email: 'alice@example.com' }, 'business_report');
    expect(await subs.unsubscribeSchedule(A, 'business_report', 'cpa@example.com')).toBe('removed_recipient');
    expect(bizRows()[0].recipients).toEqual(['alice@example.com']);
    expect(await subs.unsubscribeSchedule(A, 'business_report', 'alice@example.com')).toBe('unsubscribed');
    expect(bizRows()).toEqual([]);
    expect(await subs.unsubscribeSchedule(A, 'business_report', 'alice@example.com')).toBe('already');
    expect(db.tables.finance_email_preferences).toEqual([]);
  });
});

describe('Connect CrawlProof', () => {
  // The token is sealed to the merchant's secrets vault (2026-10-28): both
  // merchants have one, A is unlocked.
  const vaults: Record<string, { record: unknown; dek: Uint8Array }> = {};
  beforeEach(async () => {
    const sv = await import('../vault/sealed-vault');
    const svc = await import('../vault/vault-service');
    const { resetUnlockStore } = await import('../vault/unlock-store');
    resetUnlockStore();
    for (const m of [A, B]) {
      vaults[m] ??= await sv.createVault('correct horse battery', 'merchant', m);
      (db.tables.secret_vaults ??= []).push({ subject_type: 'merchant', subject_id: m, record: vaults[m].record });
    }
    await svc.unlockVault('merchant', A, sv.bytesToBase64(vaults[A].dek), 3600_000);
  });

  it('while locked the report section is skipped with a locked status, and the token is never read', async () => {
    await cp.connectCrawlProof(A, TOKEN_A, fakeCrawlProof());
    const svc = await import('../vault/vault-service');
    svc.lockVault('merchant', A);
    calls.length = 0;
    expect(await cp.loadCrawlProofForMerchant(A, '1w', fakeCrawlProof())).toBeNull();
    expect(calls).toEqual([]);
    expect((await cp.getCrawlProofStatus(A)).lastError).toMatch(/^locked:/);
    expect(db.tables.merchant_crawlproof_connections[0].token_encrypted).toMatch(/^cpv1\./);
  });

  it('refuses anything that is not a crp_ token, and full-access tokens', async () => {
    await expect(cp.connectCrawlProof(A, 'hunter2', fakeCrawlProof())).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(cp.connectCrawlProof(A, TOKEN_A, fakeCrawlProof({ scope: null }))).rejects.toMatchObject({ code: 'crawlproof_token_not_read_only' });
    await expect(cp.connectCrawlProof(A, `crp_${'z'.repeat(43)}`, fakeCrawlProof())).rejects.toMatchObject({ code: 'crawlproof_token_rejected' });
    expect(db.tables.merchant_crawlproof_connections).toEqual([]);
  });

  it('stores a read-only token encrypted, shows only its prefix, and disconnect deletes it', async () => {
    const status = await cp.connectCrawlProof(A, TOKEN_A, fakeCrawlProof());
    expect(status).toMatchObject({ connected: true, tokenPrefix: 'crp_aaaa', sitesCount: 1 });
    const stored = db.tables.merchant_crawlproof_connections[0];
    expect(stored.merchant_id).toBe(A);
    expect(JSON.stringify(stored)).not.toContain(TOKEN_A);
    expect(await cp.disconnectCrawlProof(A)).toBe(true);
    expect((await cp.getCrawlProofStatus(A)).connected).toBe(false);
    expect(await cp.disconnectCrawlProof(A)).toBe(false);
  });

  it('a merchant only ever reads with its own token', async () => {
    await cp.connectCrawlProof(A, TOKEN_A, fakeCrawlProof());
    calls.length = 0;
    expect(await cp.loadCrawlProofForMerchant(B, '1w', fakeCrawlProof())).toBeNull();
    expect(calls).toEqual([]);
    const a = await cp.loadCrawlProofForMerchant(A, '1w', fakeCrawlProof());
    expect(a?.sites.map((s) => s.name)).toEqual(['alice.example']);
    expect(calls).toEqual([`Bearer ${TOKEN_A}`]);
  });

  it('a failed read returns null and records the error instead of throwing', async () => {
    await cp.connectCrawlProof(A, TOKEN_A, fakeCrawlProof());
    expect(await cp.loadCrawlProofForMerchant(A, '1w', fakeCrawlProof({ fail: true }))).toBeNull();
    expect((await cp.getCrawlProofStatus(A)).lastError).toMatch(/did not answer/);
  });
});

describe('the report', () => {
  const activity = () =>
    biz.summarizeActivity({
      businesses: 1,
      payments: db.tables.payments.filter((p) => p.business_id === 'biz-a') as never,
      invoices: db.tables.invoices.filter((p) => p.business_id === 'biz-a') as never,
      outstanding: db.tables.invoices.filter((p) => p.business_id === 'biz-a') as never,
      start: '2026-10-12T07:00:00.000Z',
      end: '2026-10-19T07:00:00.000Z',
    });

  it('sums only settled payments as USD, and counts invoices issued, paid and outstanding', () => {
    expect(activity()).toEqual({
      businesses: 1,
      payments: { settled: 1, settledUsd: 25, created: 2, expired: 1 },
      invoices: { issued: 1, paid: 1, paidTotals: [{ currency: 'USD', amount: 100 }], outstanding: 1, overdue: 1, outstandingTotals: [{ currency: 'USD', amount: 40 }] },
    });
  });

  const input = (crawlproof: ReturnType<typeof cp.parseCrawlProofReport> | null, connected: boolean) => ({
    label: '2026-10-12 to 2026-10-18',
    appUrl: 'https://coinpayportal.test',
    activity: activity(),
    books: null,
    crawlproof,
    crawlproofConnected: connected,
    unsubscribeUrl: 'https://coinpayportal.test/api/finances/unsubscribe?t=x',
    settingsUrl: 'https://coinpayportal.test/finances/books#business-report',
  });

  it('with CrawlProof: a website section with visitors, bots, AI hits, top pages and trend', () => {
    const html = biz.renderBusinessReportHtml(input(cp.parseCrawlProofReport(report('stats:read')), true));
    expect(html).toContain('Website (CrawlProof)');
    expect(html).toContain('alice.example');
    expect(html).toContain('/pricing');
    expect(html).toContain('+50%');
    expect(html).not.toContain('connect CrawlProof');
  });

  it('without CrawlProof: no website section, a connect hint instead; connected but failed says so', () => {
    const off = biz.renderBusinessReportHtml(input(null, false));
    expect(off).not.toContain('Website (CrawlProof)');
    expect(off).toContain('connect CrawlProof');
    const failed = biz.renderBusinessReportHtml(input(null, true));
    expect(failed).not.toContain('Website (CrawlProof)');
    expect(failed).toContain('could not be read');
  });

  it('escapes whatever CrawlProof sends back', () => {
    const r = report('stats:read', [{ id: 's1', name: '<script>x</script>', url: 'https://x/' }]);
    expect(biz.renderBusinessReportHtml(input(cp.parseCrawlProofReport(r), true))).not.toContain('<script>');
  });

  it('a merchant\'s report never includes another merchant\'s payments or invoices', async () => {
    const a = await biz.loadCoinPayActivity(A, '2026-10-12T07:00:00.000Z', '2026-10-19T07:00:00.000Z');
    expect(a.payments.settledUsd).toBe(25);
    expect(a.invoices.outstandingTotals).toEqual([{ currency: 'USD', amount: 40 }]);
  });
});
