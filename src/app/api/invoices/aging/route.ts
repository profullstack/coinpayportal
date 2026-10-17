import { NextRequest, NextResponse } from 'next/server';
import { authorizeCatalog } from '@/lib/invoices/catalog';
import { arAging } from '@/lib/invoices/aging';

/** GET /api/invoices/aging?business_id=  Open (sent + overdue) invoices by days past due. */
export async function GET(request: NextRequest) {
  const auth = await authorizeCatalog(request, new URL(request.url).searchParams.get('business_id'), 'business.read');
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.supabase
    .from('invoices')
    .select('id, currency, amount, due_date, client_id, clients (name, company_name, email)')
    .eq('business_id', auth.businessId)
    .in('status', ['sent', 'overdue'])
    .limit(5000);
  if (error) return NextResponse.json({ success: false, error: 'Failed to load invoices' }, { status: 500 });
  return NextResponse.json({ success: true, ...arAging((data ?? []) as never, new Date()) });
}
