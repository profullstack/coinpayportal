import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screenCheckout } from './screen';

/**
 * Regression tests for FR-01 (2026-08-19 audit).
 *
 * Screening failed OPEN: any error anywhere in the pipeline returned
 * `decision: 'allow'`, and `checkBlocklist` returned the same `null` for a
 * database error as for "no entry matches" — so an unreachable blocklist waved
 * through every entry on it, entries usually added after a real chargeback.
 *
 * The reasoning behind failing open was sound — a broken fraud check must not
 * become a payment outage — but `allow` was the wrong conclusion. `verify`
 * keeps payments flowing while forcing 3-D Secure, which moves liability for a
 * stolen card back to the issuer.
 */

/**
 * Supabase double. `mode` picks which part of the pipeline breaks.
 */
function makeSupabase(mode: 'ok' | 'blocklist-error' | 'throw') {
  const table = (name: string) => {
    if (name === 'fraud_blocklist') {
      return {
        select: () => ({
          in: async () =>
            mode === 'blocklist-error'
              ? { data: null, error: { message: 'connection refused' } }
              : { data: [], error: null },
        }),
      };
    }

    // Everything else answers empty so scoring runs on a clean slate.
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'lte', 'in', 'order', 'limit', 'not']) {
      chain[m] = () => chain;
    }
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.single = async () => ({ data: null, error: null });
    chain.insert = async () => ({ error: null });
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve);
    return chain;
  };

  return {
    from: (name: string) => {
      if (mode === 'throw') throw new Error('database is on fire');
      return table(name);
    },
  } as never;
}

const INPUT = {
  businessId: 'biz-1',
  email: 'buyer@example.com',
  ip: '203.0.113.10',
  amount: 100,
  currency: 'USD',
  description: 'A thing',
};

describe('screenCheckout failure behaviour', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('degrades to 3DS rather than allowing when screening throws', async () => {
    const result = await screenCheckout(makeSupabase('throw'), INPUT);

    // The finding in one assertion: this used to be 'allow'.
    expect(result.decision).toBe('verify');
    expect(result.decision).not.toBe('allow');
  });

  it('does not treat an unreadable blocklist as a clean result', async () => {
    const result = await screenCheckout(makeSupabase('blocklist-error'), INPUT);

    expect(result.decision).not.toBe('allow');
  });

  it('still allows an ordinary checkout when everything is reachable', async () => {
    // The fail-safe must not become a permanent 3DS tax on legitimate traffic.
    const result = await screenCheckout(makeSupabase('ok'), INPUT);

    expect(result.decision).toBe('allow');
  });
});
