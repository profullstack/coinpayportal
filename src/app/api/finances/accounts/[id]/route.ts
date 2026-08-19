import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isAccountKind } from '@/lib/finances/classify';
import { toAccountView, type FinanceAccount } from '@/lib/finances/summary';

export const dynamic = 'force-dynamic';

const ACCOUNT_COLUMNS =
  'id, connection_id, external_id, org_name, org_domain, name, currency, balance, available_balance, balance_date, kind, kind_override, is_hidden, last_seen_at';

/**
 * PATCH /api/finances/accounts/[id] — operator corrections.
 *
 * Only two fields are writable, and neither is imported data. `kind_override`
 * corrects a misclassified account (SimpleFIN has no account-type field, so the
 * kind is a guess from the name) and is stored separately from the derived
 * `kind` so the next sync re-deriving that guess cannot clobber the correction.
 * `is_hidden` drops a closed or duplicate account out of the totals while
 * leaving its history intact.
 *
 * Balances and transactions are deliberately not writable: they are a record of
 * what an institution said, and an editable ledger is not a ledger.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;

  let body: { kind_override?: unknown; is_hidden?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if ('kind_override' in body) {
    // null clears the override and hands the account back to the heuristic.
    if (body.kind_override === null || body.kind_override === '') {
      update.kind_override = null;
    } else if (isAccountKind(body.kind_override)) {
      update.kind_override = body.kind_override;
    } else {
      return NextResponse.json({ error: 'Unknown account kind' }, { status: 400 });
    }
  }

  if ('is_hidden' in body) {
    if (typeof body.is_hidden !== 'boolean') {
      return NextResponse.json({ error: 'is_hidden must be a boolean' }, { status: 400 });
    }
    update.is_hidden = body.is_hidden;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_accounts')
    .update(update)
    .eq('id', id)
    .select(ACCOUNT_COLUMNS)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  return NextResponse.json({ account: toAccountView(data as unknown as FinanceAccount) });
}
