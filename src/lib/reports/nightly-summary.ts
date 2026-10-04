/**
 * Nightly payment summary — one email per merchant, covering the last 24
 * hours: what was received overall, then every business most to least paid.
 *
 * Pure data + render. The cron decides who gets one; this module is
 * callable from anywhere with a service client, which is what makes it
 * testable without a database.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { escapeHtml } from '../email/escape';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Statuses that mean money actually arrived. `detected` is deliberately
 * excluded from totals: a detected payment can still fail to confirm, and a
 * summary that counts it reads high and then never corrects itself. It is
 * reported separately as "in flight".
 */
const SETTLED: ReadonlySet<string> = new Set(['confirmed', 'forwarded', 'completed']);
const IN_FLIGHT: ReadonlySet<string> = new Set(['detected', 'pending', 'confirming']);

export type BusinessRow = {
  businessId: string;
  name: string;
  /** Settled fiat-equivalent total, in `currency`. */
  received: number;
  currency: string;
  payments: number;
  inFlight: number;
};

export type NightlySummary = {
  merchantId: string;
  merchantEmail: string;
  windowStart: Date;
  windowEnd: Date;
  /** Settled total across every business, in `currency`. */
  received: number;
  currency: string;
  payments: number;
  inFlight: number;
  failed: number;
  /** Most to least received. */
  businesses: BusinessRow[];
};

type PaymentRow = {
  business_id: string;
  amount: string | null;
  currency: string | null;
  status: string;
};

const toNumber = (value: string | null): number => {
  const n = value === null ? NaN : Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Aggregate one merchant's last 24 hours.
 *
 * Returns null when the merchant has no email to send to, so the caller can
 * skip without special-casing.
 */
export async function aggregateNightlySummary(
  supabase: SupabaseClient<any>,
  merchantId: string,
  now: Date = new Date(),
): Promise<NightlySummary | null> {
  const windowStart = new Date(now.getTime() - DAY_MS);

  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, email')
    .eq('id', merchantId)
    .maybeSingle();
  if (!merchant?.email) return null;

  const { data: businesses } = await supabase
    .from('businesses')
    .select('id, name')
    .eq('merchant_id', merchantId);

  const owned = (businesses ?? []) as { id: string; name: string }[];
  if (!owned.length) {
    return {
      merchantId,
      merchantEmail: merchant.email,
      windowStart,
      windowEnd: now,
      received: 0,
      currency: 'USD',
      payments: 0,
      inFlight: 0,
      failed: 0,
      businesses: [],
    };
  }

  const { data: payments } = await supabase
    .from('payments')
    .select('business_id, amount, currency, status')
    .in(
      'business_id',
      owned.map((business) => business.id),
    )
    .gte('created_at', windowStart.toISOString());

  const rows = (payments ?? []) as PaymentRow[];
  const byBusiness = new Map<string, { received: number; payments: number; inFlight: number; currency: string }>();
  let failed = 0;

  for (const row of rows) {
    const tally =
      byBusiness.get(row.business_id) ?? { received: 0, payments: 0, inFlight: 0, currency: 'USD' };
    if (row.currency) tally.currency = row.currency;

    if (SETTLED.has(row.status)) {
      tally.received += toNumber(row.amount);
      tally.payments += 1;
    } else if (IN_FLIGHT.has(row.status)) {
      tally.inFlight += 1;
    } else {
      failed += 1;
    }
    byBusiness.set(row.business_id, tally);
  }

  const businessRows: BusinessRow[] = owned
    .map((business) => {
      const tally =
        byBusiness.get(business.id) ?? { received: 0, payments: 0, inFlight: 0, currency: 'USD' };
      return {
        businessId: business.id,
        name: business.name,
        received: tally.received,
        currency: tally.currency,
        payments: tally.payments,
        inFlight: tally.inFlight,
      };
    })
    .sort((a, b) => b.received - a.received || a.name.localeCompare(b.name));

  return {
    merchantId,
    merchantEmail: merchant.email,
    windowStart,
    windowEnd: now,
    received: businessRows.reduce((sum, row) => sum + row.received, 0),
    // Mixed-currency merchants are rare; report the busiest one's and let
    // the per-business rows carry the detail rather than inventing an FX rate.
    currency: businessRows[0]?.currency ?? 'USD',
    payments: businessRows.reduce((sum, row) => sum + row.payments, 0),
    inFlight: businessRows.reduce((sum, row) => sum + row.inFlight, 0),
    failed,
    businesses: businessRows,
  };
}

/**
 * ISO currency codes Intl will format as money. Anything else — BTC, ETH,
 * USDC — is formatted plainly with enough decimals to survive.
 *
 * Do not reach for try/catch here: `Intl.NumberFormat` does **not** throw on
 * a crypto ticker. It accepts `BTC` and renders 0.00051 as "BTC 0.00",
 * rounding a real payment to nothing and reporting it as zero received.
 */
let isoCurrencies: Set<string> | null = null;

function isIsoCurrency(code: string): boolean {
  if (isoCurrencies === null) {
    try {
      const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
        .supportedValuesOf?.('currency');
      isoCurrencies = new Set(supported ?? []);
    } catch {
      isoCurrencies = new Set<string>();
    }
  }
  // An empty set means the runtime could not tell us; trust the common ones.
  if (isoCurrencies.size === 0) return ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'].includes(code);
  return isoCurrencies.has(code);
}

export function formatMoney(amount: number, currency: string): string {
  const code = (currency || 'USD').toUpperCase();
  if (isIsoCurrency(code)) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount);
  }
  return `${amount.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${code}`;
}

