import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { bankingDeps, bankingErrorResponse, NO_STORE } from '@/lib/banking/http';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/banking/accounts/:id — stop using a linked bank account.
 *
 * The row is marked removed rather than deleted: transfers that went out to
 * it still have to name where the money went.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  try {
    const removed = await bankingDeps().store.removeCounterparty(id, guard.id);
    if (!removed) return NextResponse.json({ error: 'Bank account not found' }, { status: 404 });
    return NextResponse.json({ removed: true }, NO_STORE);
  } catch (err) {
    return bankingErrorResponse(err, 'banking/accounts/remove');
  }
}
