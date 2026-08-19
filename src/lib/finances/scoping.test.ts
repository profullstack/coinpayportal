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
    const rows = () => fixtures[table] ?? [];

    builder.select = chain;
    builder.order = chain;
    builder.update = chain;
    builder.delete = chain;
    builder.insert = chain;
    builder.range = chain;
    builder.limit = chain;
    builder.gte = chain;
    builder.lte = chain;
    builder.is = chain;
    builder.or = chain;
    builder.eq = (col: string, val: unknown) => {
      record.filters[col] = val;
      return builder;
    };
    builder.in = (col: string, vals: unknown[]) => {
      record.filters[col] = vals;
      return builder;
    };
    // `.single()` resolves to one row, or a not-found error when there is none
    // — which is exactly what a scoped lookup of someone else's row returns.
    builder.single = () => ({
      then: (resolve: (v: unknown) => unknown) =>
        resolve(
          rows().length > 0
            ? { data: rows()[0], error: null }
            : { data: null, error: { message: 'No rows found' } },
        ),
    });
    // Awaiting the builder resolves to the fixture for this table.
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: rows(), error: null, count: rows().length });

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
const ATTACKER = 'merchant-ccc';

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

/**
 * Write-side scoping. Both of these guard a bug that was real: filtering a
 * mutation on the row id alone lets any caller who can guess a uuid act on
 * somebody else's connection.
 */
describe('write scoping', () => {
  it('deletes only within the caller’s own connections', async () => {
    supabaseMock = makeSupabase({ finance_connections: [] });
    const { deleteConnection } = await import('./sync');

    await deleteConnection('conn-belonging-to-someone-else', ATTACKER);

    const del = supabaseMock.calls.find((c) => c.table === 'finance_connections');
    expect(del?.filters.id).toBe('conn-belonging-to-someone-else');
    // Without this the delete would cascade away a stranger's accounts and
    // their entire transaction history.
    expect(del?.filters.merchant_id).toBe(ATTACKER);
  });

  it('stamps a sync failure only on a connection the caller owns', async () => {
    // An empty connection lookup is what passing someone else's id produces,
    // and it sends syncConnection straight into its failure path — which
    // writes last_sync_error.
    supabaseMock = makeSupabase({ finance_connections: [] });
    const { syncConnection } = await import('./sync');

    await expect(syncConnection('conn-not-mine', ATTACKER)).rejects.toThrow(/not found/i);

    const writes = supabaseMock.calls.filter(
      (c) => c.table === 'finance_connections' && 'id' in c.filters,
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write.filters.merchant_id).toBe(ATTACKER);
    }
  });
});
