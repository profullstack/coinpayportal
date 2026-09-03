import type { SupabaseClient } from '@supabase/supabase-js';
import { getInvoicePaymentLink } from '@/lib/email/invoice-delivery';
import { isBusinessPaidTier } from '@/lib/entitlements/service';
import { getEnabledManualMethods } from '@/lib/payment-methods/manual';
import { businessHasPaypal } from '@/lib/paypal/accounts';
import { createInvoiceStripeCheckout } from '@/lib/payments/invoice-stripe';
import { resolvePayee, assertPayee } from '@/lib/payments/payee';
import { createPayment, type Blockchain } from '@/lib/payments/service';

const INVOICE_GRACE_MINUTES = 60 * 24 * 7;
const MIN_INVOICE_WINDOW_MINUTES = 60 * 24;

type ActivatableInvoice = {
  id: string;
  invoice_number: string;
  status: string;
  amount: string | number;
  currency?: string | null;
  crypto_currency?: string | null;
  merchant_wallet_address?: string | null;
  fee_rate: string | number | null;
  due_date?: string | null;
  business_id: string;
  user_id: string;
  metadata?: Record<string, unknown> | null;
  businesses?: { merchant_id?: string | null } | null;
};

export type ActivateInvoiceResult =
  | {
      ok: true;
      invoice: any;
      paymentLink: string;
      idempotentReplay: boolean;
    }
  | {
      ok: false;
      status: number;
      error: string;
      code?: string;
    };

function activationKey(invoice: ActivatableInvoice): string {
  if (invoice.status === 'overdue') {
    const previousPaymentId =
      typeof invoice.metadata?.coinpay_payment_id === 'string'
        ? invoice.metadata.coinpay_payment_id
        : 'legacy';
    return `invoice:${invoice.id}:renew:${previousPaymentId}`;
  }

  return `invoice:${invoice.id}:initial`;
}

function invoicePaymentWindow(invoice: ActivatableInvoice): number {
  const minutesUntilDue = invoice.due_date
    ? Math.ceil((new Date(invoice.due_date).getTime() - Date.now()) / 60000)
    : 0;

  return Math.max(MIN_INVOICE_WINDOW_MINUTES, minutesUntilDue + INVOICE_GRACE_MINUTES);
}

/**
 * Turn a draft/overdue invoice into a live payment resource without deciding
 * how it is delivered. Both email send and manual publish use this path.
 */
