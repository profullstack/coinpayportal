import { NextRequest, NextResponse } from 'next/server';
import { authorizeCatalog } from '@/lib/invoices/catalog';
import { projectSchema, PROJECT_COLUMNS } from '@/lib/projects/service';

/** GET /api/projects?business_id=&include_archived=true */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const auth = await authorizeCatalog(request, params.get('business_id'), 'business.read');
  if (!auth.ok) return auth.response;
  let query = auth.supabase
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('business_id', auth.businessId)
    .order('created_at', { ascending: false });
  if (params.get('include_archived') !== 'true') query = query.eq('status', 'active');
  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: 'Failed to load projects' }, { status: 500 });
  return NextResponse.json({ success: true, projects: data ?? [] });
}

/** POST /api/projects { business_id, name, client_id?, hourly_rate?, ... } */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ success: false, error: 'Expected a JSON object' }, { status: 400 });
  }
  const { business_id, ...fields } = body as Record<string, unknown>;
  const auth = await authorizeCatalog(request, business_id as string | undefined, 'invoice.write');
  if (!auth.ok) return auth.response;
  const parsed = projectSchema.safeParse(fields);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ success: false, error: `${issue.path.join('.') || 'body'}: ${issue.message}` }, { status: 400 });
  }
  if (parsed.data.client_id) {
    const { data: client } = await auth.supabase.from('clients').select('business_id').eq('id', parsed.data.client_id).maybeSingle();
    if (client?.business_id !== auth.businessId) {
      return NextResponse.json({ success: false, error: 'client_id does not belong to this business' }, { status: 400 });
    }
  }
  const { data, error } = await auth.supabase
    .from('projects')
    .insert({ ...parsed.data, business_id: auth.businessId })
    .select(PROJECT_COLUMNS)
    .single();
  if (error || !data) return NextResponse.json({ success: false, error: 'Failed to create project' }, { status: 500 });
  return NextResponse.json({ success: true, project: data }, { status: 201 });
}
