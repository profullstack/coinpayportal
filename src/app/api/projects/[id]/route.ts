import { NextRequest, NextResponse } from 'next/server';
import { authorizeCatalogRow } from '@/lib/invoices/catalog';
import { projectSchema, projectStats, PROJECT_COLUMNS } from '@/lib/projects/service';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/projects/[id]: the project plus hours, unbilled, billed and paid. */
export async function GET(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const auth = await authorizeCatalogRow(request, 'projects', id, 'business.read');
  if (!auth.ok) return auth.response;
  const { data: project } = await auth.supabase.from('projects').select(PROJECT_COLUMNS).eq('id', id).single();
  const stats = await projectStats(auth.supabase, id, project?.hourly_rate == null ? null : Number(project.hourly_rate));
  return NextResponse.json({ success: true, project, stats });
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const auth = await authorizeCatalogRow(request, 'projects', id, 'invoice.write');
  if (!auth.ok) return auth.response;
  const parsed = projectSchema.partial().safeParse(await request.json().catch(() => null));
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
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(PROJECT_COLUMNS)
    .single();
  if (error || !data) return NextResponse.json({ success: false, error: 'Failed to update project' }, { status: 500 });
  return NextResponse.json({ success: true, project: data });
}

/** DELETE /api/projects/[id]: refused once any of its time is on an invoice; archive it instead. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const auth = await authorizeCatalogRow(request, 'projects', id, 'invoice.write');
  if (!auth.ok) return auth.response;
  const { count } = await auth.supabase
    .from('time_entries')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', id)
    .not('invoice_id', 'is', null);
  if (count) {
    return NextResponse.json(
      { success: false, error: 'This project has invoiced time; archive it instead' },
      { status: 409 }
    );
  }
  await auth.supabase.from('projects').delete().eq('id', id);
  return NextResponse.json({ success: true });
}
