import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { handlePayinCreate, handlePayinStatus, type PayinTarget } from '@/lib/banking/payin-route';

export const dynamic = 'force-dynamic';

/**
 * /api/invoices/[id]/ach — pay an invoice from a US bank account.
 *
 * Public, like /api/invoices/[id]/pay: an invoice link is the credential.
 * Payable while the invoice is sent or overdue, the same set the pay page
 * accepts, and never once it is paid.
 */
async function loadInvoice(id: string): Promise<PayinTarget | null> {
  const { data } = await getSupabaseAdmin()
    .from('invoices')
    .select('id, business_id, amount, currency, status, invoice_number, businesses (merchant_id)')
    .eq('id', id)
    .maybeSingle();
  if (!data || !data.business_id) return null;
  const business = data.businesses as unknown as { merchant_id: string } | null;
  if (!business?.merchant_id) return null;
  return {
    invoiceId: data.id,
    businessId: data.business_id,
    merchantId: business.merchant_id,
    amount: data.amount,
    currency: data.currency || 'USD',
    payable: data.status === 'sent' || data.status === 'overdue',
    description: data.invoice_number ? `Invoice ${data.invoice_number}` : null,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handlePayinStatus(id, loadInvoice);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handlePayinCreate(req, id, loadInvoice, 'invoices/ach');
}
