import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/server/optional-deps';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'
);

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature') as string;

    let event: any;

    try {
      event = (await getStripe()).webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
      console.error(`Webhook signature verification failed: ${err.message}`);
      return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 });
    }

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;

      case 'charge.dispute.created':
        await handleDisputeCreated(event.data.object);
        break;

      case 'payout.created':
        await handlePayoutCreated(event.data.object);
        break;

      case 'payout.paid':
        await handlePayoutPaid(event.data.object);
        break;

      case 'account.updated':
        await handleAccountUpdated(event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });

  } catch (error: any) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Webhook handling failed' }, { status: 500 });
  }
}

async function handlePaymentSucceeded(paymentIntent: any) {
  try {
    const merchantId = paymentIntent.metadata.merchant_id;
    const businessId = paymentIntent.metadata.business_id;
    // Get the charge details for fees
    const stripe = await getStripe();
    const charges = await stripe.charges.list({
      payment_intent: paymentIntent.id,
      limit: 1,
    });

    const charge = charges.data[0];
    if (!charge) return;

    const stripeFee = charge.balance_transaction 
      ? (await stripe.balanceTransactions.retrieve(charge.balance_transaction as string)).fee 
      : 0;

    // Update transaction record
    await supabase
      .from('stripe_transactions')
      .update({
        stripe_charge_id: charge.id,
        stripe_balance_txn_id: charge.balance_transaction as string,
        stripe_fee_amount: stripeFee,
        net_to_merchant: paymentIntent.amount - stripeFee - parseInt(paymentIntent.metadata.platform_fee_amount || '0'),
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_payment_intent_id', paymentIntent.id);

    // Create DID reputation event
    if (merchantId) {
      const { data: merchant } = await supabase
        .from('merchants')
        .select('did')
        .eq('id', merchantId)
        .single();

      if (merchant?.did) {
        await supabase
          .from('did_reputation_events')
          .insert({
            did: merchant.did,
            event_type: 'card_payment_success',
            source_rail: 'card',
            related_transaction_id: paymentIntent.id,
            weight: 10, // Positive weight for successful payment
            metadata: {
              amount: paymentIntent.amount,
              currency: paymentIntent.currency,
              business_id: businessId,
            },
          });
      }
    }

  } catch (error) {
    console.error('Error handling payment succeeded:', error);
  }
}

async function handleDisputeCreated(dispute: any) {
  try {
    const charge = await (await getStripe()).charges.retrieve(dispute.charge as string);
    const paymentIntent = charge.payment_intent as string;

    // Get merchant info from payment intent
    const { data: transaction } = await supabase
      .from('stripe_transactions')
      .select('merchant_id')
      .eq('stripe_payment_intent_id', paymentIntent)
      .single();

    if (!transaction) return;

    // Create dispute record
    await supabase
      .from('stripe_disputes')
      .insert({
        merchant_id: transaction.merchant_id,
        stripe_dispute_id: dispute.id,
        stripe_charge_id: dispute.charge as string,
        amount: dispute.amount,
        currency: dispute.currency,
        status: dispute.status,
        reason: dispute.reason,
        evidence_due_by: dispute.evidence_details.due_by ? new Date(dispute.evidence_details.due_by * 1000) : null,
      });

    // Create negative DID reputation event
    const { data: merchant } = await supabase
      .from('merchants')
      .select('did')
      .eq('id', transaction.merchant_id)
      .single();

    if (merchant?.did) {
      await supabase
        .from('did_reputation_events')
        .insert({
          did: merchant.did,
          event_type: 'card_dispute_created',
          source_rail: 'card',
          related_transaction_id: paymentIntent,
          weight: -50, // Heavy negative weight for dispute
          metadata: {
            dispute_id: dispute.id,
            amount: dispute.amount,
            currency: dispute.currency,
            reason: dispute.reason,
          },
        });
    }

  } catch (error) {
    console.error('Error handling dispute created:', error);
  }
}

async function handlePayoutCreated(payout: any) {
  try {
    // Find merchant by Stripe account ID
    const { data: stripeAccount } = await supabase
      .from('stripe_accounts')
      .select('merchant_id')
      .eq('stripe_account_id', payout.destination as string)
      .single();

    if (!stripeAccount) return;

    // Create payout record
    await supabase
      .from('stripe_payouts')
      .insert({
        merchant_id: stripeAccount.merchant_id,
        stripe_payout_id: payout.id,
        amount: payout.amount,
        currency: payout.currency,
        status: payout.status,
        arrival_date: new Date(payout.arrival_date * 1000),
      });

  } catch (error) {
    console.error('Error handling payout created:', error);
  }
}

async function handlePayoutPaid(payout: any) {
  try {
    // Update payout status
    await supabase
      .from('stripe_payouts')
      .update({
        status: 'paid',
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_payout_id', payout.id);

  } catch (error) {
    console.error('Error handling payout paid:', error);
  }
}

async function handleAccountUpdated(account: any) {
  try {
    // Update account capabilities
    await supabase
      .from('stripe_accounts')
      .update({
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        details_submitted: account.details_submitted,
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_account_id', account.id);

  } catch (error) {
    console.error('Error handling account updated:', error);
  }
}
