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
  const { data } = await getSupabaseAdmin()
    .from('payments')
    .select('id, business_id, amount, currency, status, description, businesses (merchant_id)')
    .eq('id', id)
    .maybeSingle();
  if (!data || !data.business_id) return null;
  const business = data.businesses as unknown as { merchant_id: string } | null;
  if (!business?.merchant_id) return null;
  return {
    paymentId: data.id,
    businessId: data.business_id,
    merchantId: business.merchant_id,
    amount: data.amount,
    currency: data.currency || 'USD',
    payable: data.status === 'pending',
    description: data.description,
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
