import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * Tenant scoping for /finances.
 *
 * These tables hold people's bank balances and the app — not RLS — is what
 * keeps one merchant out of another's. CoinPay authenticates with its own JWT
 * rather than Supabase Auth, so `auth.uid()` is null and a policy written
 * against it would be worse than none. That makes the scoping in `summary.ts`
 * load-bearing, and worth testing directly.
 */

/** Records every table touched and the filters applied, then returns fixtures. */
function makeSupabase(fixtures: Record<string, unknown[]>) {
  const calls: Array<{ table: string; filters: Record<string, unknown> }> = [];

  const from = (table: string) => {
    const record = { table, filters: {} as Record<string, unknown> };
    calls.push(record);

    const builder: Record<string, unknown> = {};
    const chain = () => builder;

    builder.select = chain;
    builder.order = chain;
    builder.eq = (col: string, val: unknown) => {
      record.filters[col] = val;
      return builder;
    };
    builder.in = (col: string, vals: unknown[]) => {
      record.filters[col] = vals;
      return builder;
    };
    // Awaiting the builder resolves to the fixture for this table.
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: fixtures[table] ?? [], error: null, count: (fixtures[table] ?? []).length });

    return builder;
  };

  return { client: { from }, calls };
}

let supabaseMock: ReturnType<typeof makeSupabase>;

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseAdmin: () => supabaseMock.client,
}));

const { listAccounts, merchantOwnsAccount } = await import('./summary');

const MERCHANT = 'merchant-aaa';
const OTHER = 'merchant-bbb';

describe('listAccounts scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves connections by merchant before reading any account', async () => {
    supabaseMock = makeSupabase({
      finance_connections: [{ id: 'conn-1' }],
      finance_accounts: [
        {
          id: 'acc-1',
          connection_id: 'conn-1',
          name: 'Checking',
          currency: 'USD',
          balance: 10,
          kind: 'checking',
          is_hidden: false,
        },
      ],
    });

    const accounts = await listAccounts(MERCHANT);

    expect(accounts).toHaveLength(1);

    const connectionQuery = supabaseMock.calls.find((c) => c.table === 'finance_connections');
    expect(connectionQuery?.filters.merchant_id).toBe(MERCHANT);

    // Accounts are reached only through the ids that query returned.
    const accountQuery = supabaseMock.calls.find((c) => c.table === 'finance_accounts');
    expect(accountQuery?.filters.connection_id).toEqual(['conn-1']);
  });

  it('returns nothing — and queries nothing — for a merchant with no connections', async () => {
    supabaseMock = makeSupabase({ finance_connections: [], finance_accounts: [] });

    const accounts = await listAccounts(OTHER);

    expect(accounts).toEqual([]);
    // The bug this guards: `.in('connection_id', [])` is not "match nothing" in
    // every query builder, and a filter that silently drops would return every
    // account on the platform. The query must not be issued at all.
    expect(supabaseMock.calls.some((c) => c.table === 'finance_accounts')).toBe(false);
  });
});

describe('merchantOwnsAccount', () => {
  it('confirms ownership through the connection', async () => {
    supabaseMock = makeSupabase({
      finance_connections: [{ id: 'conn-1' }],
      finance_accounts: [{ id: 'acc-1' }],
    });

    await expect(merchantOwnsAccount('acc-1', MERCHANT)).resolves.toBe(true);

    const accountQuery = supabaseMock.calls.find((c) => c.table === 'finance_accounts');
    expect(accountQuery?.filters.id).toBe('acc-1');
    expect(accountQuery?.filters.connection_id).toEqual(['conn-1']);
  });

  it('denies a merchant with no connections without querying accounts', async () => {
    supabaseMock = makeSupabase({ finance_connections: [], finance_accounts: [{ id: 'acc-1' }] });

    await expect(merchantOwnsAccount('acc-1', OTHER)).resolves.toBe(false);
    expect(supabaseMock.calls.some((c) => c.table === 'finance_accounts')).toBe(false);
  });
});
