/**
 * Base-unit to decimal-string conversion.
 *
 * Done with BigInt and string surgery rather than division, because the
 * largest chain here carries 18 decimals and a double holds about 15-16
 * significant digits. `Number(wei) / 1e18` silently rounds off the low end of
 * an ETH value, and the low end is exactly what someone opens an explorer to
 * check.
 */

/** Format a base-unit amount (satoshis, wei, lamports, drops) for display. */
export function fromBaseUnits(value: bigint | string | number, decimals: number): string {
  let v: bigint;
  try {
    v = typeof value === 'bigint' ? value : BigInt(String(value).split('.')[0] || '0');
  } catch {
    return '0';
  }

  const negative = v < 0n;
  if (negative) v = -v;

  const scale = 10n ** BigInt(decimals);
  const whole = v / scale;
  const fraction = v % scale;

  let out = whole.toString();
  if (fraction > 0n) {
    // Pad to the full width, then drop trailing zeros so 0.50 reads as 0.5.
    const frac = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
    out += `.${frac}`;
  }
  return negative ? `-${out}` : out;
}

/** Sum a list of base-unit numbers safely. */
export function sumBaseUnits(values: Array<number | string | bigint | undefined | null>): bigint {
  return values.reduce<bigint>((acc, v) => {
    if (v === undefined || v === null) return acc;
    try {
      return acc + BigInt(String(v).split('.')[0] || '0');
    } catch {
      return acc;
    }
  }, 0n);
}

/** Parse a `0x`-prefixed quantity from JSON-RPC. Returns 0n when absent. */
export function fromHex(value: unknown): bigint {
  if (typeof value !== 'string' || !value.startsWith('0x')) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}
