/**
 * Shared analytics series builder.
 *
 * Extracted from `/api/stripe/analytics` so the merchant dashboard, the admin
 * stats page and any future scoped view all bucket transactions the same way.
 * Everything here is pure: it takes already-fetched rows and returns numbers,
 * so the caller owns the authorization boundary (a merchant route scopes by
 * business_id, the admin route does not scope at all).
 *
 * Money conventions in this schema are inconsistent and easy to get wrong:
 *   - `payments.amount` is USD; `payments.fee_amount` is CHAIN units.
 *   - `stripe_transactions.amount` / `platform_fee_amount` are minor units.
 *   - `escrows.amount_usd` is USD; `escrows.amount` is chain units.
 * The getters below are the only place those conversions should happen.
 */

export const TREND_DAYS = 14;

export type SeriesGranularity = 'day' | 'week' | 'month';

export type SeriesPoint = {
  label: string;
  crypto_volume_usd: number;
  card_volume_usd: number;
  total_volume_usd: number;
  crypto_count: number;
  card_count: number;
  total_count: number;
  /** Platform commission only — never the Stripe processing fee. */
  crypto_commission_usd: number;
  card_commission_usd: number;
  total_commission_usd: number;
};

export function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Settled crypto payment.
 *
 * `confirmed` means the funds arrived on-chain; `forwarded` means they were
 * then swept to the merchant. Both are money the merchant received, and both
 * are what `public_landing_stats()` and `admin_platform_stats()` count as
 * settled — this predicate has to agree with them or the dashboard and the
 * admin console tell different stories about the same rows.
 *
 * `completed` is retained only because other tables use that spelling; no
 * `payments` row has ever had it. It was the ONLY success value listed here
 * alongside `forwarded`/`forwarding`, which meant every `confirmed` payment
 * was charted as if it had failed — 633 rows and $36.4k of volume as of
 * 2026-08-23, i.e. 96% of all settled crypto volume.
 */
export function isSuccessfulCryptoStatus(status: unknown): boolean {
  return ['confirmed', 'completed', 'forwarded', 'forwarding'].includes(
    String(status || '').toLowerCase()
  );
}

export function isSuccessfulCardStatus(status: unknown): boolean {
  return ['completed', 'succeeded'].includes(String(status || '').toLowerCase());
}

export function isFailedCryptoStatus(status: unknown): boolean {
  return ['failed', 'expired', 'forwarding_failed', 'settle_failed', 'settlement_failed']
    .includes(String(status || '').toLowerCase());
}

export function isFailedCardStatus(status: unknown): boolean {
  return ['failed', 'canceled', 'cancelled', 'requires_payment_method']
    .includes(String(status || '').toLowerCase());
}

export function getCryptoVolumeUsd(payment: any): number {
  return toNumber(payment.amount ?? payment.amount_usd);
}

/**
 * Convert a crypto payment's chain-denominated `fee_amount` into USD by the
 * same ratio the payment itself settled at. Summing `fee_amount` directly
 * across currencies is meaningless — 0.0001 BTC and 0.0001 SOL are not
 * comparable — so every USD figure has to go through this.
 */
export function getCryptoFeeUsd(payment: any): number {
  const feeUsd = toNumber(payment.fee_usd);
  if (feeUsd > 0) return feeUsd;

  const feeAmount = toNumber(payment.fee_amount);
  const cryptoAmount = toNumber(payment.crypto_amount);
  const usdAmount = getCryptoVolumeUsd(payment);

  if (feeAmount > 0 && cryptoAmount > 0 && usdAmount > 0) {
    return (feeAmount / cryptoAmount) * usdAmount;
  }

  return 0;
}

export function getCardVolumeUsd(transaction: any): number {
  const amountCents = toNumber(transaction.amount);
  if (amountCents > 0) return amountCents / 100;
  return toNumber(transaction.amount_usd);
}

/**
 * Total fees the merchant was charged: Stripe's cut plus ours. This is what a
 * merchant wants to see on their own dashboard.
 */
export function getCardFeeUsd(transaction: any): number {
  return (
    toNumber(transaction.stripe_fee_amount ?? transaction.stripe_fee) +
    toNumber(transaction.platform_fee_amount ?? transaction.platform_fee)
  ) / 100;
}

