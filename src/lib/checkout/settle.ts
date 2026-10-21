import type { SupabaseClient } from '@supabase/supabase-js';
import { activateSubscriptionFromCheckoutSession } from '@/lib/subscriptions/activate';

/**
 * Mark a hosted checkout session paid. Called from the payment webhook path
 * (crypto confirm/forward and PayPal capture all funnel through
 * sendPaymentWebhook) and lazily from the session read. Conditional on the
 * session not already being paid, so repeats are no-ops.
 *
 * `businessId` is the business the settled payment belongs to. The session id
 * arrives in that payment's metadata, which /api/payments/create accepts from
 * the caller, so without this check any merchant could settle another
 * business's session (a CoinPay plan checkout included) with a one-cent
 * payment of their own that names it.
 *
 * A paid session on CoinPay's own billing business then grants the plan it
 * sold; that call is idempotent and runs on every settle so a later event
 * (payment.forwarded after payment.confirmed) retries a failed grant.
 */
export async function markCheckoutSessionPaidFromWebhook(
  supabase: SupabaseClient,
  input: { sessionId: string; paymentId: string; method: string | null; businessId?: string | null }
): Promise<boolean> {
  if (!/^cs_[A-Za-z0-9]{16,64}$/.test(input.sessionId)) return false;
  const now = new Date().toISOString();
  let query = supabase
    .from('checkout_sessions')
    .update({
      status: 'paid',
      paid_at: now,
      paid_reference: input.paymentId,
      paid_method: input.method ? String(input.method).toUpperCase() : null,
      updated_at: now,
    })
    .eq('id', input.sessionId)
    .neq('status', 'paid');
  if (input.businessId) query = query.eq('business_id', input.businessId);
  const { data, error } = await query.select('id').maybeSingle();
  if (error) {
    console.error('[Checkout] mark paid failed:', error);
    return false;
  }

  try {
    await activateSubscriptionFromCheckoutSession(supabase, input.sessionId);
  } catch (e) {
    console.error('[Checkout] subscription activation failed:', e);
  }
  return !!data;
}
