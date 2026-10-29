import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';
import { listBusinesses } from '@/lib/business/service';
import { getSpending, rowToAgent } from '@/lib/agents/store';
import { remainingAllowanceUsd } from '@/lib/agents/limits';
import { validateAgentInput } from '@/lib/agents/validate';

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function auth(request: NextRequest) {
  const supabase = db();
  const result = await authenticateRequest(supabase, request.headers.get('authorization'));
  if (!result.success || !result.context || !isMerchantAuth(result.context)) return null;
  const businesses = await listBusinesses(supabase, result.context.merchantId);
  return businesses.success ? { supabase, businesses: businesses.businesses } : null;
}

export async function GET(request: NextRequest) {
  const context = await auth(request);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const businessId = request.nextUrl.searchParams.get('business_id') || context.businesses[0]?.id;
  if (!businessId) return NextResponse.json({ businesses: [], agents: [] });
  const { data, error } = await context.supabase.from('agent_wallets').select('*').eq('business_id', businessId).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Could not read agent wallets' }, { status: 500 });
  const agents = await Promise.all((data ?? []).map(async (row) => {
    const agent = rowToAgent(row);
    const spent = await getSpending(context.supabase, agent.id);
    return { ...agent, spent, remainingUsd: remainingAllowanceUsd(agent.status, agent.limits, spent) };
  }));
  return NextResponse.json({ businesses: context.businesses.map((b) => ({ id: b.id, name: b.name })), businessId, agents });
}

export async function POST(request: NextRequest) {
  const context = await auth(request);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const businessId = typeof body?.businessId === 'string' ? body.businessId : context.businesses[0]?.id;
  if (!businessId || !context.businesses.some((b) => b.id === businessId)) return NextResponse.json({ error: 'Invalid business' }, { status: 400 });
  const input = validateAgentInput(body);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  const { data, error } = await context.supabase.from('agent_wallets').insert({ business_id: businessId, name: input.value!.name, address: input.value!.address, status: input.value!.status, per_payment_limit_usd: input.value!.perPaymentLimitUsd, hourly_limit_usd: input.value!.hourlyLimitUsd, daily_limit_usd: input.value!.dailyLimitUsd, weekly_limit_usd: input.value!.weeklyLimitUsd, monthly_limit_usd: input.value!.monthlyLimitUsd, quarterly_limit_usd: input.value!.quarterlyLimitUsd, yearly_limit_usd: input.value!.yearlyLimitUsd, total_limit_usd: input.value!.totalLimitUsd }).select('*').single();
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'That wallet is already registered.' : 'Could not create agent wallet' }, { status: error.code === '23505' ? 409 : 500 });
  return NextResponse.json({ agent: rowToAgent(data) }, { status: 201 });
}
