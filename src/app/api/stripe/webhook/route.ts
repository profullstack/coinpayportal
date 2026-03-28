import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/server/optional-deps';
import { sendPaymentWebhook } from '@/lib/webhooks/service';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Support multiple webhook secrets (platform direct + Connect events)
function getWebhookSecrets(): string[] {
  return [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  ].filter(Boolean) as string[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature') as string;

    let event: any;
    const stripe = await getStripe();

    // Try each webhook secret until one verifies
    const secrets = getWebhookSecrets();
    let verified = false;
    for (const secret of secrets) {
      try {
        event = stripe.webhooks.constructEvent(body, signature, secret);
        verified = true;
        break;
      } catch {
        // Try next secret
      }
    }

    if (!verified) {
      console.error('Webhook signature verification failed with all secrets');
      return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 });
    }

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;

      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object);
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

/**
 * Handle checkout.session.completed — update payment or invoice record and fire merchant webhook
 */
async function handleCheckoutSessionCompleted(session: any) {
  try {
    const coinpayPaymentId = session.metadata?.coinpay_payment_id;
    const coinpayInvoiceId = session.metadata?.coinpay_invoice_id;
    const businessId = session.metadata?.business_id;

    // Handle invoice payments
    if (coinpayInvoiceId) {
      await handleInvoiceCheckoutCompleted(session, coinpayInvoiceId, businessId);
      return;
    }

    if (!coinpayPaymentId) {
      // No CoinPay payment ID — but if there's a business_id, fire merchant webhook
      // This handles external integrations (e.g. ugig.net funding) that create
      // checkout sessions via /api/stripe/payments/create without a CoinPay payment record
      if (businessId) {
        console.log(`[Stripe Webhook] checkout.session.completed for external payment (business=${businessId})`);

        // Update stripe_transactions record to completed
        const platformFee = parseInt(session.metadata?.platform_fee_amount || '0');
        await supabase
          .from('stripe_transactions')
          .update({
            status: 'completed',
            business_id: businessId,
            stripe_payment_intent_id: session.payment_intent,
            stripe_charge_id: session.payment_intent, // best we have
            platform_fee_amount: platformFee,
            net_to_merchant: (session.amount_total || 0) - platformFee,
            updated_at: new Date().toISOString(),
          })
          .eq('merchant_id', session.metadata?.merchant_id)
          .eq('amount', session.amount_total)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1);

        // Fire merchant webhook
        await sendPaymentWebhook(
          supabase,
          businessId,
          session.id,
          'payment.confirmed',
          {
            status: 'confirmed',
            amount_usd: session.amount_total ? session.amount_total / 100 : 0,
            currency: 'usd',
            payment_address: null,
            tx_hash: session.payment_intent,
            confirmations: 1,
            metadata: {
              ...session.metadata,
              payment_rail: 'card',
              stripe_session_id: session.id,
              stripe_payment_intent_id: session.payment_intent,
            },
          }
        );
      }
      return;
    }

    console.log(`[Stripe Webhook] checkout.session.completed for payment ${coinpayPaymentId}`);

    // Fetch the payment to get full details for webhook
    const { data: fullPayment } = await supabase
      .from('payments')
      .select('*')
      .eq('id', coinpayPaymentId)
      .single();

    if (!fullPayment) {
      console.error(`[Stripe Webhook] Payment not found: ${coinpayPaymentId}`);
      return;
    }

    // Update metadata to mark as card-confirmed, preserving existing metadata
    const updatedMetadata = {
      ...fullPayment.metadata,
      stripe_payment_intent_id: session.payment_intent,
      card_confirmed_at: new Date().toISOString(),
    };

    await supabase
      .from('payments')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: updatedMetadata,
      })
      .eq('id', coinpayPaymentId);

    // Fire merchant webhook with card_confirmed event
    if (businessId) {
      await sendPaymentWebhook(
        supabase,
        businessId,
        coinpayPaymentId,
        'payment.confirmed',
        {
          status: 'confirmed',
          amount_usd: fullPayment.amount,
          amount_crypto: null,
          currency: 'usd',
          payment_address: null,
          tx_hash: session.payment_intent,
          confirmations: 1,
          metadata: {
            ...fullPayment.metadata,
            payment_rail: 'card',
            stripe_session_id: session.id,
            stripe_payment_intent_id: session.payment_intent,
          },
        }
      );
    }

    // Also create stripe_transaction record
    const platformFee = parseInt(session.metadata?.platform_fee_amount || '0');
    try {
      await supabase
        .from('stripe_transactions')
        .insert({
          merchant_id: session.metadata?.merchant_id,
          amount: session.amount_total,
          currency: session.currency || 'usd',
          platform_fee_amount: platformFee,
          status: 'completed',
          rail: 'card',
          stripe_payment_intent_id: session.payment_intent,
          updated_at: new Date().toISOString(),
        });
    } catch (err) {
      console.log('[Stripe Webhook] Transaction insert error (may already exist):', err);
    }

  } catch (error) {
    console.error('Error handling checkout session completed:', error);
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
    // Find business by Stripe account ID
    const { data: stripeAccount } = await supabase
      .from('stripe_accounts')
      .select('merchant_id, business_id')
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

/**
 * Handle checkout.session.completed for invoice payments
 */
async function handleInvoiceCheckoutCompleted(session: any, invoiceId: string, businessId: string) {
  try {
    console.log(`[Stripe Webhook] checkout.session.completed for invoice ${invoiceId}`);

    // Fetch the invoice
    const { data: invoice } = await supabase
      .from('invoices')
      .select('*, businesses (id, name, merchant_id)')
      .eq('id', invoiceId)
      .single();

    if (!invoice) {
      console.error(`[Stripe Webhook] Invoice not found: ${invoiceId}`);
      return;
    }

    // Mark invoice as paid
    await supabase
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        tx_hash: session.payment_intent,
        metadata: {
          ...invoice.metadata,
          payment_rail: 'card',
          stripe_payment_intent_id: session.payment_intent,
          card_confirmed_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId);

    // Fire merchant webhook
    if (businessId) {
      await sendPaymentWebhook(
        supabase,
        businessId,
        invoiceId,
        'invoice.paid',
        {
          status: 'paid',
          amount_usd: invoice.amount,
          currency: invoice.currency || 'usd',
          invoice_number: invoice.invoice_number,
          payment_rail: 'card',
          stripe_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent,
        }
      );
    }

    // Create stripe_transaction record
    const platformFee = parseInt(session.metadata?.platform_fee_amount || '0');
    try {
      await supabase
        .from('stripe_transactions')
        .insert({
          merchant_id: session.metadata?.merchant_id,
          amount: session.amount_total,
          currency: session.currency || 'usd',
          platform_fee_amount: platformFee,
          status: 'completed',
          rail: 'card',
          stripe_payment_intent_id: session.payment_intent,
          updated_at: new Date().toISOString(),
        });
    } catch (err) {
      console.log('[Stripe Webhook] Invoice transaction insert error:', err);
    }
  } catch (error) {
    console.error('Error handling invoice checkout session completed:', error);
  }
}
