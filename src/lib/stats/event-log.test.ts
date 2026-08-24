import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The scoping contract is the security boundary for `/dashboard/logs`: a
 * merchant with no businesses must read nothing, and a merchant with
 * businesses must always have an `in('business_id', …)` applied.
 */

const calls: { table: string; filters: string[] }[] = [];

function makeQuery(table: string, rows: any[]) {
  const record = { table, filters: [] as string[] };
  calls.push(record);

  const query: any = {
    select: () => query,
    eq: (col: string) => {
      record.filters.push(`eq:${col}`);
      return query;
    },
    in: (col: string) => {
      record.filters.push(`in:${col}`);
      return query;
    },
    or: () => {
      record.filters.push('or');
      return query;
    },
    order: () => query,
    limit: () => query,
    then: (resolve: any) => resolve({ data: rows, error: null }),
  };
  return query;
}

const supabaseRows: Record<string, any[]> = {};

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => makeQuery(table, supabaseRows[table] ?? []),
  }),
}));

import { getEventLog } from './event-log';

beforeEach(() => {
  calls.length = 0;
  supabaseRows.fraud_events = [];
  supabaseRows.businesses = [];
});

describe('getEventLog scoping', () => {
  it('returns nothing and issues no query when the caller owns no businesses', async () => {
    const result = await getEventLog({ businessIds: [] });

    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    // The important part: it never fell through to an unfiltered read.
    expect(calls).toHaveLength(0);
  });

  it('constrains every fraud_events read by business_id when scoped', async () => {
    await getEventLog({ businessIds: ['biz-1', 'biz-2'] });

    const fraudReads = calls.filter((c) => c.table === 'fraud_events');
    expect(fraudReads.length).toBeGreaterThan(0);
    for (const read of fraudReads) {
      expect(read.filters).toContain('in:business_id');
    }
  });

  it('does not constrain by business_id for the platform-wide admin view', async () => {
    await getEventLog({ businessIds: null });

    const fraudReads = calls.filter((c) => c.table === 'fraud_events');
    expect(fraudReads.length).toBeGreaterThan(0);
    for (const read of fraudReads) {
      expect(read.filters).not.toContain('in:business_id');
    }
  });
});

describe('getEventLog row mapping', () => {
  beforeEach(() => {
    supabaseRows.fraud_events = [
      {
        id: 'e1',
        business_id: 'biz-1',
        kind: 'checkout_screen',
        decision: 'allow',
        score: 10,
        email: 'buyer@example.com',
        email_domain: 'example.com',
        ip: '203.0.113.9',
        amount: 25,
        currency: 'usd',
        description: 'Invoice #1',
        findings: [{ code: 'no-email', label: 'No buyer email supplied', score: 10 }],
        created_at: '2026-08-23T10:00:00.000Z',
      },
    ];
  });

  it('withholds the buyer IP unless the caller asked for it', async () => {
    const scoped = await getEventLog({ businessIds: ['biz-1'], includeIp: false });
    expect(scoped.rows[0].ip).toBeNull();

    calls.length = 0;
    const admin = await getEventLog({ businessIds: null, includeIp: true });
    expect(admin.rows[0].ip).toBe('203.0.113.9');
  });

  it('keeps fraud_events.amount in major units', async () => {
    const result = await getEventLog({ businessIds: null });
    // 25 means $25 here, unlike stripe_transactions.amount which is cents.
    expect(result.rows[0].amount).toBe(25);
  });

  it('normalises findings and drops malformed entries', async () => {
    supabaseRows.fraud_events[0].findings = [
      { code: 'velocity', label: 'Too many attempts', score: 30 },
      'not-an-object',
      null,
    ];

    const result = await getEventLog({ businessIds: null });
    expect(result.rows[0].findings).toEqual([
      { code: 'velocity', label: 'Too many attempts', score: 30 },
    ]);
  });

  it('tolerates a non-array findings value', async () => {
    supabaseRows.fraud_events[0].findings = { code: 'oops' };

    const result = await getEventLog({ businessIds: null });
    expect(result.rows[0].findings).toEqual([]);
  });
});
