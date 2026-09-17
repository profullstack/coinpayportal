import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { publicTransfer } from '@/lib/banking/service';
import { bankingDeps, bankingErrorResponse, NO_STORE } from '@/lib/banking/http';

export const dynamic = 'force-dynamic';

/** GET /api/banking/transfers/:id — one transfer, scoped to the merchant. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  try {
    const row = await bankingDeps().store.getTransfer(id, guard.id);
    if (!row) return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    return NextResponse.json({ transfer: publicTransfer(row) }, NO_STORE);
  } catch (err) {
    return bankingErrorResponse(err, 'banking/transfers/get');
  }
}
