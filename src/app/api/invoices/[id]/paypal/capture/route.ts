import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { capturePaypalOrder } from '@/lib/paypal/client';
import { getBusinessPaypalCredentials } from '@/lib/paypal/accounts';
import { sendPaymentWebhook } from '@/lib/webhooks/service';

/**
 * POST /api/invoices/[id]/paypal/capture
 * Public endpoint (no auth) — called after the payer approves the PayPal order
 * and is redirected back to the pay page. Captures the funds on the merchant's
 * account, marks the invoice paid, records the transaction, and fires the
 * merchant's invoice.paid webhook.
 *
 * Idempotent: a second call on an already-paid invoice is a no-op success.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const orderId = body.orderId || body.token;

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('*, businesses (id, name, merchant_id)')
      .eq('id', id)
      .single();

    if (error || !invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }
    if (invoice.status === 'paid') {
      return NextResponse.json({ success: true, status: 'paid', alreadyPaid: true });
    }
    if (!orderId) {
      return NextResponse.json({ success: false, error: 'orderId is required' }, { status: 400 });
    }
    // The order id must match the one we created for this invoice — this stops
    // an arbitrary order from being captured against someone else's invoice.
    if (invoice.paypal_order_id && invoice.paypal_order_id !== orderId) {
      return NextResponse.json({ success: false, error: 'Order does not match this invoice' }, { status: 400 });
    }

    const creds = await getBusinessPaypalCredentials(supabase, invoice.business_id);
    if (!creds) {
      return NextResponse.json({ success: false, error: 'This business has no connected PayPal account.' }, { status: 409 });
    }

    let capture;
    try {
      capture = await capturePaypalOrder({ ...creds, orderId });
    } catch (err) {
      console.error('PayPal capture error:', err);
      return NextResponse.json({ success: false, error: 'Failed to capture PayPal payment' }, { status: 502 });
    }

    if (capture.status !== 'COMPLETED') {
      return NextResponse.json(
        { success: false, error: `PayPal order not completed (status: ${capture.status})`, status: capture.status },
        { status: 400 }
      );
    }

    // Mark invoice paid.
    await supabase
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        tx_hash: capture.captureId,
        metadata: {
          ...(invoice.metadata && typeof invoice.metadata === 'object' ? invoice.metadata : {}),
          payment_rail: 'paypal',
          paypal_order_id: orderId,
          paypal_capture_id: capture.captureId,
          paypal_confirmed_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    // Record the transaction for the merchant dashboard.
    try {
      await supabase.from('paypal_transactions').upsert(
        {
          merchant_id: invoice.businesses?.merchant_id ?? null,
          business_id: invoice.business_id,
          invoice_id: invoice.id,
          paypal_order_id: orderId,
          paypal_capture_id: capture.captureId,
          payer_email: capture.payerEmail,
          amount: capture.amount ? Number(capture.amount) : Number(invoice.amount),
          currency: capture.currency || invoice.currency || 'USD',
          status: 'completed',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'paypal_order_id' }
      );
    } catch (txErr) {
      console.error('PayPal transaction insert error:', txErr);
    }

    // Fire the merchant webhook (best-effort — never block the payer's response).
    if (invoice.business_id) {
      void sendPaymentWebhook(supabase, invoice.business_id, invoice.id, 'invoice.paid', {
        status: 'paid',
        amount_usd: invoice.amount,
        currency: invoice.currency || 'USD',
        invoice_number: invoice.invoice_number,
        payment_rail: 'paypal',
        paypal_order_id: orderId,
        paypal_capture_id: capture.captureId,
      }).catch((err) => console.error('[PayPal] webhook dispatch failed', err));
    }

    return NextResponse.json({ success: true, status: 'paid' });
  } catch (error) {
    console.error('PayPal capture error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
