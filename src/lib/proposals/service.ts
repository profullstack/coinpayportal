/**
 * Proposal negotiation service.
 *
 * Holds the state machine so the API routes stay thin and the merchant-side and
 * client-side (public token) entry points cannot drift apart.
 *
 * Payee rule: every merchant-authored revision that names a coin must also name
 * the address the money will settle to — resolved from the account where
 * possible, entered manually otherwise (see `@/lib/payments/payee`). A client
 * counter may switch coins without one, because the client cannot see the
 * merchant's wallets; the merchant then has to supply a payee before they can
 * accept. Acceptance is the last gate: nothing becomes an invoice without a
 * validated payee.
 */

import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolvePayee, assertPayee } from '@/lib/payments/payee';
import {
  COUNTERABLE_BY,
  canAccept,
  isNegotiable,
  type Party,
  type Proposal,
  type ProposalEventType,
  type ProposalRevision,
  type ProposalStatus,
  type RevisionInput,
} from './types';
import { insertWithInvoiceNumber } from '../invoices/numbering';

export interface ServiceError {
  ok: false;
  error: string;
  code?: string;
  status: number;
}

export type ServiceResult<T> = ({ ok: true } & T) | ServiceError;

const PROPOSAL_SELECT = '*';
const REVISION_SELECT = '*';

/** Opaque, unguessable token for the client-facing proposal link. */
export function generateAccessToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Next `PROP-00N` for a business. */
export async function nextProposalNumber(
  supabase: SupabaseClient,
  businessId: string,
): Promise<string> {
  const { data } = await supabase
    .from('proposals')
    .select('proposal_number')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let next = 1;
  const match = data?.proposal_number?.match(/PROP-(\d+)/);
  if (match) next = parseInt(match[1], 10) + 1;
  return `PROP-${String(next).padStart(3, '0')}`;
}

