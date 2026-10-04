import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BitsoProvider, quoteFromBid } from './bitso';
import type { RemittanceQuoteParams } from './types';

global.fetch = vi.fn();

const params: RemittanceQuoteParams = {
  sendAsset: 'USDC',
  sendAmount: 1000,
  destinationCountry: 'MX',
};

const noFees = { pct: 0, fixedUsd: 0, networkUsd: 0 };

function tickerResponse(bid: string, ask = '19.10') {
  return {
    ok: true,
    json: async () => ({ success: true, payload: { book: 'usdc_mxn', bid, ask, last: '19.05' } }),
  } as unknown as Response;
}

describe('quoteFromBid', () => {
  it('pays out at the bid, net of fees', () => {
    // 1000 USDC less a $5 provider fee and $0.50 network fee is 994.50 units,
    // converted at 19 MXN each.
    const quote = quoteFromBid(19, 'usdc_mxn', params, {
      pct: 0.5,
      fixedUsd: 0,
      networkUsd: 0.5,
    });

    expect(quote!.fees.provider).toBe(5);
    expect(quote!.fees.network).toBe(0.5);
    expect(quote!.fees.total).toBe(5.5);
    expect(quote!.receiveAmount).toBeCloseTo(994.5 * 19, 6);
    expect(quote!.quotedFxRate).toBe(19);
    expect(quote!.payoutCurrency).toBe('MXN');
    expect(quote!.payoutNetwork).toBe('spei');
  });

  it('defaults to the SPEI bank rail', () => {
    const quote = quoteFromBid(19, 'usdc_mxn', params, noFees);
    expect(quote!.payoutMethod).toBe('bank');
    expect(quote!.payoutNetwork).toBe('spei');
    // SPEI clears in seconds, 24/7 — the corridor's structural advantage.
    expect(quote!.etaSeconds).toBe(60);
  });

  it('warns only when it actually fell back to another book', () => {
    const fellBack = quoteFromBid(19, 'usd_mxn', params, noFees, true);
    expect(fellBack!.warnings[0]).toContain('usd_mxn');

    // Pricing USDC off the dollar book is the intended route, not a fallback,
    // so it must not carry a warning.
    const intended = quoteFromBid(19, 'usd_mxn', params, noFees, false);
    expect(intended!.warnings).toEqual([]);
  });

  it('refuses to quote a nonsensical bid', () => {
    expect(quoteFromBid(0, 'usdc_mxn', params, noFees)).toBeNull();
    expect(quoteFromBid(-19, 'usdc_mxn', params, noFees)).toBeNull();
    expect(quoteFromBid(Number.NaN, 'usdc_mxn', params, noFees)).toBeNull();
  });

  it('refuses to quote when the fees exceed the amount sent', () => {
    // Rather than emitting a negative payout on a tiny transfer.
    const quote = quoteFromBid(19, 'usdc_mxn', { ...params, sendAmount: 1 }, {
      pct: 0,
      fixedUsd: 5,
      networkUsd: 0.5,
    });

    expect(quote).toBeNull();
  });
});

describe('BitsoProvider', () => {
  const originalEnv = process.env;
  const provider = new BitsoProvider();

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    delete process.env.BITSO_FEE_PCT;
    delete process.env.BITSO_FEE_FIXED_USD;
    delete process.env.BITSO_NETWORK_FEE_USD;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('can quote without any credentials', () => {
    // Quoting uses the public ticker, so the Mexico corridor works before
    // anyone signs a partner agreement.
    delete process.env.BITSO_API_KEY;
    expect(provider.isConfigured()).toBe(true);
  });

  it('knows it cannot settle without credentials', () => {
    delete process.env.BITSO_API_KEY;
    delete process.env.BITSO_API_SECRET;
    expect(provider.canExecutePayouts()).toBe(false);

    process.env.BITSO_API_KEY = 'k';
    process.env.BITSO_API_SECRET = 's';
    expect(provider.canExecutePayouts()).toBe(true);
  });

  it('serves only the Mexico corridor', () => {
    expect(provider.corridors).toEqual(['US-MX']);
  });

  it('prices USDC off the dollar book, in one call and without warning', async () => {
    // Verified against /v3/available_books: Bitso has no usdc_mxn book, so
    // usd_mxn is the intended route rather than a degraded one.
    vi.mocked(fetch).mockResolvedValue(tickerResponse('19.00'));

    const quotes = await provider.quote(params);

    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('book=usd_mxn');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].quotedFxRate).toBe(19);
    expect(quotes[0].warnings).toEqual([]);
  });

  it('treats an unlisted book as "does not trade here", not an outage', async () => {
    // Bitso answers 400 with an error body for an unknown book.
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 400 } as unknown as Response)
      .mockResolvedValueOnce(tickerResponse('19.00'));

    const quotes = await provider.quote({ ...params, sendAsset: 'USDT' });

    expect(quotes).toHaveLength(1);
    expect(quotes[0].warnings[0]).toContain('usd_mxn');
  });

  it('uses the usdt book for a USDT sender', async () => {
    vi.mocked(fetch).mockResolvedValue(tickerResponse('19.00'));

    await provider.quote({ ...params, sendAsset: 'USDT_POL' });

    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('book=usdt_mxn');
  });

  it('takes the bid, not the ask', async () => {
    // The sender is selling stablecoin for pesos, so the bid is the honest
    // side of the book. Quoting the ask would promise a fill nobody offers.
    vi.mocked(fetch).mockResolvedValue(tickerResponse('18.90', '19.40'));

    const quotes = await provider.quote(params);

    expect(quotes[0].quotedFxRate).toBe(18.9);
  });

  it('falls back to the dollar book when the asset book returns an error body', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: { code: 20, message: 'Unknown OrderBook usdt_mxn' } }),
      } as unknown as Response)
      .mockResolvedValueOnce(tickerResponse('19.00'));

    const quotes = await provider.quote({ ...params, sendAsset: 'USDT' });

    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('book=usdt_mxn');
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain('book=usd_mxn');
    expect(quotes[0].warnings[0]).toContain('usd_mxn');
  });

  it('surfaces an outage rather than quoting silence', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as unknown as Response);

    await expect(provider.quote(params)).rejects.toThrow('Bitso API error 503');
  });

  it('takes commercial terms from the environment', async () => {
    process.env.BITSO_FEE_PCT = '1.25';
    process.env.BITSO_NETWORK_FEE_USD = '0';
    vi.mocked(fetch).mockResolvedValue(tickerResponse('19.00'));

    const quotes = await provider.quote(params);

    expect(quotes[0].fees.provider).toBe(12.5);
    expect(quotes[0].fees.total).toBe(12.5);
  });

  it('ignores a nonsense fee override rather than quoting a negative fee', async () => {
    process.env.BITSO_FEE_PCT = '-10';
    vi.mocked(fetch).mockResolvedValue(tickerResponse('19.00'));

    const quotes = await provider.quote(params);

    expect(quotes[0].fees.provider).toBeGreaterThan(0);
  });
});
