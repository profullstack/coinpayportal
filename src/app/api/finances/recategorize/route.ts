import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { recategorizeStored } from '@/lib/finances/sync';

export const dynamic = 'force-dynamic';

export const maxDuration = 300;

/**
 * POST /api/finances/recategorize — re-derive categories on stored rows.
 *
 * Separate from sync on purpose. Categorisation is a pure function of fields
 * already in the database, so improving the rules should not spend any of the
 * ~24 requests/day SimpleFIN allows. Scoped to the caller's own transactions.
 */
export async function POST(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.write', { write: true });
  if (guard instanceof NextResponse) return guard;

  try {
    const result = await recategorizeStored(guard.id);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[finances/recategorize] failed', err);
    return NextResponse.json({ error: 'Failed to recategorize' }, { status: 500 });
  }
}
