import { describe, expect, it } from 'vitest';
import {
  AgentLimits,
  AgentSpending,
  checkAgentLimits,
  remainingAllowanceUsd,
} from './limits';

const unlimited: AgentLimits = { perPaymentUsd: null, dailyUsd: null, totalUsd: null };
const nothingSpent: AgentSpending = { last24hUsd: 0, lifetimeUsd: 0 };

describe('status', () => {
  it('refuses a revoked agent before looking at any limit', () => {
    const decision = checkAgentLimits('revoked', unlimited, nothingSpent, 1);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('agent_revoked');
  });

  it('refuses a paused agent, and says it can be resumed', () => {
    const decision = checkAgentLimits('paused', unlimited, nothingSpent, 1);
    expect(decision.reason).toBe('agent_paused');
    expect(decision.message).toMatch(/resumed/);
  });

  it('names the status rather than a limit the agent has not reached', () => {
    const limits: AgentLimits = { perPaymentUsd: 1, dailyUsd: 1, totalUsd: 1 };
    // Over every limit AND paused. The operator needs to hear "paused".
    expect(checkAgentLimits('paused', limits, nothingSpent, 500).reason).toBe('agent_paused');
  });
});

describe('an agent with no limits', () => {
  it('may spend anything', () => {
    expect(checkAgentLimits('active', unlimited, nothingSpent, 1_000_000).allowed).toBe(true);
  });

  it('reports no allowance figure, which is not the same as zero', () => {
    expect(remainingAllowanceUsd('active', unlimited, nothingSpent)).toBeNull();
  });
});

describe('per-payment limit', () => {
  const limits: AgentLimits = { perPaymentUsd: 10, dailyUsd: null, totalUsd: null };

  it('allows a payment exactly at the limit', () => {
    expect(checkAgentLimits('active', limits, nothingSpent, 10).allowed).toBe(true);
  });

  it('refuses a payment a cent over', () => {
    const decision = checkAgentLimits('active', limits, nothingSpent, 10.01);
    expect(decision.reason).toBe('per_payment_limit');
    expect(decision.limitUsd).toBe(10);
  });

  it('does not care what has been spent before', () => {
    const spent: AgentSpending = { last24hUsd: 9_999, lifetimeUsd: 9_999 };
    expect(checkAgentLimits('active', limits, spent, 5).allowed).toBe(true);
  });
});

describe('daily limit', () => {
  const limits: AgentLimits = { perPaymentUsd: null, dailyUsd: 100, totalUsd: null };

  it('allows a payment that exactly exhausts the day', () => {
    const spent: AgentSpending = { last24hUsd: 40, lifetimeUsd: 40 };
    expect(checkAgentLimits('active', limits, spent, 60).allowed).toBe(true);
  });

  it('refuses the payment that would cross it', () => {
    const spent: AgentSpending = { last24hUsd: 40, lifetimeUsd: 40 };
    const decision = checkAgentLimits('active', limits, spent, 60.01);
    expect(decision.reason).toBe('daily_limit');
    expect(decision.remainingUsd).toBe(60);
    expect(decision.message).toMatch(/\$60\.00/);
  });

  it('treats an already-overspent day as nothing left, never as negative', () => {
    // Limits can be lowered after the fact, so spend can exceed the limit.
    const spent: AgentSpending = { last24hUsd: 250, lifetimeUsd: 250 };
    const decision = checkAgentLimits('active', limits, spent, 1);
    expect(decision.reason).toBe('daily_limit');
    expect(decision.remainingUsd).toBe(0);
  });
});

describe('total limit', () => {
  const limits: AgentLimits = { perPaymentUsd: null, dailyUsd: null, totalUsd: 500 };

  it('counts lifetime spend, not the last day', () => {
    const spent: AgentSpending = { last24hUsd: 0, lifetimeUsd: 495 };
    expect(checkAgentLimits('active', limits, spent, 5).allowed).toBe(true);
    expect(checkAgentLimits('active', limits, spent, 5.01).reason).toBe('total_limit');
  });
});

describe('which limit is reported when several would stop it', () => {
  it('names the per-payment limit first, because paying less fixes it now', () => {
    const limits: AgentLimits = { perPaymentUsd: 5, dailyUsd: 10, totalUsd: 20 };
    const spent: AgentSpending = { last24hUsd: 9, lifetimeUsd: 19 };
    expect(checkAgentLimits('active', limits, spent, 100).reason).toBe('per_payment_limit');
  });

  it('names the daily limit before the lifetime one, as it clears soonest', () => {
    const limits: AgentLimits = { perPaymentUsd: null, dailyUsd: 10, totalUsd: 20 };
    const spent: AgentSpending = { last24hUsd: 10, lifetimeUsd: 20 };
    expect(checkAgentLimits('active', limits, spent, 1).reason).toBe('daily_limit');
  });
});

describe('amounts that are not really amounts', () => {
  const limits: AgentLimits = { perPaymentUsd: 10, dailyUsd: 10, totalUsd: 10 };

  it('refuses NaN rather than letting it past every comparison', () => {
    // NaN compares false against every limit, so an unguarded check would have
    // allowed it. This is the one input that must not be trusted.
    expect(checkAgentLimits('active', limits, nothingSpent, Number.NaN).allowed).toBe(false);
    expect(checkAgentLimits('active', limits, nothingSpent, Number.POSITIVE_INFINITY).allowed).toBe(
      false,
    );
  });

  it('refuses a negative amount, which would otherwise credit the allowance', () => {
    expect(checkAgentLimits('active', limits, nothingSpent, -50).allowed).toBe(false);
  });

  it('allows zero, because it moves nothing', () => {
    expect(checkAgentLimits('active', limits, nothingSpent, 0).allowed).toBe(true);
  });
});

describe('remainingAllowanceUsd', () => {
  it('is the smallest of the three remainders', () => {
    const limits: AgentLimits = { perPaymentUsd: 50, dailyUsd: 100, totalUsd: 1_000 };
    const spent: AgentSpending = { last24hUsd: 80, lifetimeUsd: 200 };
    // per-payment 50, daily 20 left, total 800 left -> 20 is the binding one.
    expect(remainingAllowanceUsd('active', limits, spent)).toBe(20);
  });

  it('is zero for an agent that is not active, whatever its limits say', () => {
    const limits: AgentLimits = { perPaymentUsd: 50, dailyUsd: 100, totalUsd: 1_000 };
    expect(remainingAllowanceUsd('paused', limits, nothingSpent)).toBe(0);
    expect(remainingAllowanceUsd('revoked', limits, nothingSpent)).toBe(0);
  });

  it('agrees with the decision it summarises', () => {
    const limits: AgentLimits = { perPaymentUsd: null, dailyUsd: 100, totalUsd: null };
    const spent: AgentSpending = { last24hUsd: 70, lifetimeUsd: 70 };
    const remaining = remainingAllowanceUsd('active', limits, spent);
    expect(remaining).toBe(30);
    expect(checkAgentLimits('active', limits, spent, remaining!).allowed).toBe(true);
    expect(checkAgentLimits('active', limits, spent, remaining! + 0.01).allowed).toBe(false);
  });
});
