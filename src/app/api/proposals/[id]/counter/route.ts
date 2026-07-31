import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeProposal } from '@/lib/auth/proposal-access';
import { addRevision, assertCounterable } from '@/lib/proposals/service';
import { notifyCountered } from '@/lib/proposals/notify';

/**
 * POST /api/proposals/[id]/counter
 * Merchant-side counter-offer: supersedes the standing revision with new terms
 * and hands the ball back to the client.
 *
 * Like the opening offer, a counter that names a coin must name a payee —
 * resolved from the account, or supplied as `merchant_wallet_address` when
 * nothing is determinable.
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
    const { proposal } = access;

    const blocked = assertCounterable(proposal.status, 'merchant');
    if (blocked) {
      return NextResponse.json(
        { success: false, error: blocked.error, code: blocked.code },
        { status: blocked.status },
      );
    }

    const body = await request.json();
    const result = await addRevision(supabase, {
      proposal,
      party: 'merchant',
      actorMerchantId: access.merchantId,
      revision: {
        amount: Number(body.amount),
        currency: body.currency,
        crypto_currency: body.crypto_currency,
        merchant_wallet_address: body.merchant_wallet_address,
        terms: body.terms,
        message: body.message,
        due_date: body.due_date,
      },
      // A counter on a draft keeps it a draft; otherwise the negotiation is live.
      nextStatus: proposal.status === 'draft' ? undefined : 'countered',
      eventType: 'countered',
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error, code: result.code },
        { status: result.status },
      );
    }

    // Only tell the client once the proposal is actually with them; countering
    // your own unsent draft is just editing it.
    if (proposal.status !== 'draft') {
      await notifyCountered(supabase, {
        proposal: result.proposal,
        revision: result.revision,
        by: 'merchant',
      });
    }

    return NextResponse.json({
      success: true,
      proposal: result.proposal,
      revision: result.revision,
    });
  } catch (error) {
    console.error('Counter proposal error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
