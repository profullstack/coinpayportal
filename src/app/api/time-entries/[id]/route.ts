import { NextRequest, NextResponse } from 'next/server';
import { authorizeCatalogRow } from '@/lib/invoices/catalog';
import { entryUpdateSchema, elapsedMinutes, ENTRY_COLUMNS } from '@/lib/projects/service';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/time-entries/[id]  { stop: true } or field edits. Billed time is locked. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const auth = await authorizeCatalogRow(request, 'time_entries', id, 'invoice.write');
  if (!auth.ok) return auth.response;
  const parsed = entryUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ success: false, error: `${issue.path.join('.') || 'body'}: ${issue.message}` }, { status: 400 });
  }
  const { data: entry } = await auth.supabase
    .from('time_entries')
    .select('id, started_at, minutes, invoice_id')
    .eq('id', id)
    .single();
  if (entry?.invoice_id) {
    return NextResponse.json({ success: false, error: 'This time is on an invoice; delete the draft invoice to edit it' }, { status: 409 });
  }
  const { stop, ...fields } = parsed.data;
  const update: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };
  if (stop) {
    if (entry?.minutes != null) {
      return NextResponse.json({ success: false, error: 'This timer is not running' }, { status: 409 });
    }
    const now = new Date();
    update.ended_at = now.toISOString();
    update.minutes = elapsedMinutes((fields.started_at as string) ?? entry!.started_at, now);
  } else if (entry?.minutes == null && fields.minutes !== undefined) {
    // Typing a duration onto a running timer finishes it.
    update.ended_at = new Date().toISOString();
  }
  const { data, error } = await auth.supabase
    .from('time_entries')
    .update(update)
    .eq('id', id)
    .is('invoice_id', null)
    .select(ENTRY_COLUMNS)
    .single();
  if (error || !data) return NextResponse.json({ success: false, error: 'Failed to update time' }, { status: 500 });
  return NextResponse.json({ success: true, time_entry: data });
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const auth = await authorizeCatalogRow(request, 'time_entries', id, 'invoice.write');
  if (!auth.ok) return auth.response;
  const { data } = await auth.supabase.from('time_entries').delete().eq('id', id).is('invoice_id', null).select('id');
  if (!data?.length) {
    return NextResponse.json({ success: false, error: 'This time is on an invoice; delete the draft invoice first' }, { status: 409 });
  }
  return NextResponse.json({ success: true });
}
