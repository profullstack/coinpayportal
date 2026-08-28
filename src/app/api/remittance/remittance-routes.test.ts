import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getQuote } from './quote/route';
import { GET as getCorridors } from './corridors/route';

vi.mock('@/lib/web-wallet/rate-limit', () => ({
  checkRateLimitAsync: vi.fn(async () => ({ allowed: true })),
}));

vi.mock('@/lib/web-wallet/client-ip', () => ({
  getClientIp: vi.fn(() => '203.0.113.1'),
}));

vi.mock('@/lib/remittance/router', () => ({
  getRemittanceQuotes: vi.fn(),
}));

vi.mock('@/lib/remittance/providers', () => ({
  isCorridorAvailable: vi.fn(() => true),
  getProvidersForCorridor: vi.fn(() => []),
  getRemittanceProviders: vi.fn(() => []),
}));

import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getRemittanceQuotes } from '@/lib/remittance/router';
import {
  isCorridorAvailable,
  getProvidersForCorridor,
  getRemittanceProviders,
} from '@/lib/remittance/providers';

const quoteRequest = (query: string) =>
  new NextRequest(`https://coinpayportal.com/api/remittance/quote?${query}`);

const result = (overrides = {}) => ({
  quotes: [{ provider: 'bitso', receiveAmount: 19_000 }],
  best: { provider: 'bitso', receiveAmount: 19_000 },
  corridor: 'US-MX',
  payoutCurrency: 'MXN',
  sendValueUsd: 1000,
  midMarketFxRate: 20,
  unavailable: [],
  ...overrides,
});

describe('GET /api/remittance/quote', () => {
  beforeEach(() => {
    vi.mocked(checkRateLimitAsync).mockResolvedValue({ allowed: true } as never);
    vi.mocked(isCorridorAvailable).mockReturnValue(true);
    vi.mocked(getRemittanceQuotes).mockResolvedValue(result() as never);
  });

  it('returns ranked quotes with the mid-market rate used to price them', async () => {
    const response = await getQuote(quoteRequest('asset=USDC&amount=1000&to=MX'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.best.provider).toBe('bitso');
    expect(body.corridor).toBe('US-MX');
    expect(body.payoutCurrency).toBe('MXN');
    // Published so the FX-margin figure can be audited, not taken on trust.
    expect(body.midMarketFxRate).toBe(20);
  });

  it('requires asset, amount and destination', async () => {
    const response = await getQuote(quoteRequest('asset=USDC&amount=1000'));
    expect(response.status).toBe(400);
    expect((await response.json()).required).toEqual(['asset', 'amount', 'to']);
  });

  it('rejects a non-stablecoin send asset', async () => {
    // Senders fund with stablecoin they already hold; there is no fiat leg.
    const response = await getQuote(quoteRequest('asset=BTC&amount=1000&to=MX'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('BTC');
    expect(body.supported).toContain('USDC');
  });

  it('rejects a destination outside our corridors', async () => {
    const response = await getQuote(quoteRequest('asset=USDC&amount=1000&to=FR'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.supported).toEqual(['MX', 'PH', 'NG', 'VN']);
  });

  it('rejects a payout method the corridor does not offer', async () => {
    const response = await getQuote(quoteRequest('asset=USDC&amount=1000&to=MX&method=ewallet'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('US-MX does not support');
    expect(body.supported).toContain('bank');
  });

  it('accepts an e-wallet payout to the Philippines', async () => {
    vi.mocked(getRemittanceQuotes).mockResolvedValue(
      result({ corridor: 'US-PH', payoutCurrency: 'PHP' }) as never
    );

    const response = await getQuote(
      quoteRequest('asset=USDC&amount=1000&to=PH&method=ewallet&network=gcash')
    );

    expect(response.status).toBe(200);
    expect((await response.json()).payoutCurrency).toBe('PHP');
  });

  it('rejects a non-positive amount', async () => {
    for (const amount of ['0', '-100', 'abc']) {
      expect((await getQuote(quoteRequest(`asset=USDC&amount=${amount}&to=MX`))).status).toBe(400);
    }
  });

  it('reads as an outage when the corridor has no partner', async () => {
    vi.mocked(isCorridorAvailable).mockReturnValue(false);

    const response = await getQuote(quoteRequest('asset=USDC&amount=1000&to=PH'));
    expect(response.status).toBe(503);
    expect((await response.json()).detail).toContain('PH');
  });

  it('reports which partners failed when none could quote', async () => {
    vi.mocked(getRemittanceQuotes).mockResolvedValue(
      result({
        quotes: [],
        best: null,
        unavailable: [{ source: 'transfi', reason: '502 Bad Gateway' }],
      }) as never
    );

    const response = await getQuote(quoteRequest('asset=USDC&amount=1000&to=MX'));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.unavailable).toEqual([{ source: 'transfi', reason: '502 Bad Gateway' }]);
  });

  it('rate limits before doing any partner work', async () => {
    vi.mocked(checkRateLimitAsync).mockResolvedValue({ allowed: false } as never);

    const response = await getQuote(quoteRequest('asset=USDC&amount=1000&to=MX'));

    expect(response.status).toBe(429);
    expect(getRemittanceQuotes).not.toHaveBeenCalled();
  });
});

describe('GET /api/remittance/corridors', () => {
  beforeEach(() => {
    vi.mocked(checkRateLimitAsync).mockResolvedValue({ allowed: true } as never);
    vi.mocked(getRemittanceProviders).mockReturnValue([
      { id: 'bitso', label: 'Bitso', corridors: ['US-MX'], isConfigured: () => true },
      { id: 'transfi', label: 'TransFi', corridors: ['US-MX', 'US-PH'], isConfigured: () => false },
    ] as never);
  });

  it('reports both corridors with their payout rails', async () => {
    vi.mocked(getProvidersForCorridor).mockImplementation(
      ((corridor: string) =>
        corridor === 'US-MX' ? [{ id: 'bitso' }] : []) as never
    );

    const response = await getCorridors(
      new NextRequest('https://coinpayportal.com/api/remittance/corridors')
    );
    const body = await response.json();

    expect(response.status).toBe(200);

    const mx = body.corridors.find((c: { corridor: string }) => c.corridor === 'US-MX');
    const ph = body.corridors.find((c: { corridor: string }) => c.corridor === 'US-PH');

    expect(mx.payoutCurrency).toBe('MXN');
    expect(mx.networks.bank).toContain('spei');
    expect(mx.available).toBe(true);
    expect(mx.partners).toEqual(['bitso']);

    // The Philippines is e-wallet first — GCash matters more than the bank rail.
    expect(ph.payoutCurrency).toBe('PHP');
    expect(ph.networks.ewallet).toContain('gcash');
    expect(ph.available).toBe(false);
  });

  it('lists only stablecoins as send assets', async () => {
    vi.mocked(getProvidersForCorridor).mockReturnValue([] as never);

    const body = await (
      await getCorridors(new NextRequest('https://coinpayportal.com/api/remittance/corridors'))
    ).json();

    expect(body.sendAssets).toContain('USDC');
    expect(body.sendAssets).not.toContain('BTC');
  });

  it('shows which partners are configured', async () => {
    vi.mocked(getProvidersForCorridor).mockReturnValue([] as never);

    const body = await (
      await getCorridors(new NextRequest('https://coinpayportal.com/api/remittance/corridors'))
    ).json();

    expect(body.partners).toEqual([
      { id: 'bitso', label: 'Bitso', corridors: ['US-MX'], configured: true },
      { id: 'transfi', label: 'TransFi', corridors: ['US-MX', 'US-PH'], configured: false },
    ]);
  });
});
