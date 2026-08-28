import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRemittanceQuotes, priceAgainstMidMarket, rankQuotes } from './router';
import type {
  Corridor,
  RawRemittanceQuote,
  RemittanceProvider,
  RemittanceQuoteParams,
} from './types';

vi.mock('@/lib/rates/tatum', () => ({ getExchangeRate: vi.fn() }));
vi.mock('@/lib/rates/fx', () => ({ getUsdFxRate: vi.fn() }));

import { getExchangeRate } from '@/lib/rates/tatum';
import { getUsdFxRate } from '@/lib/rates/fx';

const mockedSpot = vi.mocked(getExchangeRate);
const mockedFx = vi.mocked(getUsdFxRate);

function rawQuote(overrides: Partial<RawRemittanceQuote> = {}): RawRemittanceQuote {
  return {
    provider: 'testramp',
    providerLabel: 'Testramp',
    source: 'test',
    corridor: 'US-MX',
    sendAsset: 'USDC',
    sendAmount: 1000,
    payoutCurrency: 'MXN',
    payoutMethod: 'bank',
    payoutNetwork: 'spei',
    receiveAmount: 19_000,
    fees: { provider: 20, network: 0, payout: 0, total: 20 },
    quotedFxRate: 19,
    etaSeconds: null,
    minSendAmountUsd: null,
    maxSendAmountUsd: null,
    warnings: [],
    ...overrides,
  };
}

