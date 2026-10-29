import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { answerQuestion, isAskEnabled, ModelUnavailableError } from '@/lib/ask/answer';
import { checkBalance, deductCredits } from '@/lib/usage/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ACTION = 'finance_goal_strategy';
const DEFAULT_COST = 0.1;
const MAX_DESCRIPTION = 4000;

type StrategyBody = {
  description?: unknown;
  targetAmount?: unknown;
  downPayment?: unknown;
  currentAmount?: unknown;
  monthlyBudget?: unknown;
  deadline?: unknown;
  constraints?: unknown;
};

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optionalNumber(value: unknown): string | null {
  const raw = text(value, 80);
  if (!raw) return null;
  const n = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? raw : null;
}

/** POST /api/finances/goals/strategy — generate one metered, agent-ready plan. */
export async function POST(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.read');
  if (guard instanceof NextResponse) return guard;
  if (!isAskEnabled()) return NextResponse.json({ error: 'AI strategy planning is not configured', code: 'disabled' }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as StrategyBody;
  const description = text(body.description, MAX_DESCRIPTION);
  if (!description) return NextResponse.json({ error: 'Describe the goal first' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('merchant_id', guard.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!business?.id) {
    return NextResponse.json({ error: 'Create a CoinPay business before using pay-as-you-go AI.', code: 'business_required' }, { status: 402 });
  }

  // The rate is created lazily so this feature works for existing businesses while
  // still using the existing atomic usage-credit ledger and top-up flow.
  await supabase.from('usage_rates').upsert({
    business_id: business.id,
    action_type: ACTION,
    description: 'AI finance goal strategy',
    cost_usd: DEFAULT_COST,
    unit: 'strategy',
  }, { onConflict: 'business_id,action_type', ignoreDuplicates: true });

  const balance = await checkBalance(supabase, business.id, guard.email, ACTION);
  if (!balance.sufficient) {
    return NextResponse.json({ error: 'Add AI credits to generate a strategy.', code: 'credits_required', cost: balance.cost || DEFAULT_COST, businessId: business.id, balance: balance.balance }, { status: 402 });
  }

  const goal = {
    description,
    targetAmount: optionalNumber(body.targetAmount),
    downPayment: optionalNumber(body.downPayment),
    currentAmount: optionalNumber(body.currentAmount),
    monthlyBudget: optionalNumber(body.monthlyBudget),
    deadline: text(body.deadline, 40) || null,
    constraints: text(body.constraints, 2000) || null,
  };
  const question = `Create a practical strategy for this financial goal. Return ONLY Markdown that a user can paste into an AI agent as an execution brief. Include: objective, known inputs, assumptions and missing inputs, a phased plan with concrete agent tasks, numbers/timeline where supported, checkpoints and success criteria, risks/guardrails, and the first 3 actions. Do not claim to move money, access accounts, or provide regulated financial advice. Clearly label estimates and tell the agent to ask for confirmation before any purchase, transfer, loan, or other irreversible action.\n\nGoal input:\n${JSON.stringify(goal)}`;

  try {
    const result = await answerQuestion(question, { goal, product: 'CoinPay Finance Goal Strategy' });
    const charge = await deductCredits(supabase, business.id, guard.email, ACTION, 1, { descriptionLength: description.length });
    if (!charge.success) {
      return NextResponse.json({ error: 'Your AI credits changed while generating. Try again.', code: 'credits_required', cost: balance.cost || DEFAULT_COST, balance: charge.remaining_balance }, { status: 402 });
    }
    return NextResponse.json({ strategy: result.answer, model: result.model, cost: charge.cost, remaining: charge.remaining_balance });
  } catch (err) {
    if (err instanceof ModelUnavailableError) return NextResponse.json({ error: 'The AI assistant is unavailable right now. Your credits were not charged.', code: 'model_unavailable' }, { status: 503 });
    console.error('[finance-goal-strategy] failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not generate a strategy. Your credits were not charged.' }, { status: 500 });
  }
}