export async function recordEvent(
  supabase: SupabaseClient,
  input: {
    proposalId: string;
    revisionId?: string | null;
    eventType: ProposalEventType;
    actor: Party | 'system';
    actorMerchantId?: string | null;
    message?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from('proposal_events').insert({
    proposal_id: input.proposalId,
    revision_id: input.revisionId ?? null,
    event_type: input.eventType,
    actor: input.actor,
    actor_merchant_id: input.actorMerchantId ?? null,
    message: input.message ?? null,
  });
  // The audit trail must never take down the action it is recording.
  if (error) console.error('[proposals] failed to record event:', error.message);
}

/**
 * Build the payee for a revision.
 *
 * Merchant revisions must end up with an address whenever a coin is named —
 * resolved from business/global/linked-web wallets, or supplied manually.
 * Client revisions inherit the standing payee when the coin is unchanged, and
 * are allowed to leave it unset when they switch coins.
 */
export async function resolveRevisionPayee(
  supabase: SupabaseClient,
  input: {
    proposal: Pick<Proposal, 'business_id' | 'user_id'>;
    party: Party;
    cryptoCurrency: string | null | undefined;
    requestedAddress: string | null | undefined;
    previousRevision?: Pick<
      ProposalRevision,
      'crypto_currency' | 'merchant_wallet_address'
    > | null;
  },
): Promise<ServiceResult<{ address: string | null; source: string | null }>> {
  const crypto = (input.cryptoCurrency || '').trim().toUpperCase();
  if (!crypto) {
    // No coin named yet — nothing to resolve against. The proposal cannot be
    // accepted in this state; acceptance re-checks.
    return { ok: true, address: null, source: null };
  }

  const sameCoinAsBefore =
    !!input.previousRevision?.crypto_currency &&
    input.previousRevision.crypto_currency.toUpperCase() === crypto;

  const inheritedAddress = sameCoinAsBefore
    ? input.previousRevision?.merchant_wallet_address ?? null
    : null;

  const requested = (input.requestedAddress || '').trim() || inheritedAddress;

  if (input.party === 'client') {
    // The client never picks where the merchant gets paid. Carry the standing
    // payee forward when the coin is unchanged; otherwise leave it for the
    // merchant to fill in before accepting.
    return {
      ok: true,
      address: inheritedAddress,
      source: inheritedAddress ? 'inherited' : null,
    };
  }

  const payee = await resolvePayee(supabase, {
    businessId: input.proposal.business_id,
    merchantId: input.proposal.user_id,
    cryptocurrency: crypto,
    requestedAddress: requested,
    inherited: !input.requestedAddress && !!inheritedAddress,
  });

  if (!payee.ok) {
    return { ok: false, error: payee.error, code: payee.code, status: payee.status };
  }

  return { ok: true, address: payee.address, source: payee.source };
}

/**
 * Append a revision and make it the standing offer, superseding the previous
 * one. Used for the opening offer and for every counter after it.
 */
export async function addRevision(
  supabase: SupabaseClient,
  input: {
    proposal: Proposal;
    party: Party;
    actorMerchantId?: string | null;
    revision: RevisionInput;
    /** Status to move the proposal to; omit to leave it unchanged. */
    nextStatus?: ProposalStatus;
    eventType: ProposalEventType;
  },
): Promise<ServiceResult<{ revision: ProposalRevision; proposal: Proposal }>> {
  const { proposal, party } = input;

  if (!Number.isFinite(input.revision.amount) || input.revision.amount <= 0) {
    return { ok: false, error: 'A positive amount is required', status: 400 };
  }

  // NEW-F1A-P-02: countering an expired proposal used to work, which meant a
  // deadline stopped the deal closing but not the negotiation continuing — the
  // one thing a deadline is for. The opening offer is exempt: a draft being
  // sent for the first time has no deadline to have passed yet.
  if (isNegotiable(proposal.status)) {
    const expired = await assertNotExpired(supabase, proposal);
    if (expired) return expired;
  }

  const { data: previous } = await supabase
    .from('proposal_revisions')
    .select(REVISION_SELECT)
    .eq('proposal_id', proposal.id)
    .order('revision_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const payee = await resolveRevisionPayee(supabase, {
    proposal,
    party,
    cryptoCurrency: input.revision.crypto_currency,
    requestedAddress: input.revision.merchant_wallet_address,
    previousRevision: previous ?? null,
  });
  if (!payee.ok) return payee;

  const revisionNumber = (previous?.revision_number ?? 0) + 1;

  const { data: revision, error } = await supabase
    .from('proposal_revisions')
    .insert({
      proposal_id: proposal.id,
      revision_number: revisionNumber,
      proposed_by: party,
      proposed_by_merchant_id: party === 'merchant' ? input.actorMerchantId ?? null : null,
      amount: input.revision.amount,
      currency: input.revision.currency || previous?.currency || 'USD',
      crypto_currency: input.revision.crypto_currency || null,
      merchant_wallet_address: payee.address,
      payee_source: payee.source,
      terms: input.revision.terms ?? null,
      message: input.revision.message ?? null,
      due_date: input.revision.due_date ?? null,
      status: 'open',
    })
    .select(REVISION_SELECT)
    .single();

  if (error || !revision) {
    return { ok: false, error: error?.message || 'Failed to save revision', status: 400 };
  }

  // Retire the previous offer now that a newer one is on the table.
  if (previous?.id) {
    await supabase
      .from('proposal_revisions')
      .update({ status: 'superseded' })
      .eq('id', previous.id)
      .eq('status', 'open');
  }

  const update: Record<string, unknown> = {
    current_revision_id: revision.id,
    updated_at: new Date().toISOString(),
  };
  if (input.nextStatus) update.status = input.nextStatus;

  const { data: updatedProposal, error: proposalError } = await supabase
    .from('proposals')
    .update(update)
    .eq('id', proposal.id)
    .select(PROPOSAL_SELECT)
    .single();

  if (proposalError || !updatedProposal) {
    return { ok: false, error: proposalError?.message || 'Failed to update proposal', status: 400 };
  }

  await recordEvent(supabase, {
    proposalId: proposal.id,
    revisionId: revision.id,
    eventType: input.eventType,
    actor: party,
    actorMerchantId: input.actorMerchantId,
    message: input.revision.message ?? null,
  });

  return { ok: true, revision, proposal: updatedProposal };
}

