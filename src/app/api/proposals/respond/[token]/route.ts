import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveProposalByToken } from '@/lib/auth/proposal-access';
import {
  acceptProposal,
  addRevision,
  assertCounterable,
  recordEvent,
  rejectProposal,
} from '@/lib/proposals/service';
import { notifyCountered, notifyDecided } from '@/lib/proposals/notify';

function client() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Fields the client is allowed to see. The access token is the credential, so
 * the response is deliberately narrow — no internal ids, no other proposals, and
 * never the token itself echoed back into a shared page.
 */
function publicView(
  proposal: Record<string, any>,
  revisions: Record<string, any>[],
) {
  return {
    proposal_number: proposal.proposal_number,
    title: proposal.title,
    description: proposal.description,
    status: proposal.status,
    business_name: proposal.businesses?.name ?? null,
    client_name: proposal.clients?.name ?? proposal.clients?.company_name ?? null,
    expires_at: proposal.expires_at,
    sent_at: proposal.sent_at,
    current_revision_id: proposal.current_revision_id,
    revisions: revisions.map((r) => ({
      id: r.id,
      revision_number: r.revision_number,
      proposed_by: r.proposed_by,
      amount: r.amount,
      currency: r.currency,
      crypto_currency: r.crypto_currency,
      terms: r.terms,
      message: r.message,
      due_date: r.due_date,
      status: r.status,
      created_at: r.created_at,
      // The payee address is shown so the client knows where funds will go if
      // they accept — it is the merchant's public receive address.
      merchant_wallet_address: r.merchant_wallet_address,
    })),
  };
}

/**
 * GET /api/proposals/respond/[token]
 * The client's read-only view of a proposal they were sent.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const supabase = client();

    const access = await resolveProposalByToken(
      supabase,
      token,
      `*, clients (id, name, company_name), businesses (id, name)`,
    );
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    const { data: revisions } = await supabase
      .from('proposal_revisions')
      .select('*')
      .eq('proposal_id', access.proposal.id)
      .order('revision_number', { ascending: true });

    await recordEvent(supabase, {
      proposalId: access.proposal.id,
      revisionId: access.proposal.current_revision_id,
      eventType: 'viewed',
      actor: 'client',
    });

    return NextResponse.json({
      success: true,
      proposal: publicView(access.proposal as unknown as Record<string, any>, revisions || []),
    });
  } catch (error) {
    console.error('Public proposal view error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/proposals/respond/[token]
 * The client's response: `accept`, `reject`, or `counter`.
 *
 * A client counter may change amount, currency, terms, due date and the coin —
 * but never the payee. Where the money lands is the merchant's to decide, so a
 * counter that switches coins leaves the payee unset and the merchant must
 * supply one when they accept.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const supabase = client();

    const access = await resolveProposalByToken(supabase, token);
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }
    const { proposal } = access;

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').toLowerCase();

    if (action === 'accept') {
      const result = await acceptProposal(supabase, {
        proposal,
        party: 'client',
        message: body.message,
      });
      if (!result.ok) {
        return NextResponse.json(
          { success: false, error: result.error, code: result.code },
          { status: result.status },
        );
      }
      await notifyDecided(supabase, {
        proposal: result.proposal,
        revision: result.revision,
        by: 'client',
        decision: 'accepted',
        message: body.message,
      });

      return NextResponse.json({ success: true, status: result.proposal.status });
    }

    if (action === 'reject') {
      // Captured before the reject marks it, so the email can quote the terms.
      const { data: declined } = await supabase
        .from('proposal_revisions')
        .select('*')
        .eq('id', proposal.current_revision_id ?? '')
        .maybeSingle();

      const result = await rejectProposal(supabase, {
        proposal,
        party: 'client',
        message: body.message,
      });
      if (!result.ok) {
        return NextResponse.json(
          { success: false, error: result.error, code: result.code },
          { status: result.status },
        );
      }

      await notifyDecided(supabase, {
        proposal: result.proposal,
        revision: declined ?? null,
        by: 'client',
        decision: 'rejected',
        message: body.message,
      });

      return NextResponse.json({ success: true, status: result.proposal.status });
    }

    if (action === 'counter') {
      const blocked = assertCounterable(proposal.status, 'client');
      if (blocked) {
        return NextResponse.json(
          { success: false, error: blocked.error, code: blocked.code },
          { status: blocked.status },
        );
      }

      const result = await addRevision(supabase, {
        proposal,
        party: 'client',
        revision: {
          amount: Number(body.amount),
          currency: body.currency,
          crypto_currency: body.crypto_currency,
          // Ignored for client revisions; the payee is carried over or left for
          // the merchant. Passed explicitly to make that intent obvious.
          merchant_wallet_address: null,
          terms: body.terms,
          message: body.message,
          due_date: body.due_date,
        },
        nextStatus: 'countered',
        eventType: 'countered',
      });

      if (!result.ok) {
        return NextResponse.json(
          { success: false, error: result.error, code: result.code },
          { status: result.status },
        );
      }
      await notifyCountered(supabase, {
        proposal: result.proposal,
        revision: result.revision,
        by: 'client',
      });

      return NextResponse.json({ success: true, status: result.proposal.status });
    }

    return NextResponse.json(
      { success: false, error: 'action must be one of: accept, reject, counter' },
      { status: 400 },
    );
  } catch (error) {
    console.error('Public proposal respond error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
