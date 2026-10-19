import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * The daily summary on by default: who gets it, that it only ever goes to the
 * merchant's own address, that the backfill is idempotent, and that an
 * unsubscribe sticks through the backfill and through linking another bank.
 */

type Row = Record<string, unknown>;

/** A tiny in-memory PostgREST: enough of select/eq/neq/in/upsert/update/delete for these modules. */
function makeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const conflictKeys: Record<string, string[]> = {
    finance_email_schedules: ['merchant_id', 'kind'],
    finance_email_preferences: ['merchant_id'],
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
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => db.client }));
vi.mock('./audit', () => ({ audit: async () => {} }));

const subs = await import('./daily-subscriptions');
const { deleteSchedule, upsertSchedule } = await import('./schedules');

const A = 'merchant-aaa';
const B = 'merchant-bbb';
const C = 'merchant-ccc';
const NOW = new Date('2026-10-17T12:00:00.000Z');

function seed() {
  return makeDb({
    merchants: [
      { id: A, email: 'Alice@Example.com' },
      { id: B, email: 'bob@example.com' },
      { id: C, email: 'carol@example.com' },
    ],
    finance_connections: [
      { id: 'c1', merchant_id: A, lifecycle_state: 'active' },
      { id: 'c2', merchant_id: A, lifecycle_state: 'active' },
      { id: 'c3', merchant_id: B, lifecycle_state: 'active' },
      // Carol linked once and disconnected: nothing to say.
      { id: 'c4', merchant_id: C, lifecycle_state: 'disconnected' },
    ],
    finance_settings: [{ merchant_id: B, timezone: 'America/New_York' }],
    finance_email_schedules: [],
    finance_email_preferences: [],
  });
}

const daily = () => db.tables.finance_email_schedules.filter((r) => r.kind === 'daily_summary');

beforeEach(() => {
  db = seed();
});

describe('default subscription', () => {
  it('subscribes every merchant with a live connection, to their own address only, in their timezone or Pacific', async () => {
    const result = await subs.backfillDailySummaries({ now: NOW });
    expect(result).toEqual({ considered: 2, created: 2 });
    const byMerchant = Object.fromEntries(daily().map((r) => [r.merchant_id, r]));
    expect(Object.keys(byMerchant).sort()).toEqual([A, B]);
    expect(byMerchant[A].recipients).toEqual(['alice@example.com']);
    expect(byMerchant[B].recipients).toEqual(['bob@example.com']);
    expect(byMerchant[A].timezone).toBe('America/Los_Angeles');
    expect(byMerchant[B].timezone).toBe('America/New_York');
    expect(byMerchant[A].hour).toBe(7);
    expect(byMerchant[A].scope).toBe('all');
    // 12:00Z is 05:00 PDT, so the first run is 07:00 PDT today.
    expect(byMerchant[A].next_run_at).toBe('2026-10-17T14:00:00.000Z');
  });

  it('is idempotent and never overwrites a schedule the owner already has', async () => {
    db.tables.finance_email_schedules.push({ id: 'own', merchant_id: A, kind: 'daily_summary', recipients: ['alice@example.com', 'cpa@example.com'], hour: 9, timezone: 'Europe/Berlin', active: true });
    expect((await subs.backfillDailySummaries({ now: NOW })).created).toBe(1);
    expect((await subs.backfillDailySummaries({ now: NOW })).created).toBe(0);
    expect(daily().length).toBe(2);
    const own = daily().find((r) => r.merchant_id === A)!;
    expect(own.hour).toBe(9);
    expect(own.recipients).toEqual(['alice@example.com', 'cpa@example.com']);
  });

  it('linking a first connection subscribes that merchant and nobody else', async () => {
    expect(await subs.ensureDefaultDailySummary(B)).toBe(true);
    expect(daily().map((r) => r.merchant_id)).toEqual([B]);
    expect(daily()[0].recipients).toEqual(['bob@example.com']);
    expect(await subs.ensureDefaultDailySummary(B)).toBe(false);
    expect(await subs.ensureDefaultDailySummary(C)).toBe(false);
    expect(daily().length).toBe(1);
  });

  it('plans from each merchant’s own row only, skipping bad addresses', () => {
    const rows = subs.planDefaultSubscriptions({
      merchants: [{ id: A, email: 'alice@example.com' }, { id: B, email: 'not-an-email' }, { id: A, email: 'evil@example.com' }],
      connected: new Set([A, B]),
      subscribed: new Set(),
      optedOut: new Set(),
      timezones: new Map([[A, 'Not/AZone']]),
      nextRun: () => NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ merchant_id: A, recipients: ['alice@example.com'], timezone: 'America/Los_Angeles' });
  });

  it('subscribes nobody when the opt-outs cannot be read', async () => {
    const real = db.client.from;
    db.client.from = ((table: string) => {
      const b = real(table) as Record<string, unknown>;
      if (table === 'finance_email_preferences') b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'relation does not exist' } }).then(resolve);
      return b;
    }) as typeof real;
    await expect(subs.backfillDailySummaries({ now: NOW })).rejects.toThrow(/backfill/);
    expect(await subs.ensureDefaultDailySummary(A)).toBe(false);
    expect(daily()).toHaveLength(0);
  });
});

