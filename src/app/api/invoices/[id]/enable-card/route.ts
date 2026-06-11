import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';
import { isBusinessPaidTier } from '@/lib/entitlements/service';
import { createInvoiceStripeCheckout } from '@/lib/payments/invoice-stripe';

/**
 * POST /api/invoices/[id]/enable-card
 * Generate (or regenerate) the Stripe Connect checkout URL for an already-sent
 * invoice. Use after a merchant finishes Stripe onboarding so the card option
 * appears on the payment page without having to re-send the invoice.
 *
 * Idempotent: if a checkout URL already exists it is returned unchanged.
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
      .select(`*, businesses (id, name, merchant_id)`)
      .eq('id', id)
      .eq('user_id', merchantId)
      .single();

    if (fetchError || !invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }

    // Only meaningful once the invoice is live for payment.
    if (!['sent', 'overdue'].includes(invoice.status)) {
      return NextResponse.json(
        { success: false, error: `Cannot enable card payments for an invoice with status: ${invoice.status}` },
        { status: 400 }
      );
    }

    // Already enabled — return the existing URL (idempotent).
    if (invoice.stripe_checkout_url) {
      return NextResponse.json({ success: true, invoice, alreadyEnabled: true });
    }

    const isPaidTier = await isBusinessPaidTier(supabase, invoice.business_id);

    let checkout;
    try {
      checkout = await createInvoiceStripeCheckout(supabase, invoice, isPaidTier);
    } catch (stripeError) {
      console.error('Failed to create Stripe checkout session for invoice:', stripeError);
      return NextResponse.json(
        { success: false, error: 'Failed to create Stripe checkout session' },
        { status: 502 }
      );
    }

    if (!checkout) {
      return NextResponse.json(
        {
          success: false,
          error: 'This business has no Stripe Connect account with card charges enabled. Connect Stripe first.',
          needsStripeOnboarding: true,
        },
        { status: 409 }
      );
    }

    const { data: updatedInvoice, error: updateError } = await supabase
      .from('invoices')
      .update({
        stripe_checkout_url: checkout.stripeCheckoutUrl,
        stripe_session_id: checkout.stripeSessionId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(`*, clients (id, name, email, company_name), businesses (id, name)`)
      .single();

    if (updateError) {
      return NextResponse.json({ success: false, error: 'Failed to update invoice' }, { status: 500 });
    }

    return NextResponse.json({ success: true, invoice: updatedInvoice });
  } catch (error) {
    console.error('Enable card payments error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
