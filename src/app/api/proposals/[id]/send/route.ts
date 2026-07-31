import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeProposal } from '@/lib/auth/proposal-access';
import { recordEvent } from '@/lib/proposals/service';
import { assertPayee } from '@/lib/payments/payee';
import { sendEmail } from '@/lib/email';
import { proposalSentTemplate } from '@/lib/email/proposal-templates';

/**
 * POST /api/proposals/[id]/send
 * Put a draft in front of the client and email them the response link.
 *
 * A proposal that names a coin must name a payee before it goes out — the same
 * gate invoices use, applied one step earlier so the client is never asked to
 * agree to terms whose destination is undecided.
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

    const access = await authorizeProposal(
      supabase,
      request,
      id,
      'invoice.write',
      `*, clients (id, name, email, company_name), businesses (id, name)`,
    );
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }
    const proposal = access.proposal as typeof access.proposal & {
      clients?: { email?: string; name?: string } | null;
      businesses?: { name?: string } | null;
    };

    if (proposal.status !== 'draft') {
      return NextResponse.json(
        { success: false, error: `Cannot send a proposal that is ${proposal.status}` },
        { status: 409 },
      );
    }

    const clientEmail = proposal.clients?.email;
    if (!clientEmail) {
      return NextResponse.json(
        { success: false, error: 'A client with an email address is required to send a proposal' },
        { status: 400 },
      );
    }

    const { data: revision } = await supabase
      .from('proposal_revisions')
      .select('*')
      .eq('id', proposal.current_revision_id ?? '')
      .maybeSingle();

    if (!revision) {
      return NextResponse.json(
        { success: false, error: 'This proposal has no offer to send' },
        { status: 409 },
      );
    }

    if (revision.crypto_currency) {
      const payee = assertPayee(revision.merchant_wallet_address, revision.crypto_currency);
      if (!payee.ok) {
        return NextResponse.json(
          { success: false, error: payee.error, code: payee.code },
          { status: payee.status },
        );
      }
    }

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from('proposals')
      .update({ status: 'sent', sent_at: now, updated_at: now })
      .eq('id', id)
      .select('*')
      .single();

    if (error || !updated) {
      return NextResponse.json(
        { success: false, error: error?.message || 'Failed to send proposal' },
        { status: 400 },
      );
    }

    await recordEvent(supabase, {
      proposalId: id,
      revisionId: revision.id,
      eventType: 'sent',
      actor: 'merchant',
      actorMerchantId: access.merchantId,
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.coinpayportal.com';
    const respondLink = `${baseUrl}/proposals/respond/${proposal.access_token}`;

    // Delivery failure must not roll back the state change — the proposal is
    // sent, and the link can be re-shared.
    try {
      const template = proposalSentTemplate({
        businessName: proposal.businesses?.name || 'A CoinPay business',
        proposalNumber: proposal.proposal_number,
        title: proposal.title,
        amount: Number(revision.amount),
        currency: revision.currency || 'USD',
        cryptoCurrency: revision.crypto_currency,
        terms: revision.terms,
        message: revision.message,
        dueDate: revision.due_date,
        expiresAt: proposal.expires_at,
        respondLink,
      });
      await sendEmail({ to: clientEmail, subject: template.subject, html: template.html });
    } catch (emailError) {
      console.error('Failed to email proposal:', emailError);
    }

    return NextResponse.json({ success: true, proposal: updated, respond_link: respondLink });
  } catch (error) {
    console.error('Send proposal error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
