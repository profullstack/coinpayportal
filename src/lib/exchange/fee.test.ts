import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const paid = vi.hoisted(() => ({ merchants: new Set<string>() }));
vi.mock('@/lib/entitlements/service', () => ({
  isPaidTier: vi.fn(async (_s: unknown, merchantId: string) => paid.merchants.has(merchantId)),
}));

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeFee, feeBpsFor, netOfFee, resolveWalletTier } from './fee';
import { cancelOrder, createOrder, parseQuoteRequest, presentOrder, quoteAndStore, recordFeeTx, submitOrderTx } from './orders';
import { setAdapters } from './router';
import type { ExchangeAdapter } from './types';

const FEE_BTC = 'bc1qfeewalletfeewalletfeewalletfeewalletfee0';
const env = process.env;

beforeEach(() => {
  process.env = { ...env, EXCHANGE_ENGINE_ENABLED: 'true', EXCHANGE_FEE_ENABLED: 'true', PLATFORM_FEE_WALLET_BTC: FEE_BTC };
  paid.merchants.clear();
});
afterEach(() => {
  process.env = env;
  setAdapters(null);
});

describe('swap fee math', () => {
  it('is 2% free tier and 1% paid tier, exactly', () => {
    expect(computeFee('0.5', 'BTC', 'free')).toEqual({ amount: '0.01', netAmount: '0.49', bps: 200, address: FEE_BTC, tier: 'free' });
    expect(computeFee('0.5', 'BTC', 'paid')).toMatchObject({ amount: '0.005', netAmount: '0.495', bps: 100 });
    // No float drift, and the fee rounds down to whole sats.
    expect(computeFee('0.12345679', 'BTC', 'free')).toMatchObject({ amount: '0.00246913', netAmount: '0.12098766' });
    expect(netOfFee('0.12345679', '0.00246913', 'BTC')).toBe('0.12098766');
  });

  it('charges nothing when disabled, unconfigured, or below dust', () => {
    expect(computeFee('0.0004', 'BTC', 'free')).toMatchObject({ amount: '0', netAmount: '0.0004', address: null }); // 800 sats < 1000
    expect(computeFee('1', 'ETH', 'free')).toMatchObject({ amount: '0', netAmount: '1' }); // no ETH fee wallet in this env
    process.env.EXCHANGE_FEE_ENABLED = 'false';
    expect(feeBpsFor('free')).toBe(0);
    expect(computeFee('0.5', 'BTC', 'free').amount).toBe('0');
  });

  it('reads rates from env but refuses anything over 5%', () => {
    process.env.EXCHANGE_FEE_BPS_FREE = '150';
    expect(feeBpsFor('free')).toBe(150);
    process.env.EXCHANGE_FEE_BPS_FREE = '5000';
    expect(feeBpsFor('free')).toBe(200);
  });
});

