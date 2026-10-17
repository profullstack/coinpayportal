import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeCatalog, serviceClient } from '@/lib/invoices/catalog';
import { newPortalToken, portalUrl } from '@/lib/invoices/portal';

type Ctx = { params: Promise<{ id: string }> };

async function authorizeClient(request: NextRequest, id: string) {
  if (!z.string().uuid().safeParse(id).success) return { ok: false as const, status: 404 };
  const { data: client } = await serviceClient().from('clients').select('id, business_id').eq('id', id).maybeSingle();
  if (!client) return { ok: false as const, status: 404 };
  const auth = await authorizeCatalog(request, client.business_id, 'customer.write');
  if (!auth.ok) return { ok: false as const, status: auth.response.status === 403 ? 403 : 404 };
  return { ok: true as const, supabase: auth.supabase };
}

/**
 * POST /api/clients/[id]/portal-link
 * Create (or replace) the client's portal link. The old link stops working.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const auth = await authorizeClient(request, id);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.status === 403 ? 'Insufficient permissions' : 'Client not found' }, { status: auth.status });
  }
  const token = newPortalToken();
  const { error } = await auth.supabase
    .from('clients')
    .update({ portal_token: token, portal_token_created_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return NextResponse.json({ success: false, error: 'Failed to create portal link' }, { status: 500 });
  return NextResponse.json({ success: true, url: portalUrl(token) }, { status: 201 });
}

/** DELETE /api/clients/[id]/portal-link: revoke the link. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const auth = await authorizeClient(request, id);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.status === 403 ? 'Insufficient permissions' : 'Client not found' }, { status: auth.status });
  }
  await auth.supabase.from('clients').update({ portal_token: null, portal_token_created_at: null }).eq('id', id);
  return NextResponse.json({ success: true });
}
