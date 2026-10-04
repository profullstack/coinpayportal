/**
 * Finances SDK tests — the snapshot maths and the API wrappers.
 *
 * Fixtures mirror the real response shapes from prod (probed 2026-09-05):
 * `/finances/summary`, `/finances/accounts`, `/payments`, `/stripe/transactions`,
 * `/stripe/analytics`, `/escrow`, `/invoices`.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildFinanceSnapshot,
  collectFinanceSnapshot,
  cryptoFeeUsd,
  periodForDays,
  getFinanceSummary,
  listFinanceTransactions,
  syncFinances,
  subscribeToPayments,
} from '../src/finances.js';
import { money, shortDate, ago } from '../src/finances-tui.js';

const NOW = new Date('2026-09-05T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

function fixtureRaw() {
  return {
    summary: {
      windowDays: 30,
      totals: [{ currency: 'USD', assets: 21005.54, liabilities: 65013.13, net: -44007.59, accounts: 20 }],
      primaryCurrency: 'USD',
      byKind: [{ kind: 'credit', currency: 'USD', total: 65013.13, accounts: 9 }],
      byInstitution: [
        { org: 'Chase Bank', currency: 'USD', assets: 0, liabilities: 33655.95, accounts: 2 },
        { org: 'Credit Union', currency: 'USD', assets: 19000, liabilities: 14000, accounts: 5 },
      ],
      cashflow: { currency: 'USD', moneyIn: 3263.2, moneyOut: 13565.34, net: -10302.14, transactions: 260 },
      topCategories: [{ category: 'software', spent: 1200, received: 0, count: 40 }],
      accountCount: 20,
      hiddenCount: 0,
      transactionCount: 1199,
      oldestTransaction: daysAgo(100),
      newestTransaction: daysAgo(3),
    },
    accounts: [
      { id: 'a1', org_name: 'Chase Bank', name: 'Sapphire', currency: 'USD', balance: -33655.95, display_balance: 33655.95, kind: 'credit', effective_kind: 'credit', is_liability: true, is_hidden: false },
      { id: 'a2', org_name: 'Credit Union', name: 'Checking', currency: 'USD', balance: 1600, display_balance: 1600, kind: 'checking', effective_kind: 'checking', is_liability: false, is_hidden: false },
    ],
    transactions: { rows: [{ id: 't1', amount: -24.5, posted: daysAgo(3), payee: 'Amazon', account_name: 'Discover', currency: 'USD' }], total: 1199, limit: 100, offset: 0 },
    connections: { connections: [{ id: 'c1', provider: 'simplefin', label: 'SimpleFIN', is_active: true, last_synced_at: daysAgo(1), last_sync_status: 'partial' }], plaidEnabled: false },
    stats: { success: true, businesses: [{ id: 'b1', name: 'ugig.net' }], plan: { id: 'starter', commission_rate: 0.01, commission_percent: '1.0%' } },
    analytics: {
      crypto: { total_volume_usd: '525.17', total_transactions: 1000, successful_transactions: 289, failed_transactions: 711, failure_rate: 71.1, total_fees_usd: '4.83' },
      card: { total_volume_usd: '29065.58', total_transactions: 816, successful_transactions: 516, failed_transactions: 47, failure_rate: 5.8, total_fees_usd: '126.23' },
      combined: { total_volume_usd: '29590.75', total_transactions: 1816, successful_transactions: 805, failed_transactions: 758, failure_rate: 41.7, total_fees_usd: '131.06' },
      series: { granularity: 'day', points: [
        { label: '2026-08-06', crypto_volume_usd: 0, card_volume_usd: 1923.86, total_volume_usd: 1923.86, crypto_count: 0, card_count: 31, total_count: 31, crypto_commission_usd: 0, card_commission_usd: 6.55, total_commission_usd: 6.55 },
        { label: '2026-08-07', crypto_volume_usd: 10, card_volume_usd: 100, total_volume_usd: 110, crypto_count: 1, card_count: 2, total_count: 3, crypto_commission_usd: 0.1, card_commission_usd: 1, total_commission_usd: 1.1 },
      ] },
    },
    payments: {
      success: true,
      payments: [
        // paid, fee 1% of 10 USDC on $10
        { id: 'p1', business_name: 'ugig.net', amount_crypto: '10.01', amount_usd: '10.00', currency: 'USDC_POL', status: 'confirmed', fee_amount: '0.1001', created_at: daysAgo(2) },
        { id: 'p2', business_name: 'bitorrented.com', amount_crypto: '25.88', amount_usd: '4.99', currency: 'ADA', status: 'expired', fee_amount: null, created_at: daysAgo(5) },
        { id: 'p3', business_name: 'bitorrented.com', amount_crypto: '0.01', amount_usd: '20.00', currency: 'SOL', status: 'detected', fee_amount: null, created_at: daysAgo(1) },
        // outside the window
        { id: 'p4', business_name: 'old', amount_crypto: '1', amount_usd: '999', currency: 'BTC', status: 'forwarded', fee_amount: '0.01', created_at: daysAgo(60) },
      ],
      pagination: { limit: 100, offset: 0, total: 4, has_more: false },
    },
    cardTransactions: {
      success: true,
      transactions: [
        { id: 'c1', business_name: 'ugig.net', amount_cents: 1000, platform_fee_amount: 10, stripe_fee_amount: 59, net_to_merchant: 931, status: 'completed', currency: 'usd', created_at: daysAgo(3) },
        { id: 'c2', business_name: 'ugig.net', amount_cents: 7000, platform_fee_amount: 70, stripe_fee_amount: 0, net_to_merchant: 6930, status: 'succeeded', currency: 'usd', created_at: daysAgo(4) },
        { id: 'c3', business_name: 'ugig.net', amount_cents: 14000, platform_fee_amount: 0, stripe_fee_amount: 0, net_to_merchant: 0, status: 'failed', currency: 'usd', created_at: daysAgo(4) },
        { id: 'c4', business_name: 'ugig.net', amount_cents: 2500, platform_fee_amount: 25, stripe_fee_amount: 0, net_to_merchant: 2475, status: 'refunded', currency: 'usd', created_at: daysAgo(6) },
      ],
      pagination: { limit: 100, offset: 0, total: 4, has_more: true },
    },
    escrows: {
      escrows: [
        { id: 'e1', chain: 'SOL', amount: 0.2188, amount_usd: 19.97, fee_amount: 0.002188, fee_tx_hash: null, status: 'refunded', settled_at: daysAgo(4), created_at: daysAgo(10) },
        { id: 'e2', chain: 'SOL', amount: 0.5632, amount_usd: 50, fee_amount: 0.005632, fee_tx_hash: '0xfee', status: 'settled', settled_at: daysAgo(8), created_at: daysAgo(12) },
        { id: 'e3', chain: 'ETH', amount: 0.01, amount_usd: 30, fee_amount: 0.0001, fee_tx_hash: null, status: 'funded', created_at: daysAgo(1) },
        { id: 'e4', chain: 'SOL', amount: 1, amount_usd: 100, fee_amount: 0.01, fee_tx_hash: '0xold', status: 'settled', settled_at: daysAgo(90), created_at: daysAgo(95) },
      ],
      total: 4,
    },
    invoices: {
      success: true,
      invoices: [
        { id: 'i1', invoice_number: 'INV-1', amount: 200, status: 'draft', due_date: daysAgo(-7) },
        { id: 'i2', invoice_number: 'INV-2', amount: 356, status: 'sent', due_date: daysAgo(-3) },
        { id: 'i3', invoice_number: 'INV-3', amount: 85.6, status: 'sent', due_date: daysAgo(2) },
        { id: 'i4', invoice_number: 'INV-4', amount: 64, status: 'paid', paid_at: daysAgo(5) },
        { id: 'i5', invoice_number: 'INV-5', amount: 1000, status: 'paid', paid_at: daysAgo(70) },
        { id: 'i6', invoice_number: 'INV-6', amount: 249, status: 'cancelled' },
        { id: 'i7', invoice_number: 'INV-7', amount: 12, status: 'overdue', due_date: daysAgo(20) },
      ],
    },
    payouts: { success: true, payouts: [
      { id: 'po1', amount_cents: 5000, status: 'paid', created_at: daysAgo(2) },
      { id: 'po2', amount_cents: 2500, status: 'in_transit', created_at: daysAgo(1) },
    ] },
    errors: {},
  };
}

describe('periodForDays', () => {
  it('maps windows onto the analytics periods', () => {
    expect(periodForDays(7)).toBe('7d');
    expect(periodForDays(30)).toBe('30d');
    expect(periodForDays(45)).toBe('90d');
    expect(periodForDays(365)).toBe('1y');
    expect(periodForDays(0)).toBe('all');
    expect(periodForDays(NaN)).toBe('all');
  });
});

describe('cryptoFeeUsd', () => {
  it('pro-rates the crypto fee into USD', () => {
    expect(cryptoFeeUsd({ fee_amount: '0.1', amount_crypto: '10', amount_usd: '10' })).toBeCloseTo(0.1, 6);
  });
  it('reads the raw payment column names too', () => {
    expect(cryptoFeeUsd({ fee_amount: '0.5', crypto_amount: '50', amount: '100' })).toBeCloseTo(1, 6);
  });
  it('is zero without a fee', () => {
    expect(cryptoFeeUsd({ fee_amount: null, amount_crypto: '1', amount_usd: '1' })).toBe(0);
  });
});

describe('buildFinanceSnapshot', () => {
  const snapshot = buildFinanceSnapshot(fixtureRaw(), { days: 30, now: NOW });

  it('takes the headline earnings from the server-side analytics', () => {
    expect(snapshot.earnings.grossVolumeUsd).toBe(29590.75);
    expect(snapshot.earnings.cryptoVolumeUsd).toBe(525.17);
    expect(snapshot.earnings.cardVolumeUsd).toBe(29065.58);
    expect(snapshot.earnings.commissionUsd).toBe(131.06);
    expect(snapshot.earnings.transactions).toBe(805);
    expect(snapshot.earnings.failed).toBe(758);
  });

  it('nets out commission, processor fees and refunds', () => {
    // stripe fees: 0.59 on c1; refunds: card 25.00 + escrow 19.97
    expect(snapshot.earnings.stripeFeesUsd).toBe(0.59);
    expect(snapshot.earnings.refundsUsd).toBe(44.97);
    expect(snapshot.earnings.netUsd).toBe(Math.round((29590.75 - 131.06 - 0.59 - 44.97) * 100) / 100);
  });

  it('counts crypto payments inside the window only', () => {
    expect(snapshot.crypto.total).toBe(3);
    expect(snapshot.crypto.successful).toBe(1);
    expect(snapshot.crypto.pending).toBe(1);
    expect(snapshot.crypto.failed).toBe(1);
    expect(snapshot.crypto.volumeUsd).toBe(10);
    expect(snapshot.crypto.feesUsd).toBe(0.1);
    expect(snapshot.crypto.byChain).toEqual({ USDC_POL: 10 });
    expect(snapshot.crypto.partial).toBe(false);
  });

  it('turns card cents into dollars and separates refunds', () => {
    expect(snapshot.card.volumeUsd).toBe(80);
    expect(snapshot.card.platformFeesUsd).toBe(0.8);
    expect(snapshot.card.stripeFeesUsd).toBe(0.59);
    expect(snapshot.card.netUsd).toBe(78.61);
    expect(snapshot.card.refundedUsd).toBe(25);
    expect(snapshot.card.refunded).toBe(1);
    expect(snapshot.card.failed).toBe(1);
    expect(snapshot.card.partial).toBe(true);
  });

  it('buckets escrow by status and only counts fees that moved', () => {
    expect(snapshot.escrow.heldUsd).toBe(30);
    expect(snapshot.escrow.held).toBe(1);
    expect(snapshot.escrow.refundedUsd).toBe(19.97);
    expect(snapshot.escrow.released).toBe(1); // e4 is outside the window
    expect(snapshot.escrow.releasedUsd).toBe(50);
    expect(snapshot.escrow.feesUsd).toBe(0.5);
  });

  it('buckets invoices: outstanding, overdue, paid in window, drafts', () => {
    expect(snapshot.invoices.totals).toEqual({ draft: 200, outstanding: 356, overdue: 97.6, paid: 64, cancelled: 249 });
    expect(snapshot.invoices.counts).toEqual({ draft: 1, outstanding: 1, overdue: 2, paid: 1, cancelled: 1 });
  });

  it('sums payouts by status', () => {
    expect(snapshot.payout.paidUsd).toBe(50);
    expect(snapshot.payout.pendingUsd).toBe(25);
  });

  it('carries the bank position and sorts institutions by exposure', () => {
    expect(snapshot.bank.assets).toBe(21005.54);
    expect(snapshot.bank.liabilities).toBe(65013.13);
    expect(snapshot.bank.net).toBe(-44007.59);
    expect(snapshot.bank.cashflow.moneyOut).toBe(13565.34);
    expect(snapshot.bank.creditCards.map((a) => a.id)).toEqual(['a1']);
    expect(snapshot.bank.byInstitution[0].org).toBe('Chase Bank');
    expect(snapshot.bank.ledgerTotal).toBe(1199);
    expect(snapshot.bank.connections).toHaveLength(1);
  });

  it('builds the daily series for the graph', () => {
    expect(snapshot.series).toHaveLength(2);
    expect(snapshot.series[0]).toEqual({ label: '2026-08-06', volumeUsd: 1923.86, cryptoUsd: 0, cardUsd: 1923.86, commissionUsd: 6.55, count: 31 });
  });

  it('falls back to the page sums when analytics failed', () => {
    const raw = fixtureRaw();
    delete raw.analytics;
    raw.errors.analytics = 'HTTP 500';
    const s = buildFinanceSnapshot(raw, { days: 30, now: NOW });
    expect(s.earnings.grossVolumeUsd).toBe(90);
    expect(s.earnings.commissionUsd).toBe(0.9);
    expect(s.series).toEqual([]);
    expect(s.errors.analytics).toBe('HTTP 500');
  });

  it('survives an empty input', () => {
    const s = buildFinanceSnapshot({}, { days: 30, now: NOW });
    expect(s.earnings.grossVolumeUsd).toBe(0);
    expect(s.bank.connections).toEqual([]);
    expect(s.invoices.counts.outstanding).toBe(0);
    expect(s.recent.payments).toEqual([]);
  });

  it('treats days=0 as everything', () => {
    const s = buildFinanceSnapshot(fixtureRaw(), { days: 0, now: NOW });
    expect(s.crypto.total).toBe(4);
    expect(s.escrow.released).toBe(2);
  });
});

describe('API wrappers', () => {
  function fakeClient() {
    const calls = [];
    return {
      calls,
      request: vi.fn(async (endpoint, options) => {
        calls.push({ endpoint, options });
        if (endpoint.startsWith('/finances/summary')) return { summary: { windowDays: 7 } };
        if (endpoint.startsWith('/finances/transactions')) return { rows: [], total: 0 };
        if (endpoint.startsWith('/finances/sync')) return { results: [], totals: {}, status: 'ok' };
        return {};
      }),
    };
  }

  it('getFinanceSummary passes the window and unwraps', async () => {
    const client = fakeClient();
    const summary = await getFinanceSummary(client, { days: 7, includeHidden: true });
    expect(summary).toEqual({ windowDays: 7 });
    expect(client.calls[0].endpoint).toBe('/finances/summary?days=7&hidden=1');
  });

  it('listFinanceTransactions maps filters onto query params and drops blanks', async () => {
    const client = fakeClient();
    await listFinanceTransactions(client, { search: 'amazon', includePending: false, limit: 10, category: undefined });
    expect(client.calls[0].endpoint).toBe('/finances/transactions?search=amazon&pending=0&limit=10');
  });

  it('syncFinances POSTs a JSON body', async () => {
    const client = fakeClient();
    await syncFinances(client, { days: 45 });
    expect(client.calls[0].endpoint).toBe('/finances/sync');
    expect(client.calls[0].options.method).toBe('POST');
    expect(JSON.parse(client.calls[0].options.body)).toEqual({ days: 45 });
  });

  it('collectFinanceSnapshot keeps going when a source fails', async () => {
    const client = {
      request: vi.fn(async (endpoint) => {
        if (endpoint.startsWith('/stripe/payouts')) throw new Error('Failed to fetch payouts');
        if (endpoint.startsWith('/finances/summary')) return { summary: fixtureRaw().summary };
        if (endpoint.startsWith('/finances/accounts')) return { accounts: [] };
        if (endpoint.startsWith('/finances/transactions')) return { rows: [], total: 0 };
        if (endpoint.startsWith('/finances/connections')) return { connections: [], plaidEnabled: false };
        if (endpoint.startsWith('/stripe/analytics')) return { analytics: fixtureRaw().analytics };
        if (endpoint.startsWith('/payments')) return fixtureRaw().payments;
        if (endpoint.startsWith('/stripe/transactions')) return fixtureRaw().cardTransactions;
        if (endpoint.startsWith('/escrow')) return fixtureRaw().escrows;
        if (endpoint.startsWith('/invoices')) return fixtureRaw().invoices;
        return { success: true };
      }),
    };
    const snapshot = await collectFinanceSnapshot(client, { days: 30 });
    expect(snapshot.errors).toEqual({ payouts: 'Failed to fetch payouts' });
    expect(snapshot.earnings.grossVolumeUsd).toBe(29590.75);
    expect(snapshot.payout.paidUsd).toBe(0);
    const endpoints = client.request.mock.calls.map((c) => c[0]);
    expect(endpoints.some((e) => e.startsWith('/stripe/analytics?period=30d'))).toBe(true);
    expect(endpoints.some((e) => e.startsWith('/escrow?limit=100'))).toBe(true);
  });
});

describe('subscribeToPayments', () => {
  it('parses SSE frames and can be closed', async () => {
    const encoder = new TextEncoder();
    const frames = [
      'data: {"type":"connected","timestamp":"t"}\n\n',
      'data: {"type":"payment_completed","timestamp":"t","payment":{"id":"p1","status":"completed","amount_usd":"10"}}\n\n',
    ];
    let pulled = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (pulled < frames.length) controller.enqueue(encoder.encode(frames[pulled++]));
        // then hang until aborted
      },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, body });

    const events = [];
    const statuses = [];
    const close = subscribeToPayments({
      baseUrl: 'https://example.test/api/',
      token: 'jwt',
      onEvent: (e) => events.push(e),
      onStatus: (s) => statuses.push(s),
    });

    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(fetchSpy.mock.calls[0][0]).toBe('https://example.test/api/realtime/payments');
    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt');
    expect(events[1].payment.id).toBe('p1');
    expect(statuses).toContain('connected');

    close();
    expect(statuses.at(-1)).toBe('closed');
    fetchSpy.mockRestore();
  });

  it('refuses to start without a base URL and token', () => {
    expect(() => subscribeToPayments({})).toThrow(/baseUrl and token/);
  });
});

describe('formatting helpers', () => {
  it('formats money, dates and relative time', () => {
    expect(money(1234.5)).toBe('$1,234.50');
    expect(money(-44007.59)).toBe('-$44,007.59');
    expect(money(29065.58, 'USD', { compact: true })).toBe('$29K');
    expect(shortDate('2026-09-02T12:00:00+00:00')).toBe('2026-09-02');
    expect(shortDate(null)).toBe('—');
    expect(ago(null)).toBe('never');
    expect(ago(new Date(Date.now() - 90 * 60000).toISOString())).toBe('1h ago');
  });
});
