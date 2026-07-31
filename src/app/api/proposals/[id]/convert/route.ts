import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeProposal } from '@/lib/auth/proposal-access';
import { convertToInvoice } from '@/lib/proposals/service';
import { isBusinessPaidTier } from '@/lib/entitlements/service';
import { getFeePercentage } from '@/lib/payments/fees';

/**
 * POST /api/proposals/[id]/convert
 * Turn an accepted proposal into a draft invoice, carrying the agreed amount,
 * coin and payee across. The invoice is created as a draft so the business can
 * review it before sending.
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

    const isPaidTier = await isBusinessPaidTier(supabase, access.proposal.business_id);

    const result = await convertToInvoice(supabase, {
      proposal: access.proposal,
      actorMerchantId: access.merchantId,
      feeRate: getFeePercentage(isPaidTier),
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error, code: result.code },
        { status: result.status },
      );
    }

    return NextResponse.json({ success: true, invoice: result.invoice }, { status: 201 });
  } catch (error) {
    console.error('Convert proposal error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
