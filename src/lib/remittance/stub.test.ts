import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StubRemittanceProvider } from './stub';
import { priceAgainstMidMarket, rankQuotes } from './router';

describe('StubRemittanceProvider', () => {
  const originalEnv = process.env;
  const provider = new StubRemittanceProvider();

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('stays off unless explicitly enabled', () => {
    delete process.env.REMITTANCE_ENABLE_STUB;
    expect(provider.isConfigured()).toBe(false);

    process.env.REMITTANCE_ENABLE_STUB = '1';
    process.env.NODE_ENV = 'development';
    expect(provider.isConfigured()).toBe(true);
  });

  it('refuses to run in production even when the flag is set', () => {
    // A fabricated quote shown to someone sending money to their family is
    // worse than showing them no quote at all.
    process.env.REMITTANCE_ENABLE_STUB = '1';
    process.env.NODE_ENV = 'production';
    expect(provider.isConfigured()).toBe(false);
  });

  it('quotes both corridors in the right currency', async () => {
    const mx = await provider.quote({
      sendAsset: 'USDC',
      sendAmount: 500,
      destinationCountry: 'MX',
    });
    const ph = await provider.quote({
      sendAsset: 'USDC',
      sendAmount: 500,
      destinationCountry: 'PH',
    });

    expect(mx[0].payoutCurrency).toBe('MXN');
    expect(ph[0].payoutCurrency).toBe('PHP');
  });

  it('returns nothing for a corridor we do not serve', async () => {
    expect(
      await provider.quote({ sendAsset: 'USDC', sendAmount: 500, destinationCountry: 'FR' })
    ).toEqual([]);
  });

  it('labels every synthetic quote as not a real offer', async () => {
    const quotes = await provider.quote({
      sendAsset: 'USDC',
      sendAmount: 500,
      destinationCountry: 'MX',
    });

    for (const quote of quotes) {
      expect(quote.warnings).toContain('Synthetic quote from the development stub — not a real offer');
    }
  });

  it('reproduces the trap the router exists to catch', async () => {
    // One stub partner charges a flat $1.99 and takes 4.4% in the rate; the
    // other charges 1.5% and takes 0.3%. Ranked on fee, the family gets less.
    const quotes = await provider.quote({
      sendAsset: 'USDC',
      sendAmount: 1000,
      destinationCountry: 'MX',
    });

    const ranked = rankQuotes(quotes.map((q) => priceAgainstMidMarket(q, 1000, 18.5)));

    const winner = ranked[0];
    const loser = ranked[ranked.length - 1];

    expect(winner.receiveAmount).toBeGreaterThan(loser.receiveAmount);
    expect(winner.fees.total).toBeGreaterThan(loser.fees.total);
    expect(winner.allInCostPct!).toBeLessThan(loser.allInCostPct!);
  });
});
