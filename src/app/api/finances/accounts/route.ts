import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { listAccounts } from '@/lib/finances/summary';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/accounts — every linked account with its current balance.
 *
 * `?hidden=1` includes accounts an operator has hidden from the totals.
 */
export async function GET(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.read');
  if (guard instanceof NextResponse) return guard;

  try {
    const accounts = await listAccounts(guard.id, {
      includeHidden: req.nextUrl.searchParams.get('hidden') === '1',
    });
    return NextResponse.json({ accounts }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[finances/accounts] failed', err);
    return NextResponse.json({ error: 'Failed to load accounts' }, { status: 500 });
  }
}