describe('unsubscribe sticks', () => {
  it('the one-click unsubscribe deletes the schedule and nothing re-creates it', async () => {
    await subs.backfillDailySummaries({ now: NOW });
    expect(await subs.unsubscribeDailySummary(A, 'ALICE@example.com')).toBe('unsubscribed');
    expect(daily().map((r) => r.merchant_id)).toEqual([B]);
    expect(await subs.unsubscribeDailySummary(A, 'alice@example.com')).toBe('already');

    // Not by the backfill, not by linking another bank.
    expect((await subs.backfillDailySummaries({ now: NOW })).created).toBe(0);
    db.tables.finance_connections.push({ id: 'c5', merchant_id: A, lifecycle_state: 'active' });
    expect(await subs.ensureDefaultDailySummary(A)).toBe(false);
    expect(daily().map((r) => r.merchant_id)).toEqual([B]);
  });

  it('a second recipient unsubscribing removes only that address', async () => {
    db.tables.finance_email_schedules.push({ id: 's1', merchant_id: A, kind: 'daily_summary', recipients: ['alice@example.com', 'cpa@example.com'], active: true });
    expect(await subs.unsubscribeDailySummary(A, 'cpa@example.com')).toBe('removed_recipient');
    expect(daily()[0].recipients).toEqual(['alice@example.com']);
    // A token for an address that is not on the list changes nothing.
    expect(await subs.unsubscribeDailySummary(A, 'stranger@example.com')).toBe('already');
    expect(db.tables.finance_email_preferences).toHaveLength(0);
  });

  it('`coinpay finances daily off` (DELETE) is an opt-out too; turning it on again clears it', async () => {
    await subs.backfillDailySummaries({ now: NOW });
    expect(await deleteSchedule(A, 'daily_summary')).toBe(true);
    expect((await subs.getEmailPreferences(A))?.daily_summary_opted_out_at).toBeTruthy();
    expect((await subs.backfillDailySummaries({ now: NOW })).created).toBe(0);

    await upsertSchedule(A, { active: true }, { timezone: 'America/Los_Angeles', email: 'alice@example.com' }, 'daily_summary');
    expect((await subs.getEmailPreferences(A))?.daily_summary_opted_out_at).toBeNull();
    expect(daily().filter((r) => r.merchant_id === A)).toHaveLength(1);
  });

  it('a spend target is stored per merchant and validated', async () => {
    await subs.setDailySpendTarget(A, subs.parseSpendTarget('100'));
    expect((await subs.getEmailPreferences(A))?.daily_spend_target).toBe(100);
    expect(await subs.getEmailPreferences(B)).toBeNull();
    expect(subs.parseSpendTarget(null)).toBeNull();
    expect(subs.parseSpendTarget('$42.555')).toBe(42.56);
    expect(() => subs.parseSpendTarget(-1)).toThrow();
    expect(() => subs.parseSpendTarget('lots')).toThrow();
  });
});

