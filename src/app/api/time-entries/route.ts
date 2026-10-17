import { NextRequest, NextResponse } from 'next/server';
import { authorizeCatalog, authorizeCatalogRow, serviceClient } from '@/lib/invoices/catalog';
import { entrySchema, ENTRY_COLUMNS } from '@/lib/projects/service';

/**
 * GET /api/time-entries?project_id=&unbilled=true   (or ?business_id=&running=true)
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const projectId = params.get('project_id');
  const auth = projectId
    ? await authorizeCatalogRow(request, 'projects', projectId, 'business.read')
    : await authorizeCatalog(request, params.get('business_id'), 'business.read');
  if (!auth.ok) return auth.response;

  let query = auth.supabase
    .from('time_entries')
    .select(ENTRY_COLUMNS)
    .eq('business_id', auth.businessId)
    .order('started_at', { ascending: false })
    .limit(500);
  if (projectId) query = query.eq('project_id', projectId);
  if (params.get('unbilled') === 'true') query = query.is('invoice_id', null).eq('billable', true);
  // The caller's own running timer.
  if (params.get('running') === 'true') query = query.is('minutes', null).eq('merchant_id', auth.merchantId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: 'Failed to load time' }, { status: 500 });
  return NextResponse.json({ success: true, time_entries: data ?? [] });
}

/**
 * POST /api/time-entries
 *   { project_id, minutes, description?, started_at?, billable?, hourly_rate? }  log finished time
 *   { project_id, start: true, description? }                                    start a timer
 */
export async function POST(request: NextRequest) {
  const parsed = entrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ success: false, error: `${issue.path.join('.') || 'body'}: ${issue.message}` }, { status: 400 });
  }
  const { project_id, start, ...fields } = parsed.data;
  const auth = await authorizeCatalogRow(request, 'projects', project_id, 'invoice.write');
  if (!auth.ok) return auth.response;

  const { data, error } = await serviceClient()
    .from('time_entries')
    .insert({
      ...fields,
      description: fields.description ?? '',
      project_id,
      business_id: auth.businessId,
      merchant_id: auth.merchantId,
      ...(start ? { started_at: new Date().toISOString(), minutes: null } : {}),
    })
    .select(ENTRY_COLUMNS)
    .single();
  if (error?.code === '23505') {
    return NextResponse.json({ success: false, error: 'You already have a timer running; stop it first' }, { status: 409 });
  }
  if (error || !data) return NextResponse.json({ success: false, error: 'Failed to save time' }, { status: 500 });
  return NextResponse.json({ success: true, time_entry: data }, { status: 201 });
}