/** Minimal supabase-js stand-in (same shape as orders.test.ts), plus account links. */
function fakeSupabase(links: Array<{ wallet_id: string; merchant_id: string }> = []) {
  const tables: Record<string, Record<string, any>[]> = { exchange_quotes: [], exchange_orders: [], exchange_order_events: [], wallet_account_links: links };
  let seq = 0;
  function builder(table: string) {
    const filters: [string, unknown][] = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: any;
    let wantRows = false;
    const run = () => {
      const rows = tables[table];
      const match = (r: any) => filters.every(([k, v]) => r[k] === v);
      if (op === 'insert') {
        const list = Array.isArray(payload) ? payload : [payload];
        const out = list.map((p) => {
          const row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, created_at: new Date().toISOString(), ...p };
          rows.push(row);
          return row;
        });
        return { data: wantRows ? (Array.isArray(payload) ? out : out[0]) : null, error: null };
      }
      if (op === 'update') {
        const hits = rows.filter(match);
        hits.forEach((r) => Object.assign(r, payload));
        return { data: hits.map((r) => ({ ...r })), error: null };
      }
      return { data: rows.filter(match).map((r) => ({ ...r })), error: null };
    };
    const b: any = {
      select: () => { if (op !== 'select') wantRows = true; return b; },
      insert: (p: any) => { op = 'insert'; payload = p; return b; },
      update: (p: any) => { op = 'update'; payload = p; return b; },
      eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
      order: () => b,
      limit: () => b,
      maybeSingle: async () => { const r = run(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
      single: async () => { const r = run(); const d = Array.isArray(r.data) ? r.data[0] : r.data; return d ? { ...r, data: d } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  }
  return { client: { from: builder } as unknown as SupabaseClient, tables };
}

function adapter(): ExchangeAdapter {
  return {
    id: 'changenow',
    label: 'ChangeNOW',
    isConfigured: () => true,
    supports: () => true,
    // 1 BTC -> 35 ETH, so the output shows exactly what amount the provider was asked about.
    quote: vi.fn(async (r) => ({
      provider: 'changenow', from: r.from, to: r.to, amountIn: r.amount, expectedAmountOut: String(Number(r.amount) * 35),
      fees: {}, expiresAt: Date.now() + 600_000, etaSeconds: null, verification: 'provider_may_require', warnings: [], route: {},
    })),
    createOrder: vi.fn(async (_q, r) => ({
      providerOrderId: 'cn1',
      plan: { kind: 'send', chain: r.from, to: 'bc1qproviderdeposit', amount: r.amount, expiresAt: null },
      details: {},
    })),
    getStatus: vi.fn(),
  } as ExchangeAdapter;
}

const DEST = '0x00000000000000000000000000000000000000a1';

describe('tiers', () => {
  it('a wallet linked to a paid merchant is paid tier; everyone else is free', async () => {
    paid.merchants.add('m-paid');
    const db = fakeSupabase([{ wallet_id: 'w-paid', merchant_id: 'm-paid' }, { wallet_id: 'w-free', merchant_id: 'm-free' }]);
    expect(await resolveWalletTier(db.client, 'w-paid')).toBe('paid');
    expect(await resolveWalletTier(db.client, 'w-free')).toBe('free');
    expect(await resolveWalletTier(db.client, 'w-unlinked')).toBe('free');
    expect(await resolveWalletTier(db.client, null)).toBe('free');
  });
});

describe('orders with a fee', () => {
  it('quotes the provider on the net amount and splits the plan into deposit + fee', async () => {
    const a = adapter();
    setAdapters([a]);
    const db = fakeSupabase();
    const routed = await quoteAndStore(db.client, parseQuoteRequest({ from: 'BTC', to: 'ETH', amount: '0.5' }, null), 'free');
    const q = routed.quotes[0];
    expect((a.quote as any).mock.calls[0][0].amount).toBe('0.49'); // provider never sees the fee
    expect(q).toMatchObject({ amountIn: '0.5', expectedAmountOut: '17.15', coinpayFee: { amount: '0.01', asset: 'BTC', bps: 200, tier: 'free' } });

    const { order } = await createOrder(db.client, { walletId: 'w1', quoteId: q.id, idempotencyKey: 'fee-key-0001', destinationAddress: DEST, country: null });
    expect((a.createOrder as any).mock.calls[0][1].amount).toBe('0.49');
    expect(order.plan).toMatchObject({ kind: 'send', to: 'bc1qproviderdeposit', amount: '0.49', fee: { to: FEE_BTC, amount: '0.01', bps: 200 } });
    expect(order).toMatchObject({ fee_amount: '0.01', fee_bps: 200, fee_tier: 'free', fee_address: FEE_BTC });
    expect(presentOrder(order).fee).toMatchObject({ amount: '0.01', paid: false });

    // Deposit, then the fee transaction; it can be recorded once, and not with the deposit's hash.
    let o = await submitOrderTx(db.client, order, 'ab'.repeat(32));
    await expect(recordFeeTx(db.client, o, 'ab'.repeat(32))).rejects.toThrow(/cannot be the deposit/);
    o = await recordFeeTx(db.client, o, 'cd'.repeat(32));
    expect(presentOrder(o).fee).toMatchObject({ paid: true, txHash: 'cd'.repeat(32) });
    await expect(recordFeeTx(db.client, o, 'ef'.repeat(32))).rejects.toThrow(/already recorded/);
  });

  it('paid tier pays 1%, and a free wallet cannot use a paid-tier quote', async () => {
    setAdapters([adapter()]);
    paid.merchants.add('m-paid');
    const db = fakeSupabase([{ wallet_id: 'w-paid', merchant_id: 'm-paid' }]);
    const routed = await quoteAndStore(db.client, parseQuoteRequest({ from: 'BTC', to: 'ETH', amount: '0.5' }, null), 'paid');
    expect(routed.quotes[0].coinpayFee).toMatchObject({ amount: '0.005', bps: 100, tier: 'paid' });

    await expect(createOrder(db.client, { walletId: 'w-free', quoteId: routed.quotes[0].id, idempotencyKey: 'fee-key-0002', destinationAddress: DEST, country: null }))
      .rejects.toMatchObject({ code: 'quote_expired' });
    const { order } = await createOrder(db.client, { walletId: 'w-paid', quoteId: routed.quotes[0].id, idempotencyKey: 'fee-key-0003', destinationAddress: DEST, country: null });
    expect(order.plan).toMatchObject({ amount: '0.495', fee: { amount: '0.005', bps: 100 } });
    await cancelOrder(db.client, order);
  });

  it('no fee leg when the fee would be dust', async () => {
    setAdapters([adapter()]);
    const db = fakeSupabase();
    const routed = await quoteAndStore(db.client, parseQuoteRequest({ from: 'BTC', to: 'ETH', amount: '0.0004' }, null), 'free');
    expect(routed.quotes[0].coinpayFee).toBeUndefined();
    const { order } = await createOrder(db.client, { walletId: 'w1', quoteId: routed.quotes[0].id, idempotencyKey: 'fee-key-0004', destinationAddress: DEST, country: null });
    expect((order.plan as any).fee).toBeUndefined();
    expect(order.plan).toMatchObject({ amount: '0.0004' });
    await expect(recordFeeTx(db.client, order, 'cd'.repeat(32))).rejects.toThrow(/no fee/);
  });
});
