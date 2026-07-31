import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeProposal } from '@/lib/auth/proposal-access';

function client() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * GET /api/proposals/[id]
 * The proposal plus its full negotiation history — every revision and event, so
 * the merchant view can render the back-and-forth as a thread.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = client();

    const access = await authorizeProposal(
      supabase,
      request,
      id,
      'business.read',
      `*, clients (id, name, email, company_name), businesses (id, name)`,
    );
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    const [{ data: revisions }, { data: events }] = await Promise.all([
      supabase
        .from('proposal_revisions')
        .select('*')
        .eq('proposal_id', id)
        .order('revision_number', { ascending: true }),
      supabase
        .from('proposal_events')
        .select('*')
        .eq('proposal_id', id)
        .order('created_at', { ascending: true }),
    ]);

    return NextResponse.json({
      success: true,
      proposal: access.proposal,
      revisions: revisions || [],
      events: events || [],
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/proposals/[id]
 * Only drafts can be deleted; anything the client has seen is withdrawn instead,
 * so the other party's record of the negotiation is never silently erased.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = client();

    const access = await authorizeProposal(supabase, request, id, 'invoice.write', 'id, status');
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    if (access.proposal.status !== 'draft') {
      return NextResponse.json(
        {
          success: false,
          error: 'Only draft proposals can be deleted. Withdraw this one instead.',
          code: 'NOT_DELETABLE',
        },
        { status: 409 },
      );
    }

    const { error } = await supabase.from('proposals').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
