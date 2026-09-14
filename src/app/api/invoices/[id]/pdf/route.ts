import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { invoicePdfId, InvoicePdfError, PUBLIC_INVOICE_PDF_FIELDS, PUBLIC_INVOICE_STATUSES, renderInvoiceSnapshot } from '@/lib/invoices/pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
const notFound = () => NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404, headers });

/** Read-only public snapshot. Knowing a draft ID never grants public access. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!invoicePdfId.safeParse(id).success) return notFound();
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await supabase.from('invoices')
      .select(PUBLIC_INVOICE_PDF_FIELDS).eq('id', id).single();
    if (error?.code === 'PGRST116' || (!error && !data)) return notFound();
    if (error) throw new InvoicePdfError('lookup_failed');
    if (!PUBLIC_INVOICE_STATUSES.includes(data.status)) return notFound();
    const pdf = await renderInvoiceSnapshot(data, id);
    return new NextResponse(pdf, { headers: {
      ...headers,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${id}.pdf"`,
    } });
  } catch (error) {
    console.warn('invoice_pdf_unavailable', { reason: error instanceof InvoicePdfError ? error.reason : 'unexpected' });
    // No raw database values or renderer errors in a public response.
    return NextResponse.json({ success: false, error: 'Invoice PDF is unavailable. Please use the live invoice.' }, { status: 503, headers });
  }
}
