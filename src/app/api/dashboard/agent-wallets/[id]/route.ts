import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';
import { listBusinesses } from '@/lib/business/service';
import { patchToRow, validateAgentPatch } from '@/lib/agents/validate';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const auth = await authenticateRequest(supabase, request.headers.get('authorization'));
  if (!auth.success || !auth.context || !isMerchantAuth(auth.context)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const businesses = await listBusinesses(supabase, auth.context.merchantId);
  const ids = businesses.success ? (businesses.businesses ?? []).map((b) => b.id) : [];
  const patch = validateAgentPatch(await request.json().catch(() => null));
  if (!patch.ok) return NextResponse.json({ error: patch.error }, { status: 400 });
  const { id } = await context.params;
  const { data, error } = await supabase.from('agent_wallets').update(patchToRow(patch.value!)).in('business_id', ids).eq('id', id).select('*').maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not update agent wallet' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Agent wallet not found' }, { status: 404 });
  return NextResponse.json({ agent: data });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const auth = await authenticateRequest(supabase, request.headers.get('authorization'));
  if (!auth.success || !auth.context || !isMerchantAuth(auth.context)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const businesses = await listBusinesses(supabase, auth.context.merchantId);
  const ids = businesses.success ? (businesses.businesses ?? []).map((b) => b.id) : [];
  const { id } = await context.params;
  const { data, error } = await supabase.from('agent_wallets').update({ status: 'revoked', updated_at: new Date().toISOString() }).in('business_id', ids).eq('id', id).select('id,status').maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not revoke agent wallet' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Agent wallet not found' }, { status: 404 });
  return NextResponse.json({ agent: data });
}
