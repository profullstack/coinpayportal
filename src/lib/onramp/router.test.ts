import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOnrampQuotes, priceAgainstSpot, rankQuotes } from './router';
import type {
  OnrampProvider,
  OnrampQuote,
  OnrampQuoteParams,
  RawOnrampQuote,
} from './types';

vi.mock('@/lib/rates/tatum', () => ({
  getExchangeRate: vi.fn(),
}));

import { getExchangeRate } from '@/lib/rates/tatum';

const mockedRate = vi.mocked(getExchangeRate);

function rawQuote(overrides: Partial<RawOnrampQuote> = {}): RawOnrampQuote {
  return {
    provider: 'testramp',
    providerLabel: 'Testramp',
    source: 'test',
    paymentMethod: 'bank_transfer',
    fiatCurrency: 'USD',
    fiatAmount: 1000,
    cryptoAsset: 'BTC',
    receiveAmount: 9.5,
    fees: { provider: 20, network: 0, payment: 0, total: 20 },
    quotedRate: 105,
    etaSeconds: null,
    minFiatAmount: null,
    maxFiatAmount: null,
    warnings: [],
    ...overrides,
  };
}

function fakeProvider(
  id: string,
  behaviour: {
    configured?: boolean;
    quotes?: RawOnrampQuote[];
    error?: Error;
    delayMs?: number;
  } = {}
): OnrampProvider {
  return {
    id,
    label: id,
    isConfigured: () => behaviour.configured ?? true,
    quote: async (_params: OnrampQuoteParams, signal?: AbortSignal) => {
      if (behaviour.error) throw behaviour.error;
      if (behaviour.delayMs) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, behaviour.delayMs);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason ?? new Error('aborted'));
          });
        });
      }
      return behaviour.quotes ?? [];
    },
    createSession: async () => {
      throw new Error('not used');
    },
    listAssets: async () => ({ source: id, fiat: [], crypto: [], paymentMethods: [] }),
  };
}

const params: OnrampQuoteParams = {
  fiatCurrency: 'USD',
  fiatAmount: 1000,
  cryptoAsset: 'BTC',
};

describe('priceAgainstSpot', () => {
  it('recovers the spread the provider did not disclose', () => {
    // Spot 100/unit on 1000 spent means a zero-cost fill is 10 units.
    // Delivering 9.5 costs 5% all-in, of which only 2% was disclosed as a fee.
    const quote = priceAgainstSpot(rawQuote(), 100);

    expect(quote.midMarketReceiveAmount).toBe(10);
    expect(quote.allInCostPct).toBe(5);
    expect(quote.spreadPct).toBe(3);
    expect(quote.spotRate).toBe(100);
  });

  it('reports no spread rather than guessing when spot is unavailable', () => {
    const quote = priceAgainstSpot(rawQuote(), null);

    expect(quote.spotRate).toBeNull();
    expect(quote.spreadPct).toBeNull();
    expect(quote.allInCostPct).toBeNull();
    expect(quote.midMarketReceiveAmount).toBeNull();
    // The provider's own figures survive untouched.
    expect(quote.receiveAmount).toBe(9.5);
  });

  it('treats a nonsensical spot rate as no spot at all', () => {
    expect(priceAgainstSpot(rawQuote(), 0).allInCostPct).toBeNull();
    expect(priceAgainstSpot(rawQuote(), -5).allInCostPct).toBeNull();
    expect(priceAgainstSpot(rawQuote(), Number.NaN).allInCostPct).toBeNull();
  });

  it('reports a negative spread when the fill beats the disclosed fee', () => {
    // 9.9 delivered on a 1000 spend at spot 100 is a 1% all-in cost, against a
    // 2% disclosed fee — the provider gave back more than it charged.
    const quote = priceAgainstSpot(rawQuote({ receiveAmount: 9.9 }), 100);

    expect(quote.allInCostPct).toBe(1);
    expect(quote.spreadPct).toBe(-1);
  });
});

describe('rankQuotes', () => {
  it('ranks on delivered amount, not on the disclosed fee', () => {
    // The whole argument for this module: the quote advertising 1% delivers
    // less crypto than the one advertising 3%.
    const cheapLooking = priceAgainstSpot(
      rawQuote({ provider: 'cheap-looking', receiveAmount: 9.5, fees: { provider: 10, network: 0, payment: 0, total: 10 } }),
      100
    );
    const actuallyBetter = priceAgainstSpot(
      rawQuote({ provider: 'actually-better', receiveAmount: 9.6, fees: { provider: 30, network: 0, payment: 0, total: 30 } }),
      100
    );

    const ranked = rankQuotes([cheapLooking, actuallyBetter]);

    expect(ranked[0].provider).toBe('actually-better');
    expect(ranked[0].fees.total).toBeGreaterThan(ranked[1].fees.total);
    expect(ranked[0].allInCostPct!).toBeLessThan(ranked[1].allInCostPct!);
  });

  it('breaks a tie on the smaller fee, then the faster settlement', () => {
    const base = { receiveAmount: 9.5 };
    const slow = priceAgainstSpot(rawQuote({ ...base, provider: 'slow', etaSeconds: 172_800 }), 100);
    const fast = priceAgainstSpot(rawQuote({ ...base, provider: 'fast', etaSeconds: 600 }), 100);

    expect(rankQuotes([slow, fast])[0].provider).toBe('fast');
  });

  it('does not mutate its input', () => {
    const quotes: OnrampQuote[] = [
      priceAgainstSpot(rawQuote({ provider: 'a', receiveAmount: 9.0 }), 100),
      priceAgainstSpot(rawQuote({ provider: 'b', receiveAmount: 9.9 }), 100),
    ];
    rankQuotes(quotes);

    expect(quotes[0].provider).toBe('a');
  });
});

