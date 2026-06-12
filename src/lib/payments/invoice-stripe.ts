import type { SupabaseClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/server/optional-deps';

/**
 * Minimal shape of an invoice needed to build a Stripe Connect checkout session.
 */
export interface InvoiceForStripe {
  id: string;
  invoice_number: string;
  amount: string | number;
  business_id: string;
  businesses?: { merchant_id?: string | null } | null;
}

export interface InvoiceStripeCheckout {
  stripeCheckoutUrl: string;
  stripeSessionId: string;
}

/**
 * Create a Stripe Connect checkout session for an invoice and route the funds to
 * the business's connected account, taking the CoinPay platform fee as an
 * application fee. Returns `null` when the business has no usable Stripe Connect
 * account (not connected, or charges not yet enabled) — callers decide whether
 * that is fatal.
 *
 * Shared by the invoice "send" flow (initial creation) and the "enable-card"
 * flow (regenerating the card option on an already-sent invoice once the
 * merchant finishes Stripe onboarding).
 */
export async function createInvoiceStripeCheckout(
  supabase: SupabaseClient,
  invoice: InvoiceForStripe,
  isPaidTier: boolean
): Promise<InvoiceStripeCheckout | null> {
  const { data: stripeAccount } = await supabase
    .from('stripe_accounts')
    .select('stripe_account_id, charges_enabled')
    .eq('business_id', invoice.business_id)
    .single();

  if (!stripeAccount?.stripe_account_id || !stripeAccount.charges_enabled) {
    return null;
  }

  const amountCents = Math.round(parseFloat(String(invoice.amount)) * 100);
  const platformFeeRate = isPaidTier ? 0.005 : 0.01;
  const platformFeeAmount = Math.round(amountCents * platformFeeRate);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';
  const stripe = await getStripe();
  const session = await stripe.checkout.sessions.create({
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: `Invoice ${invoice.invoice_number}` },
          unit_amount: amountCents,
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    payment_intent_data: {
      application_fee_amount: platformFeeAmount,
      transfer_data: {
        destination: stripeAccount.stripe_account_id,
      },
      metadata: {
        coinpay_invoice_id: invoice.id,
        business_id: invoice.business_id,
        merchant_id: invoice.businesses?.merchant_id,
      },
    },
    success_url: `${appUrl}/invoices/${invoice.id}/pay?status=success`,
    cancel_url: `${appUrl}/invoices/${invoice.id}/pay`,
    metadata: {
      coinpay_invoice_id: invoice.id,
      business_id: invoice.business_id,
      merchant_id: invoice.businesses?.merchant_id,
      platform_fee_amount: platformFeeAmount.toString(),
    },
  });

  return { stripeCheckoutUrl: session.url!, stripeSessionId: session.id };
}
