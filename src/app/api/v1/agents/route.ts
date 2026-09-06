/**
 * GET  /api/v1/agents — the agents this business has registered
 * POST /api/v1/agents — register one
 *
 * An agent is a bot's wallet plus the limits it may spend within. The limits
 * are enforced at x402 v2 settle, which is the last moment before our relayer
 * broadcasts the transfer and therefore the only moment a spend can still be
 * refused. See supabase/migrations/20260906060000_agent_wallets.sql for what
 * that does and does not cover.
 *
 * Authenticated with a scoped API key, same as the x402 routes. `payouts:create`
 * is the scope, because registering an agent is granting something the ability
 * to move money out — the same class of authority as creating a payout, and a
 * strictly larger one than `payments:create`, which only takes money in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveScopedKey, scopesSatisfy } from '@/lib/auth/scoped-keys';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getSpending, rowToAgent } from '@/lib/agents/store';
import { remainingAllowanceUsd } from '@/lib/agents/limits';
import { validateAgentInput } from '@/lib/agents/validate';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/** Authenticate, and return the business id or the response to send instead. */
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

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if (auth.error) return auth.error;
    const { supabase, businessId } = auth;

    const { data, error } = await supabase
      .from('agent_wallets')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: 'Could not read agents' }, { status: 500 });
    }

    // Each agent is reported with what it could still spend right now, because
    // that is the number an operator actually wants and it cannot be worked out
    // from the limits alone.
    const agents = await Promise.all(
      (data ?? []).map(async (row) => {
        const agent = rowToAgent(row);
        const spending = await getSpending(supabase, agent.id);
        return {
          id: agent.id,
          name: agent.name,
          address: agent.address,
          status: agent.status,
          limits: {
            perPaymentUsd: agent.limits.perPaymentUsd,
            dailyUsd: agent.limits.dailyUsd,
            totalUsd: agent.limits.totalUsd,
          },
          spent: { last24hUsd: spending.last24hUsd, lifetimeUsd: spending.lifetimeUsd },
          remainingUsd: remainingAllowanceUsd(agent.status, agent.limits, spending),
          createdAt: agent.createdAt,
          updatedAt: agent.updatedAt,
        };
      })
    );

    return NextResponse.json({ agents });
  } catch {
    return NextResponse.json({ error: 'Could not read agents' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if (auth.error) return auth.error;
    const { supabase, businessId } = auth;

    const rate = await checkRateLimitAsync(businessId, 'x402_verify');
    if (!rate.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const body = await request.json().catch(() => null);
    const input = validateAgentInput(body);
    if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

    const { data, error } = await supabase
      .from('agent_wallets')
      .insert({
        business_id: businessId,
        name: input.value!.name,
        address: input.value!.address,
        status: input.value!.status,
        per_payment_limit_usd: input.value!.perPaymentLimitUsd,
        daily_limit_usd: input.value!.dailyLimitUsd,
        total_limit_usd: input.value!.totalLimitUsd,
      })
      .select('*')
      .single();

    if (error) {
      // One address belongs to one agent globally, because settle looks an
      // agent up by address alone. Say so rather than returning a bare 500:
      // the caller can act on it, and it is the only conflict this insert has.
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'That address is already registered as an agent wallet.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: 'Could not create the agent' }, { status: 500 });
    }

    const agent = rowToAgent(data);
    return NextResponse.json(
      {
        agent: {
          id: agent.id,
          name: agent.name,
          address: agent.address,
          status: agent.status,
          limits: agent.limits,
          createdAt: agent.createdAt,
        },
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: 'Could not create the agent' }, { status: 500 });
  }
}
