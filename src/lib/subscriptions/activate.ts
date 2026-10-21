import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditEvent } from '@/lib/audit/log';
import { billingBusinessId, getSubscriptionPrice, type BillingPeriod } from './plans';

/**
 * Grant the plan a paid plan-checkout session bought.
 *
 * Called from markCheckoutSessionPaidFromWebhook every time a session's
 * payment settles (confirmed, then forwarded; PayPal capture), so a transient
 * failure on the first call is retried by the next. Idempotent: the session's
 * metadata is stamped `subscription_activated_at` by a conditional update
 * before the plan is granted, so two calls cannot both extend the plan.
 *
 * Trust: only a session on CoinPay's own billing business counts, and only
 * that business (its owner, teammates or API key) can create one. Whose plan it
 * is comes from the session row (`account_id`, written by createSubscriptionCheckout),
 * and the plan and period are checked against the price table and the amount
 * the session charged.
 */
export async function activateSubscriptionFromCheckoutSession(
  supabase: SupabaseClient,
  sessionId: string
): Promise<{ activated: boolean; reason?: string }> {
  const { data: session } = await supabase
    .from('checkout_sessions')
    .select('id, business_id, status, amount, currency, account_id, metadata, paid_method, paid_reference')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return { activated: false, reason: 'not_found' };
  if (session.business_id !== billingBusinessId()) return { activated: false, reason: 'not_billing' };

  const metadata = (session.metadata && typeof session.metadata === 'object' ? session.metadata : {}) as Record<string, unknown>;
  if (metadata.type !== 'subscription_payment') return { activated: false, reason: 'not_subscription' };
  if (session.status !== 'paid') return { activated: false, reason: 'not_paid' };
  if (metadata.subscription_activated_at) return { activated: false, reason: 'already_activated' };

  const merchantId = String(session.account_id || '');
  const planId = String(metadata.plan_id || '');
  const billingPeriod = String(metadata.billing_period || '') as BillingPeriod;
  const price = getSubscriptionPrice(planId, billingPeriod);
  if (!/^[0-9a-f-]{36}$/i.test(merchantId) || price === null) {
    console.error(`[Subscriptions] session ${sessionId} has no valid merchant/plan`, { merchantId, planId, billingPeriod });
    return { activated: false, reason: 'invalid' };
  }
  if (session.currency !== 'USD' || !(Number(session.amount) >= price)) {
    console.error(`[Subscriptions] session ${sessionId} charged ${session.amount} ${session.currency}, plan costs ${price}`);
    return { activated: false, reason: 'underpaid' };
  }

  const now = new Date();
  // Claim first. The filter on the JSON key makes this a compare-and-set.
  const { data: claimed, error: claimError } = await supabase
    .from('checkout_sessions')
    .update({ metadata: { ...metadata, subscription_activated_at: now.toISOString() }, updated_at: now.toISOString() })
    .eq('id', sessionId)
    .is('metadata->>subscription_activated_at', null)
    .select('id')
    .maybeSingle();
  if (claimError || !claimed) {
    if (claimError) console.error('[Subscriptions] activation claim failed:', claimError);
    return { activated: false, reason: claimError ? 'claim_failed' : 'already_activated' };
  }

  const { data: merchant } = await supabase
    .from('merchants')
    .select('subscription_plan_id, subscription_status, subscription_ends_at')
    .eq('id', merchantId)
    .maybeSingle();

  const previousPlan: string = merchant?.subscription_plan_id || 'starter';

  // Renewing early extends from the current end date rather than losing the
  // days already paid for.
  const currentEnd = merchant?.subscription_ends_at ? new Date(merchant.subscription_ends_at) : null;
  const start =
    merchant?.subscription_plan_id === planId && currentEnd && currentEnd > now ? currentEnd : now;
  const endDate = new Date(start);
  if (billingPeriod === 'yearly') endDate.setFullYear(endDate.getFullYear() + 1);
  else endDate.setMonth(endDate.getMonth() + 1);

  const { error: updateError } = await supabase
    .from('merchants')
    .update({
      subscription_plan_id: planId,
      subscription_status: 'active',
      subscription_started_at: start === now ? now.toISOString() : undefined,
      subscription_ends_at: endDate.toISOString(),
    })
    .eq('id', merchantId);

  if (updateError) {
    // Release the claim so the next settle call retries.
    await supabase
      .from('checkout_sessions')
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq('id', sessionId);
    console.error('[Subscriptions] plan grant failed:', updateError);
    return { activated: false, reason: 'update_failed' };
  }

  await supabase.from('subscription_history').insert({
    merchant_id: merchantId,
    previous_plan_id: previousPlan,
    new_plan_id: planId,
    change_type: previousPlan === planId ? 'reactivation' : 'upgrade',
    metadata: {
      checkout_session_id: sessionId,
      billing_period: billingPeriod,
      amount: Number(session.amount),
      paid_method: session.paid_method,
      paid_reference: session.paid_reference,
      subscription_ends_at: endDate.toISOString(),
    },
  });

  await recordAuditEvent(supabase, {
    action: 'subscription.activated',
    actorType: 'system',
    actorId: 'checkout-session',
    subjectType: 'merchant',
    subjectId: merchantId,
    merchantId,
    detail: {
      plan_id: planId,
      billing_period: billingPeriod,
      checkout_session_id: sessionId,
      paid_method: session.paid_method,
      paid_reference: session.paid_reference,
      amount_paid: Number(session.amount),
      currency: session.currency,
      ends_at: endDate.toISOString(),
    },
  });

  return { activated: true };
}
