import { describe, it, expect } from 'vitest';
import {
  parseExactAmount,
  sumAmounts,
  addAmounts,
  subtractAmounts,
  compareAmounts,
  formatFixed,
  toUnits,
  fromUnits,
  normalizeCurrency,
  displayDecimalsFor,
  isExactAmount,
} from './decimal';

describe('parseExactAmount', () => {
  it('keeps decimal strings exact and canonical', () => {
    expect(parseExactAmount('0.10')).toBe('0.1');
    expect(parseExactAmount('-1500.00')).toBe('-1500');
    expect(parseExactAmount('1,234.56')).toBe('1234.56');
    expect(parseExactAmount('+7.5')).toBe('7.5');
    expect(parseExactAmount('.25')).toBe('0.25');
    expect(parseExactAmount('007.1000')).toBe('7.1');
    expect(parseExactAmount('-0.0000')).toBe('0');
  });

  it('accepts what PostgREST returns for numeric(20,4)', () => {
    expect(parseExactAmount(12.34)).toBe('12.34');
    expect(parseExactAmount(-0.1)).toBe('-0.1');
    expect(parseExactAmount(1e21)).toBeNull();
    expect(parseExactAmount(Number.NaN)).toBeNull();
  });

  it('rejects precision the storage cannot hold rather than rounding', () => {
    // A fifth decimal would be silently rounded by numeric(20,4); the
    // statement it came from would then never reconcile.
    expect(parseExactAmount('1.00001')).toBeNull();
    expect(parseExactAmount('0.12345')).toBeNull();
    expect(parseExactAmount('12345678901234567.00')).toBeNull();
  });

  it('rejects junk', () => {
    expect(parseExactAmount('n/a')).toBeNull();
    expect(parseExactAmount('')).toBeNull();
    expect(parseExactAmount('1e3')).toBeNull();
    expect(parseExactAmount('12,34')).toBeNull();
    expect(parseExactAmount(null)).toBeNull();
    expect(parseExactAmount({})).toBeNull();
  });
});

describe('arithmetic', () => {
  it('sums 0.10 + 0.20 to exactly 0.30', () => {
    expect(addAmounts('0.10', '0.20')).toBe('0.3');
    expect(sumAmounts(['0.1', '0.2', '0.3'])).toBe('0.6');
  });

  it('does not drift over many rows', () => {
    const rows = Array.from({ length: 10_000 }, () => '0.01');
    expect(sumAmounts(rows)).toBe('100');
  });

  it('handles large magnitudes', () => {
    expect(addAmounts('9999999999999999.9999', '0.0001')).toBe('10000000000000000');
    expect(subtractAmounts('0', '0.0001')).toBe('-0.0001');
  });

  it('compares by value', () => {
    expect(compareAmounts('1.5', '1.50')).toBe(0);
    expect(compareAmounts('-2', '1')).toBe(-1);
    expect(compareAmounts('2', '1.9999')).toBe(1);
  });

  it('round-trips units', () => {
    expect(toUnits('-12.3456')).toBe(-123456n);
    expect(fromUnits(123456n)).toBe('12.3456');
    expect(fromUnits(0n)).toBe('0');
    expect(fromUnits(-5n)).toBe('-0.0005');
  });

  it('recognises canonical strings', () => {
    expect(isExactAmount('12.5')).toBe(true);
    expect(isExactAmount('12.50')).toBe(false);
    expect(isExactAmount(12.5)).toBe(false);
  });
});

describe('formatFixed', () => {
  it('pads and rounds only for display', () => {
    expect(formatFixed('12.5', 2)).toBe('12.50');
    expect(formatFixed('12.345', 2)).toBe('12.35');
    expect(formatFixed('-12.345', 2)).toBe('-12.35');
    expect(formatFixed('-0.004', 2)).toBe('0.00');
    expect(formatFixed('1234', 0)).toBe('1234');
    expect(formatFixed('1.5', 3)).toBe('1.500');
  });
});

describe('currencies', () => {
  it('upper-cases ISO codes and preserves custom identifiers exactly', () => {
    expect(normalizeCurrency('usd')).toBe('USD');
    expect(normalizeCurrency('https://example.com/Points')).toBe('https://example.com/Points');
    expect(normalizeCurrency('')).toBe('USD');
  });

  it('knows the display decimals for common ISO codes', () => {
    expect(displayDecimalsFor('USD')).toBe(2);
    expect(displayDecimalsFor('JPY')).toBe(0);
    expect(displayDecimalsFor('KWD')).toBe(3);
    expect(displayDecimalsFor('https://example.com/points')).toBe(4);
  });
});
