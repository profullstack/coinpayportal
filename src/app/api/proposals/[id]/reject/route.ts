import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeProposal } from '@/lib/auth/proposal-access';
import { rejectProposal } from '@/lib/proposals/service';

/**
 * POST /api/proposals/[id]/reject
 * Merchant declines the client's standing counter-offer, ending the negotiation.
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

    const result = await rejectProposal(supabase, {
      proposal: access.proposal,
      party: 'merchant',
      actorMerchantId: access.merchantId,
      message: body.message,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error, code: result.code },
        { status: result.status },
      );
    }

    return NextResponse.json({ success: true, proposal: result.proposal });
  } catch (error) {
    console.error('Reject proposal error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
