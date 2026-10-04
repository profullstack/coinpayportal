import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';
import { verifyBusinessAccess } from '@/lib/wallets/supported-coins';
import { importManualDefaultsToBusiness } from '@/lib/payment-methods/account-defaults';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * POST /api/businesses/[id]/payment-methods/manual/import
 * Import the merchant's account-level manual-method defaults into this business
 * (unlock + enable each with the saved handle).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = getSupabase();
  try {
    const { id } = await params;
    const authResult = await resolveMerchant(supabase, request);
    if ('error' in authResult) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }
    // Same field, same invariant as the sibling route: this copies payout
    // handles into the business, and a payout handle is where customer money is
    // sent. Raised from `settings.manage` to the owner-only `funds.move` so the
    // two paths that write this value agree.
    const access = await verifyBusinessAccess(supabase, id, authResult.merchantId, 'funds.move');
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status ?? 404 });
    }

    const result = await importManualDefaultsToBusiness(supabase, authResult.merchantId, id);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status ?? 400 });
    }
    return NextResponse.json({ success: true, imported: result.imported });
  } catch (error) {
    console.error('Manual defaults import error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
