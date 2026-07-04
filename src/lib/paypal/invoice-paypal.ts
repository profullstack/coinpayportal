import type { SupabaseClient } from '@supabase/supabase-js';
import { createPaypalOrder, type PaypalOrder } from './client';
import { getBusinessPaypalCredentials } from './accounts';

/**
 * Minimal shape of an invoice needed to build a PayPal order.
 */
export interface InvoiceForPaypal {
  id: string;
  invoice_number: string;
  amount: string | number;
  currency?: string | null;
  business_id: string;
  businesses?: { name?: string | null } | null;
}

/**
 * Create a PayPal order for an invoice on the business's connected PayPal
 * account. Unlike the Stripe rail there's no platform application fee — the
 * merchant receives the full amount in their own PayPal account.
 *
 * Returns `null` when the business has no connected PayPal account — callers
 * decide whether that is fatal.
 */
export async function createInvoicePaypalOrder(
  supabase: SupabaseClient,
  invoice: InvoiceForPaypal
): Promise<PaypalOrder | null> {
  const creds = await getBusinessPaypalCredentials(supabase, invoice.business_id);
  if (!creds) {
    return null;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';

  return createPaypalOrder({
    ...creds,
    amount: invoice.amount,
    currency: invoice.currency || 'USD',
    referenceId: invoice.invoice_number,
    description: `Invoice ${invoice.invoice_number}`,
    brandName: invoice.businesses?.name || 'CoinPay',
    returnUrl: `${appUrl}/invoices/${invoice.id}/pay?paypal=success`,
    cancelUrl: `${appUrl}/invoices/${invoice.id}/pay?paypal=cancel`,
  });
}
