import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';
import { sendPaymentWebhook } from '@/lib/webhooks/service';

/**
 * POST /api/invoices/[id]/mark-paid
 * Merchant-only. Manually mark an invoice paid — used for the manual P2P rails
 * (Venmo / Cash App / Zelle) where the customer pays the merchant directly and
 * CoinPay never sees the funds, so there's no automated confirmation. Records
 * who/when/which method, and fires the invoice.paid webhook like the automated
 * rails. Idempotent on an already-paid invoice.
 *
 * Body: { method?: string }  // e.g. 'zelle' | 'venmo' | 'cashapp' | 'other'
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

    const body = await request.json().catch(() => ({}));
    const method = typeof body.method === 'string' ? body.method : 'manual';

    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select('*, businesses (id, name, merchant_id)')
      .eq('id', id)
      .eq('user_id', merchantId)
      .single();

    if (fetchError || !invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }
    if (invoice.status === 'paid') {
      return NextResponse.json({ success: true, alreadyPaid: true, invoice });
    }
    if (!['sent', 'overdue', 'draft'].includes(invoice.status)) {
      return NextResponse.json(
        { success: false, error: `Cannot mark an invoice with status '${invoice.status}' as paid` },
        { status: 400 }
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        metadata: {
          ...(invoice.metadata && typeof invoice.metadata === 'object' ? invoice.metadata : {}),
          payment_rail: 'manual',
          manual_method: method,
          marked_paid_by: merchantId,
          marked_paid_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*, clients (id, name, email, company_name), businesses (id, name)')
      .single();

    if (updateError) {
      return NextResponse.json({ success: false, error: 'Failed to mark invoice as paid' }, { status: 500 });
    }

    if (invoice.business_id) {
      void sendPaymentWebhook(supabase, invoice.business_id, invoice.id, 'invoice.paid', {
        status: 'paid',
        amount_usd: invoice.amount,
        currency: invoice.currency || 'USD',
        invoice_number: invoice.invoice_number,
        payment_rail: 'manual',
        manual_method: method,
      }).catch((err) => console.error('[mark-paid] webhook dispatch failed', err));
    }

    return NextResponse.json({ success: true, invoice: updated });
  } catch (error) {
    console.error('Mark invoice paid error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
