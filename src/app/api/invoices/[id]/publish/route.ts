import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeInvoice } from '@/lib/auth/invoice-access';
import { getInvoicePaymentLink } from '@/lib/email/invoice-delivery';
import { activateInvoicePayment } from '@/lib/invoices/activation';

/**
 * POST /api/invoices/[id]/publish
 * Create live payment details without emailing the client.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const access = await authorizeInvoice(
      supabase,
      request,
      id,
      'invoice.write',
      `
        *,
        clients (id, name, email, company_name),
        businesses (id, name, merchant_id)
      `
    );

    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    const { invoice } = access;
    if (invoice.status === 'sent') {
      if (!invoice.payment_address) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invoice is sent but has no active payment details',
            code: 'PAYMENT_ADDRESS_MISSING',
          },
          { status: 409 }
        );
      }

      return NextResponse.json({
        success: true,
        invoice,
        paymentLink: getInvoicePaymentLink(id),
        emailAttempted: false,
        idempotentReplay: true,
      });
    }

    if (invoice.status !== 'draft') {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot publish invoice with status: ${invoice.status}`,
          code: 'INVOICE_NOT_PUBLISHABLE',
        },
        { status: 400 }
      );
    }

    const activation = await activateInvoicePayment(supabase, invoice);
    if (!activation.ok) {
      return NextResponse.json(
        { success: false, error: activation.error, code: activation.code },
        { status: activation.status }
      );
    }

    return NextResponse.json({
      success: true,
      invoice: activation.invoice,
      paymentLink: activation.paymentLink,
      emailAttempted: false,
      idempotentReplay: activation.idempotentReplay,
    });
  } catch (error) {
    console.error('Publish invoice error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
