/**
 * Backfill a single stranded Stripe-paid CoinPay payment and re-fire its
 * outbound merchant webhook.
 *
 * Use this when a Stripe webhook delivery was lost (e.g. the
 * stripe_transactions schema was incomplete and the row insert silently
 * failed) and the merchant's downstream system never got notified.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-stripe-payment.ts <coinpay_payment_id> [--dry-run]
 *
 * Example (the d0rz funding payment):
 *   pnpm tsx scripts/backfill-stripe-payment.ts 2a75c13a-51fc-4a2e-8693-545d6509a167
 */

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { sendPaymentWebhook } from '../src/lib/webhooks/service';

async function main() {
  const paymentId = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');

  if (!paymentId) {
    console.error('Usage: pnpm tsx scripts/backfill-stripe-payment.ts <payment_id> [--dry-run]');
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey || !stripeKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / STRIPE_SECRET_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const stripe = new Stripe(stripeKey);

  // 1. Load payment
  const { data: payment, error: payErr } = await supabase
    .from('payments')
    .select('*')
    .eq('id', paymentId)
    .single();

  if (payErr || !payment) {
    console.error(`Payment ${paymentId} not found:`, payErr);
    process.exit(1);
  }

  console.log(`Loaded payment: status=${payment.status}, business_id=${payment.business_id}, amount=${payment.amount}`);

  // 2. Find the matching Stripe session via metadata search.
  // We need the payment_intent id to record on the row + send in the webhook.
  console.log('Searching Stripe for matching checkout session…');
  const sessions = await stripe.checkout.sessions.list({ limit: 100 });
  const session = sessions.data.find(
    (s) => s.metadata?.coinpay_payment_id === paymentId
  );

  if (!session) {
    console.error('No matching Stripe checkout session found in last 100. Try widening the search or pass --pi <id> directly.');
    process.exit(1);
  }

  console.log(`Found Stripe session: ${session.id} (status=${session.status}, payment_status=${session.payment_status})`);

  if (session.payment_status !== 'paid') {
    console.error(`Session is not paid (payment_status=${session.payment_status}). Refusing to backfill.`);
    process.exit(1);
  }

  if (dryRun) {
    console.log('--dry-run: would mark payment confirmed and fire webhook, exiting.');
    return;
  }

  // 3. Mark the payment confirmed
  const { error: upErr } = await supabase
    .from('payments')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {
        ...(payment.metadata || {}),
        stripe_payment_intent_id: session.payment_intent,
        card_confirmed_at: new Date().toISOString(),
        backfilled_at: new Date().toISOString(),
      },
    })
    .eq('id', paymentId);

  if (upErr) {
    console.error('Failed to update payment:', upErr);
    process.exit(1);
  }
  console.log('Payment marked confirmed.');

  // 4. Insert the stripe_transactions row (idempotent via unique pi)
  const platformFee = parseInt((session.metadata?.platform_fee_amount as string) || '0');
  const { error: txErr } = await supabase
    .from('stripe_transactions')
    .upsert(
      {
        merchant_id: session.metadata?.merchant_id,
        business_id: payment.business_id,
        amount: session.amount_total,
        currency: session.currency || 'usd',
        platform_fee_amount: platformFee,
        net_to_merchant: (session.amount_total || 0) - platformFee,
        status: 'completed',
        rail: 'card',
        stripe_payment_intent_id: session.payment_intent as string,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'stripe_payment_intent_id' }
    );
  if (txErr) {
    console.error('Failed to upsert stripe_transactions row:', txErr);
  } else {
    console.log('stripe_transactions row upserted.');
  }

  // 5. Fire the outbound merchant webhook
  const result = await sendPaymentWebhook(
    supabase,
    payment.business_id,
    paymentId,
    'payment.confirmed',
    {
      status: 'confirmed',
      amount_usd: payment.amount,
      amount_crypto: null,
      currency: 'usd',
      payment_address: null,
      tx_hash: session.payment_intent,
      confirmations: 1,
      metadata: {
        ...(payment.metadata || {}),
        payment_rail: 'card',
        stripe_session_id: session.id,
        stripe_payment_intent_id: session.payment_intent,
        backfill: true,
      },
    }
  );

  if (result.success) {
    console.log('Outbound webhook delivered successfully.');
  } else {
    console.error('Outbound webhook delivery failed:', result.error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
