import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { listFinanceOwners } from '@/lib/finances/access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/owners — whose books the caller can open: their own, plus
 * every org owner who granted them finance access. Drives the Finances switcher.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const owners = await listFinanceOwners(getSupabaseAdmin(), guard.id, guard.email);
  return NextResponse.json({ owners });
}
