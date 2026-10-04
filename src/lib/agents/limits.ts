/**
 * Whether an agent may make a payment, and by how much it would be over.
 *
 * Kept as pure functions over plain numbers so the decision is testable without
 * a database, a chain or a clock. The route supplies the facts; this file only
 * judges them. That split is deliberate: this is the code that decides whether
 * someone's money moves, and it should be readable in one sitting.
 *
 * Three limits, all optional, all in USD:
 *
 *   perPayment  the largest single payment
 *   daily       the most that may be spent in a rolling 24 hours
 *   total       the most that may ever be spent, over the agent's lifetime
 *
 * A null limit means no limit of that kind. An agent with all three null is
 * unlimited, which is what our own crawler effectively is today.
 */

/** The limits on one agent. Null means unlimited for that dimension. */
export interface AgentLimits {
  perPaymentUsd: number | null;
  dailyUsd: number | null;
  totalUsd: number | null;
}

/** What the agent has already spent, in USD. */
export interface AgentSpending {
  /** Spent in the rolling window the daily limit covers. */
  last24hUsd: number;
  /** Spent over the agent's whole life. */
  lifetimeUsd: number;
}

export type AgentStatus = 'active' | 'paused' | 'revoked';

/** Why a payment was refused. `null` reason means it was allowed. */
export type RefusalReason =
  | 'agent_paused'
  | 'agent_revoked'
  | 'per_payment_limit'
  | 'daily_limit'
  | 'total_limit';

export interface LimitDecision {
  allowed: boolean;
  reason: RefusalReason | null;
  /** Human-readable, safe to hand back to the caller. */
  message: string | null;
  /** The limit that stopped it, in USD, when one did. */
  limitUsd: number | null;
  /** How much of that limit was left, in USD, when one stopped it. */
  remainingUsd: number | null;
}

const ALLOWED: LimitDecision = {
  allowed: true,
  reason: null,
  message: null,
  limitUsd: null,
  remainingUsd: null,
};

const money = (usd: number): string => `$${usd.toFixed(2)}`;

function refuse(
  reason: RefusalReason,
  message: string,
  limitUsd: number | null = null,
  remainingUsd: number | null = null,
): LimitDecision {
  return { allowed: false, reason, message, limitUsd, remainingUsd };
}

/**
 * Decide one payment.
 *
 * Order matters and is not arbitrary. Status comes first because a paused or
 * revoked agent should be told that, not told it is over a limit it has not
 * reached. Then the per-payment ceiling, which is the cheapest to explain and
 * the one a caller can act on immediately by paying less. Then daily, then
 * lifetime, narrowest window first, so the message names the limit that will
 * clear soonest.
 *
 * A zero-amount payment is allowed through: it moves nothing, and refusing it
 * would turn a no-op into an error for no benefit.
 */
export function checkAgentLimits(
  status: AgentStatus,
  limits: AgentLimits,
  spending: AgentSpending,
  amountUsd: number,
): LimitDecision {
  if (status === 'revoked') {
    return refuse('agent_revoked', 'This agent has been revoked and cannot spend.');
  }
  if (status === 'paused') {
    return refuse('agent_paused', 'This agent is paused and cannot spend until it is resumed.');
  }

  // Guard the arithmetic rather than trusting the caller. A NaN would compare
  // false against every limit and sail through, which is the worst possible
  // failure for this particular function.
  if (!Number.isFinite(amountUsd) || amountUsd < 0) {
    return refuse('per_payment_limit', 'Payment amount is not a valid number.');
  }

  const { perPaymentUsd, dailyUsd, totalUsd } = limits;

  if (perPaymentUsd !== null && amountUsd > perPaymentUsd) {
    return refuse(
      'per_payment_limit',
      `Payment of ${money(amountUsd)} is over this agent's ${money(perPaymentUsd)} per-payment limit.`,
      perPaymentUsd,
      perPaymentUsd,
    );
  }

  if (dailyUsd !== null) {
    const remaining = Math.max(0, dailyUsd - spending.last24hUsd);
    if (amountUsd > remaining) {
      return refuse(
        'daily_limit',
        `Payment of ${money(amountUsd)} is over this agent's remaining daily allowance of ${money(remaining)}.`,
        dailyUsd,
        remaining,
      );
    }
  }

  if (totalUsd !== null) {
    const remaining = Math.max(0, totalUsd - spending.lifetimeUsd);
    if (amountUsd > remaining) {
      return refuse(
        'total_limit',
        `Payment of ${money(amountUsd)} is over this agent's remaining lifetime allowance of ${money(remaining)}.`,
        totalUsd,
        remaining,
      );
    }
  }

  return ALLOWED;
}

/**
 * What an agent could still spend right now, in USD, or null when nothing
 * limits it. This is the number worth showing an operator, and it is the
 * smallest of the three remainders rather than any one of them.
 */
export function remainingAllowanceUsd(
  status: AgentStatus,
  limits: AgentLimits,
  spending: AgentSpending,
): number | null {
  if (status !== 'active') return 0;

  const candidates: number[] = [];
  if (limits.perPaymentUsd !== null) candidates.push(limits.perPaymentUsd);
  if (limits.dailyUsd !== null) candidates.push(Math.max(0, limits.dailyUsd - spending.last24hUsd));
  if (limits.totalUsd !== null) candidates.push(Math.max(0, limits.totalUsd - spending.lifetimeUsd));

  return candidates.length ? Math.min(...candidates) : null;
}
