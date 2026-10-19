/**
 * Weekly payments report: the default account report for merchants who take
 * payments or send invoices through CoinPay but have no bank linked in
 * Finances (they get the weekly digest instead, or as well).
 *
 * Seven days ending at the send: what was received overall and per business
 * (the nightly summary's aggregate over a longer window), invoices paid and
 * issued in the window, and what is overdue now. A week with nothing in it
 * sends nothing (`hasActivity`), so a dormant account is never mailed.
 *
 * Pure data + render, like nightly-summary.ts; the schedule worker decides
 * who gets one.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { escapeHtml } from '../email/escape';
import { aggregateNightlySummary, formatMoney, type NightlySummary } from './nightly-summary';

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type InvoiceTotals = {
  paid: number;
  paidAmount: number;
  issued: number;
  issuedAmount: number;
  overdue: number;
  overdueAmount: number;
  currency: string;
};

export type WeeklyPayments = NightlySummary & { invoices: InvoiceTotals };

type InvoiceRow = { status: string; amount: string | number | null; currency: string | null; paid_at: string | null; created_at: string };

const num = (v: string | number | null): number => {
  const n = typeof v === 'number' ? v : v === null ? NaN : Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Tally invoices for the window. Pure. Amounts in another currency than the busiest are counted, not summed. */
export function tallyInvoices(rows: InvoiceRow[], windowStart: Date, windowEnd: Date): InvoiceTotals {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.currency || 'USD', (counts.get(r.currency || 'USD') ?? 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'USD';
  const inWindow = (iso: string | null) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= windowStart.getTime() && t < windowEnd.getTime();
  };
  const totals: InvoiceTotals = { paid: 0, paidAmount: 0, issued: 0, issuedAmount: 0, overdue: 0, overdueAmount: 0, currency };
  for (const r of rows) {
    const same = (r.currency || 'USD') === currency;
    if (r.status === 'paid' && inWindow(r.paid_at)) {
      totals.paid += 1;
      if (same) totals.paidAmount += num(r.amount);
    }
    if (['sent', 'paid', 'overdue'].includes(r.status) && inWindow(r.created_at)) {
      totals.issued += 1;
      if (same) totals.issuedAmount += num(r.amount);
    }
    if (r.status === 'overdue') {
      totals.overdue += 1;
      if (same) totals.overdueAmount += num(r.amount);
    }
  }
  return totals;
}

/**
 * Whether the week has anything worth an email. Expired checkouts and an
 * invoice that was already overdue last week are not news.
 */
export function hasActivity(report: Pick<WeeklyPayments, 'payments' | 'inFlight' | 'invoices'>): boolean {
  return report.payments > 0 || report.inFlight > 0 || report.invoices.paid > 0 || report.invoices.issued > 0;
}

export async function aggregateWeeklyPayments(
  supabase: SupabaseClient<any>,
  merchantId: string,
  now: Date = new Date(),
): Promise<WeeklyPayments | null> {
  const summary = await aggregateNightlySummary(supabase, merchantId, now, WEEK_MS);
  if (!summary) return null;
  const empty: InvoiceTotals = { paid: 0, paidAmount: 0, issued: 0, issuedAmount: 0, overdue: 0, overdueAmount: 0, currency: summary.currency };
  if (summary.businesses.length === 0) return { ...summary, invoices: empty };
  const { data, error } = await supabase
    .from('invoices')
    .select('status, amount, currency, paid_at, created_at')
    .in('business_id', summary.businesses.map((b) => b.businessId))
    .or(`status.eq.overdue,created_at.gte.${summary.windowStart.toISOString()},paid_at.gte.${summary.windowStart.toISOString()}`)
    .limit(5000);
  if (error) throw new Error(`Could not read invoices: ${error.message}`);
  return { ...summary, invoices: tallyInvoices((data ?? []) as InvoiceRow[], summary.windowStart, summary.windowEnd) };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export function renderWeeklyPaymentsEmail(report: WeeklyPayments, footerHtml = ''): { subject: string; html: string } {
  const total = formatMoney(report.received, report.currency);
  const range = `${day(report.windowStart)} to ${day(new Date(report.windowEnd.getTime() - 1))}`;
  const subject = `CoinPay weekly payments: ${total} received, ${range}`;
  const inv = report.invoices;
  const active = report.businesses.filter((b) => b.payments > 0 || b.inFlight > 0);
  const rows = active.length
    ? active
        .map(
          (b) => `<tr><td style="padding:8px 0;border-top:1px solid #e5e7eb;font-size:14px;color:#111827">${escapeHtml(b.name)}<div style="color:#6b7280;font-size:12px">${b.payments} payment${b.payments === 1 ? '' : 's'}${b.inFlight ? ` · ${b.inFlight} in flight` : ''}</div></td>
<td align="right" style="padding:8px 0;border-top:1px solid #e5e7eb;font-size:15px;font-weight:700;white-space:nowrap">${escapeHtml(formatMoney(b.received, b.currency))}</td></tr>`,
        )
        .join('')
    : `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">No crypto payments this week.</td></tr>`;
  const money = (n: number) => escapeHtml(formatMoney(n, inv.currency));
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827">
<h2 style="margin:0 0 4px">Your week on CoinPay</h2>
<p style="color:#6b7280;font-size:13px;margin:0 0 20px">${escapeHtml(range)} (UTC)</p>
<div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:20px">
<div style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">Received</div>
<div style="font-size:28px;font-weight:700;margin-top:4px">${escapeHtml(total)}</div>
<div style="color:#6b7280;font-size:13px;margin-top:6px">${report.payments} settled${report.inFlight ? ` · ${report.inFlight} in flight` : ''}</div>
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
<h3 style="font-size:14px;margin:20px 0 6px">Invoices</h3>
<p style="margin:0;font-size:14px">${inv.paid} paid (${money(inv.paidAmount)}) · ${inv.issued} issued (${money(inv.issuedAmount)}) · ${inv.overdue} overdue (${money(inv.overdueAmount)})</p>
<p style="margin:20px 0 0;font-size:12px;color:#6b7280">In flight means detected but not yet confirmed, so it is not in the total.</p>
${footerHtml}
</div>`;
  return { subject, html };
}