/** Guard: may `party` put a counter-offer on this proposal right now? */
/**
 * Refuse a proposal past its own deadline, and record that it is past it.
 *
 * NEW-F1A-P-02: `expires_at` was checked in exactly one place — `acceptProposal`
 * — so a proposal could still be countered, rejected, withdrawn, re-sent and
 * viewed by token long after it had expired. The deadline meant "you cannot
 * accept this", not "this is over", which is not what either party reads it as
 * when they set one.
 *
 * `'expired'` is also a permitted value of `proposals_status_check` that
 * *nothing ever wrote*. The state existed in the schema and in the type union
 * and was unreachable, so no proposal has ever shown as expired in any list or
 * dashboard — they simply sit as `sent` for ever.
 *
 * Both halves are fixed here. The status is flipped on the way past, which
 * gives the state a producer without a new cron: expiry is only interesting
 * when someone tries to act, and that is exactly when this runs. The write is
 * conditioned on the status still being negotiable so it cannot overwrite a
 * concurrent accept or reject.
 */
export async function assertNotExpired(
  supabase: SupabaseClient,
  proposal: Proposal,
): Promise<ServiceResult<null> | null> {
  if (!proposal.expires_at) return null;

  const expiresAt = new Date(proposal.expires_at).getTime();
  // An unparseable deadline is treated as no deadline rather than as an expired
  // one — refusing to act on a proposal because of a bad timestamp would be a
  // worse failure than letting it through.
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) return null;

  if (isNegotiable(proposal.status)) {
    await supabase
      .from('proposals')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', proposal.id)
      .in('status', ['sent', 'countered']);
  }

  return { ok: false, error: 'This proposal has expired', code: 'EXPIRED', status: 409 };
}

export function assertCounterable(
  status: ProposalStatus,
  party: Party,
): ServiceError | null {
  if (!COUNTERABLE_BY[status]?.includes(party)) {
    return {
      ok: false,
      error: `A ${party} cannot counter a proposal that is ${status}`,
      code: 'NOT_COUNTERABLE',
      status: 409,
    };
  }
  return null;
}

/**
 * Accept the standing revision.
 *
 * The final payee gate lives here: an accepted proposal is a commitment to pay
 * someone, so it must name a coin and a valid address. When the standing
 * revision has neither (typically after a client switched coins), the merchant
 * accepting it may pass `payeeAddress` to fill the gap — the "enter it manually"
 * path — and a client accepting simply cannot proceed until the merchant does.
 */
