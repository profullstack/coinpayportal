/**
 * The one call the settle route makes: may this payer spend this much?
 *
 * Joins the pure rule in ./limits to the rows in ./store so the route stays a
 * route. Everything here is written to fail in the safe direction: a payer that
 * is not an agent is allowed through untouched, and an agent whose payment we
 * cannot measure is refused rather than waved past unmeasured.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { checkAgentLimits, type RefusalReason } from './limits';
import { findAgentByAddress, getSpending, recordSpend, usdFromTokenUnits } from './store';

/** Why a spend was refused, including the reasons that are not limits. */
export type AgentRefusal = RefusalReason | 'unpriceable_asset';

export interface AgentAuthorisation {
  allowed: boolean;
  /** Null when the payer is not a registered agent, which is the common case. */
  agentId: string | null;
  agentName: string | null;
  /** The payment in USD, once we could price it. */
  amountUsd: number | null;
  network: string;
  nonce: string | null;
  reason: AgentRefusal | null;
  message: string | null;
  limitUsd: number | null;
  remainingUsd: number | null;
}

const allow = (network: string, extra: Partial<AgentAuthorisation> = {}): AgentAuthorisation => ({
  allowed: true,
  agentId: null,
  agentName: null,
  amountUsd: null,
  network,
  nonce: null,
  reason: null,
  message: null,
  limitUsd: null,
  remainingUsd: null,
  ...extra,
});

/**
 * Decide whether to broadcast, for a payer that may or may not be an agent.
 *
 * A database failure while looking the agent up resolves to "not an agent", so
 * an outage in this table cannot take payments down for everyone. That is a
 * deliberate trade: the limits are a safety rail their owner opted into, not an
 * authorisation boundary protecting a third party, and failing every payment
 * closed would be the larger harm.
 */
export async function authoriseAgentSpend(
  supabase: SupabaseClient,
  payment: {
    payer: string;
    amountUnits: bigint | string;
    network: string;
    nonce?: string | null;
  },
): Promise<AgentAuthorisation> {
  const agent = await findAgentByAddress(supabase, payment.payer);
  if (!agent) return allow(payment.network);

  const nonce = payment.nonce ?? null;
  const amountUsd = usdFromTokenUnits(payment.amountUnits);

  if (amountUsd === null) {
    // An agent's limits are in dollars. If we cannot say what this payment is
    // worth, we cannot say it is under the limit, so it does not go out.
    return {
      allowed: false,
      agentId: agent.id,
      agentName: agent.name,
      amountUsd: null,
      network: payment.network,
      nonce,
      reason: 'unpriceable_asset',
      message:
        'This payment is in an asset the agent spending limits cannot be measured in, so it was not sent.',
      limitUsd: null,
      remainingUsd: null,
    };
  }

  const spending = await getSpending(supabase, agent.id);
  const decision = checkAgentLimits(agent.status, agent.limits, spending, amountUsd);

  return {
    allowed: decision.allowed,
    agentId: agent.id,
    agentName: agent.name,
    amountUsd,
    network: payment.network,
    nonce,
    reason: decision.reason,
    message: decision.message,
    limitUsd: decision.limitUsd,
    remainingUsd: decision.remainingUsd,
  };
}

/**
 * Write the spend down, after the broadcast succeeded.
 *
 * Never throws. A ledger write that fails must not turn a payment that has
 * already moved on chain into an error the caller will retry, because the retry
 * would be the thing that double-spends. The cost of the failure is an
 * understated allowance, which is the safe direction to be wrong in.
 */
export async function recordAgentSpend(
  supabase: SupabaseClient,
  authorisation: AgentAuthorisation,
  txHash?: string | null,
): Promise<void> {
  if (!authorisation.agentId || authorisation.amountUsd === null) return;
  try {
    await recordSpend(supabase, {
      agentWalletId: authorisation.agentId,
      amountUsd: authorisation.amountUsd,
      network: authorisation.network,
      nonce: authorisation.nonce,
      txHash: txHash ?? null,
    });
  } catch {
    /* see above: an unrecorded spend is better than a retried broadcast */
  }
}