function fakeProvider(
  id: string,
  behaviour: {
    corridors?: Corridor[];
    configured?: boolean;
    quotes?: RawRemittanceQuote[];
    error?: Error;
    delayMs?: number;
  } = {}
): RemittanceProvider {
  return {
    id,
    label: id,
    corridors: behaviour.corridors ?? ['US-MX', 'US-PH'],
    isConfigured: () => behaviour.configured ?? true,
    quote: async (_params: RemittanceQuoteParams, signal?: AbortSignal) => {
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
  };
}

const params: RemittanceQuoteParams = {
  sendAsset: 'USDC',
  sendAmount: 1000,
  destinationCountry: 'MX',
};

describe('priceAgainstMidMarket', () => {
  it('recovers the margin taken in the FX rate', () => {
    // $1000 at a mid-market 20 MXN/USD is a 20,000 peso zero-cost payout.
    // Delivering 19,000 costs 5% all-in, of which only 2% was a disclosed fee.
    const quote = priceAgainstMidMarket(rawQuote(), 1000, 20);

    expect(quote.midMarketReceiveAmount).toBe(20_000);
    expect(quote.allInCostPct).toBe(5);
    expect(quote.fxMarginPct).toBe(3);
    expect(quote.sendValueUsd).toBe(1000);
  });

  it('reports nothing rather than guessing when FX is unavailable', () => {
    const quote = priceAgainstMidMarket(rawQuote(), 1000, null);

    expect(quote.fxMarginPct).toBeNull();
    expect(quote.allInCostPct).toBeNull();
    expect(quote.midMarketReceiveAmount).toBeNull();
    // The partner's own figures survive untouched.
    expect(quote.receiveAmount).toBe(19_000);
  });

  it('reports nothing when the send value is unknown', () => {
    expect(priceAgainstMidMarket(rawQuote(), null, 20).allInCostPct).toBeNull();
  });

  it('treats a nonsensical rate as no rate at all', () => {
    expect(priceAgainstMidMarket(rawQuote(), 1000, 0).allInCostPct).toBeNull();
    expect(priceAgainstMidMarket(rawQuote(), 1000, -20).allInCostPct).toBeNull();
    expect(priceAgainstMidMarket(rawQuote(), 1000, Number.NaN).allInCostPct).toBeNull();
  });
});

describe('rankQuotes', () => {
  it('ranks on pesos delivered, not on the disclosed fee', () => {
    // The argument for the whole module: the partner advertising a 1% fee
    // delivers less money to the family than the one advertising 3%.
    const cheapLooking = priceAgainstMidMarket(
      rawQuote({
        provider: 'cheap-looking',
        receiveAmount: 19_000,
        fees: { provider: 10, network: 0, payout: 0, total: 10 },
      }),
      1000,
      20
    );
    const actuallyBetter = priceAgainstMidMarket(
      rawQuote({
        provider: 'actually-better',
        receiveAmount: 19_200,
        fees: { provider: 30, network: 0, payout: 0, total: 30 },
      }),
      1000,
      20
    );

    const ranked = rankQuotes([cheapLooking, actuallyBetter]);

    expect(ranked[0].provider).toBe('actually-better');
    expect(ranked[0].fees.total).toBeGreaterThan(ranked[1].fees.total);
    expect(ranked[0].allInCostPct!).toBeLessThan(ranked[1].allInCostPct!);
  });

  it('breaks a tie on the smaller fee, then the faster payout', () => {
    const slow = priceAgainstMidMarket(rawQuote({ provider: 'slow', etaSeconds: 86_400 }), 1000, 20);
    const fast = priceAgainstMidMarket(rawQuote({ provider: 'fast', etaSeconds: 60 }), 1000, 20);

    expect(rankQuotes([slow, fast])[0].provider).toBe('fast');
  });

  it('does not mutate its input', () => {
    const quotes = [
      priceAgainstMidMarket(rawQuote({ provider: 'a', receiveAmount: 18_000 }), 1000, 20),
      priceAgainstMidMarket(rawQuote({ provider: 'b', receiveAmount: 19_900 }), 1000, 20),
    ];
    rankQuotes(quotes);

    expect(quotes[0].provider).toBe('a');
  });
});

describe('getRemittanceQuotes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedSpot.mockResolvedValue(1);
    mockedFx.mockResolvedValue(20);
  });

  it('merges and ranks quotes from every partner on the corridor', async () => {
    const result = await getRemittanceQuotes(params, {
      providers: [
        fakeProvider('alpha', { quotes: [rawQuote({ provider: 'alpha', receiveAmount: 18_800 })] }),
        fakeProvider('beta', { quotes: [rawQuote({ provider: 'beta', receiveAmount: 19_400 })] }),
      ],
    });

    expect(result.quotes).toHaveLength(2);
    expect(result.best?.provider).toBe('beta');
    expect(result.corridor).toBe('US-MX');
    expect(result.payoutCurrency).toBe('MXN');
    expect(result.midMarketFxRate).toBe(20);
    expect(result.unavailable).toEqual([]);
  });

  it('does not price the send leg at a flat dollar', async () => {
    // A depegged or simply mispriced stablecoin would distort every cost
    // figure downstream, so the USD value comes from spot, not an assumption.
    mockedSpot.mockResolvedValue(0.97);

    const result = await getRemittanceQuotes(params, {
      providers: [fakeProvider('alpha', { quotes: [rawQuote()] })],
    });

    expect(result.sendValueUsd).toBe(970);
    expect(mockedSpot).toHaveBeenCalledWith('USDC', 'USD');
  });

  it('excludes a partner that does not serve the corridor, and says so', async () => {
    const result = await getRemittanceQuotes(
      { ...params, destinationCountry: 'PH' },
      {
        providers: [
          fakeProvider('mexico-only', { corridors: ['US-MX'] }),
          fakeProvider('both', { quotes: [rawQuote({ corridor: 'US-PH' })] }),
        ],
      }
    );

    expect(result.quotes).toHaveLength(1);
    expect(result.unavailable).toEqual([
      { source: 'mexico-only', reason: 'Does not serve US-PH' },
    ]);
  });

  it('reports an unconfigured partner instead of quoting it', async () => {
    const result = await getRemittanceQuotes(params, {
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

  it('keeps quoting when one partner throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await getRemittanceQuotes(params, {
      providers: [
        fakeProvider('healthy', { quotes: [rawQuote({ provider: 'healthy' })] }),
        fakeProvider('broken', { error: new Error('502 Bad Gateway') }),
      ],
    });

    expect(result.best?.provider).toBe('healthy');
    expect(result.unavailable).toEqual([{ source: 'broken', reason: '502 Bad Gateway' }]);
  });

  it('times a slow partner out without failing the request', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await getRemittanceQuotes(params, {
      timeoutMs: 20,
      providers: [
        fakeProvider('quick', { quotes: [rawQuote({ provider: 'quick' })] }),
        fakeProvider('slow', { delayMs: 500, quotes: [rawQuote({ provider: 'slow' })] }),
      ],
    });

    expect(result.best?.provider).toBe('quick');
    expect(result.unavailable[0].source).toBe('slow');
  });

  it('discards a payout of nothing', async () => {
    const result = await getRemittanceQuotes(params, {
      providers: [
        fakeProvider('zero', {
          quotes: [rawQuote({ receiveAmount: 0 }), rawQuote({ provider: 'real' })],
        }),
      ],
    });

    expect(result.quotes).toHaveLength(1);
    expect(result.quotes[0].provider).toBe('real');
  });

  it('still ranks when the FX lookup fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFx.mockRejectedValue(new Error('fx down'));

    const result = await getRemittanceQuotes(params, {
      providers: [
        fakeProvider('alpha', { quotes: [rawQuote({ provider: 'alpha', receiveAmount: 18_800 })] }),
        fakeProvider('beta', { quotes: [rawQuote({ provider: 'beta', receiveAmount: 19_400 })] }),
      ],
    });

    // Ranking never depended on FX, so it survives a pricing outage.
    expect(result.best?.provider).toBe('beta');
    expect(result.midMarketFxRate).toBeNull();
    expect(result.best?.fxMarginPct).toBeNull();
  });

  it('rejects a send asset that is not a stablecoin we accept', async () => {
    await expect(
      getRemittanceQuotes({ ...params, sendAsset: 'BTC' }, { providers: [] })
    ).rejects.toThrow('Unsupported send asset: BTC');
  });

  it('rejects a destination outside the corridors we serve', async () => {
    await expect(
      getRemittanceQuotes({ ...params, destinationCountry: 'FR' }, { providers: [] })
    ).rejects.toThrow('Unsupported destination: FR');
  });

  it('rejects a payout method the corridor does not offer', async () => {
    // Mexico has no e-wallet rail in this model; the Philippines does.
    await expect(
      getRemittanceQuotes(
        { ...params, destinationCountry: 'MX', payoutMethod: 'ewallet' },
        { providers: [] }
      )
    ).rejects.toThrow('US-MX does not support payout method: ewallet');
  });

  it('rejects a non-positive amount', async () => {
    await expect(
      getRemittanceQuotes({ ...params, sendAmount: 0 }, { providers: [] })
    ).rejects.toThrow('positive number');
  });
});