export function renderNightlySummaryEmail(summary: NightlySummary): {
  subject: string;
  html: string;
} {
  const total = formatMoney(summary.received, summary.currency);
  const subject =
    summary.payments === 0
      ? 'CoinPay nightly — no payments in the last 24 hours'
      : `CoinPay nightly — ${total} across ${summary.payments} payment${summary.payments === 1 ? '' : 's'}`;

  const rowsHtml = summary.businesses.length
    ? summary.businesses
        .map(
          (business) => `
        <tr>
          <td style="padding:10px 0;border-top:1px solid #e5e7eb;">
            <div style="color:#111827;font-size:14px;font-weight:600;">${escapeHtml(business.name)}</div>
            <div style="color:#6b7280;font-size:12px;margin-top:4px;">
              ${business.payments} payment${business.payments === 1 ? '' : 's'}${business.inFlight ? ` · ${business.inFlight} in flight` : ''}
            </div>
          </td>
          <td align="right" style="padding:10px 0;border-top:1px solid #e5e7eb;color:#111827;font-size:16px;font-weight:700;white-space:nowrap;">
            ${escapeHtml(formatMoney(business.received, business.currency))}
          </td>
        </tr>`,
        )
        .join('')
    : `<tr><td style="padding:10px 0;color:#6b7280;font-size:13px;">No businesses yet.</td></tr>`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <h2 style="color:#111827;margin:0 0 4px;">Last 24 hours</h2>
      <p style="color:#6b7280;font-size:13px;margin:0 0 20px;">Busiest business first.</p>

      <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:20px;">
        <div style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Received</div>
        <div style="color:#111827;font-size:28px;font-weight:700;margin-top:4px;">${escapeHtml(total)}</div>
        <div style="color:#6b7280;font-size:13px;margin-top:6px;">
          ${summary.payments} settled${summary.inFlight ? ` · ${summary.inFlight} in flight` : ''}${summary.failed ? ` · ${summary.failed} failed` : ''}
        </div>
      </div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${rowsHtml}
      </table>

      <p style="margin:24px 0 0;font-size:12px;color:#6b7280;">
        In flight means detected but not yet confirmed, so it is not counted in the total.
      </p>
    </div>`;

  return { subject, html };
}
