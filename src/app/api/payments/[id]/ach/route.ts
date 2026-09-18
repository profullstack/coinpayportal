import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { handlePayinCreate, handlePayinStatus, type PayinTarget } from '@/lib/banking/payin-route';

export const dynamic = 'force-dynamic';

/**
 * /api/payments/[id]/ach — pay a payment from a US bank account.
 *
 * Public, like the payment page itself: the id is the credential, exactly as
 * it is for the crypto address and the Stripe checkout link on the same page.
 */
async function loadPayment(id: string): Promise<PayinTarget | null> {
  // Two plain reads rather than an embedded join: the payment's business is
  // resolved by id, so this does not depend on PostgREST finding a
  // relationship between the tables.
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('payments')
    // payments has no description column; it lives in metadata.
    .select('id, business_id, amount, currency, status, metadata')
    .eq('id', id)
    .maybeSingle();
  if (!data || !data.business_id) return null;
  const { data: business } = await supabase
    .from('businesses')
    .select('merchant_id')
    .eq('id', data.business_id)
    .maybeSingle();
  if (!business?.merchant_id) return null;
  return {
    paymentId: data.id,
    businessId: data.business_id,
    merchantId: business.merchant_id,
    amount: data.amount,
    currency: data.currency || 'USD',
    payable: data.status === 'pending',
    description:
      typeof (data.metadata as Record<string, unknown> | null)?.description === 'string'
        ? ((data.metadata as Record<string, unknown>).description as string)
        : null,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handlePayinStatus(id, loadPayment);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handlePayinCreate(req, id, loadPayment, 'payments/ach');
}
