import type { SupabaseClient } from '@supabase/supabase-js';
import { sendPaymentWebhook } from '@/lib/webhooks/service';
import type { PaypalCapture } from './client';

/**
 * Settling a captured PayPal order.
 *
 * Two independent paths reach this: the payer's return from PayPal (fast, but
 * only happens if they don't close the tab) and the PAYMENT.CAPTURE.COMPLETED
 * webhook (reliable, but can lag). Both must produce the same end state and
 * neither may double-fire the merchant's webhook, so settlement lives here and
 * is guarded by a conditional UPDATE rather than a read-then-write.
 */

export interface SettleResult {
  settled: boolean;
  /** True when the row was already completed — a duplicate, not a failure. */
  alreadySettled: boolean;
  transactionId: string | null;
  error?: string;
}

export interface PaypalTransactionRow {
  id: string;
  business_id: string | null;
  merchant_id: string | null;
  amount: number | string | null;
  currency: string | null;
  status: string;
  invoice_number: string | null;
  customer_email: string | null;
  platform_fee_amount: number | string | null;
  paypal_order_id: string;
}

/**
 * Move a pending PayPal transaction to completed and notify the merchant.
 *
 * The UPDATE carries `.neq('status', 'completed')` so two concurrent callers
 * cannot both claim it: whichever loses matches zero rows and reports
 * `alreadySettled`, and only the winner sends the outbound webhook. Postgres
 * serialises the two updates on the row, so this is a real lock and not a
 * check-then-act race.
 */
export async function settlePaypalCapture(
  supabase: SupabaseClient,
  transaction: PaypalTransactionRow,
  capture: PaypalCapture
): Promise<SettleResult> {
  if (capture.status !== 'COMPLETED') {
    return {
      settled: false,
      alreadySettled: false,
      transactionId: transaction.id,
      error: `PayPal capture is ${capture.status}, not COMPLETED`,
    };
  }

  const amount = capture.amount !== null ? Number(capture.amount) : Number(transaction.amount ?? 0);
  const paypalFee = capture.paypalFee !== null ? Number(capture.paypalFee) : null;
  // PayPal's own breakdown is authoritative for what the platform actually
  // took. Fall back to what we asked for only when the breakdown is absent.
  const platformFee =
    capture.platformFee !== null
      ? Number(capture.platformFee)
      : Number(transaction.platform_fee_amount ?? 0);

  // net_amount already has PayPal's fee removed but NOT the platform fee, so
  // the merchant's true take is net_amount minus our commission.
  const netFromPaypal = capture.netAmount !== null ? Number(capture.netAmount) : null;
  const netToMerchant =
    netFromPaypal !== null
      ? Math.round((netFromPaypal - platformFee) * 100) / 100
      : Math.round((amount - platformFee - (paypalFee ?? 0)) * 100) / 100;

  const { data: updated, error: updateError } = await supabase
    .from('paypal_transactions')
    .update({
      status: 'completed',
      paypal_capture_id: capture.captureId,
      payer_email: capture.payerEmail,
      amount,
      currency: capture.currency || transaction.currency || 'USD',
      paypal_fee_amount: paypalFee,
      platform_fee_amount: platformFee,
      net_to_merchant: netToMerchant,
      payee_merchant_id: capture.payeeMerchantId,
      captured_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', transaction.id)
    .neq('status', 'completed')
    .select('id')
    .maybeSingle();

  if (updateError) {
    console.error('[PayPal] Settlement update failed:', updateError);
    return {
      settled: false,
      alreadySettled: false,
      transactionId: transaction.id,
      error: 'Failed to record PayPal capture',
    };
  }

  if (!updated) {
    // Zero rows matched: someone else completed it first.
    return { settled: false, alreadySettled: true, transactionId: transaction.id };
  }

  // Outbound merchant webhook. Deliberately after the row is committed and only
  // on the winning path, and deliberately non-fatal: a merchant endpoint that
  // is down must not make PayPal retry a capture we have already banked.
  if (transaction.business_id) {
    try {
      await sendPaymentWebhook(supabase, transaction.business_id, transaction.id, 'payment.confirmed', {
        amount,
        amount_usd: String(amount),
        currency: capture.currency || transaction.currency || 'USD',
        status: 'completed',
        rail: 'paypal',
        payment_method: 'paypal',
        paypal_order_id: transaction.paypal_order_id,
        paypal_capture_id: capture.captureId,
        payer_email: capture.payerEmail,
        invoice_number: transaction.invoice_number,
        platform_fee_amount: platformFee,
        net_to_merchant: netToMerchant,
      });
    } catch (err) {
      console.error('[PayPal] Merchant webhook dispatch failed:', err);
    }
  }

  return { settled: true, alreadySettled: false, transactionId: transaction.id };
}

/**
 * Find the transaction an order belongs to.
 *
 * Prefers `custom_id`, which we set to the row id at order creation and PayPal
 * echoes back on the capture — it survives even if the order id binding failed.
 * Falls back to the order id.
 */
export async function findPaypalTransaction(
  supabase: SupabaseClient,
  { orderId, customId }: { orderId?: string | null; customId?: string | null }
): Promise<PaypalTransactionRow | null> {
  // Repeated as a literal in each call rather than hoisted into a variable:
  // Supabase parses the select string at the type level and degrades to an
  // error type for anything it cannot read statically, including a variable.
  if (customId) {
    const { data } = await supabase
      .from('paypal_transactions')
      .select(
        `id, business_id, merchant_id, amount, currency, status, invoice_number,
         customer_email, platform_fee_amount, paypal_order_id`
      )
      .eq('id', customId)
      .maybeSingle();
    if (data) return data as unknown as PaypalTransactionRow;
  }

  if (orderId) {
    const { data } = await supabase
      .from('paypal_transactions')
      .select(
        `id, business_id, merchant_id, amount, currency, status, invoice_number,
         customer_email, platform_fee_amount, paypal_order_id`
      )
      .eq('paypal_order_id', orderId)
      .maybeSingle();
    if (data) return data as unknown as PaypalTransactionRow;
  }

  return null;
}
