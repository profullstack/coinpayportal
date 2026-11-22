import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cancelOrder, createOrder, parseQuoteRequest, quoteAndStore, refreshOrder, submitOrderTx } from './orders';
import { setAdapters } from './router';
import type { ExchangeAdapter } from './types';

/** Just enough of the supabase-js query builder for orders.ts, backed by arrays. */
function fakeSupabase() {
  const tables: Record<string, Record<string, any>[]> = { exchange_quotes: [], exchange_orders: [], exchange_order_events: [] };
  let seq = 0;
  const uniques: Record<string, (r: any) => string | null> = {
    exchange_orders: (r) => `${r.wallet_id}|${r.idempotency_key}`,
    exchange_order_events: (r) => `${r.order_id}|${r.dedupe_key}`,
  };
  const inTx = (r: any) => (r.in_tx_hash ? `${r.provider}|${r.in_tx_hash.toLowerCase()}` : null);

  function builder(table: string) {
    const filters: [string, unknown][] = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: any;
    let wantRows = false;
    const run = (): { data: any; error: any; count?: number } => {
      const rows = tables[table];
      const match = (r: any) => filters.every(([k, v]) => r[k] === v);
      if (op === 'insert') {
        const list = Array.isArray(payload) ? payload : [payload];
        const out = [];
        for (const p of list) {
          const row = { id: p.id ?? `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, created_at: new Date().toISOString(), ...p };
          const key = uniques[table]?.(row);
          if (key && rows.some((r) => uniques[table]!(r) === key)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          rows.push(row);
          out.push(row);
        }
        return { data: wantRows ? (Array.isArray(payload) ? out : out[0]) : null, error: null };
      }
      if (op === 'update') {
        const hits = rows.filter(match);
        for (const r of hits) {
          const next = { ...r, ...payload };
          if (table === 'exchange_orders' && inTx(next) && rows.some((o) => o !== r && inTx(o) === inTx(next))) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_exchange_orders_in_tx"' } };
          }
          Object.assign(r, payload);
        }
        return { data: hits.map((r) => ({ ...r })), error: null };
      }
      return { data: rows.filter(match).map((r) => ({ ...r })), error: null, count: rows.filter(match).length };
    };
    const b: any = {
      select: () => { if (op !== 'select') wantRows = true; return b; },
      insert: (p: any) => { op = 'insert'; payload = p; return b; },
      update: (p: any) => { op = 'update'; payload = p; return b; },
      eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
      order: () => b,
      limit: () => b,
      maybeSingle: async () => { const r = run(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
      single: async () => { const r = run(); const d = Array.isArray(r.data) ? r.data[0] : r.data; return d ? { ...r, data: d } : { data: null, error: r.error ?? { code: 'PGRST116', message: 'no rows' } }; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  }
  return { client: { from: builder } as unknown as SupabaseClient, tables };
}

const DEST = '0x00000000000000000000000000000000000000a1';
const env = process.env;
let db: ReturnType<typeof fakeSupabase>;
let adapter: ExchangeAdapter;

beforeEach(() => {
  process.env = { ...env, EXCHANGE_ENGINE_ENABLED: 'true' };
  db = fakeSupabase();
  adapter = {
    id: 'thorchain',
    label: 'THORChain',
    isConfigured: () => true,
    supports: () => true,
    quote: vi.fn(async (r) => ({
      provider: 'thorchain', from: r.from, to: r.to, amountIn: r.amount, expectedAmountOut: '0.35',
      fees: {}, expiresAt: Date.now() + 600_000, etaSeconds: 600, verification: 'none', warnings: [], route: {},
    })),
    createOrder: vi.fn(async (_q, r) => ({
      providerOrderId: null,
      plan: { kind: 'send_with_memo', chain: r.from, to: 'bc1qvault', amount: r.amount, memo: `=:e:${r.destinationAddress}`, expiresAt: Date.now() + 600_000 },
      details: { memo: `=:e:${r.destinationAddress}` },
    })),
    getStatus: vi.fn(),
  } as ExchangeAdapter;
  setAdapters([adapter]);
});
afterEach(() => {
  process.env = env;
  setAdapters(null);
});

async function quoteId() {
  const r = await quoteAndStore(db.client, parseQuoteRequest({ from: 'BTC', to: 'ETH', amount: '0.01' }, null));
  return r.quotes[0].id;
}

describe('parseQuoteRequest', () => {
  it('validates assets, amount and addresses against the right chain', () => {
    expect(() => parseQuoteRequest({ from: 'BTC', to: 'BTC', amount: '1' }, null)).toThrow(/itself/);
    expect(() => parseQuoteRequest({ from: 'BTC', to: 'ETH', amount: '1e3' }, null)).toThrow(/decimal/);
    expect(() => parseQuoteRequest({ from: 'BTC', to: 'ETH', amount: '1', destinationAddress: 'bc1qnotanethaddress' }, null)).toThrow(/valid ETH/);
    expect(parseQuoteRequest({ from: 'btc', to: 'usdc', amount: 0.5 }, 'US')).toMatchObject({ from: 'BTC', to: 'USDC_ETH', amount: '0.5', country: 'US' });
  });
});

describe('createOrder', () => {
  it('creates once per idempotency key and calls the provider once', async () => {
    const id = await quoteId();
    const input = { walletId: 'w1', quoteId: id, idempotencyKey: 'key-00000001', destinationAddress: DEST, country: null };
    const first = await createOrder(db.client, input);
    const again = await createOrder(db.client, input);
    expect(first.replayed).toBe(false);
    expect(first.order.status).toBe('awaiting_user_action');
    expect(first.order.plan).toMatchObject({ kind: 'send_with_memo', memo: `=:e:${DEST}` });
    expect(again).toMatchObject({ replayed: true, order: { id: first.order.id } });
    expect(adapter.createOrder).toHaveBeenCalledTimes(1);
    expect(db.tables.exchange_order_events.map((e) => e.to_status)).toEqual(['created', 'awaiting_user_action']);
  });

  it('rejects a stale quote', async () => {
    const id = await quoteId();
    db.tables.exchange_quotes[0].created_at = new Date(Date.now() - 11 * 60_000).toISOString();
    await expect(createOrder(db.client, { walletId: 'w1', quoteId: id, idempotencyKey: 'key-00000002', destinationAddress: DEST, country: null }))
      .rejects.toMatchObject({ code: 'quote_expired' });
    expect(adapter.createOrder).not.toHaveBeenCalled();
  });

  it('rejects a destination for the wrong chain before calling the provider', async () => {
    const id = await quoteId();
    await expect(createOrder(db.client, { walletId: 'w1', quoteId: id, idempotencyKey: 'key-00000003', destinationAddress: 'bc1q0y356csjsefu3gtqe505he6p40a8dm7kd6ayht', country: null }))
      .rejects.toThrow(/valid ETH/);
    expect(db.tables.exchange_orders).toHaveLength(0);
  });

  it('records a provider failure as a failed order', async () => {
    (adapter.createOrder as any).mockRejectedValueOnce(new Error('THORChain BTC inbound is halted'));
    const id = await quoteId();
    await expect(createOrder(db.client, { walletId: 'w1', quoteId: id, idempotencyKey: 'key-00000004', destinationAddress: DEST, country: null })).rejects.toThrow(/halted/);
    expect(db.tables.exchange_orders[0].status).toBe('failed');
  });
});

describe('order lifecycle', () => {
  async function newOrder(key = 'key-lifecycle') {
    const id = await quoteId();
    return (await createOrder(db.client, { walletId: 'w1', quoteId: id, idempotencyKey: key, destinationAddress: DEST, country: null })).order;
  }
  const hash = 'ab'.repeat(32);

  it('submit -> pending -> completed, with deduped events', async () => {
    let o = await newOrder();
    o = await submitOrderTx(db.client, o, hash);
    expect(o.status).toBe('submitted');
    expect(await submitOrderTx(db.client, o, hash)).toMatchObject({ status: 'submitted' }); // idempotent

    (adapter.getStatus as any).mockResolvedValueOnce({ status: 'pending', providerStatus: 'inbound_observed' });
    o = await refreshOrder(db.client, o, { force: true });
    expect(o.status).toBe('pending');

    (adapter.getStatus as any).mockResolvedValueOnce({ status: 'completed', providerStatus: 'outbound_signed', outTxHash: 'cd'.repeat(32), amountOut: '0.349' });
    o = await refreshOrder(db.client, o, { force: true });
    expect(o).toMatchObject({ status: 'completed', out_tx_hash: 'cd'.repeat(32) });
    expect(o.completed_at).toBeTruthy();

    // Late / replayed report cannot reopen it.
    (adapter.getStatus as any).mockResolvedValueOnce({ status: 'pending', providerStatus: 'inbound_observed' });
    expect((await refreshOrder(db.client, o, { force: true })).status).toBe('completed');
    expect(db.tables.exchange_order_events.map((e) => e.to_status)).toEqual(['created', 'awaiting_user_action', 'submitted', 'pending', 'completed']);
  });

  it('a completion without a payout tx goes to manual review', async () => {
    let o = await submitOrderTx(db.client, await newOrder(), hash);
    (adapter.getStatus as any).mockResolvedValueOnce({ status: 'completed', providerStatus: 'done' });
    o = await refreshOrder(db.client, o, { force: true });
    expect(o.status).toBe('manual_review');
  });

  it('a tx hash attaches to only one order', async () => {
    await submitOrderTx(db.client, await newOrder('key-aaaaaaaa'), hash);
    const other = await newOrder('key-bbbbbbbb');
    await expect(submitOrderTx(db.client, other, hash)).rejects.toThrow(/another order/);
  });

  it('a provider error never changes state', async () => {
    const o = await submitOrderTx(db.client, await newOrder(), hash);
    (adapter.getStatus as any).mockRejectedValueOnce(new Error('THORNode 502'));
    expect((await refreshOrder(db.client, o, { force: true })).status).toBe('submitted');
  });

  it('expires an unsent THORChain order past its quote expiry, and cannot cancel after sending', async () => {
    const o = await newOrder();
    db.tables.exchange_orders[0].expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await refreshOrder(db.client, { ...o, expires_at: db.tables.exchange_orders[0].expires_at })).status).toBe('expired');

    const sent = await submitOrderTx(db.client, await newOrder('key-cccccccc'), 'ef'.repeat(32));
    await expect(cancelOrder(db.client, sent)).rejects.toMatchObject({ code: 'invalid_transition' });
  });
});
