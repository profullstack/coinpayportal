/**
 * Exact decimal <-> integer base-unit conversion. Money never goes through a
 * float here: "0.1" BTC must become exactly 10000000 sats.
 */

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

export function isPositiveDecimal(value: unknown): value is string {
  if (typeof value !== 'string' || !DECIMAL_RE.test(value.trim())) return false;
  return toBaseUnits(value, 18) > 0n;
}

/** "1.5", 8 -> 150000000n. Extra fractional digits are truncated, not rounded. */
export function toBaseUnits(value: string, decimals: number): bigint {
  const m = DECIMAL_RE.exec(value.trim());
  if (!m) throw new Error(`Not a decimal amount: ${value}`);
  const whole = m[1];
  const frac = (m[2] ?? '').slice(0, decimals).padEnd(decimals, '0');
  return BigInt(whole + frac);
}

/** 150000000n, 8 -> "1.5" */
export function fromBaseUnits(units: bigint | string, decimals: number): string {
  const n = typeof units === 'bigint' ? units : BigInt(units);
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals) || '0';
  const frac = decimals > 0 ? s.slice(s.length - decimals).replace(/0+$/, '') : '';
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Compare two non-negative decimal strings exactly. */
export function compareDecimal(a: string, b: string): number {
  const ua = toBaseUnits(a, 18);
  const ub = toBaseUnits(b, 18);
  return ua === ub ? 0 : ua > ub ? 1 : -1;
}
