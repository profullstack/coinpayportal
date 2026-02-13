import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

let _stripe: Stripe;
function getStripe() {
  return (_stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-01-28.clover' as const,
  }));
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature') as string;

    let event: Stripe.Event;

    try {
      event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
      console.error(`Webhook signature verification failed: ${err.message}`);
      return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 });
    }

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case 'charge.dispute.created':
        await handleDisputeCreated(event.data.object as Stripe.Dispute);
        break;

      case 'payout.created':
        await handlePayoutCreated(event.data.object as Stripe.Payout);
        break;

      case 'payout.paid':
        await handlePayoutPaid(event.data.object as Stripe.Payout);
        break;

      case 'account.updated':
        await handleAccountUpdated(event.data.object as Stripe.Account);
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

async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  try {
    const merchantId = paymentIntent.metadata.merchant_id;
    const businessId = paymentIntent.metadata.business_id;
    const isEscrow = paymentIntent.metadata.escrow_mode === 'true';

    // Get the charge details for fees
    const charges = await getStripe().charges.list({
      payment_intent: paymentIntent.id,
      limit: 1,
    });

    const charge = charges.data[0];
    if (!charge) return;

    const stripeFee = charge.balance_transaction 
      ? (await getStripe().balanceTransactions.retrieve(charge.balance_transaction as string)).fee 
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

    // Update escrow record if applicable
    if (isEscrow) {
      await supabase
        .from('stripe_escrows')
        .update({
          stripe_charge_id: charge.id,
          stripe_fee: stripeFee,
          releasable_amount: paymentIntent.amount - stripeFee - parseInt(paymentIntent.metadata.platform_fee_amount || '0'),
          status: 'funded',
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_payment_intent_id', paymentIntent.id);
    }

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
              escrow_mode: isEscrow,
            },
          });
      }
    }

  } catch (error) {
    console.error('Error handling payment succeeded:', error);
  }
}

async function handleDisputeCreated(dispute: Stripe.Dispute) {
  try {
    const charge = await getStripe().charges.retrieve(dispute.charge as string);
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

async function handlePayoutCreated(payout: Stripe.Payout) {
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

async function handlePayoutPaid(payout: Stripe.Payout) {
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

async function handleAccountUpdated(account: Stripe.Account) {
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