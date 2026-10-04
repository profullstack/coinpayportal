/**
 * PATCH  /api/v1/agents/:id — change an agent's limits, name or status
 * DELETE /api/v1/agents/:id — revoke it
 *
 * The important operation here is the one that stops a bot: PATCH with
 * `{"status":"paused"}` takes effect on the next settle, with no deploy and no
 * key rotation. That is the kill switch, and it is why this route exists
 * separately from the collection.
 *
 * DELETE revokes rather than deleting. The spend ledger is the audit trail for
 * money that has already moved, and dropping the agent row would cascade it
 * away; an operator who wants a bot stopped wants it stopped, not erased.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveScopedKey, scopesSatisfy } from '@/lib/auth/scoped-keys';
import { getSpending, rowToAgent } from '@/lib/agents/store';
import { remainingAllowanceUsd } from '@/lib/agents/limits';
import { patchToRow, validateAgentPatch } from '@/lib/agents/validate';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

async function authenticate(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return { error: NextResponse.json({ error: 'API key required' }, { status: 401 }) };
  }
  const supabase = getSupabase();
  const resolved = await resolveScopedKey(supabase, apiKey);
  if (!resolved) {
    return { error: NextResponse.json({ error: 'Invalid or inactive API key' }, { status: 401 }) };
  }
  if (!scopesSatisfy(resolved.scopes, 'payouts:create')) {
    return {
      error: NextResponse.json(
        { error: 'This API key lacks the payouts:create scope' },
        { status: 403 }
      ),
    };
  }
  return { supabase, businessId: resolved.business.id };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticate(request);
    if (auth.error) return auth.error;
    const { supabase, businessId } = auth;
    const { id } = await context.params;

    const body = await request.json().catch(() => null);
    const patch = validateAgentPatch(body);
    if (!patch.ok) return NextResponse.json({ error: patch.error }, { status: 400 });

    // The business_id in the filter is what stops one merchant editing
    // another's agent. It is not decoration: the id alone is guessable in the
    // sense that it is handed out, and the service role bypasses RLS.
    const { data, error } = await supabase
      .from('agent_wallets')
      .update(patchToRow(patch.value!))
      .eq('id', id)
      .eq('business_id', businessId)
      .select('*')
      .maybeSingle();

    if (error) return NextResponse.json({ error: 'Could not update the agent' }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'No such agent' }, { status: 404 });

    const agent = rowToAgent(data);
    const spending = await getSpending(supabase, agent.id);
    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        address: agent.address,
        status: agent.status,
        limits: agent.limits,
        spent: { last24hUsd: spending.last24hUsd, lifetimeUsd: spending.lifetimeUsd },
        remainingUsd: remainingAllowanceUsd(agent.status, agent.limits, spending),
        updatedAt: agent.updatedAt,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Could not update the agent' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticate(request);
    if (auth.error) return auth.error;
    const { supabase, businessId } = auth;
    const { id } = await context.params;

    const { data, error } = await supabase
      .from('agent_wallets')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('business_id', businessId)
      .select('id, status')
      .maybeSingle();

    if (error) return NextResponse.json({ error: 'Could not revoke the agent' }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'No such agent' }, { status: 404 });

    return NextResponse.json({ agent: { id: data.id, status: data.status } });
  } catch {
    return NextResponse.json({ error: 'Could not revoke the agent' }, { status: 500 });
  }
}