export async function acceptProposal(
  supabase: SupabaseClient,
  input: {
    proposal: Proposal;
    party: Party;
    actorMerchantId?: string | null;
    /** Manual payee supplied at accept time. Merchant-only. */
    payeeAddress?: string | null;
    message?: string | null;
  },
): Promise<ServiceResult<{ proposal: Proposal; revision: ProposalRevision }>> {
  const { proposal, party } = input;

  const { data: revision } = await supabase
    .from('proposal_revisions')
    .select(REVISION_SELECT)
    .eq('id', proposal.current_revision_id ?? '')
    .maybeSingle();

  if (!revision) {
    return { ok: false, error: 'This proposal has no offer to accept', status: 409 };
  }

  if (!canAccept(proposal.status, revision, party)) {
    const reason = !isNegotiable(proposal.status)
      ? `This proposal is ${proposal.status}`
      : 'You cannot accept your own offer — counter it or wait for a response';
    return { ok: false, error: reason, code: 'NOT_ACCEPTABLE', status: 409 };
  }

  const expiredOnAccept = await assertNotExpired(supabase, proposal);
  if (expiredOnAccept) return expiredOnAccept;

  // Payee gate.
  let payeeAddress = revision.merchant_wallet_address;
  let payeeSource = revision.payee_source;

  if (!revision.crypto_currency) {
    return {
      ok: false,
      error: 'A cryptocurrency must be agreed before this proposal can be accepted',
      code: 'CRYPTO_REQUIRED',
      status: 400,
    };
  }

  if (!payeeAddress || input.payeeAddress) {
    if (party !== 'merchant') {
      return {
        ok: false,
        error:
          'This offer has no payee address yet. The business must confirm where funds should be sent before it can be accepted.',
        code: 'PAYEE_REQUIRED',
        status: 409,
      };
    }

    const resolved = await resolvePayee(supabase, {
      businessId: proposal.business_id,
      merchantId: proposal.user_id,
      cryptocurrency: revision.crypto_currency,
      requestedAddress: input.payeeAddress,
    });
    if (!resolved.ok) {
      return { ok: false, error: resolved.error, code: resolved.code, status: resolved.status };
    }
    payeeAddress = resolved.address;
    payeeSource = resolved.source;
  }

  const finalCheck = assertPayee(payeeAddress, revision.crypto_currency);
  if (!finalCheck.ok) {
    return {
      ok: false,
      error: finalCheck.error,
      code: finalCheck.code,
      status: finalCheck.status,
    };
  }

  const now = new Date().toISOString();

  const { data: acceptedRevision } = await supabase
    .from('proposal_revisions')
    .update({
      status: 'accepted',
      merchant_wallet_address: finalCheck.address,
      payee_source: payeeSource,
    })
    .eq('id', revision.id)
    .select(REVISION_SELECT)
    .single();

  // Compare-and-swap on the status observed earlier in this function.
  //
  // Acceptance is what binds the payee address and fee for the resulting
  // invoice, so accepting twice — two clicks, or an accept racing a counter —
  // could re-accept a proposal that had already moved on, overwriting the
  // agreed terms. Only the caller that finds it still in the pre-accept state
  // gets to settle it.
  const { data: updatedProposal, error } = await supabase
    .from('proposals')
    .update({ status: 'accepted', accepted_at: now, updated_at: now })
    .eq('id', proposal.id)
    .eq('status', proposal.status)
    .select(PROPOSAL_SELECT)
    .single();

  if (error || !updatedProposal) {
    return {
      ok: false,
      error: 'This proposal was already accepted or changed; reload it and try again.',
      status: 409,
    };
  }

  await recordEvent(supabase, {
    proposalId: proposal.id,
    revisionId: revision.id,
    eventType: 'accepted',
    actor: party,
    actorMerchantId: input.actorMerchantId,
    message: input.message ?? null,
  });

  return { ok: true, proposal: updatedProposal, revision: acceptedRevision ?? revision };
}

/** Decline the standing offer outright. Either side may do this. */
export async function rejectProposal(
  supabase: SupabaseClient,
  input: {
    proposal: Proposal;
    party: Party;
    actorMerchantId?: string | null;
    message?: string | null;
  },
): Promise<ServiceResult<{ proposal: Proposal }>> {
  const { proposal, party } = input;

  if (!isNegotiable(proposal.status)) {
    return {
      ok: false,
      error: `This proposal is ${proposal.status} and can no longer be rejected`,
      code: 'NOT_REJECTABLE',
      status: 409,
    };
  }

  // NEW-F1A-P-02: the deadline applied only to accepting, so an expired
  // proposal could still be rejected — and the rejection would look like a
  // live decision rather than something that had already lapsed.
  const expiredOnReject = await assertNotExpired(supabase, proposal);
  if (expiredOnReject) return expiredOnReject;

  const now = new Date().toISOString();

  if (proposal.current_revision_id) {
    await supabase
      .from('proposal_revisions')
      .update({ status: 'rejected' })
      .eq('id', proposal.current_revision_id);
  }

  const { data: updated, error } = await supabase
    .from('proposals')
    .update({ status: 'rejected', rejected_at: now, updated_at: now })
    .eq('id', proposal.id)
    .select(PROPOSAL_SELECT)
    .single();

  if (error || !updated) {
    return { ok: false, error: error?.message || 'Failed to reject proposal', status: 400 };
  }

  await recordEvent(supabase, {
    proposalId: proposal.id,
    revisionId: proposal.current_revision_id,
    eventType: 'rejected',
    actor: party,
    actorMerchantId: input.actorMerchantId,
    message: input.message ?? null,
  });

  return { ok: true, proposal: updated };
}

