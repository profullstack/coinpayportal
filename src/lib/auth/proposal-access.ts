import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { resolveMerchant } from './merchant';
import { authorizeBusiness } from './authz';
import type { Capability } from './permissions';
import type { Proposal } from '@/lib/proposals/types';

/**
 * Authorize the caller for a single proposal by its OWNING BUSINESS, mirroring
 * `authorizeInvoice`. Proposals are created with `user_id = business.merchant_id`
 * so a `user_id` gate would hide them from team members who hold a role on the
 * business.
 *
 * 404 covers both "no such proposal" and "you cannot see its business", so
 * existence is never leaked.
 *
 * Proposal capabilities map onto the invoice ones: reading needs `business.read`,
 * anything that changes the negotiation needs `invoice.write`.
 */
export type ProposalAccessOk = {
  ok: true;
  merchantId: string;
  apiKeyBusinessId: string | null;
  proposal: Proposal;
};
export type ProposalAccessErr = { ok: false; status: number; error: string };

export async function authorizeProposal(
  supabase: SupabaseClient,
  request: NextRequest,
  proposalId: string,
  capability: Capability,
  select = '*',
): Promise<ProposalAccessOk | ProposalAccessErr> {
  const auth = await resolveMerchant(supabase, request);
  if ('error' in auth) return { ok: false, status: auth.status, error: auth.error };
  const { merchantId, apiKeyBusinessId } = auth;

  const { data: proposal, error } = await supabase
    .from('proposals')
    .select(select)
    .eq('id', proposalId)
    .single();

  // `select` is a caller-supplied string, so supabase-js widens the row type;
  // narrow through `unknown` rather than fighting the generic.
  const row = proposal as unknown as { business_id?: string } | null;
  if (error || !row?.business_id) {
    return { ok: false, status: 404, error: 'Proposal not found' };
  }
  const businessId = row.business_id;

  if (apiKeyBusinessId) {
    if (businessId !== apiKeyBusinessId) {
      return { ok: false, status: 404, error: 'Proposal not found' };
    }
  } else {
    const authz = await authorizeBusiness(supabase, merchantId, businessId, capability);
    if (!authz.ok) {
      return {
        ok: false,
        status: authz.status,
        error: authz.status === 404 ? 'Proposal not found' : authz.error,
      };
    }
  }

  return { ok: true, merchantId, apiKeyBusinessId, proposal: proposal as unknown as Proposal };
}

/**
 * Resolve a proposal from the client-facing access token.
 *
 * This is the unauthenticated counterpart used by the public respond page: the
 * token IS the credential, so it must be compared in full and the proposal must
 * still be live. Draft proposals are unreachable by token — a proposal only
 * becomes visible to the client when it is sent.
 */
export async function resolveProposalByToken(
  supabase: SupabaseClient,
  token: string,
  select = '*',
): Promise<{ ok: true; proposal: Proposal } | ProposalAccessErr> {
  const trimmed = (token || '').trim();
  // Guard against a blank/absurd token hitting the database at all.
  if (trimmed.length < 20 || trimmed.length > 200) {
    return { ok: false, status: 404, error: 'Proposal not found' };
  }

  const { data: proposal, error } = await supabase
    .from('proposals')
    .select(select)
    .eq('access_token', trimmed)
    .maybeSingle();

  const row = proposal as unknown as { status?: string } | null;
  if (error || !row) {
    return { ok: false, status: 404, error: 'Proposal not found' };
  }

  // A draft has never been shown to the client, so the token must not open it.
  if (row.status === 'draft') {
    return { ok: false, status: 404, error: 'Proposal not found' };
  }

  return { ok: true, proposal: proposal as unknown as Proposal };
}
