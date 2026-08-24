/**
 * Platform-wide analytics for the admin stats console.
 *
 * Deliberately unscoped: every row on the platform, across every merchant.
 * That makes this module the whole blast radius of an authorization mistake,
 * so nothing outside an admin-guarded route may import it — same contract as
 * `admin-user-stats.ts`.
 *
 * Aggregation happens here rather than in SQL so it shares `buildSeries()`
 * with the merchant dashboard: one bucketing implementation, one set of money
 * conversions, no drift between what a merchant sees and what we see.
 */

import { getSupabaseAdmin } from '@/lib/supabase/server';
import {
  buildSeries,
  getCardCommissionUsd,
  getCardVolumeUsd,
  getCryptoFeeUsd,
  getCryptoVolumeUsd,
  isFailedCardStatus,
  isFailedCryptoStatus,
  isSuccessfulCardStatus,
  isSuccessfulCryptoStatus,
  toNumber,
  type SeriesGranularity,
  type SeriesPoint,
} from './analytics-series';

/**
 * A handful of test rows carry absurd amounts (a single expired BTC payment of
 * ~$1e9). They are all `expired` so they never reach a volume figure, but they
 * would wreck an axis if a status filter ever changed, so they are capped out
 * at the source.
 */
const MAX_PLAUSIBLE_USD = 1_000_000;

/** Supabase caps a single select at 1000 rows; page through anything larger. */
const PAGE_SIZE = 1000;

export type CommissionSummary = {
  /** Commission recorded against settled crypto payments, in USD. */
  cryptoAccruedUsd: number;
  /** Commission with an on-chain sweep transaction — money that actually moved. */
  cryptoCollectedUsd: number;
  cryptoSweepCount: number;
  /** Platform fee on completed Stripe charges (never Stripe's own processing fee). */
  cardCommissionUsd: number;
  /** Completed charges that recorded no platform fee at all. */
  cardZeroFeeCount: number;
  cardZeroFeeVolumeUsd: number;
  cardCompletedCount: number;
  /** Fees on paid USD invoices. */
  invoiceFeesUsd: number;
  /** Escrow fees with a fee transaction hash. */
  escrowCollectedUsd: number;
  /** Everything we can prove was collected. */
  totalCollectedUsd: number;
};

export type AdminPlatformStats = {
  windowDays: number;
  generatedAt: string;
  series: { granularity: SeriesGranularity; points: SeriesPoint[] };
  methodSplit: { cryptoVolume: number; cardVolume: number };
  statusBreakdown: { succeeded: number; failed: number; pending: number };
  commission: CommissionSummary;
};

/**
 * Read every row of a table matching a filter, paging past the 1000-row cap.
 * `applyFilters` runs on each page so the caller can express the query once.
 *
 * The `order('id')` is not cosmetic: Postgres gives no ordering guarantee
 * without an ORDER BY, so paging with `range()` alone can return the same row
 * on two pages and skip another entirely. Every table read here has a uuid
 * primary key, which makes `id` a stable and total sort key.
 */
async function fetchAll<T = any>(
  table: string,
  columns: string,
  applyFilters: (q: any) => any = (q) => q
): Promise<T[]> {
  const supabase = getSupabaseAdmin();
  const rows: T[] = [];

  for (let page = 0; ; page += 1) {
    const from = page * PAGE_SIZE;
    const query = applyFilters(supabase.from(table).select(columns))
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
    // Defensive: a filter that matches everything should still terminate.
    if (rows.length > 500_000) return rows;
  }
}

function sinceIso(days: number): string {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);
  return since.toISOString();
}

