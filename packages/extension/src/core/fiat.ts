/**
 * Fiat display currencies and crypto↔fiat conversion.
 *
 * The list mirrors the portal's `SUPPORTED_FIAT_CURRENCIES`
 * (src/lib/web-wallet/settings.ts) because `GET /api/rates` only accepts those
 * codes — anything else is silently coerced to USD server-side, which would
 * show the user a number labelled with a currency it isn't. Keep the two lists
 * in sync; the extension validates locally so a bad code never reaches the API.
 */

export const FIAT_CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'CHF', symbol: 'Fr', name: 'Swiss Franc' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
] as const;

export type FiatCurrency = (typeof FIAT_CURRENCIES)[number]['code'];

/** What the wallet shows until the user picks something else. */
export const DEFAULT_FIAT: FiatCurrency = 'USD';

export function isFiatCurrency(value: unknown): value is FiatCurrency {
  return typeof value === 'string' && FIAT_CURRENCIES.some((c) => c.code === value);
}

/** Normalize anything (stored value, message payload) to a supported code. */
export function toFiatCurrency(value: unknown): FiatCurrency {
  const upper = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return isFiatCurrency(upper) ? upper : DEFAULT_FIAT;
}

export function fiatSymbol(code: FiatCurrency): string {
  return FIAT_CURRENCIES.find((c) => c.code === code)?.symbol ?? '';
}

/**
 * Value of `amount` units of a coin, in fiat. Returns null for anything that
 * isn't a usable pair so callers render "unavailable" instead of "0.00" — a
 * missing rate and a zero-value payment must not look the same.
 */
export function cryptoToFiat(amount: string | number, rate: number): number | null {
  const value = parseAmount(amount);
  if (value === null || !Number.isFinite(rate) || rate <= 0) return null;
  return value * rate;
}

/** Inverse of `cryptoToFiat` — how much coin a fiat amount buys. */
export function fiatToCrypto(amount: string | number, rate: number): number | null {
  const value = parseAmount(amount);
  if (value === null || !Number.isFinite(rate) || rate <= 0) return null;
  return value / rate;
}

/**
 * Numeric value of an amount, or null if there isn't one. Empty/blank input is
 * rejected explicitly: `Number('')` is 0, which would render an empty field as
 * a zero-value payment instead of "nothing entered yet".
 */
function parseAmount(amount: string | number): number | null {
  if (typeof amount === 'string' && amount.trim() === '') return null;
  const value = Number(amount);
  return Number.isFinite(value) ? value : null;
}

/**
 * Format a fiat amount for display. Sub-cent values keep extra digits: a
 * fraction of a cent is a real amount for micro-payments and rounding it to
 * "$0.00" reads as free.
 */
export function formatFiat(amount: number, code: FiatCurrency): string {
  if (!Number.isFinite(amount)) return '';
  const abs = Math.abs(amount);
  const extraDigits = abs > 0 && abs < 0.01;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      ...(extraDigits ? { minimumFractionDigits: 2, maximumFractionDigits: 6 } : {}),
    }).format(amount);
  } catch {
    // Intl currency data missing (very old engines) — the symbol carries it.
    return `${fiatSymbol(code)}${amount.toFixed(extraDigits ? 6 : 2)}`;
  }
}

/**
 * Format a coin amount: 8 decimals covers a satoshi, trailing zeros trimmed so
 * "0.50000000" doesn't crowd the popup.
 */
export function formatCrypto(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  const fixed = amount.toFixed(8);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}
