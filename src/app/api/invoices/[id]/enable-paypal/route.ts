import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';
import { businessHasPaypal } from '@/lib/paypal/accounts';

/**
 * POST /api/invoices/[id]/enable-paypal
 * Turn on the PayPal option for an already-sent invoice. Use after a merchant
 * connects PayPal so the option appears on the payment page without re-sending
 * the invoice. Mirrors the Stripe enable-card flow. Idempotent.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const authResult = await resolveMerchant(supabase, request);
    if ('error' in authResult) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }
    const { merchantId } = authResult;

    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select('*, businesses (id, name, merchant_id)')
      .eq('id', id)
      .eq('user_id', merchantId)
      .single();

    if (fetchError || !invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }

    if (!['sent', 'overdue'].includes(invoice.status)) {
      return NextResponse.json(
        { success: false, error: `Cannot enable PayPal for an invoice with status: ${invoice.status}` },
        { status: 400 }
      );
    }

    if (invoice.paypal_enabled) {
      return NextResponse.json({ success: true, invoice, alreadyEnabled: true });
    }

    if (!(await businessHasPaypal(supabase, invoice.business_id))) {
      return NextResponse.json(
        { success: false, error: 'This business has no connected PayPal account. Connect PayPal first.', needsPaypalConnect: true },
        { status: 409 }
      );
    }

    const { data: updatedInvoice, error: updateError } = await supabase
      .from('invoices')
      .update({ paypal_enabled: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, clients (id, name, email, company_name), businesses (id, name)')
      .single();

    if (updateError) {
      return NextResponse.json({ success: false, error: 'Failed to update invoice' }, { status: 500 });
    }

    return NextResponse.json({ success: true, invoice: updatedInvoice });
  } catch (error) {
    console.error('Enable PayPal error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
