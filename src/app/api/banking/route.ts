import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { getActiveBankProvider } from '@/lib/banking/providers';
import { holdDays } from '@/lib/banking/service';
import { NO_STORE } from '@/lib/banking/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/banking — whether a bank rail is available, and on whose rail.
 *
 * `enabled: false` is a normal answer: no originator is configured until one
 * is onboarded, and the page uses this to say so rather than offering a form
 * that cannot work.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;

  const provider = getActiveBankProvider();
  return NextResponse.json(
    {
      enabled: provider !== null,
      provider: provider ? { id: provider.id, label: provider.label, currencies: provider.currencies } : null,
      holdDays: holdDays(),
    },
    NO_STORE,
  );
}
