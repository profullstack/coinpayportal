import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getStripeClient } from './client';
import { handleAccountUpdated } from './accounts';
import { createEscrowRecord } from './escrow';
import { recordReputationEvent } from './reputation';
import { calculatePlatformFee, type MerchantTier } from './payments';

/**
 * Verify and construct a Stripe webhook event
 */
export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
  webhookSecret: string
): Stripe.Event {
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

/**
 * Handle all relevant Stripe webhook events
 */
export async function handleWebhookEvent(
  supabase: SupabaseClient,
  event: Stripe.Event
): Promise<{ handled: boolean; action?: string }> {
  switch (event.type) {
    case 'payment_intent.succeeded':
      return handlePaymentIntentSucceeded(supabase, event.data.object as Stripe.PaymentIntent);

    case 'charge.dispute.created':
      return handleDisputeCreated(supabase, event.data.object as Stripe.Dispute);

    case 'charge.refunded':
      return handleChargeRefunded(supabase, event.data.object as Stripe.Charge);

    case 'account.updated':
      return handleAccountUpdatedEvent(supabase, event.data.object as Stripe.Account);

    case 'payout.paid':
      return handlePayoutPaid(supabase, event.data.object as Stripe.Payout);

    default:
      return { handled: false };
  }
}

async function handlePaymentIntentSucceeded(
  supabase: SupabaseClient,
  paymentIntent: Stripe.PaymentIntent
) {
  const merchantId = paymentIntent.metadata?.coinpay_merchant_id;
  const mode = paymentIntent.metadata?.mode || 'gateway';
  const platformFee = parseInt(paymentIntent.metadata?.platform_fee || '0', 10);

  // Record transaction
  await supabase.from('stripe_transactions').insert({
    merchant_id: merchantId,
    stripe_payment_intent_id: paymentIntent.id,
    stripe_charge_id: paymentIntent.latest_charge as string || null,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    platform_fee_amount: platformFee,
    status: 'succeeded',
    mode,
  });

  // If escrow mode, create escrow record
  if (mode === 'escrow' && merchantId) {
    const releaseAfterDays = parseInt(paymentIntent.metadata?.release_after_days || '7', 10);
    await createEscrowRecord(supabase, {
      merchantId,
      stripePaymentIntentId: paymentIntent.id,
      stripeChargeId: paymentIntent.latest_charge as string,
      totalAmount: paymentIntent.amount,
      platformFee,
      stripeFee: 0, // Stripe fee comes from balance_transaction, updated later
      releaseAfterDays,
    });
  }

  // Record reputation event
  if (merchantId) {
    const { data: merchant } = await supabase
      .from('merchants')
      .select('did')
      .eq('id', merchantId)
      .single();

    if (merchant?.did) {
      await recordReputationEvent(supabase, {
        did: merchant.did,
        eventType: 'card_payment_success',
        relatedTransactionId: paymentIntent.id,
        metadata: { amount: paymentIntent.amount, currency: paymentIntent.currency },
      });
    }
  }

  return { handled: true, action: 'payment_recorded' };
}

async function handleDisputeCreated(
  supabase: SupabaseClient,
  dispute: Stripe.Dispute
) {
  // Find merchant by charge
  const { data: txn } = await supabase
    .from('stripe_transactions')
    .select('merchant_id')
    .eq('stripe_charge_id', dispute.charge as string)
    .single();

  const merchantId = txn?.merchant_id;

  await supabase.from('stripe_disputes').insert({
    merchant_id: merchantId,
    stripe_dispute_id: dispute.id,
    stripe_charge_id: dispute.charge as string,
    amount: dispute.amount,
    currency: dispute.currency,
    status: dispute.status,
    reason: dispute.reason,
    evidence_due_by: dispute.evidence_details?.due_by
      ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
      : null,
  });

  // Record reputation event
  if (merchantId) {
    const { data: merchant } = await supabase
      .from('merchants')
      .select('did')
      .eq('id', merchantId)
      .single();

    if (merchant?.did) {
      await recordReputationEvent(supabase, {
        did: merchant.did,
        eventType: 'card_dispute_created',
        relatedTransactionId: dispute.charge as string,
        metadata: { amount: dispute.amount, reason: dispute.reason },
      });
    }
  }

  return { handled: true, action: 'dispute_recorded' };
}

async function handleChargeRefunded(
  supabase: SupabaseClient,
  charge: Stripe.Charge
) {
  // Update transaction status
  await supabase
    .from('stripe_transactions')
    .update({ status: 'refunded', updated_at: new Date().toISOString() })
    .eq('stripe_charge_id', charge.id);

  const { data: txn } = await supabase
    .from('stripe_transactions')
    .select('merchant_id')
    .eq('stripe_charge_id', charge.id)
    .single();

  if (txn?.merchant_id) {
    const { data: merchant } = await supabase
      .from('merchants')
      .select('did')
      .eq('id', txn.merchant_id)
      .single();

    if (merchant?.did) {
      await recordReputationEvent(supabase, {
        did: merchant.did,
        eventType: 'card_refund',
        relatedTransactionId: charge.id,
        metadata: { amount: charge.amount_refunded },
      });
    }
  }

  return { handled: true, action: 'refund_recorded' };
}

async function handleAccountUpdatedEvent(
  supabase: SupabaseClient,
  account: Stripe.Account
) {
  const updates = handleAccountUpdated(account);

  await supabase
    .from('stripe_accounts')
    .update(updates)
    .eq('stripe_account_id', account.id);

  return { handled: true, action: 'account_updated' };
}

async function handlePayoutPaid(
  supabase: SupabaseClient,
  payout: Stripe.Payout
) {
  // Payouts come from connected accounts — store them
  await supabase.from('stripe_payouts').upsert(
    {
      stripe_payout_id: payout.id,
      amount: payout.amount,
      currency: payout.currency,
      status: payout.status,
      arrival_date: payout.arrival_date
        ? new Date(payout.arrival_date * 1000).toISOString()
        : null,
    },
    { onConflict: 'stripe_payout_id' }
  );

  return { handled: true, action: 'payout_recorded' };
}
