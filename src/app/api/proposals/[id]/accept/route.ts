import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeProposal } from '@/lib/auth/proposal-access';
import { acceptProposal } from '@/lib/proposals/service';

/**
 * POST /api/proposals/[id]/accept
 * The merchant accepting a client counter-offer.
 *
 * If the client's counter switched coins it will have no payee, because the
 * client cannot see the merchant's wallets. The merchant closes that gap here by
 * passing `merchant_wallet_address` — the manual-entry path — and the accept is
 * refused outright if no valid payee can be established.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const access = await authorizeProposal(supabase, request, id, 'invoice.write');
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    const body = await request.json().catch(() => ({}));

    const result = await acceptProposal(supabase, {
      proposal: access.proposal,
      party: 'merchant',
      actorMerchantId: access.merchantId,
      payeeAddress: body.merchant_wallet_address,
      message: body.message,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error, code: result.code },
        { status: result.status },
      );
    }

    return NextResponse.json({
      success: true,
      proposal: result.proposal,
      revision: result.revision,
    });
  } catch (error) {
    console.error('Accept proposal error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