/**
 * Our commission alone, excluding Stripe's processing fee. This is platform
 * revenue and is deliberately NOT the same number as `getCardFeeUsd`.
 */
export function getCardCommissionUsd(transaction: any): number {
  return toNumber(transaction.platform_fee_amount ?? transaction.platform_fee) / 100;
}

export function startOfUTCDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

/**
 * Build a bucketed time series (successful volume, commission and transaction
 * counts, split by rail) over [windowStart, windowEnd). Granularity adapts to
 * the span so the chart never has thousands of points: daily up to ~3 months,
 * weekly up to ~2 years, monthly beyond that.
 */
export function buildSeries(
  cryptoPayments: any[],
  cardTransactions: any[],
  windowStart: Date,
  windowEnd: Date
): { granularity: SeriesGranularity; points: SeriesPoint[] } {
  const dayMs = 86400000;
  const start = startOfUTCDay(windowStart);
  const spanDays = Math.max(1, Math.ceil((windowEnd.getTime() - start.getTime()) / dayMs));
  const granularity: SeriesGranularity =
    spanDays <= 92 ? 'day' : spanDays <= 740 ? 'week' : 'month';

  const indexOf = (t: number): number => {
    if (granularity === 'month') {
      const d = new Date(t);
      return (d.getUTCFullYear() - start.getUTCFullYear()) * 12 + (d.getUTCMonth() - start.getUTCMonth());
    }
    const binMs = granularity === 'week' ? 7 * dayMs : dayMs;
    return Math.floor((t - start.getTime()) / binMs);
  };
  const labelForIndex = (i: number): string => {
    if (granularity === 'month') {
      const dt = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      return dt.toISOString().slice(0, 7); // YYYY-MM
    }
    const binMs = granularity === 'week' ? 7 * dayMs : dayMs;
    return new Date(start.getTime() + i * binMs).toISOString().slice(0, 10); // YYYY-MM-DD
  };

  const lastIndex = Math.max(0, indexOf(windowEnd.getTime() - 1));
  const points: SeriesPoint[] = [];
  for (let i = 0; i <= lastIndex; i++) {
    points.push({
      label: labelForIndex(i),
      crypto_volume_usd: 0,
      card_volume_usd: 0,
      total_volume_usd: 0,
      crypto_count: 0,
      card_count: 0,
      total_count: 0,
      crypto_commission_usd: 0,
      card_commission_usd: 0,
      total_commission_usd: 0,
    });
  }

  const add = (rows: any[], kind: 'crypto' | 'card') => {
    for (const row of rows || []) {
      if (!row.created_at) continue;
      const t = new Date(row.created_at).getTime();
      if (t < start.getTime() || t >= windowEnd.getTime()) continue;
      const i = indexOf(t);
      if (i < 0 || i >= points.length) continue;
      const p = points[i];
      if (kind === 'crypto') {
        p.crypto_count += 1;
        p.total_count += 1;
        if (isSuccessfulCryptoStatus(row.status)) {
          const v = getCryptoVolumeUsd(row);
          p.crypto_volume_usd += v;
          p.total_volume_usd += v;
          const c = getCryptoFeeUsd(row);
          p.crypto_commission_usd += c;
          p.total_commission_usd += c;
        }
      } else {
        p.card_count += 1;
        p.total_count += 1;
        if (isSuccessfulCardStatus(row.status)) {
          const v = getCardVolumeUsd(row);
          p.card_volume_usd += v;
          p.total_volume_usd += v;
          const c = getCardCommissionUsd(row);
          p.card_commission_usd += c;
          p.total_commission_usd += c;
        }
      }
    }
  };
  add(cryptoPayments, 'crypto');
  add(cardTransactions, 'card');

  for (const p of points) {
    p.crypto_volume_usd = Number(p.crypto_volume_usd.toFixed(2));
    p.card_volume_usd = Number(p.card_volume_usd.toFixed(2));
    p.total_volume_usd = Number(p.total_volume_usd.toFixed(2));
    p.crypto_commission_usd = Number(p.crypto_commission_usd.toFixed(2));
    p.card_commission_usd = Number(p.card_commission_usd.toFixed(2));
    p.total_commission_usd = Number(p.total_commission_usd.toFixed(2));
  }

  return { granularity, points };
}
