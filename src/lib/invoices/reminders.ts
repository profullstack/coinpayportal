import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';
import { invoiceOverdueTemplate, invoiceReminderTemplate, type InvoiceBrand } from '@/lib/email/invoice-templates';
import { deliverInvoiceEmail, getInvoicePaymentLink } from '@/lib/email/invoice-delivery';
import { insertWithInvoiceNumber } from './numbering';
import { activateInvoicePayment } from './activation';
import { computeInvoiceTotals, itemisedInvoiceColumns } from './line-items';
import {
  type InvoiceSettings,
  loadInvoiceSettingsMap,
  dueReminderOffsets,
  lateFeeDue,
  computeLateFee,
} from './settings';

/**
 * Scheduled reminders and late fees for sent/overdue invoices.
 *
 * Every step is claimed by inserting its (invoice, kind, offset) row into
 * invoice_reminders BEFORE acting, so a retry, a second monitor process or a
 * crash halfway can never send a reminder twice or charge a fee twice. A step
 * that fails keeps its row as `failed` with the reason; it is not retried.
 *
 * The late fee is its own invoice for the fee alone, linked back through
 * late_fee_for_invoice_id. Raising the amount on the original would re-quote
 * a live crypto payment, and a client already paying the old quote would pay
 * an address nothing watches any more.
 */

export type ReminderStats = { reminders: number; lateFees: number; skipped: number; errors: number };

const HORIZON_DAYS_BEFORE = 60;
const HORIZON_DAYS_AFTER = 366;

type DueInvoice = {
  id: string;
  invoice_number: string;
  status: string;
  amount: string | number;
  currency: string | null;
  crypto_currency: string | null;
  merchant_wallet_address: string | null;
  fee_rate: string | number | null;
  due_date: string;
  business_id: string;
  user_id: string;
  client_id: string | null;
  late_fee_for_invoice_id: string | null;
  updated_at: string | null;
  metadata: Record<string, unknown> | null;
  clients: { id: string; name: string | null; email: string | null; company_name: string | null } | null;
  businesses: { id: string; name: string | null; merchant_id: string | null } | null;
};

export function brandFrom(settings: InvoiceSettings, businessName: string | null | undefined): InvoiceBrand {
  return {
    name: businessName || null,
    color: settings.brand_color,
    logoUrl: settings.logo_url,
    footer: settings.invoice_footer,
  };
}

async function claim(
  supabase: SupabaseClient,
  invoiceId: string,
  kind: 'reminder' | 'late_fee',
  offsetDays: number
): Promise<string | null> {
  const { data, error } = await supabase
    .from('invoice_reminders')
    .insert({ invoice_id: invoiceId, kind, offset_days: offsetDays })
    .select('id')
    .maybeSingle();
  // 23505: someone already claimed this step. Anything else: do not act.
  if (error || !data) return null;
  return data.id as string;
}

async function finish(
  supabase: SupabaseClient,
  id: string,
  status: 'sent' | 'skipped' | 'failed',
  extra: { error?: string; related_invoice_id?: string } = {}
) {
  await supabase.from('invoice_reminders').update({ status, ...extra }).eq('id', id);
}

export async function runReminderCycle(supabase: SupabaseClient, now: Date): Promise<ReminderStats> {
  const stats: ReminderStats = { reminders: 0, lateFees: 0, skipped: 0, errors: 0 };
  const from = new Date(now.getTime() - HORIZON_DAYS_AFTER * 86_400_000).toISOString();
  const to = new Date(now.getTime() + HORIZON_DAYS_BEFORE * 86_400_000).toISOString();

  const { data: invoices, error } = await supabase
    .from('invoices')
    .select(
      'id, invoice_number, status, amount, currency, crypto_currency, merchant_wallet_address, fee_rate, due_date, business_id, user_id, client_id, late_fee_for_invoice_id, updated_at, metadata, clients (id, name, email, company_name), businesses (id, name, merchant_id)'
    )
    .in('status', ['sent', 'overdue'])
    .not('due_date', 'is', null)
    .gte('due_date', from)
    .lte('due_date', to);
  if (error || !invoices?.length) return stats;

  const rows = invoices as unknown as DueInvoice[];
  const settingsMap = await loadInvoiceSettingsMap(supabase, rows.map((i) => i.business_id));
  const { data: done } = await supabase
    .from('invoice_reminders')
    .select('invoice_id, kind, offset_days')
    .in('invoice_id', rows.map((i) => i.id));
  const doneSet = new Set((done ?? []).map((d) => `${d.invoice_id}|${d.kind}|${d.offset_days}`));

  for (const invoice of rows) {
    const settings = settingsMap.get(invoice.business_id)!;
    try {
      const doneOffsets = new Set(
        settings.reminder_days.filter((o) => doneSet.has(`${invoice.id}|reminder|${o}`))
      );
      for (const offset of dueReminderOffsets(invoice.due_date, settings, now, doneOffsets)) {
        await sendReminder(supabase, invoice, settings, offset, stats);
      }
      // A late fee is never charged on a late fee.
      if (
        !invoice.late_fee_for_invoice_id &&
        !doneSet.has(`${invoice.id}|late_fee|${settings.late_fee_after_days}`) &&
        lateFeeDue(invoice.due_date, settings, now)
      ) {
        await chargeLateFee(supabase, invoice, settings, stats);
      }
    } catch (err) {
      console.error(`[Reminders] invoice ${invoice.id} failed:`, err instanceof Error ? err.message : err);
      stats.errors++;
    }
  }
  return stats;
}