describe('getOnrampQuotes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedRate.mockResolvedValue(100);
  });

  it('merges and ranks quotes from every configured source', async () => {
    const result = await getOnrampQuotes(params, {
      providers: [
        fakeProvider('alpha', { quotes: [rawQuote({ provider: 'alpha', receiveAmount: 9.4 })] }),
        fakeProvider('beta', { quotes: [rawQuote({ provider: 'beta', receiveAmount: 9.7 })] }),
      ],
    });

    expect(result.quotes).toHaveLength(2);
    expect(result.best?.provider).toBe('beta');
    expect(result.spotRate).toBe(100);
    expect(result.unavailable).toEqual([]);
  });

  it('accepts several quotes from one aggregator source', async () => {
    const result = await getOnrampQuotes(params, {
      providers: [
        fakeProvider('onramper', {
          quotes: [
            rawQuote({ provider: 'moonpay', receiveAmount: 9.3 }),
            rawQuote({ provider: 'banxa', receiveAmount: 9.8 }),
          ],
        }),
      ],
    });

    expect(result.quotes.map((q) => q.provider)).toEqual(['banxa', 'moonpay']);
  });

  it('reports an unconfigured source instead of quoting it', async () => {
    const result = await getOnrampQuotes(params, {
      providers: [
        fakeProvider('configured', { quotes: [rawQuote()] }),
        fakeProvider('missing-key', { configured: false }),
      ],
    });

    expect(result.quotes).toHaveLength(1);
    expect(result.unavailable).toEqual([
      { source: 'missing-key', reason: 'Not configured — no API credentials set' },
    ]);
  });

  it('keeps quoting when one source throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await getOnrampQuotes(params, {
      providers: [
        fakeProvider('healthy', { quotes: [rawQuote({ provider: 'healthy' })] }),
        fakeProvider('broken', { error: new Error('502 Bad Gateway') }),
      ],
    });

    expect(result.best?.provider).toBe('healthy');
    expect(result.unavailable).toEqual([{ source: 'broken', reason: '502 Bad Gateway' }]);
  });

  it('drops a source that returns nothing, and says why', async () => {
    const result = await getOnrampQuotes(params, {
      providers: [fakeProvider('empty', { quotes: [] })],
    });

    expect(result.quotes).toEqual([]);
    expect(result.best).toBeNull();
    expect(result.unavailable).toEqual([
      { source: 'empty', reason: 'No quote for this asset, amount or country' },
    ]);
  });

  it('discards a quote that would deliver nothing', async () => {
    const result = await getOnrampQuotes(params, {
      providers: [
        fakeProvider('zero', {
          quotes: [rawQuote({ receiveAmount: 0 }), rawQuote({ provider: 'real', receiveAmount: 9.5 })],
        }),
      ],
    });

    expect(result.quotes).toHaveLength(1);
    expect(result.quotes[0].provider).toBe('real');
  });

  it('times a slow source out without failing the request', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await getOnrampQuotes(params, {
      timeoutMs: 20,
      providers: [
        fakeProvider('quick', { quotes: [rawQuote({ provider: 'quick' })] }),
        fakeProvider('slow', { delayMs: 500, quotes: [rawQuote({ provider: 'slow' })] }),
      ],
    });

    expect(result.best?.provider).toBe('quick');
    expect(result.unavailable[0].source).toBe('slow');
  });

  it('still ranks when the spot rate lookup fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedRate.mockRejectedValue(new Error('pricing down'));

    const result = await getOnrampQuotes(params, {
      providers: [
        fakeProvider('alpha', { quotes: [rawQuote({ provider: 'alpha', receiveAmount: 9.4 })] }),
        fakeProvider('beta', { quotes: [rawQuote({ provider: 'beta', receiveAmount: 9.7 })] }),
      ],
    });

    // Ranking never depended on spot, so it survives a pricing outage.
    expect(result.best?.provider).toBe('beta');
    expect(result.spotRate).toBeNull();
    expect(result.best?.allInCostPct).toBeNull();
  });

  it('rejects an asset we cannot receive', async () => {
    await expect(
      getOnrampQuotes({ ...params, cryptoAsset: 'NOTACOIN' }, { providers: [] })
    ).rejects.toThrow('Unsupported asset: NOTACOIN');
  });

  it('rejects a non-positive amount', async () => {
    await expect(getOnrampQuotes({ ...params, fiatAmount: 0 }, { providers: [] })).rejects.toThrow(
      'positive number'
    );
  });
});
