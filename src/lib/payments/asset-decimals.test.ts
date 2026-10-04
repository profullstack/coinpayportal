import { describe, it, expect } from 'vitest';
import { assetDecimals, atomicUnit, quantizeQuote, DEFAULT_QUOTE_DECIMALS } from './asset-decimals';
import { isSufficientPayment, settlementThreshold } from './tolerance';

describe('assetDecimals', () => {
  it('knows the six-decimal stablecoins on every chain', () => {
    for (const asset of ['USDC_ETH', 'USDC_POL', 'USDC_SOL', 'USDC_BASE', 'USDT_ETH', 'USDC']) {
      expect(assetDecimals(asset)).toBe(6);
    }
  });

  it('knows the native coins', () => {
    expect(assetDecimals('BTC')).toBe(8);
    expect(assetDecimals('SOL')).toBe(9);
    expect(assetDecimals('ETH')).toBe(18);
  });

  it('is case-insensitive', () => {
    expect(assetDecimals('usdc_eth')).toBe(6);
  });

  it('falls back to the historical eight places for an asset it does not know', () => {
    expect(assetDecimals('WHATEVER')).toBe(DEFAULT_QUOTE_DECIMALS);
    expect(assetDecimals(null)).toBe(DEFAULT_QUOTE_DECIMALS);
  });
});

describe('quantizeQuote', () => {
  /*
   * The payment that found this: $5.00 + fee quoted as 6.44064406 USDC. No
   * wallet can send that — USDC's smallest unit is 0.000001 — so the monitor
   * read 6.440644 against an expected 6.44064406 for fifteen minutes and the
   * payment expired with the money at the deposit address.
   */
  it('makes a USDC quote payable', () => {
    const quoted = quantizeQuote(6.44064406, 'USDC_ETH');
    expect(quoted).toBe(6.440645);
    // The decisive property: what a wallet sends for this quote settles it.
    expect(isSufficientPayment(quoted, quoted, 'USDC_ETH')).toBe(true);
  });

  it('never rounds down, so quantising cannot leave the merchant short', () => {
    expect(quantizeQuote(6.44064406, 'USDC_ETH')).toBeGreaterThanOrEqual(6.44064406);
    expect(quantizeQuote(5.01050105, 'USDC_POL')).toBeGreaterThanOrEqual(5.01050105);
  });

  it('leaves an amount that already fits the asset alone', () => {
    expect(quantizeQuote(5, 'USDC_ETH')).toBe(5);
    expect(quantizeQuote(0.05, 'USDC_ETH')).toBe(0.05);
    expect(quantizeQuote(6.440644, 'USDC_ETH')).toBe(6.440644);
    expect(quantizeQuote(0.00221692, 'SOL')).toBe(0.00221692);
  });

  it('leaves eight-decimal quotes on eight- and nine-decimal assets untouched', () => {
    expect(quantizeQuote(0.00006801, 'BTC')).toBe(0.00006801);
    expect(quantizeQuote(0.08689990, 'SOL')).toBe(0.0868999);
  });

  it('passes non-amounts through rather than inventing one', () => {
    expect(quantizeQuote(0, 'USDC_ETH')).toBe(0);
    expect(quantizeQuote(Number.NaN, 'USDC_ETH')).toBeNaN();
  });
});

describe('atomicUnit', () => {
  it('is the smallest movable amount of the asset', () => {
    expect(atomicUnit('USDC_ETH')).toBeCloseTo(1e-6, 12);
    expect(atomicUnit('BTC')).toBeCloseTo(1e-8, 14);
  });
});

describe('settlement of a quote written at the wrong precision', () => {
  // The rows already in the table, which no code change can re-quote.
  const expected = 6.44064406;
  const payable = 6.440644;

  it('settles the closest amount a USDC wallet can send', () => {
    expect(isSufficientPayment(payable, expected, 'USDC_ETH')).toBe(true);
  });

  it('still refuses a real underpayment of the same invoice', () => {
    expect(isSufficientPayment(6.44, expected, 'USDC_ETH')).toBe(false);
    expect(isSufficientPayment(6.440643, expected, 'USDC_ETH')).toBe(false);
  });

  it('tolerates about one atomic unit and no more', () => {
    const threshold = settlementThreshold(expected, 'USDC_ETH');
    const tolerated = expected - threshold;
    expect(tolerated).toBeGreaterThan(0);
    // Bounded by the smallest amount USDC can move — a millionth of a dollar.
    expect(tolerated).toBeCloseTo(atomicUnit('USDC_ETH'), 12);
    // And the bound is real: a balance a full unit short is still unpaid.
    expect(isSufficientPayment(6.440643, expected, 'USDC_ETH')).toBe(false);
  });

  it('keeps the old float-only slack when no asset is named', () => {
    expect(isSufficientPayment(payable, expected)).toBe(false);
    expect(isSufficientPayment(expected, expected)).toBe(true);
  });

  it('never settles a zero or missing balance, asset or not', () => {
    expect(isSufficientPayment(0, expected, 'USDC_ETH')).toBe(false);
    expect(isSufficientPayment(null, expected, 'USDC_ETH')).toBe(false);
    expect(isSufficientPayment(payable, null, 'USDC_ETH')).toBe(false);
  });
});
