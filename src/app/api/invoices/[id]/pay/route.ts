import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/invoices/[id]/pay
 * Public endpoint - returns invoice payment data (no auth required)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        status,
        currency,
        amount,
        line_items,
        subtotal,
        discount_total,
        tax_total,
        crypto_currency,
        crypto_amount,
        payment_address,
        stripe_checkout_url,
        paypal_enabled,
        manual_methods,
        due_date,
        notes,
        created_at,
        businesses (id, name)
      `)
      .eq('id', id)
      .single();

    if (error || !invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }

    // Only show sent/overdue invoices publicly
    if (!['sent', 'overdue', 'paid'].includes(invoice.status)) {
      return NextResponse.json({ success: false, error: 'Invoice not available for payment' }, { status: 404 });
    }

    // Catalog ids are the merchant's bookkeeping, not the payer's business.
    const lineItems = Array.isArray(invoice.line_items)
      ? invoice.line_items.map(({ item_id: _itemId, ...line }: Record<string, unknown>) => line)
      : null;

    return NextResponse.json({ success: true, invoice: { ...invoice, line_items: lineItems } });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
