import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { capturePaypalOrder, getPaypalOrder } from '@/lib/paypal/client';
import { resolvePaypalContext } from '@/lib/paypal/accounts';
import { findPaypalTransaction, settlePaypalCapture } from '@/lib/paypal/settle';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/paypal/payments/capture
 *
 * Capture an approved PayPal order. Called by the payer's browser when PayPal
 * returns them to us, so it is deliberately UNAUTHENTICATED — the payer is not
 * a CoinPay user and holds no credentials.
 *
 * That is safe because the route has no free parameters: it will only capture an
 * order that already exists as a `paypal_transactions` row we created, using
 * credentials the caller never sees, for an amount the caller cannot influence.
 * The worst a stranger can do with a guessed order id is complete a payment the
 * merchant already wanted. Settlement itself is idempotent (see settle.ts), so a
 * replayed request cannot double-credit or double-notify.
 *
 * The webhook is the reliable path; this one exists so the payer sees a settled
 * receipt immediately instead of a spinner.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const body = await request.json().catch(() => ({}));
    const orderId =
      (typeof body.order_id === 'string' && body.order_id.trim()) ||
      (typeof body.orderId === 'string' && body.orderId.trim()) ||
      // PayPal's return URL calls the order id `token`.
      (typeof body.token === 'string' && body.token.trim()) ||
      null;
    const transactionId =
      (typeof body.transaction_id === 'string' && body.transaction_id.trim()) || null;

    if (!orderId && !transactionId) {
      return NextResponse.json(
        { success: false, error: 'order_id or transaction_id is required' },
        { status: 400 }
      );
    }

    const transaction = await findPaypalTransaction(supabase, {
      orderId,
      customId: transactionId,
    });

    if (!transaction) {
      return NextResponse.json({ success: false, error: 'Payment not found' }, { status: 404 });
    }

    // A transaction_id lookup must not let a caller capture some OTHER order
    // against this row. When both are supplied they have to agree.
    if (orderId && transaction.paypal_order_id !== orderId) {
      return NextResponse.json(
        { success: false, error: 'Order does not match this payment' },
        { status: 400 }
      );
    }

    if (transaction.status === 'completed') {
      return NextResponse.json({
        success: true,
        already_captured: true,
        transaction_id: transaction.id,
        status: 'completed',
      });
    }

    if (['refunded', 'partially_refunded', 'canceled', 'expired'].includes(transaction.status)) {
      return NextResponse.json(
        { success: false, error: `This payment is ${transaction.status} and cannot be captured` },
        { status: 409 }
      );
    }

    if (!transaction.business_id) {
      return NextResponse.json(
        { success: false, error: 'Payment is not linked to a business' },
        { status: 409 }
      );
    }

    const context = await resolvePaypalContext(supabase, transaction.business_id);
    if ('error' in context) {
      return NextResponse.json({ success: false, error: context.error }, { status: context.status });
    }

    const callArgs = {
      ...context.creds,
      ...context.callContext,
      orderId: transaction.paypal_order_id,
    };

    let capture;
    try {
      capture = await capturePaypalOrder(callArgs);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PayPal capture failed';

      // ORDER_ALREADY_CAPTURED means the webhook (or a racing tab) got there
      // first. Read the order back and settle from that, rather than reporting a
      // failure for a payment that actually succeeded.
      if (/ORDER_ALREADY_CAPTURED/i.test(message)) {
        try {
          capture = await getPaypalOrder(callArgs);
        } catch (readErr) {
          console.error('[PayPal] Re-read after ORDER_ALREADY_CAPTURED failed:', readErr);
          return NextResponse.json(
            { success: false, error: 'Could not confirm PayPal payment status' },
            { status: 502 }
          );
        }
      } else {
        await supabase
          .from('paypal_transactions')
          .update({
            status: 'failed',
            failure_reason: message.slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq('id', transaction.id)
          .eq('status', 'pending');

        console.error('[PayPal] Capture failed:', err);
        return NextResponse.json({ success: false, error: message }, { status: 502 });
      }
    }

    const result = await settlePaypalCapture(supabase, transaction, capture);

    if (!result.settled && !result.alreadySettled) {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to settle PayPal payment' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      already_captured: result.alreadySettled,
      transaction_id: transaction.id,
      status: 'completed',
      capture_id: capture.captureId,
      amount: capture.amount,
      currency: capture.currency,
    });
  } catch (error) {
    console.error('PayPal capture route error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
