/**
 * Exact money arithmetic for the finance reports.
 *
 * Every authoritative total in a report is computed here or in Postgres, never
 * through `Number`. A JavaScript double cannot hold 0.10, so summing a ledger
 * with `+` drifts by a fraction of a cent per thousand rows — small enough to
 * pass a glance, large enough to make a statement fail to reconcile.
 *
 * The representation is a bigint of ten-thousandths, matching the
 * `numeric(20,4)` storage the finance tables already use. That scale is the
 * explicit precision policy: a provider value with more than four decimals is
 * rejected at validation time rather than rounded, because a silently rounded
 * amount is one the statement will never agree with. Widening the scale is a
 * deliberate migration, not something this module does on its own.
 */

/** Decimal places carried by every amount. Matches `numeric(20,4)`. */
export const AMOUNT_SCALE = 4;

/** Integer digits allowed by `numeric(20,4)`. */
const MAX_INTEGER_DIGITS = 16;

const SCALE_FACTOR = 10n ** BigInt(AMOUNT_SCALE);

/**
 * A validated amount: an optional sign, digits, and at most four decimals,
 * with no leading zeros, no trailing fractional zeros and no negative zero.
 * This is the form stored in report datasets and emitted in JSON/CSV.
 */
export type ExactAmount = string;

/** Thousands separators are only accepted in the one unambiguous layout. */
const GROUPED = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const PLAIN = /^[+-]?(\d+)(\.(\d*))?$|^[+-]?\.(\d+)$/;

/**
 * Parse a provider amount into an exact amount, or `null` when it cannot be
 * represented exactly under the precision policy.
 *
 * Accepts decimal strings (what SimpleFIN sends) and finite numbers (what
 * PostgREST returns for a `numeric` column — exact for every value the column
 * can hold, since a double round-trips sixteen significant digits and the
 * shortest representation JavaScript prints is the decimal Postgres stored).
 * Rejects exponents, NaN, more than four decimals and more than sixteen
 * integer digits.
 */
export function parseExactAmount(value: unknown): ExactAmount | null {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    text = value.toString();
    if (/e/i.test(text)) return null;
  } else if (typeof value === 'string') {
    text = value.trim();
  } else if (typeof value === 'bigint') {
    text = value.toString();
  } else {
    return null;
  }

  if (!text) return null;
  if (GROUPED.test(text)) text = text.replace(/,/g, '');
  if (!PLAIN.test(text)) return null;

  let negative = false;
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  const dot = text.indexOf('.');
  const intPart = (dot === -1 ? text : text.slice(0, dot)).replace(/^0+(?=\d)/, '') || '0';
  const fracRaw = dot === -1 ? '' : text.slice(dot + 1);
  const frac = fracRaw.replace(/0+$/, '');

  if (frac.length > AMOUNT_SCALE) return null;
  if (intPart.length > MAX_INTEGER_DIGITS) return null;

  const units = BigInt(intPart) * SCALE_FACTOR + BigInt((frac + '0'.repeat(AMOUNT_SCALE)).slice(0, AMOUNT_SCALE));
  return fromUnits(negative ? -units : units);
}

/** Whether a value is already a canonical exact amount. */
export function isExactAmount(value: unknown): value is ExactAmount {
  return typeof value === 'string' && parseExactAmount(value) === value;
}

/** Ten-thousandths as a bigint. Throws on anything not exact. */
export function toUnits(amount: ExactAmount): bigint {
  const canonical = parseExactAmount(amount);
  if (canonical === null) throw new Error(`Not an exact amount: ${String(amount)}`);
  let text = canonical;
  let negative = false;
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }
  const dot = text.indexOf('.');
  const intPart = dot === -1 ? text : text.slice(0, dot);
  const frac = dot === -1 ? '' : text.slice(dot + 1);
  const units = BigInt(intPart) * SCALE_FACTOR + BigInt((frac + '0'.repeat(AMOUNT_SCALE)).slice(0, AMOUNT_SCALE));
  return negative ? -units : units;
}

/** Canonical string for a bigint of ten-thousandths. */
export function fromUnits(units: bigint): ExactAmount {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const intPart = (magnitude / SCALE_FACTOR).toString();
  const frac = (magnitude % SCALE_FACTOR).toString().padStart(AMOUNT_SCALE, '0').replace(/0+$/, '');
  const body = frac ? `${intPart}.${frac}` : intPart;
  return negative && magnitude !== 0n ? `-${body}` : body;
}

export function addAmounts(a: ExactAmount, b: ExactAmount): ExactAmount {
  return fromUnits(toUnits(a) + toUnits(b));
}

export function subtractAmounts(a: ExactAmount, b: ExactAmount): ExactAmount {
  return fromUnits(toUnits(a) - toUnits(b));
}

export function negateAmount(a: ExactAmount): ExactAmount {
  return fromUnits(-toUnits(a));
}

export function sumAmounts(amounts: Iterable<ExactAmount>): ExactAmount {
  let total = 0n;
  for (const amount of amounts) total += toUnits(amount);
  return fromUnits(total);
}

/** -1, 0 or 1. */
export function compareAmounts(a: ExactAmount, b: ExactAmount): -1 | 0 | 1 {
  const x = toUnits(a);
  const y = toUnits(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isNegativeAmount(a: ExactAmount): boolean {
  return toUnits(a) < 0n;
}

export function isZeroAmount(a: ExactAmount): boolean {
  return toUnits(a) === 0n;
}

/**
 * Render with a fixed number of decimals for display. Rounds half away from
 * zero when the requested precision is below the stored scale — this is for a
 * printed column, never for a value that will be summed again.
 */
export function formatFixed(amount: ExactAmount, decimals = 2): string {
  const units = toUnits(amount);
  const negative = units < 0n;
  let magnitude = negative ? -units : units;

  if (decimals < AMOUNT_SCALE) {
    const drop = 10n ** BigInt(AMOUNT_SCALE - decimals);
    magnitude = (magnitude + drop / 2n) / drop;
  } else if (decimals > AMOUNT_SCALE) {
    magnitude *= 10n ** BigInt(decimals - AMOUNT_SCALE);
  }

  const divisor = 10n ** BigInt(decimals);
  const intPart = (magnitude / divisor).toString();
  const frac = decimals > 0 ? '.' + (magnitude % divisor).toString().padStart(decimals, '0') : '';
  const body = `${intPart}${frac}`;
  return negative && magnitude !== 0n ? `-${body}` : body;
}

/**
 * Decimal places conventionally shown for a currency. Only standard ISO codes
 * are looked up; anything else is displayed at full stored precision, since a
 * custom currency identifier promises nothing about its minor unit.
 */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'XOF', 'XAF', 'PYG', 'UGX', 'RWF']);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);
const ISO_CODE = /^[A-Z]{3}$/;

export function displayDecimalsFor(currency: string): number {
  if (!ISO_CODE.test(currency)) return AMOUNT_SCALE;
  if (ZERO_DECIMAL.has(currency)) return 0;
  if (THREE_DECIMAL.has(currency)) return 3;
  return 2;
}

/**
 * Normalise a currency identifier. ISO codes are upper-cased; anything else —
 * SimpleFIN allows a URL describing a custom currency — is kept exactly as
 * sent, case included, so two identifiers that differ only in case are never
 * merged into one bucket.
 */
export function normalizeCurrency(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'USD';
  const trimmed = value.trim();
  return /^[A-Za-z]{3}$/.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}