export async function activateInvoicePayment(
  supabase: SupabaseClient,
  invoice: ActivatableInvoice
): Promise<ActivateInvoiceResult> {
  if (invoice.status !== 'draft' && invoice.status !== 'overdue') {
    return {
      ok: false,
      status: 400,
      error: `Cannot activate invoice with status: ${invoice.status}`,
      code: 'INVOICE_NOT_ACTIVATABLE',
    };
  }

  if (!invoice.crypto_currency) {
    return {
      ok: false,
      status: 400,
      error: 'Crypto currency must be set before activating the invoice',
      code: 'CRYPTO_CURRENCY_REQUIRED',
    };
  }

  const amount = Number(invoice.amount);
  const feeRate = invoice.fee_rate == null ? Number.NaN : Number(invoice.fee_rate);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(feeRate) || feeRate < 0) {
    return {
      ok: false,
      status: 400,
      error: 'Invoice amount or fee rate is invalid',
      code: 'INVALID_INVOICE_AMOUNT',
    };
  }

  let payeeAddress = (invoice.merchant_wallet_address || '').trim();
  if (!payeeAddress) {
    const resolved = await resolvePayee(supabase, {
      businessId: invoice.business_id,
      merchantId: invoice.businesses?.merchant_id ?? invoice.user_id,
      cryptocurrency: invoice.crypto_currency,
    });
    if (!resolved.ok) {
      return {
        ok: false,
        status: resolved.status,
        error: resolved.error,
        code: resolved.code,
      };
    }
    payeeAddress = resolved.address;
  } else {
    const checked = assertPayee(payeeAddress, invoice.crypto_currency);
    if (!checked.ok) {
      return {
        ok: false,
        status: checked.status,
        error: checked.error,
        code: checked.code,
      };
    }
    payeeAddress = checked.address;
  }

  const key = activationKey(invoice);
  const paymentResult = await createPayment(supabase, {
    business_id: invoice.business_id,
    amount,
    currency: invoice.currency || 'USD',
    blockchain: invoice.crypto_currency as Blockchain,
    merchant_wallet_address: payeeAddress,
    expires_in_minutes: invoicePaymentWindow(invoice),
    idempotency_key: key,
    metadata: {
      ...(invoice.metadata && typeof invoice.metadata === 'object' ? invoice.metadata : {}),
      source: 'invoice',
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
    },
  });

  if (!paymentResult.success) {
    return {
      ok: false,
      status: 500,
      error: `Failed to create invoice payment: ${paymentResult.error || 'Unknown payment error'}`,
      code: 'PAYMENT_CREATION_FAILED',
    };
  }

  const coinpayPayment = paymentResult.payment;
  if (!coinpayPayment?.payment_address) {
    return {
      ok: false,
      status: paymentResult.replayed ? 409 : 500,
      error: paymentResult.replayed
        ? 'Invoice payment is still being created; retry shortly'
        : 'Failed to create invoice payment: No payment address generated',
      code: paymentResult.replayed ? 'PAYMENT_CREATION_IN_PROGRESS' : 'PAYMENT_ADDRESS_MISSING',
    };
  }

  const isPaidTier = await isBusinessPaidTier(supabase, invoice.business_id);
  let stripeCheckoutUrl: string | null = null;
  let stripeSessionId: string | null = null;
  let stripeResolutionSucceeded = false;
  try {
    const checkout = await createInvoiceStripeCheckout(
      supabase,
      invoice,
      isPaidTier,
      `${key}:stripe`
    );
    if (checkout) {
      stripeCheckoutUrl = checkout.stripeCheckoutUrl;
      stripeSessionId = checkout.stripeSessionId;
    }
    stripeResolutionSucceeded = true;
  } catch (error) {
    console.error('Failed to create Stripe checkout session for invoice:', error);
  }

  let paypalEnabled = false;
  let paypalResolutionSucceeded = false;
  try {
    paypalEnabled = await businessHasPaypal(supabase, invoice.business_id);
    paypalResolutionSucceeded = true;
  } catch (error) {
    console.error('Failed to check PayPal availability for invoice:', error);
  }

  let manualMethods: Awaited<ReturnType<typeof getEnabledManualMethods>> = [];
  let manualResolutionSucceeded = false;
  try {
    manualMethods = await getEnabledManualMethods(supabase, invoice.business_id);
    manualResolutionSucceeded = true;
  } catch (error) {
    console.error('Failed to resolve manual methods for invoice:', error);
  }

  const now = new Date().toISOString();
  const { data: updatedInvoice, error: updateError } = await supabase
    .from('invoices')
    .update({
      status: 'sent',
      crypto_amount: Number(coinpayPayment.crypto_amount || 0).toFixed(8),
      payment_address: coinpayPayment.payment_address,
      merchant_wallet_address: payeeAddress,
      fee_amount: amount * feeRate,
      metadata: {
        ...(invoice.metadata && typeof invoice.metadata === 'object' ? invoice.metadata : {}),
        coinpay_payment_id: coinpayPayment.id,
        payment_activation_key: key,
      },
      // A successful lookup with no usable Stripe account intentionally clears
      // stale checkout details. A transient lookup/API failure preserves the
      // existing fields, especially when renewing an overdue invoice.
      ...(stripeResolutionSucceeded && {
        stripe_checkout_url: stripeCheckoutUrl,
        stripe_session_id: stripeSessionId,
      }),
      ...(paypalResolutionSucceeded && { paypal_enabled: paypalEnabled }),
      ...(manualResolutionSucceeded && { manual_methods: manualMethods }),
      updated_at: now,
    })
    .eq('id', invoice.id)
    .eq('status', invoice.status)
    .select('*, clients (id, name, email, company_name), businesses (id, name, merchant_id)')
    .maybeSingle();

  if (updateError) {
    return {
      ok: false,
      status: 500,
      error: 'Failed to update invoice',
      code: 'INVOICE_UPDATE_FAILED',
    };
  }

  if (!updatedInvoice) {
    const { data: current, error: reloadError } = await supabase
      .from('invoices')
      .select('*, clients (id, name, email, company_name), businesses (id, name, merchant_id)')
      .eq('id', invoice.id)
      .single();

    if (!reloadError && current?.status === 'sent' && current.payment_address) {
      return {
        ok: true,
        invoice: current,
        paymentLink: getInvoicePaymentLink(invoice.id),
        idempotentReplay: true,
      };
    }

    return {
      ok: false,
      status: 409,
      error: 'Invoice changed while payment details were being created; refresh and retry',
      code: 'INVOICE_STATE_CHANGED',
    };
  }

  return {
    ok: true,
    invoice: updatedInvoice,
    paymentLink: getInvoicePaymentLink(invoice.id),
    idempotentReplay: paymentResult.replayed === true,
  };
}
