import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

/** A tiny table store that really applies eq / neq / in, so the filters are what is tested. */
let tables: Record<string, Record<string, unknown>[]> = {};
function from(table: string) {
  const preds: Array<(row: Record<string, unknown>) => boolean> = [];
  const rows = () => (tables[table] ?? []).filter((row) => preds.every((p) => p(row)));
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => (preds.push((r) => r[col] === val), builder),
    neq: (col: string, val: unknown) => (preds.push((r) => r[col] !== val), builder),
    in: (col: string, vals: unknown[]) => (preds.push((r) => vals.includes(r[col])), builder),
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null }),
  };
  return builder;
}
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => ({ from }) }));
vi.mock('../supabase/server', () => ({ getSupabaseAdmin: () => ({ from }) }));

import { accountsLinkedElsewhere } from './sync';

const conn = (id: string, created_at: string, extra: Record<string, unknown> = {}) => ({
  id, created_at, merchant_id: 'm1', provider: 'simplefin', is_active: true, lifecycle_state: 'active', ...extra,
});
const set = (...ids: string[]) => ({ accounts: ids.map((id) => ({ id })) }) as never;

describe('accountsLinkedElsewhere', () => {
  beforeEach(() => {
    tables = {
      finance_connections: [conn('old', '2026-08-19T00:00:00Z'), conn('new', '2026-10-04T00:00:00Z')],
      finance_accounts: [
        { connection_id: 'old', external_id: 'ACT-1' },
        { connection_id: 'old', external_id: 'ACT-2' },
        { connection_id: 'new', external_id: 'ACT-1' },
      ],
    };
  });

  it('skips, on the newer connection, accounts an older one already holds', async () => {
    const taken = await accountsLinkedElsewhere({ connectionId: 'new', merchantId: 'm1', provider: 'simplefin', set: set('ACT-1', 'ACT-2', 'ACT-3') });
    expect([...taken].sort()).toEqual(['ACT-1', 'ACT-2']);
  });

  it('never skips on the older connection, so the two cannot starve each other', async () => {
    const taken = await accountsLinkedElsewhere({ connectionId: 'old', merchantId: 'm1', provider: 'simplefin', set: set('ACT-1', 'ACT-2') });
    expect(taken.size).toBe(0);
  });

  it('ignores disconnected connections, other providers and other merchants', async () => {
    tables.finance_connections = [
      conn('gone', '2026-01-01T00:00:00Z', { lifecycle_state: 'disconnected' }),
      conn('plaid', '2026-01-01T00:00:00Z', { provider: 'plaid' }),
      conn('theirs', '2026-01-01T00:00:00Z', { merchant_id: 'm2' }),
      conn('new', '2026-10-04T00:00:00Z'),
    ];
    tables.finance_accounts = ['gone', 'plaid', 'theirs'].map((c) => ({ connection_id: c, external_id: 'ACT-1' }));
    const taken = await accountsLinkedElsewhere({ connectionId: 'new', merchantId: 'm1', provider: 'simplefin', set: set('ACT-1') });
    expect(taken.size).toBe(0);
  });
});