async function sendReminder(
  supabase: SupabaseClient,
  invoice: DueInvoice,
  settings: InvoiceSettings,
  offset: number,
  stats: ReminderStats
) {
  const claimId = await claim(supabase, invoice.id, 'reminder', offset);
  if (!claimId) return;
  const email = invoice.clients?.email;
  if (!email) {
    await finish(supabase, claimId, 'skipped', { error: 'Client has no email' });
    stats.skipped++;
    return;
  }
  const common = {
    invoiceNumber: invoice.invoice_number,
    amount: Number(invoice.amount),
    currency: invoice.currency || 'USD',
    dueDate: invoice.due_date,
    businessName: invoice.businesses?.name || 'CoinPay Merchant',
    paymentLink: getInvoicePaymentLink(invoice.id),
    brand: brandFrom(settings, invoice.businesses?.name),
  };
  const template =
    offset < 0 ? invoiceReminderTemplate({ ...common, daysUntilDue: -offset }) : invoiceOverdueTemplate(common);
  const result = await sendEmail({ to: email, subject: template.subject, html: template.html });
  if (result.success) {
    await finish(supabase, claimId, 'sent');
    stats.reminders++;
  } else {
    await finish(supabase, claimId, 'failed', { error: (result.error || 'Email failed').slice(0, 500) });
    stats.errors++;
  }
}

async function chargeLateFee(
  supabase: SupabaseClient,
  invoice: DueInvoice,
  settings: InvoiceSettings,
  stats: ReminderStats
) {
  const fee = computeLateFee(invoice.amount, settings);
  if (fee === null) return;
  const claimId = await claim(supabase, invoice.id, 'late_fee', settings.late_fee_after_days);
  if (!claimId) return;

  const label =
    settings.late_fee_type === 'percent'
      ? `Late fee (${settings.late_fee_value}%) on ${invoice.invoice_number}`
      : `Late fee on ${invoice.invoice_number}`;
  const totals = computeInvoiceTotals([{ description: label, quantity: 1, unit_price: fee }]);

  const { data: created, error } = await insertWithInvoiceNumber<any>(supabase, invoice.business_id, (invoiceNumber) =>
    supabase
      .from('invoices')
      .insert({
        user_id: invoice.user_id,
        business_id: invoice.business_id,
        client_id: invoice.client_id,
        invoice_number: invoiceNumber,
        status: 'draft',
        currency: invoice.currency || 'USD',
        ...itemisedInvoiceColumns(totals),
        crypto_currency: invoice.crypto_currency,
        merchant_wallet_address: invoice.merchant_wallet_address,
        fee_rate: invoice.fee_rate,
        // Payable on receipt: a week, so the fee invoice is not itself late at once.
        due_date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        notes: `Late fee for invoice ${invoice.invoice_number}, which was due ${invoice.due_date.slice(0, 10)}.`,
        late_fee_for_invoice_id: invoice.id,
        metadata: { late_fee: true, late_fee_for: invoice.id },
      })
      .select('*, clients (id, name, email, company_name), businesses (id, name, merchant_id)')
      .single()
  );
  if (error || !created) {
    await finish(supabase, claimId, 'failed', { error: 'Could not create the late fee invoice' });
    stats.errors++;
    return;
  }

  const activation = await activateInvoicePayment(supabase, created);
  if (!activation.ok) {
    // The draft stays for the merchant to send by hand.
    await finish(supabase, claimId, 'failed', { error: activation.error.slice(0, 500), related_invoice_id: created.id });
    stats.errors++;
    return;
  }

  const delivered = activation.invoice.clients?.email
    ? await deliverInvoiceEmail({
        ...activation.invoice,
        brand: brandFrom(settings, activation.invoice.businesses?.name),
      })
    : { success: false, error: 'Client has no email' };
  await finish(supabase, claimId, 'sent', {
    related_invoice_id: created.id,
    ...(delivered.success ? {} : { error: `Fee invoice created; email not sent: ${delivered.error}`.slice(0, 500) }),
  });
  stats.lateFees++;
}

