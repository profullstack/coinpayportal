import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StubOnrampProvider } from './stub';
import { priceAgainstSpot, rankQuotes } from './router';

describe('StubOnrampProvider', () => {
  const originalEnv = process.env;
  const provider = new StubOnrampProvider();

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('stays off unless explicitly enabled', () => {
    delete process.env.ONRAMP_ENABLE_STUB;
    expect(provider.isConfigured()).toBe(false);

    process.env.ONRAMP_ENABLE_STUB = '1';
    process.env.NODE_ENV = 'development';
    expect(provider.isConfigured()).toBe(true);
  });

  it('refuses to run in production even when the flag is set', () => {
    // A fabricated quote shown to someone about to spend real money is worse
    // than showing them no quote at all.
    process.env.ONRAMP_ENABLE_STUB = '1';
    process.env.NODE_ENV = 'production';
    expect(provider.isConfigured()).toBe(false);
  });

  it('labels every synthetic quote as not a real offer', async () => {
    const quotes = await provider.quote({
      fiatCurrency: 'USD',
      fiatAmount: 500,
      cryptoAsset: 'BTC',
    });

    expect(quotes.length).toBeGreaterThan(0);
    for (const quote of quotes) {
      expect(quote.warnings).toContain('Synthetic quote from the development stub — not a real offer');
    }
  });

  it('honours a payment-method filter', async () => {
    const quotes = await provider.quote({
      fiatCurrency: 'USD',
      fiatAmount: 500,
      cryptoAsset: 'BTC',
      paymentMethod: 'card',
    });

    expect(quotes.every((q) => q.paymentMethod === 'card')).toBe(true);
  });

  it('reproduces the trap the router exists to catch', async () => {
    // The stub deliberately contains a source whose disclosed fee is lower but
    // whose delivered amount is worse. If ranking ever regresses to sorting on
    // fee percentage, this test fails.
    const quotes = await provider.quote({
      fiatCurrency: 'USD',
      fiatAmount: 1000,
      cryptoAsset: 'BTC',
      paymentMethod: 'bank_transfer',
    });

    const ranked = rankQuotes(quotes.map((q) => priceAgainstSpot(q, 95_000)));

    const winner = ranked[0];
    const loser = ranked[ranked.length - 1];

    expect(winner.receiveAmount).toBeGreaterThan(loser.receiveAmount);
    expect(winner.fees.total).toBeGreaterThan(loser.fees.total);
    expect(winner.allInCostPct!).toBeLessThan(loser.allInCostPct!);
  });
});
