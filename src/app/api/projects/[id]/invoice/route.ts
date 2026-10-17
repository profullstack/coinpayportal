import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeCatalogRow } from '@/lib/invoices/catalog';
import { billProjectTime } from '@/lib/projects/service';

/**
 * POST /api/projects/[id]/invoice  { entry_ids?: uuid[] }
 * Bill the project's unbilled billable time (all of it, or the listed
 * entries) as a draft itemised invoice to review and send.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeCatalogRow(request, 'projects', id, 'invoice.write');
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const parsed = z.object({ entry_ids: z.array(z.string().uuid()).max(100).optional() }).strict().safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'entry_ids must be a list of time entry ids' }, { status: 400 });
  }
  const result = await billProjectTime(auth.supabase, id, parsed.data.entry_ids);
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, invoice: result.invoice, entries_billed: result.entries }, { status: 201 });
}