describe('weekly digest, the default account report', () => {
  const weekly = () => db.tables.finance_email_schedules.filter((r) => r.kind === 'weekly_digest');

  it('linking a first connection turns on the weekly digest (and the daily summary) for that merchant only', async () => {
    db.tables.merchants.push({ id: 'merchant-new', email: 'new@example.com' });
    db.tables.finance_connections.push({ id: 'c9', merchant_id: 'merchant-new', lifecycle_state: 'active' });
    expect(await subs.ensureDefaultReports('merchant-new')).toEqual({ daily_summary: true, weekly_digest: true });
    expect(weekly()).toHaveLength(1);
    expect(weekly()[0]).toMatchObject({
      merchant_id: 'merchant-new',
      weekdays: [1, 5],
      hour: 8,
      scope: 'all',
      formats: ['pdf', 'csv'],
      recipients: ['new@example.com'],
      timezone: 'America/Los_Angeles',
      active: true,
    });
    // Saturday 2026-10-17 12:00Z: the next slot is Monday 08:00 PDT.
    expect(weekly()[0].next_run_at).toBe('2026-10-19T15:00:00.000Z');
    expect(await subs.ensureDefaultReports('merchant-new')).toEqual({ daily_summary: false, weekly_digest: false });
  });

  it('backfill is idempotent and leaves an existing schedule exactly as it was', async () => {
    const own = { id: 'own-weekly', merchant_id: A, kind: 'weekly_digest', weekdays: [1], hour: 6, timezone: 'America/Los_Angeles', scope: 'business', recipients: ['alice@example.com'], active: true, next_run_at: '2026-10-26T13:00:00.000Z' };
    db.tables.finance_email_schedules.push({ ...own });
    expect(await subs.backfillWeeklyDigests({ now: NOW })).toEqual({ considered: 2, created: 1 });
    expect(await subs.backfillWeeklyDigests({ now: NOW })).toEqual({ considered: 2, created: 0 });
    expect(weekly()).toHaveLength(2);
    expect(weekly().find((r) => r.merchant_id === A)).toEqual(own);
    const bob = weekly().find((r) => r.merchant_id === B)!;
    expect(bob.timezone).toBe('America/New_York');
    expect(bob.next_run_at).toBe('2026-10-19T12:00:00.000Z');
  });

  it('creates nothing for merchants without finance data', async () => {
    db.tables.merchants.push({ id: 'merchant-empty', email: 'empty@example.com' });
    await subs.backfillWeeklyDigests({ now: NOW });
    expect(await subs.ensureDefaultWeeklyDigest('merchant-empty')).toBe(false);
    // Carol only has a disconnected connection.
    expect(await subs.ensureDefaultWeeklyDigest(C)).toBe(false);
    expect(weekly().map((r) => r.merchant_id).sort()).toEqual([A, B]);
  });

  it('turning it off (DELETE, the toggle, the email link) is remembered and never undone automatically', async () => {
    await subs.backfillWeeklyDigests({ now: NOW });

    expect(await deleteSchedule(A, 'weekly_digest')).toBe(true);
    expect((await subs.getEmailPreferences(A))?.weekly_digest_opted_out_at).toBeTruthy();
    // The daily summary opt-out is separate.
    expect((await subs.getEmailPreferences(A))?.daily_summary_opted_out_at).toBeNull();

    await upsertSchedule(B, { active: false }, { timezone: 'America/New_York', email: 'bob@example.com' }, 'weekly_digest');
    expect((await subs.getEmailPreferences(B))?.weekly_digest_opted_out_at).toBeTruthy();
    db.tables.finance_email_schedules = db.tables.finance_email_schedules.filter((r) => !(r.merchant_id === B && r.kind === 'weekly_digest'));

    expect((await subs.backfillWeeklyDigests({ now: NOW })).created).toBe(0);
    db.tables.finance_connections.push({ id: 'c6', merchant_id: A, lifecycle_state: 'active' });
    expect((await subs.ensureDefaultReports(A)).weekly_digest).toBe(false);
    expect(weekly()).toHaveLength(0);

    // Only the owner turns it back on.
    await upsertSchedule(A, { active: true }, { timezone: 'America/Los_Angeles', email: 'alice@example.com' }, 'weekly_digest');
    expect((await subs.getEmailPreferences(A))?.weekly_digest_opted_out_at).toBeNull();
    expect(weekly().map((r) => r.merchant_id)).toEqual([A]);
  });

  it('the one-click link turns off only the weekly digest, for that address', async () => {
    await subs.backfillDefaultSchedules('daily_summary', { now: NOW });
    await subs.backfillWeeklyDigests({ now: NOW });
    expect(await subs.unsubscribeSchedule(A, 'weekly_digest', 'alice@example.com')).toBe('unsubscribed');
    expect(await subs.unsubscribeSchedule(A, 'weekly_digest', 'alice@example.com')).toBe('already');
    expect(weekly().map((r) => r.merchant_id)).toEqual([B]);
    expect(daily().map((r) => r.merchant_id).sort()).toEqual([A, B]);
    expect((await subs.backfillWeeklyDigests({ now: NOW })).created).toBe(0);
  });
});

