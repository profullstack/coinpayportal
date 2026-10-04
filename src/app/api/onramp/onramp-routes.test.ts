import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getQuote } from './quote/route';
import { POST as createSession } from './session/route';
import { GET as getAssets } from './assets/route';

vi.mock('@/lib/web-wallet/rate-limit', () => ({
  checkRateLimitAsync: vi.fn(async () => ({ allowed: true })),
}));

vi.mock('@/lib/web-wallet/client-ip', () => ({
  getClientIp: vi.fn(() => '203.0.113.1'),
}));

vi.mock('@/lib/onramp/router', () => ({
  getOnrampQuotes: vi.fn(),
}));

vi.mock('@/lib/onramp/providers', () => ({
  isOnrampAvailable: vi.fn(() => true),
  getConfiguredProviders: vi.fn(() => []),
  getProviderById: vi.fn(),
  getOnrampProviders: vi.fn(() => []),
}));

import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getOnrampQuotes } from '@/lib/onramp/router';
import {
  isOnrampAvailable,
  getConfiguredProviders,
  getProviderById,
  getOnrampProviders,
} from '@/lib/onramp/providers';

const quoteRequest = (query: string) =>
  new NextRequest(`https://coinpayportal.com/api/onramp/quote?${query}`);

const sessionRequest = (body: unknown) =>
  new NextRequest('https://coinpayportal.com/api/onramp/session', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

const result = (overrides = {}) => ({
  quotes: [{ provider: 'moonpay', receiveAmount: 0.005 }],
  best: { provider: 'moonpay', receiveAmount: 0.005 },
  spotRate: 95_000,
  unavailable: [],
  ...overrides,
});

describe('GET /api/onramp/quote', () => {
  beforeEach(() => {
    vi.mocked(checkRateLimitAsync).mockResolvedValue({ allowed: true } as never);
    vi.mocked(isOnrampAvailable).mockReturnValue(true);
    vi.mocked(getOnrampQuotes).mockResolvedValue(result() as never);
  });

  it('returns ranked quotes with the spot rate used to price them', async () => {
    const response = await getQuote(quoteRequest('asset=BTC&amount=500'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.best.provider).toBe('moonpay');
    // Published so the comparison can be audited, not taken on trust.
    expect(body.spotRate).toBe(95_000);
  });

  it('requires an asset and an amount', async () => {
    const response = await getQuote(quoteRequest('asset=BTC'));
    expect(response.status).toBe(400);
    expect((await response.json()).required).toEqual(['asset', 'amount']);
  });

  it('rejects an asset we cannot receive', async () => {
    const response = await getQuote(quoteRequest('asset=NOTACOIN&amount=500'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('NOTACOIN');
    expect(body.supported).toContain('BTC');
  });

  it('rejects a non-positive amount', async () => {
    for (const amount of ['0', '-100', 'abc']) {
      const response = await getQuote(quoteRequest(`asset=BTC&amount=${amount}`));
      expect(response.status).toBe(400);
    }
  });

  it('rejects an unknown payment method', async () => {
    const response = await getQuote(quoteRequest('asset=BTC&amount=500&method=carrier'));
    expect(response.status).toBe(400);
    expect((await response.json()).supported).toContain('bank_transfer');
  });

  it('reads as an outage, not a bad request, when nothing is configured', async () => {
    vi.mocked(isOnrampAvailable).mockReturnValue(false);

    const response = await getQuote(quoteRequest('asset=BTC&amount=500'));
    expect(response.status).toBe(503);
    expect((await response.json()).detail).toContain('ONRAMPER_API_KEY');
  });

  it('reports which sources failed when none could quote', async () => {
    vi.mocked(getOnrampQuotes).mockResolvedValue(
      result({
        quotes: [],
        best: null,
        unavailable: [{ source: 'onramper', reason: '502 Bad Gateway' }],
      }) as never
    );

    const response = await getQuote(quoteRequest('asset=BTC&amount=500'));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.unavailable).toEqual([{ source: 'onramper', reason: '502 Bad Gateway' }]);
  });

  it('rate limits before doing any provider work', async () => {
    vi.mocked(checkRateLimitAsync).mockResolvedValue({ allowed: false } as never);

    const response = await getQuote(quoteRequest('asset=BTC&amount=500'));

    expect(response.status).toBe(429);
    expect(getOnrampQuotes).not.toHaveBeenCalled();
  });
});

describe('POST /api/onramp/session', () => {
  const provider = {
    id: 'onramper',
    label: 'Onramper',
    isConfigured: () => true,
    quote: vi.fn(),
    listAssets: vi.fn(),
    createSession: vi.fn(async () => ({
      source: 'onramper',
      provider: 'moonpay',
      url: 'https://buy.onramper.com?x=1',
      sessionId: null,
      expiresAt: null,
    })),
  };

  beforeEach(() => {
    vi.mocked(checkRateLimitAsync).mockResolvedValue({ allowed: true } as never);
    vi.mocked(getConfiguredProviders).mockReturnValue([provider] as never);
    vi.mocked(getProviderById).mockReturnValue(provider as never);
    provider.createSession.mockClear();
  });

  it('hands back a provider URL for a valid request', async () => {
    const response = await createSession(
      sessionRequest({
        asset: 'BTC',
        amount: 500,
        walletAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.session.url).toContain('buy.onramper.com');
  });

  it('rejects an address that does not belong to the settlement chain', async () => {
    // A Polygon USDC purchase sent to a Bitcoin address is unrecoverable, and
    // the ramp will not catch it for us.
    const response = await createSession(
      sessionRequest({
        asset: 'USDC_POL',
        amount: 500,
        walletAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Invalid POL address');
    expect(provider.createSession).not.toHaveBeenCalled();
  });

  it('accepts an address on a chain the validator cannot judge', async () => {
    // validateAddress only understands BTC/BCH/ETH/POL/SOL. Rejecting XRP
    // because we cannot check it would break a supported asset.
    const response = await createSession(
      sessionRequest({ asset: 'XRP', amount: 100, walletAddress: 'rAnyXrpAddressShape' })
    );

    expect(response.status).toBe(200);
  });

  it('requires an address', async () => {
    const response = await createSession(sessionRequest({ asset: 'BTC', amount: 500 }));
    expect(response.status).toBe(400);
    expect((await response.json()).required).toContain('walletAddress');
  });

  it('rejects a malformed body', async () => {
    const request = new NextRequest('https://coinpayportal.com/api/onramp/session', {
      method: 'POST',
      body: 'not json',
      headers: { 'content-type': 'application/json' },
    });

    expect((await createSession(request)).status).toBe(400);
  });

  it('returns 503 when no source is configured', async () => {
    vi.mocked(getConfiguredProviders).mockReturnValue([] as never);

    const response = await createSession(
      sessionRequest({
        asset: 'BTC',
        amount: 500,
        walletAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      })
    );

    expect(response.status).toBe(503);
  });

  it('rejects an unknown source', async () => {
    vi.mocked(getProviderById).mockReturnValue(undefined as never);

    const response = await createSession(
      sessionRequest({
        asset: 'BTC',
        amount: 500,
        walletAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        source: 'nonesuch',
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('nonesuch');
  });
});

describe('GET /api/onramp/assets', () => {
  beforeEach(() => {
    vi.mocked(checkRateLimitAsync).mockResolvedValue({ allowed: true } as never);
  });

  it('reports assets we can receive and which sources are live', async () => {
    vi.mocked(getOnrampProviders).mockReturnValue([
      { id: 'onramper', label: 'Onramper', isConfigured: () => true },
      { id: 'transak', label: 'Transak', isConfigured: () => false },
    ] as never);

    const response = await getAssets(
      new NextRequest('https://coinpayportal.com/api/onramp/assets')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assets).toContain('USDC_POL');
    expect(body.available).toBe(true);
    expect(body.sources).toEqual([
      { id: 'onramper', label: 'Onramper', configured: true },
      { id: 'transak', label: 'Transak', configured: false },
    ]);
  });

  it('says so when nothing is configured', async () => {
    vi.mocked(getOnrampProviders).mockReturnValue([
      { id: 'onramper', label: 'Onramper', isConfigured: () => false },
    ] as never);

    const body = await (
      await getAssets(new NextRequest('https://coinpayportal.com/api/onramp/assets'))
    ).json();

    expect(body.available).toBe(false);
  });
});
