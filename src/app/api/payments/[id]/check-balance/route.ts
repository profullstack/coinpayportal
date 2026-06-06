import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPaymentWebhook } from '@/lib/webhooks/service';
import { forwardPaymentSecurely } from '@/lib/wallets/secure-forwarding';
import { checkBalance } from '@/app/api/cron/monitor-payments/balance-checkers';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * POST /api/payments/[id]/check-balance
 * Check blockchain balance and update payment status if funds detected
 * 
 * This endpoint is called by the frontend during polling to actively check
 * for incoming payments, providing faster detection than the scheduled Edge Function.
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
    
    // Check if sufficient funds received (allow 1% tolerance for network fees)
    const expectedAmount = parseFloat(payment.crypto_amount);
    const tolerance = expectedAmount * 0.01;
    
    if (balance >= expectedAmount - tolerance) {
      const now = new Date().toISOString();
      
      // Mark as confirmed
      await supabase
        .from('payments')
        .update({
          status: 'confirmed',
          confirmed_at: now,
          updated_at: now,
        })
        .eq('id', paymentId);

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