describe('weekly payments, the default report without a bank linked', () => {
  const payments = () => db.tables.finance_email_schedules.filter((r) => r.kind === 'weekly_payments');
  const D = 'merchant-ddd';
  const E = 'merchant-eee';
  const F = 'merchant-fff';
  const G = 'merchant-ggg';

  beforeEach(() => {
    db.tables.merchants.push(
      { id: D, email: 'dan@example.com' },
      { id: E, email: 'eve@example.com' },
      { id: F, email: 'fraud@example.com' },
      { id: G, email: 'quiet@example.com' },
    );
    db.tables.businesses = [
      { id: 'b-a', merchant_id: A },
      { id: 'b-d', merchant_id: D },
      { id: 'b-e', merchant_id: E },
      { id: 'b-f', merchant_id: F },
      { id: 'b-g', merchant_id: G },
    ];
    db.tables.payments = [
      // Alice has a bank linked: she gets the weekly digest instead.
      { business_id: 'b-a', status: 'confirmed' },
      { business_id: 'b-d', status: 'forwarded' },
      { business_id: 'b-e', status: 'confirmed' },
      { business_id: 'b-f', status: 'confirmed' },
      // Quiet only ever had expired checkouts.
      { business_id: 'b-g', status: 'expired' },
    ];
    db.tables.invoices = [{ business_id: 'b-g', status: 'draft' }];
    db.tables.merchant_settings = [{ merchant_id: E, email_notifications: false }];
    db.tables.fraud_blocklist = [{ kind: 'merchant', value: F }];
  });

  it('goes to active merchants without a bank, never to quiet, muted or blocklisted ones', async () => {
    expect(await subs.backfillWeeklyPayments({ now: NOW })).toEqual({ considered: 1, created: 1 });
    expect(payments()).toHaveLength(1);
    expect(payments()[0]).toMatchObject({ merchant_id: D, weekdays: [1, 5], hour: 8, recipients: ['dan@example.com'], timezone: 'America/Los_Angeles', formats: ['html'], active: true });
    expect(payments()[0].next_run_at).toBe('2026-10-19T15:00:00.000Z');
  });

  it('a sent invoice counts as activity too', async () => {
    db.tables.invoices.push({ business_id: 'b-g', status: 'sent' });
    await subs.backfillWeeklyPayments({ now: NOW });
    expect(payments().map((r) => r.merchant_id).sort()).toEqual([D, G]);
  });

  it('is idempotent, and turning it off sticks', async () => {
    await subs.backfillWeeklyPayments({ now: NOW });
    expect((await subs.backfillWeeklyPayments({ now: NOW })).created).toBe(0);
    expect(await subs.unsubscribeSchedule(D, 'weekly_payments', 'dan@example.com')).toBe('unsubscribed');
    expect((await subs.getEmailPreferences(D))?.weekly_payments_opted_out_at).toBeTruthy();
    expect((await subs.backfillWeeklyPayments({ now: NOW })).created).toBe(0);
    expect(payments()).toHaveLength(0);
    // The other default reports' opt-outs are untouched.
    expect((await subs.getEmailPreferences(D))?.weekly_digest_opted_out_at).toBeNull();
  });
});
