import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant, requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { resolveOrgRole } from '@/lib/auth/authz';
import { isPaidTier } from '@/lib/entitlements/service';
import { buildAskContext, type AskScope } from '@/lib/ask/context';
import { answerQuestion, isAskEnabled, ModelUnavailableError } from '@/lib/ask/answer';
import { askAllowance, recordAsk } from '@/lib/ask/limits';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_QUESTION = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Ask Your Data": a question in, an answer about your own businesses and books out.
 *
 * Free for platform admins; a Professional-plan feature for everyone else. For a
 * question about an organization, either the asker's plan or the org owner's plan
 * counts, so an owner on Professional covers the accountants they invite.
 */

type Access =
  | { ok: true; isAdmin: boolean; paidBy: 'admin' | 'self' | 'org_owner' }
  | { ok: false; status: number; error: string; code: string };

async function resolveAccess(
  actorId: string,
  scope: AskScope,
): Promise<Access> {
  const supabase = getSupabaseAdmin();
  const { data: me } = await supabase.from('merchants').select('is_admin').eq('id', actorId).maybeSingle();
  const isAdmin = me?.is_admin === true;

  if (scope.kind === 'platform' && !isAdmin) {
    return { ok: false, status: 403, error: 'Platform questions are for admins', code: 'admin_only' };
  }
  if (scope.kind === 'org') {
    const role = await resolveOrgRole(supabase, actorId, scope.orgId);
    if (!role) return { ok: false, status: 404, error: 'Organization not found', code: 'not_found' };
  }
  if (isAdmin) return { ok: true, isAdmin, paidBy: 'admin' };
  if (await isPaidTier(supabase, actorId)) return { ok: true, isAdmin, paidBy: 'self' };
  if (scope.kind === 'org') {
    const { data: org } = await supabase
      .from('organizations')
      .select('owner_merchant_id')
      .eq('id', scope.orgId)
      .maybeSingle();
    if (org?.owner_merchant_id && (await isPaidTier(supabase, org.owner_merchant_id))) {
      return { ok: true, isAdmin, paidBy: 'org_owner' };
    }
  }
  return {
    ok: false,
    status: 402,
    error: 'Ask Your Data is part of the Professional plan.',
    code: 'upgrade_required',
  };
}

function parseScope(raw: { scope?: unknown; organizationId?: unknown }): AskScope | null {
  if (raw.scope === 'platform') return { kind: 'platform' };
  if (raw.scope === 'org') {
    return typeof raw.organizationId === 'string' && UUID_RE.test(raw.organizationId)
      ? { kind: 'org', orgId: raw.organizationId }
      : null;
  }
  return { kind: 'me' };
}

/** GET /api/ask?scope=me|org|platform&organizationId= — may I ask, and how many left today. */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const sp = req.nextUrl.searchParams;
  const scope = parseScope({ scope: sp.get('scope'), organizationId: sp.get('organizationId') });
  if (!scope) return NextResponse.json({ error: 'organizationId is required for scope=org' }, { status: 400 });

  if (!isAskEnabled()) {
    return NextResponse.json({ allowed: false, code: 'disabled', error: 'Ask Your Data is not configured' });
  }
  const access = await resolveAccess(guard.id, scope);
  if (!access.ok) {
    return NextResponse.json({ allowed: false, code: access.code, error: access.error, upgradeUrl: '/pricing' });
  }
  const allowance = askAllowance(guard.id, access.isAdmin);
  return NextResponse.json({ allowed: true, paidBy: access.paidBy, ...allowance });
}

/** POST /api/ask { question, scope?, organizationId? } */
export async function POST(req: NextRequest) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;

  if (!isAskEnabled()) {
    return NextResponse.json({ error: 'Ask Your Data is not configured', code: 'disabled' }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { question?: unknown; scope?: unknown; organizationId?: unknown };
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) return NextResponse.json({ error: 'Ask a question' }, { status: 400 });
  if (question.length > MAX_QUESTION) {
    return NextResponse.json({ error: `Keep questions under ${MAX_QUESTION} characters` }, { status: 400 });
  }
  const scope = parseScope(body);
  if (!scope) return NextResponse.json({ error: 'organizationId is required for scope=org' }, { status: 400 });

  const access = await resolveAccess(guard.id, scope);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, code: access.code, ...(access.code === 'upgrade_required' ? { upgradeUrl: '/pricing' } : {}) },
      { status: access.status },
    );
  }

  const allowance = askAllowance(guard.id, access.isAdmin);
  if (allowance.remaining <= 0) {
    return NextResponse.json(
      { error: `Daily limit of ${allowance.limit} questions reached. It resets at midnight UTC.`, code: 'rate_limited' },
      { status: 429 },
    );
  }

  try {
    const context = await buildAskContext(getSupabaseAdmin(), { id: guard.id, email: guard.email }, scope);
    recordAsk(guard.id);
    const result = await answerQuestion(question, context);
    return NextResponse.json({
      answer: result.answer,
      refused: result.refused,
      remaining: Math.max(0, allowance.remaining - 1),
    });
  } catch (err) {
    if (err instanceof ModelUnavailableError) {
      return NextResponse.json(
        { error: 'The assistant is unavailable right now. Try again later.', code: 'model_unavailable' },
        { status: 503 },
      );
    }
    console.error('[ask] failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not answer that right now' }, { status: 500 });
  }
}