function plausibleUsd(value: number): number {
  return value > MAX_PLAUSIBLE_USD ? 0 : value;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * Build the commission picture from already-fetched rows plus the two small
 * side tables (swept addresses, paid invoices, settled escrows).
 *
 * The distinction that matters: `accrued` is what the fee columns claim,
 * `collected` is what has a transaction hash proving it moved. They are not
 * the same number, and reporting only the first overstates revenue.
 */
export function summariseCommission(input: {
  payments: any[];
  cardTransactions: any[];
  sweptAddresses: any[];
  paidInvoices: any[];
  settledEscrows: any[];
}): CommissionSummary {
  const paymentsById = new Map(input.payments.map((p) => [p.id, p]));

  let cryptoAccruedUsd = 0;
  for (const payment of input.payments) {
    if (!isSuccessfulCryptoStatus(payment.status)) continue;
    cryptoAccruedUsd += plausibleUsd(getCryptoFeeUsd(payment));
  }

  let cryptoCollectedUsd = 0;
  for (const address of input.sweptAddresses) {
    const expected = toNumber(address.amount_expected);
    const commission = toNumber(address.commission_amount);
    if (expected <= 0 || commission <= 0) continue;
    const payment = paymentsById.get(address.payment_id);
    const usd = plausibleUsd(getCryptoVolumeUsd(payment ?? {}));
    if (usd <= 0) continue;
    cryptoCollectedUsd += usd * (commission / expected);
  }

  let cardCommissionUsd = 0;
  let cardZeroFeeCount = 0;
  let cardZeroFeeVolumeUsd = 0;
  let cardCompletedCount = 0;
  for (const transaction of input.cardTransactions) {
    if (!isSuccessfulCardStatus(transaction.status)) continue;
    cardCompletedCount += 1;
    const commission = getCardCommissionUsd(transaction);
    cardCommissionUsd += commission;
    if (commission <= 0) {
      cardZeroFeeCount += 1;
      cardZeroFeeVolumeUsd += plausibleUsd(getCardVolumeUsd(transaction));
    }
  }

  let invoiceFeesUsd = 0;
  for (const invoice of input.paidInvoices) {
    invoiceFeesUsd += toNumber(invoice.fee_amount);
  }

  let escrowCollectedUsd = 0;
  for (const escrow of input.settledEscrows) {
    const amount = toNumber(escrow.amount);
    const fee = toNumber(escrow.fee_amount);
    const usd = toNumber(escrow.amount_usd);
    if (amount <= 0 || fee <= 0 || usd <= 0) continue;
    escrowCollectedUsd += plausibleUsd(usd * (fee / amount));
  }

  const totalCollectedUsd =
    cryptoCollectedUsd + cardCommissionUsd + invoiceFeesUsd + escrowCollectedUsd;

  return {
    cryptoAccruedUsd: round2(cryptoAccruedUsd),
    cryptoCollectedUsd: round2(cryptoCollectedUsd),
    cryptoSweepCount: input.sweptAddresses.length,
    cardCommissionUsd: round2(cardCommissionUsd),
    cardZeroFeeCount,
    cardZeroFeeVolumeUsd: round2(cardZeroFeeVolumeUsd),
    cardCompletedCount,
    invoiceFeesUsd: round2(invoiceFeesUsd),
    escrowCollectedUsd: round2(escrowCollectedUsd),
    totalCollectedUsd: round2(totalCollectedUsd),
  };
}

/** Volume split and success/fail/pending counts over the fetched window. */
export function summariseTotals(payments: any[], cardTransactions: any[]) {
  let cryptoVolume = 0;
  let cardVolume = 0;
  let succeeded = 0;
  let failed = 0;
  let pending = 0;

  for (const payment of payments) {
    if (isSuccessfulCryptoStatus(payment.status)) {
      succeeded += 1;
      cryptoVolume += plausibleUsd(getCryptoVolumeUsd(payment));
    } else if (isFailedCryptoStatus(payment.status)) {
      failed += 1;
    } else {
      pending += 1;
    }
  }

  for (const transaction of cardTransactions) {
    if (isSuccessfulCardStatus(transaction.status)) {
      succeeded += 1;
      cardVolume += plausibleUsd(getCardVolumeUsd(transaction));
    } else if (isFailedCardStatus(transaction.status)) {
      failed += 1;
    } else {
      pending += 1;
    }
  }

  return {
    methodSplit: { cryptoVolume: round2(cryptoVolume), cardVolume: round2(cardVolume) },
    statusBreakdown: { succeeded, failed, pending },
  };
}

/**
 * Everything the admin stats page renders, in one round of reads.
 *
 * `windowDays` scopes the chart series and the volume/status summaries. The
 * commission summary is deliberately lifetime — "what have we ever actually
 * collected" is the question it answers, and windowing it hides the gap.
 */
export async function getAdminPlatformStats(windowDays = 30): Promise<AdminPlatformStats> {
  const days = Math.min(Math.max(Math.trunc(windowDays) || 30, 1), 730);
  const windowStart = new Date(sinceIso(days));
  const windowEnd = new Date();
  const since = windowStart.toISOString();

  const [windowPayments, windowCards, allPayments, allCards, sweptAddresses, paidInvoices, settledEscrows] =
    await Promise.all([
      fetchAll('payments', 'id,amount,crypto_amount,fee_amount,status,created_at', (q) =>
        q.gte('created_at', since)
      ),
      fetchAll(
        'stripe_transactions',
        'id,amount,platform_fee_amount,stripe_fee_amount,status,created_at',
        (q) => q.gte('created_at', since)
      ),
      fetchAll('payments', 'id,amount,crypto_amount,fee_amount,status'),
      fetchAll('stripe_transactions', 'id,amount,platform_fee_amount,status'),
      fetchAll('payment_addresses', 'id,payment_id,amount_expected,commission_amount', (q) =>
        q.not('commission_tx_hash', 'is', null)
      ),
      fetchAll('invoices', 'id,fee_amount,amount,currency,status', (q) =>
        q.eq('status', 'paid').eq('currency', 'USD')
      ),
      fetchAll('escrows', 'id,amount,amount_usd,fee_amount,fee_tx_hash', (q) =>
        q.not('fee_tx_hash', 'is', null)
      ),
    ]);

  const totals = summariseTotals(windowPayments, windowCards);

  return {
    windowDays: days,
    generatedAt: new Date().toISOString(),
    series: buildSeries(windowPayments, windowCards, windowStart, windowEnd),
    methodSplit: totals.methodSplit,
    statusBreakdown: totals.statusBreakdown,
    commission: summariseCommission({
      payments: allPayments,
      cardTransactions: allCards,
      sweptAddresses,
      paidInvoices,
      settledEscrows,
    }),
  };
}
