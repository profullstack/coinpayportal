import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createInvoicePaypalOrder } from '@/lib/paypal/invoice-paypal';

/**
 * POST /api/invoices/[id]/paypal/create-order
 * Public endpoint (no auth) — the invoice recipient calls this when they click
 * "Pay with PayPal". Creates a PayPal order on the merchant's connected account
 * and returns the approval URL to redirect the payer to.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('id, invoice_number, amount, currency, status, business_id, paypal_enabled, businesses (name)')
      .eq('id', id)
      .single();

    if (error || !invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }
    if (!['sent', 'overdue'].includes(invoice.status)) {
      return NextResponse.json({ success: false, error: 'Invoice is not open for payment' }, { status: 400 });
    }
    if (!invoice.paypal_enabled) {
      return NextResponse.json({ success: false, error: 'PayPal is not enabled for this invoice' }, { status: 400 });
    }

    let order;
    try {
      order = await createInvoicePaypalOrder(supabase, invoice as any);
    } catch (err) {
      console.error('PayPal create-order error:', err);
      return NextResponse.json({ success: false, error: 'Failed to create PayPal order' }, { status: 502 });
    }

    if (!order) {
      return NextResponse.json(
        { success: false, error: 'This business has no connected PayPal account.' },
        { status: 409 }
      );
    }

    // Record the order so the capture callback can be validated against it.
    //
    // F-1.1-16: this used to write `invoices.paypal_order_id` unconditionally,
    // and the route is public. That single column is the only thing capture
    // checked, so anyone who knew an invoice id could call this endpoint and
    // overwrite it — including after the real payer had already been handed
    // their order. The payer then approves order A, capture sees B, rejects it
    // as "Order does not match this invoice", and the invoice can never be
    // paid for as long as the attacker keeps posting. Repeating it across open
    // invoices is a denial of payment for the whole platform.
    //
    // An invoice legitimately has more than one order over its life — a payer
    // abandons the PayPal flow and starts again, or two people open the same
    // pay link — so the fix is not "first write wins", which would let an
    // attacker lock the slot even earlier. Each order we issue is recorded as
    // its own row, bound to this invoice, and capture accepts any order bound
    // to the invoice it is settling. `paypal_order_id` is unique on that
    // table, so rows cannot collide or be rewritten to point elsewhere.
    const { error: bindError } = await supabase.from('paypal_transactions').insert({
      business_id: invoice.business_id,
      invoice_id: invoice.id,
      paypal_order_id: order.orderId,
      amount: Number(invoice.amount),
      currency: invoice.currency || 'USD',
      status: 'created',
    });

    if (bindError) {
      // Without the binding row, capture cannot confirm this order belongs to
      // this invoice. Handing the payer an approval URL we will later refuse to
      // capture is worse than failing here.
      console.error('PayPal order binding insert failed:', bindError);
      return NextResponse.json(
        { success: false, error: 'Failed to create PayPal order' },
        { status: 500 }
      );
    }

    // Kept in step for the dashboard and for older rows, but it is no longer
    // what authorises a capture.
    await supabase
      .from('invoices')
      .update({ paypal_order_id: order.orderId, updated_at: new Date().toISOString() })
      .eq('id', id);

    return NextResponse.json({ success: true, orderId: order.orderId, approveUrl: order.approveUrl });
  } catch (error) {
    console.error('PayPal create-order error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
