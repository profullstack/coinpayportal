/**
 * What a pay-in's lifecycle means for the payment or invoice it pays.
 *
 * A submitted ACH debit is not a paid invoice. The payment or invoice is
 * marked paid only when the transfer reaches `completed`: settled and past the
 * hold. A return after that reverses it, and the merchant is told both times.
 * The decision is a pure function so the two moments are pinned by tests; the
 * writes are the same ones the Stripe and PayPal rails make.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendPaymentWebhook } from '@/lib/webhooks/service';
import type { BankTransferRow } from './store';

export type PayinEffect = 'confirm' | 'reverse' | null;

/**
 * `confirm` when the transfer just completed; `reverse` when a transfer that
 * had completed is now returned. Everything else, including settlement (money
 * moved but still returnable), changes nothing for the merchant.
 */
export function payinEffectFor(before: BankTransferRow, after: BankTransferRow): PayinEffect {
  if (after.kind !== 'payin') return null;
  if (after.status === 'completed' && before.status !== 'completed') return 'confirm';
  if (after.status === 'returned' && before.status !== 'returned' && after.completed_at) return 'reverse';
  return null;
}

/**
 * Apply the effect to the payment or invoice, and notify the merchant.
 *
 * Both writes are conditional on the row's current status, so a repeated
 * transition (two overlapping cron ticks) cannot confirm twice or notify twice.
 * The webhook is sent after the write and never rolls it back: the money
 * moved either way.
 */
export async function applyPayinTransition(
  supabase: SupabaseClient,
  before: BankTransferRow,
  after: BankTransferRow,
): Promise<PayinEffect> {
  const effect = payinEffectFor(before, after);
  if (!effect) return null;
  const now = new Date().toISOString();

  if (after.payment_id) {
    const { data: payment } = await supabase
      .from('payments')
      .select('id, business_id, amount, currency, metadata, status')
      .eq('id', after.payment_id)
      .maybeSingle();
    if (!payment) return effect;

    if (effect === 'confirm') {
      const { data: updated } = await supabase
        .from('payments')
        .update({
          status: 'confirmed',
          confirmed_at: now,
          updated_at: now,
          metadata: { ...(payment.metadata ?? {}), payment_rail: 'ach', bank_transfer_id: after.id, ach_confirmed_at: now },
        })
        .eq('id', payment.id)
        .eq('status', 'pending')
        .select('id');
      if (updated && updated.length > 0 && payment.business_id) {
        void sendPaymentWebhook(supabase, payment.business_id, payment.id, 'payment.confirmed', {
          status: 'confirmed',
          amount_usd: payment.amount,
          amount_crypto: null,
          currency: after.currency.toLowerCase(),
          payment_address: null,
          tx_hash: after.provider_transfer_id,
          confirmations: 1,
          metadata: { ...(payment.metadata ?? {}), payment_rail: 'ach', bank_transfer_id: after.id },
        }).catch((err) => console.error('[banking] payin webhook failed', err));
      }
    } else {
      const { data: updated } = await supabase
        .from('payments')
        .update({
          status: 'failed',
          updated_at: now,
          metadata: {
            ...(payment.metadata ?? {}),
            payment_rail: 'ach',
            bank_transfer_id: after.id,
            ach_returned_at: after.returned_at ?? now,
            ach_return_code: after.return_code,
          },
        })
        .eq('id', payment.id)
        .eq('status', 'confirmed')
        .select('id');
      if (updated && updated.length > 0 && payment.business_id) {
        void sendPaymentWebhook(supabase, payment.business_id, payment.id, 'payment.failed', {
          status: 'failed',
          amount_usd: payment.amount,
          currency: after.currency.toLowerCase(),
          payment_address: null,
          tx_hash: after.provider_transfer_id,
          error: `ACH debit returned${after.return_code ? ` (${after.return_code})` : ''} after the payment was confirmed`,
          metadata: { ...(payment.metadata ?? {}), payment_rail: 'ach', ach_return_code: after.return_code },
        }).catch((err) => console.error('[banking] payin webhook failed', err));
      }
    }
    return effect;
  }

  if (after.invoice_id) {
    const { data: invoice } = await supabase
      .from('invoices')
      .select('id, business_id, invoice_number, amount, currency, metadata, status')
      .eq('id', after.invoice_id)
      .maybeSingle();
    if (!invoice) return effect;

    if (effect === 'confirm') {
      const { data: updated } = await supabase
        .from('invoices')
        .update({
          status: 'paid',
          paid_at: now,
          tx_hash: after.provider_transfer_id,
          settlement_method: 'ach',
          updated_at: now,
          metadata: { ...(invoice.metadata ?? {}), payment_rail: 'ach', bank_transfer_id: after.id, ach_confirmed_at: now },
        })
        .eq('id', invoice.id)
        .neq('status', 'paid')
        .select('id');
      if (updated && updated.length > 0 && invoice.business_id) {
        void sendPaymentWebhook(supabase, invoice.business_id, invoice.id, 'invoice.paid', {
          status: 'paid',
          amount_usd: invoice.amount,
          currency: invoice.currency || after.currency,
          invoice_number: invoice.invoice_number,
          payment_rail: 'ach',
          bank_transfer_id: after.id,
        }).catch((err) => console.error('[banking] payin webhook failed', err));
      }
    } else {
      // The invoice goes back to owed. 'sent' is the status the pay page
      // accepts, and the return is recorded on the invoice for the merchant.
      const { data: updated } = await supabase
        .from('invoices')
        .update({
          status: 'sent',
          paid_at: null,
          updated_at: now,
          metadata: {
            ...(invoice.metadata ?? {}),
            payment_rail: 'ach',
            bank_transfer_id: after.id,
            ach_returned_at: after.returned_at ?? now,
            ach_return_code: after.return_code,
          },
        })
        .eq('id', invoice.id)
        .eq('status', 'paid')
        .select('id');
      if (updated && updated.length > 0 && invoice.business_id) {
        void sendPaymentWebhook(supabase, invoice.business_id, invoice.id, 'invoice.payment_returned', {
          status: 'sent',
          amount_usd: invoice.amount,
          currency: invoice.currency || after.currency,
          invoice_number: invoice.invoice_number,
          payment_rail: 'ach',
          return_code: after.return_code,
        }).catch((err) => console.error('[banking] payin webhook failed', err));
      }
    }
  }

  return effect;
}
