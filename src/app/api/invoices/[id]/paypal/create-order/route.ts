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

    // Record the order id so the capture callback can be validated against it.
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
