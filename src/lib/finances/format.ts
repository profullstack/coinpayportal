/**
 * Display helpers for money and dates on /finances.
 *
 * Pure and separate from the components so the rounding and sign rules can be
 * tested directly — a balance sheet that renders "-$0.00" or drops a minus sign
 * is worse than no balance sheet.
 */

/**
 * Format an amount in its own currency.
 *
 * Falls back to a plain fixed-decimal string when the currency code is not one
 * `Intl` recognises, rather than throwing and taking the page down with it.
 */
export function formatMoney(
  amount: number | null | undefined,
  currency = 'USD',
  { signed = false }: { signed?: boolean } = {},
): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';

  // Negative zero renders as "-$0.00", which reads as a debt that isn't there.
  const value = Object.is(amount, -0) ? 0 : amount;

  let formatted: string;
  try {
    formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(value));
  } catch {
    formatted = `${currency || ''} ${Math.abs(value).toFixed(2)}`.trim();
  }

  if (value < 0) return `-${formatted}`;
  if (signed && value > 0) return `+${formatted}`;
  return formatted;
}

/** Compact form for headline tiles: $33.9k, $1.2M. */
export function formatCompact(amount: number | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  const abs = Math.abs(amount);
  if (abs < 10_000) return formatMoney(amount, currency);

  try {
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(Math.abs(amount));
    return amount < 0 ? `-${formatted}` : formatted;
  } catch {
    return formatMoney(amount, currency);
  }
}

/** `2026-08-19` → `19 Aug 2026`. Dates only; these are calendar days, not instants. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** "3 hours ago" / "just now", for sync freshness. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'never';

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';

  const units: Array<[number, string]> = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
  ];

  let label = 'minute';
  let divisor = 60;
  for (const [unitSeconds, unitLabel] of units) {
    if (seconds >= unitSeconds) {
      divisor = unitSeconds;
      label = unitLabel;
    }
  }

  const count = Math.floor(seconds / divisor);
  return `${count} ${label}${count === 1 ? '' : 's'} ago`;
}

/** Percentage of a whole, guarding the zero-total case that would give NaN. */
export function percentOf(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(Math.max((part / total) * 100, 0), 100);
}
