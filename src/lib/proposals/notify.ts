/**
 * Proposal notifications.
 *
 * A negotiation only works if the other side finds out it is their turn, so
 * every state change that hands the ball over emails the counterparty.
 *
 * Delivery is always best-effort: the state change has already been committed by
 * the time we get here, and a bounced email must never roll it back or fail the
 * request. Failures are logged and swallowed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';
import {
  proposalCounteredTemplate,
  proposalDecidedTemplate,
} from '@/lib/email/proposal-templates';
import type { Proposal, ProposalRevision } from './types';

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://www.coinpayportal.com';
}

interface Parties {
  clientEmail: string | null;
  merchantEmail: string | null;
  businessName: string;
  clientName: string;
}

/** Resolve both sides' contact details for a proposal. */
async function loadParties(
  supabase: SupabaseClient,
  proposal: Proposal,
): Promise<Parties> {
  const [{ data: client }, { data: business }, { data: merchant }] = await Promise.all([
    proposal.client_id
      ? supabase
          .from('clients')
          .select('name, email, company_name')
          .eq('id', proposal.client_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('businesses').select('name').eq('id', proposal.business_id).maybeSingle(),
    supabase.from('merchants').select('email').eq('id', proposal.user_id).maybeSingle(),
  ]);

  return {
    clientEmail: client?.email ?? null,
    merchantEmail: merchant?.email ?? null,
    businessName: business?.name ?? 'A CoinPay business',
    clientName: client?.company_name || client?.name || client?.email || 'The client',
  };
}

/**
 * Tell the other party a counter-offer is waiting for them.
 *
 * `by` is who authored the counter, so the mail goes to the opposite side.
 */
export async function notifyCountered(
  supabase: SupabaseClient,
  input: { proposal: Proposal; revision: ProposalRevision; by: 'merchant' | 'client' },
): Promise<void> {
  try {
    const parties = await loadParties(supabase, input.proposal);

    const toClient = input.by === 'merchant';
    const to = toClient ? parties.clientEmail : parties.merchantEmail;
    if (!to) return;

    const template = proposalCounteredTemplate({
      businessName: parties.businessName,
      proposalNumber: input.proposal.proposal_number,
      title: input.proposal.title,
      amount: Number(input.revision.amount),
      currency: input.revision.currency || 'USD',
      message: input.revision.message,
      respondLink: toClient
        ? `${baseUrl()}/proposals/respond/${input.proposal.access_token}`
        : `${baseUrl()}/proposals/${input.proposal.id}`,
    });

    await sendEmail({ to, subject: template.subject, html: template.html });
  } catch (error) {
    console.error('[proposals] counter notification failed:', error);
  }
}

/**
 * Tell the other party the negotiation is over.
 *
 * `by` is who made the decision, so the mail goes to the opposite side.
 */
export async function notifyDecided(
  supabase: SupabaseClient,
  input: {
    proposal: Proposal;
    revision: ProposalRevision | null;
    by: 'merchant' | 'client';
    decision: 'accepted' | 'rejected';
    message?: string | null;
  },
): Promise<void> {
  try {
    const parties = await loadParties(supabase, input.proposal);

    const toClient = input.by === 'merchant';
    const to = toClient ? parties.clientEmail : parties.merchantEmail;
    if (!to) return;

    const template = proposalDecidedTemplate({
      proposalNumber: input.proposal.proposal_number,
      title: input.proposal.title,
      // Named from the recipient's point of view.
      counterpartyName: input.by === 'merchant' ? parties.businessName : parties.clientName,
      amount: Number(input.revision?.amount ?? 0),
      currency: input.revision?.currency || 'USD',
      decision: input.decision,
      message: input.message,
      link: toClient
        ? `${baseUrl()}/proposals/respond/${input.proposal.access_token}`
        : `${baseUrl()}/proposals/${input.proposal.id}`,
    });

    await sendEmail({ to, subject: template.subject, html: template.html });
  } catch (error) {
    console.error('[proposals] decision notification failed:', error);
  }
}
