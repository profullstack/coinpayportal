/**
 * Fiat conversion rules. The distinction these tests pin down is
 * "no rate" (null) vs "worth nothing" (0) — collapsing the two would let the
 * Send tab price a payment at zero when the rate feed is simply down.
 */

import { describe, it, expect } from 'vitest';

import {
  FIAT_CURRENCIES,
  DEFAULT_FIAT,
  isFiatCurrency,
  toFiatCurrency,
  cryptoToFiat,
  fiatToCrypto,
  formatFiat,
  formatCrypto,
} from '../fiat.js';

describe('currency codes', () => {
  it('defaults to USD and includes it', () => {
    expect(DEFAULT_FIAT).toBe('USD');
    expect(FIAT_CURRENCIES.some((c) => c.code === 'USD')).toBe(true);
  });

  it('accepts supported codes only', () => {
    expect(isFiatCurrency('EUR')).toBe(true);
    expect(isFiatCurrency('usd')).toBe(false); // case-sensitive by design
    expect(isFiatCurrency('XYZ')).toBe(false);
    expect(isFiatCurrency(undefined)).toBe(false);
  });

  it('normalizes stored/user input, falling back to USD', () => {
    expect(toFiatCurrency('eur')).toBe('EUR');
    expect(toFiatCurrency(' gbp ')).toBe('GBP');
    expect(toFiatCurrency('DOGE')).toBe('USD');
    expect(toFiatCurrency(null)).toBe('USD');
  });
});

describe('cryptoToFiat', () => {
  it('prices an amount at the given rate', () => {
    expect(cryptoToFiat('0.5', 60000)).toBe(30000);
    expect(cryptoToFiat(2, 1.5)).toBe(3);
  });

  it('returns null rather than a number for unusable input', () => {
    expect(cryptoToFiat('', 60000)).toBeNull();
    expect(cryptoToFiat('abc', 60000)).toBeNull();
    expect(cryptoToFiat('1', 0)).toBeNull();
    expect(cryptoToFiat('1', Number.NaN)).toBeNull();
  });

  it('prices a genuine zero as zero, not as missing', () => {
    expect(cryptoToFiat('0', 60000)).toBe(0);
  });
});

describe('fiatToCrypto', () => {
  it('inverts cryptoToFiat', () => {
    expect(fiatToCrypto('30000', 60000)).toBe(0.5);
  });

  it('returns null when the rate is unusable', () => {
    expect(fiatToCrypto('10', 0)).toBeNull();
    expect(fiatToCrypto('10', -1)).toBeNull();
  });
});

describe('formatFiat', () => {
  it('renders normal amounts with two decimals', () => {
    expect(formatFiat(1234.5, 'USD')).toMatch(/1,?234\.50/);
  });

  it('keeps precision below a cent so micro-payments are not shown as free', () => {
    const formatted = formatFiat(0.00042, 'USD');
    expect(formatted).not.toMatch(/^\D*0\.00$/);
    expect(formatted).toMatch(/0\.0004/);
  });
});

describe('formatCrypto', () => {
  it('trims trailing zeros but keeps satoshi precision', () => {
    expect(formatCrypto(0.5)).toBe('0.5');
    expect(formatCrypto(1)).toBe('1');
    expect(formatCrypto(0.00000001)).toBe('0.00000001');
  });
});