/**
 * Turn an accepted proposal into a draft invoice, carrying the agreed payee
 * across so the invoice is born compliant with the same rule.
 */
export async function convertToInvoice(
  supabase: SupabaseClient,
  input: { proposal: Proposal; actorMerchantId: string; feeRate: number },
): Promise<ServiceResult<{ invoice: Record<string, unknown> }>> {
  const { proposal } = input;

  if (proposal.status !== 'accepted') {
    return {
      ok: false,
      error: 'Only an accepted proposal can become an invoice',
      code: 'NOT_ACCEPTED',
      status: 409,
    };
  }
  if (proposal.invoice_id) {
    return {
      ok: false,
      error: 'This proposal has already been invoiced',
      code: 'ALREADY_INVOICED',
      status: 409,
    };
  }

  const { data: revision } = await supabase
    .from('proposal_revisions')
    .select(REVISION_SELECT)
    .eq('id', proposal.current_revision_id ?? '')
    .maybeSingle();

  if (!revision) {
    return { ok: false, error: 'Accepted revision not found', status: 404 };
  }

  const payee = assertPayee(revision.merchant_wallet_address, revision.crypto_currency);
  if (!payee.ok) {
    return { ok: false, error: payee.error, code: payee.code, status: payee.status };
  }

  // NEW-F1A-P-01: this ordered by `created_at` and took the newest row, which
  // is not the highest number — backdate or delete an invoice and the next
  // number collides with one that already exists. There was also no retry on
  // the unique violation a concurrent create causes, so the loser simply could
  // not convert their proposal. Both are handled by the shared helper now.
  const { data: invoice, error } = await insertWithInvoiceNumber<any>(
    supabase,
    proposal.business_id,
    (invoiceNumber) => supabase
    .from('invoices')
    .insert({
      user_id: proposal.user_id,
      business_id: proposal.business_id,
      client_id: proposal.client_id,
      invoice_number: invoiceNumber,
      status: 'draft',
      currency: revision.currency || 'USD',
      amount: revision.amount,
      crypto_currency: revision.crypto_currency,
      merchant_wallet_address: payee.address,
      fee_rate: input.feeRate,
      due_date: revision.due_date,
      notes: revision.terms || proposal.description || null,
      metadata: {
        source: 'proposal',
        proposal_id: proposal.id,
        proposal_number: proposal.proposal_number,
        payee_source: revision.payee_source,
      },
    })
    .select('*')
    .single()
  );

  if (error || !invoice) {
    return { ok: false, error: error?.message || 'Failed to create invoice', status: 400 };
  }

  await supabase
    .from('proposals')
    .update({ invoice_id: invoice.id, updated_at: new Date().toISOString() })
    .eq('id', proposal.id);

  await recordEvent(supabase, {
    proposalId: proposal.id,
    revisionId: revision.id,
    eventType: 'invoiced',
    actor: 'merchant',
    actorMerchantId: input.actorMerchantId,
    message: `Converted to invoice ${invoice.invoice_number}`,
  });

  return { ok: true, invoice };
}
