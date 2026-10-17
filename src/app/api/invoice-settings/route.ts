import { NextRequest, NextResponse } from 'next/server';
import { authorizeCatalog } from '@/lib/invoices/catalog';
import { loadInvoiceSettings, settingsUpdateSchema, SETTINGS_COLUMNS } from '@/lib/invoices/settings';

/**
 * GET /api/invoice-settings?business_id=
 * PUT /api/invoice-settings  { business_id, ...fields }
 * Reminder schedule, late fee and branding for one business.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeCatalog(request, new URL(request.url).searchParams.get('business_id'), 'business.read');
  if (!auth.ok) return auth.response;
  const settings = await loadInvoiceSettings(auth.supabase, auth.businessId);
  return NextResponse.json({ success: true, settings: { business_id: auth.businessId, ...settings } });
}

export async function PUT(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ success: false, error: 'Expected a JSON object' }, { status: 400 });
  }
  const { business_id, ...fields } = body;
  const auth = await authorizeCatalog(request, business_id as string | undefined, 'invoice.write');
  if (!auth.ok) return auth.response;

  // Validate the merged result, so a partial update cannot leave a fee type
  // without a value.
  const current = await loadInvoiceSettings(auth.supabase, auth.businessId);
  const parsed = settingsUpdateSchema.safeParse({ ...current, ...fields });
  const extra = settingsUpdateSchema.safeParse(fields);
  if (!parsed.success || !extra.success) {
    const issue = (parsed.success ? extra : parsed).error!.issues[0];
    return NextResponse.json(
      { success: false, error: `${issue.path.join('.') || 'body'}: ${issue.message}` },
      { status: 400 }
    );
  }

  const next = { ...parsed.data };
  if (next.late_fee_type === 'none') next.late_fee_value = null;
  const { data, error } = await auth.supabase
    .from('invoice_settings')
    .upsert({ business_id: auth.businessId, ...next, updated_at: new Date().toISOString() })
    .select(SETTINGS_COLUMNS)
    .single();
  if (error || !data) {
    return NextResponse.json({ success: false, error: 'Failed to save settings' }, { status: 500 });
  }
  return NextResponse.json({ success: true, settings: data });
}
