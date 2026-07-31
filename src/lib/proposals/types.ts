/**
 * Proposal domain types.
 *
 * A proposal is a quote under negotiation. Each offer and counter-offer is an
 * immutable `ProposalRevision`; `Proposal.current_revision_id` points at the one
 * awaiting a response. Nothing settles until a revision is accepted and turned
 * into an invoice.
 */

export type ProposalStatus =
  | 'draft'
  | 'sent'
  | 'countered'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'
  | 'expired';

export type RevisionStatus = 'open' | 'accepted' | 'rejected' | 'superseded';

/** Which side of the negotiation acted. */
export type Party = 'merchant' | 'client';

export type ProposalEventType =
  | 'created'
  | 'sent'
  | 'viewed'
  | 'countered'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'
  | 'expired'
  | 'invoiced';

export interface ProposalRevision {
  id: string;
  proposal_id: string;
  revision_number: number;
  proposed_by: Party;
  proposed_by_merchant_id: string | null;
  amount: string | number;
  currency: string;
  crypto_currency: string | null;
  merchant_wallet_address: string | null;
  payee_source: string | null;
  terms: string | null;
  message: string | null;
  due_date: string | null;
  status: RevisionStatus;
  created_at: string | null;
}

export interface Proposal {
  id: string;
  user_id: string;
  business_id: string;
  client_id: string | null;
  proposal_number: string;
  title: string;
  description: string | null;
  status: ProposalStatus;
  current_revision_id: string | null;
  access_token: string;
  expires_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  invoice_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ProposalEvent {
  id: string;
  proposal_id: string;
  revision_id: string | null;
  event_type: ProposalEventType;
  actor: Party | 'system';
  actor_merchant_id: string | null;
  message: string | null;
  created_at: string | null;
}

/** Terms either side can put on the table. */
export interface RevisionInput {
  amount: number;
  currency?: string;
  crypto_currency?: string | null;
  /** Payee for this revision; required from the merchant when a coin is set. */
  merchant_wallet_address?: string | null;
  terms?: string | null;
  message?: string | null;
  due_date?: string | null;
}

/**
 * Which statuses accept a counter-offer from which side.
 *
 * A merchant may re-open their own `sent` proposal with better terms, and both
 * sides may keep countering while the negotiation is live. Terminal states
 * (accepted/rejected/withdrawn/expired) accept nothing.
 */
export const COUNTERABLE_BY: Record<ProposalStatus, Party[]> = {
  draft: ['merchant'],
  sent: ['merchant', 'client'],
  countered: ['merchant', 'client'],
  accepted: [],
  rejected: [],
  withdrawn: [],
  expired: [],
};

/** True when `party` may respond at all — the proposal is still live. */
export function isNegotiable(status: ProposalStatus): boolean {
  return status === 'sent' || status === 'countered';
}

/**
 * You cannot accept your own offer — only the side that did not author the
 * standing revision can close it. That single rule covers both directions:
 * the client accepts what the merchant sent, and the merchant accepts a client
 * counter-offer.
 */
export function canAccept(
  status: ProposalStatus,
  currentRevision: Pick<ProposalRevision, 'proposed_by' | 'status'> | null,
  party: Party,
): boolean {
  if (!isNegotiable(status)) return false;
  if (!currentRevision || currentRevision.status !== 'open') return false;
  return currentRevision.proposed_by !== party;
}
