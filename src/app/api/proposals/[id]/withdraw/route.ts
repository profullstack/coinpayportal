import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeProposal } from '@/lib/auth/proposal-access';
import { generateAccessToken, recordEvent } from '@/lib/proposals/service';
import { isNegotiable } from '@/lib/proposals/types';

/**
 * POST /api/proposals/[id]/withdraw
 * Business pulls a live proposal off the table.
 *
 * The access token is rotated so the old client link stops working — withdrawing
 * has to actually revoke the client's ability to accept, not just change a
 * status they never see.
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

    if (!isNegotiable(proposal.status) && proposal.status !== 'draft') {
      return NextResponse.json(
        {
          success: false,
          error: `A proposal that is ${proposal.status} cannot be withdrawn`,
          code: 'NOT_WITHDRAWABLE',
        },
        { status: 409 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const now = new Date().toISOString();

    if (proposal.current_revision_id) {
      await supabase
        .from('proposal_revisions')
        .update({ status: 'superseded' })
        .eq('id', proposal.current_revision_id)
        .eq('status', 'open');
    }

    const { data: updated, error } = await supabase
      .from('proposals')
      .update({ status: 'withdrawn', access_token: generateAccessToken(), updated_at: now })
      .eq('id', id)
      .select('*')
      .single();

    if (error || !updated) {
      return NextResponse.json(
        { success: false, error: error?.message || 'Failed to withdraw proposal' },
        { status: 400 },
      );
    }

    await recordEvent(supabase, {
      proposalId: id,
      revisionId: proposal.current_revision_id,
      eventType: 'withdrawn',
      actor: 'merchant',
      actorMerchantId: access.merchantId,
      message: body.message,
    });

    return NextResponse.json({ success: true, proposal: updated });
  } catch (error) {
    console.error('Withdraw proposal error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
