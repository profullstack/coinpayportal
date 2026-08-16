import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPaymentWebhook } from '@/lib/webhooks/service';
import { forwardPaymentSecurely } from '@/lib/wallets/secure-forwarding';
import { checkBalance } from '@/app/api/cron/monitor-payments/balance-checkers';
import { authorizePaymentAccess } from '@/lib/auth/payment-access';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { isSufficientPayment } from '@/lib/payments/tolerance';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * POST /api/payments/[id]/check-balance
 * Check blockchain balance and update payment status if funds detected
 *
 * This endpoint is called by the frontend during polling to actively check
 * for incoming payments, providing faster detection than the scheduled Edge Function.
 *
 * Authorization is mandatory. Confirming a payment here also triggers an
 * on-chain forward, so an unauthenticated caller who knew (or guessed) a
 * payment UUID could drive the whole settlement pipeline — and drive it
 * concurrently, producing duplicate sends. The caller must hold the internal
 * key, a merchant JWT for the payment's business, or that business's API key.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: paymentId } = await params;

    // Create Supabase client with service role for admin access
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the payment
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single();

    if (paymentError || !payment) {
      return NextResponse.json(
        { success: false, error: 'Payment not found' },
        { status: 404 }
      );
    }

    const auth = await authorizePaymentAccess(supabase, request, payment.business_id, { write: true });
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    // Second layer: even an authorized caller cannot use this as an RPC
    // amplifier against the chain providers.
    const limit = await checkRateLimitAsync(paymentId, 'check_balance');
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many balance checks for this payment' },
        { status: 429, headers: { 'Retry-After': String(Math.max(1, limit.resetAt - Math.floor(Date.now() / 1000))) } }
      );
    }

    // Only check pending payments
    if (payment.status !== 'pending') {
      return NextResponse.json({
        success: true,
        status: payment.status,
        message: `Payment is already ${payment.status}`,
      });
    }
    
    const isExpired = Boolean(payment.expires_at && new Date(payment.expires_at) < new Date());
    
    // Check if we have a payment address
    if (!payment.payment_address) {
      if (isExpired) {
        await supabase
          .from('payments')
          .update({
            status: 'expired',
            updated_at: new Date().toISOString(),
          })
          .eq('id', paymentId);

        return NextResponse.json({
          success: true,
          status: 'expired',
          message: 'Payment has expired',
        });
      }

      return NextResponse.json({
        success: false,
        error: 'Payment has no address to check',
      });
    }
    
    // Check blockchain balance
    const balance = await checkBalance(payment.payment_address, payment.blockchain);
    console.log(`Payment ${paymentId}: blockchain=${payment.blockchain}, address=${payment.payment_address}, balance=${balance}, expected=${payment.crypto_amount}`);
    
    // Settlement requires the full amount. A NULL/NaN expected amount fails
    // closed here rather than making the comparison NaN (which used to confirm
    // at a zero balance).
    const expectedAmount = parseFloat(payment.crypto_amount);

    if (isSufficientPayment(balance, payment.crypto_amount)) {
      const now = new Date().toISOString();

      // Compare-and-swap: only the caller that observes the row still 'pending'
      // gets to confirm it. Three schedulers plus this endpoint can race here,
      // and without the guard each of them would go on to forward on-chain.
      const { data: claimed } = await supabase
        .from('payments')
        .update({
          status: 'confirmed',
          confirmed_at: now,
          updated_at: now,
        })
        .eq('id', paymentId)
        .eq('status', 'pending')
        .select('id');

      if (!claimed || claimed.length === 0) {
        // Another worker confirmed it first; it owns the forward.
        return NextResponse.json({
          success: true,
          status: 'confirmed',
          balance,
          message: 'Payment already confirmed',
        });
      }

      console.log(`Payment ${paymentId} confirmed with balance ${balance}`);

      // Send payment.confirmed webhook to notify merchant
      try {
        await sendPaymentWebhook(supabase, payment.business_id, paymentId, 'payment.confirmed', {
          amount_usd: payment.amount?.toString() || '0',
          amount_crypto: payment.crypto_amount?.toString() || '0',
          currency: payment.blockchain,
          status: 'confirmed',
          received_amount: balance.toString(),
          confirmed_at: now,
          payment_address: payment.payment_address,
          tx_hash: payment.tx_hash || undefined,
          metadata: payment.metadata || undefined,
        });
        console.log(`Webhook sent for payment ${paymentId} confirmation`);
      } catch (webhookError) {
        // Log but don't fail the request - webhook failures shouldn't block payment flow
        console.error(`Failed to send webhook for payment ${paymentId}:`, webhookError);
      }

      // Trigger forwarding directly (avoid HTTP self-call timeout issues)
      try {
        console.log(`Triggering forwarding for payment ${paymentId}...`);
        const forwardResult = await forwardPaymentSecurely(supabase, paymentId);

        if (forwardResult.success) {
          console.log(`Forwarding completed for payment ${paymentId}: merchantTx=${forwardResult.merchantTxHash}`);
        } else {
          console.error(`Forwarding failed for ${paymentId}: ${forwardResult.error}`);
        }
      } catch (forwardError) {
        console.error(`Error during forwarding for ${paymentId}:`, forwardError);
      }
      
      return NextResponse.json({
        success: true,
        status: 'confirmed',
        balance,
        message: 'Payment confirmed! Funds detected.',
      });
    }

    if (isExpired) {
      await supabase
        .from('payments')
        .update({
          status: 'expired',
          updated_at: new Date().toISOString(),
        })
        .eq('id', paymentId);

      return NextResponse.json({
        success: true,
        status: 'expired',
        balance,
        expected: expectedAmount,
        message: 'Payment has expired',
      });
    }
    
    return NextResponse.json({
      success: true,
      status: 'pending',
      balance,
      expected: expectedAmount,
      message: balance > 0 
        ? `Partial payment detected: ${balance} / ${expectedAmount}` 
        : 'Waiting for payment...',
    });
  } catch (error) {
    console.error('Check balance error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check balance',
      },
      { status: 500 }
    );
  }
}
