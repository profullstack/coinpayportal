import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authoriseAgentSpend, recordAgentSpend } from './authorise';
import { normaliseAddress, usdFromTokenUnits } from './store';

const AGENT_ADDRESS = '0x46e9322933cc873b40535f9574357a97adee6c79';

interface FakeAgent {
  id?: string;
  name?: string;
  status?: string;
  per_payment_limit_usd?: number | null;
  daily_limit_usd?: number | null;
  total_limit_usd?: number | null;
}

/**
 * A Supabase stand-in with just the two tables this code touches. Written by
 * hand rather than mocked wholesale so the shape of every call it makes is
 * visible in the test.
 */
function fakeSupabase(options: {
  agent?: FakeAgent | null;
  spends?: { amount_usd: number; created_at: string }[];
  agentLookupFails?: boolean;
  insertFails?: boolean;
}) {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      if (table === 'agent_wallets') {
        return {
          select: () => ({
            eq: (_column: string, value: string) => ({
              maybeSingle: async () => {
                if (options.agentLookupFails) return { data: null, error: new Error('down') };
                if (!options.agent || value !== AGENT_ADDRESS) return { data: null, error: null };
                return {
                  data: {
                    id: options.agent.id ?? 'agent-1',
                    business_id: 'biz-1',
                    name: options.agent.name ?? 'crawler',
                    address: AGENT_ADDRESS,
                    status: options.agent.status ?? 'active',
                    // numeric arrives as a string from PostgREST
                    per_payment_limit_usd:
                      options.agent.per_payment_limit_usd == null
                        ? null
                        : String(options.agent.per_payment_limit_usd),
                    daily_limit_usd:
                      options.agent.daily_limit_usd == null
                        ? null
                        : String(options.agent.daily_limit_usd),
                    total_limit_usd:
                      options.agent.total_limit_usd == null
                        ? null
                        : String(options.agent.total_limit_usd),
                    created_at: '2026-09-01T00:00:00Z',
                    updated_at: '2026-09-01T00:00:00Z',
                  },
                  error: null,
                };
              },
            }),
          }),
        };
      }
      if (table === 'agent_spends') {
        return {
          select: () => ({
            eq: async () => ({ data: options.spends ?? [], error: null }),
          }),
          insert: async (row: Record<string, unknown>) => {
            if (options.insertFails) throw new Error('ledger down');
            inserted.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client: client as unknown as SupabaseClient, inserted };
}

const recently = () => new Date(Date.now() - 60_000).toISOString();
const longAgo = () => new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString();

describe('a payer that is not an agent', () => {
  it('is allowed through untouched', async () => {
    const { client } = fakeSupabase({ agent: null });
    const decision = await authoriseAgentSpend(client, {
      payer: '0xsomeoneelse',
      amountUnits: 1_000_000n,
      network: 'base',
    });
    expect(decision.allowed).toBe(true);
    expect(decision.agentId).toBeNull();
  });

  it('is what a database failure resolves to, so an outage cannot stop payments', async () => {
    const { client } = fakeSupabase({ agent: { daily_limit_usd: 1 }, agentLookupFails: true });
    const decision = await authoriseAgentSpend(client, {
      payer: AGENT_ADDRESS,
      amountUnits: 999_000_000n,
      network: 'base',
    });
    expect(decision.allowed).toBe(true);
  });
});

describe('a registered agent', () => {
  it('is found whatever case the proof spells its address in', async () => {
    const { client } = fakeSupabase({ agent: { daily_limit_usd: 10 } });
    const decision = await authoriseAgentSpend(client, {
      payer: '  0x46E9322933CC873B40535F9574357A97ADEE6C79  ',
      amountUnits: 1_000_000n,
      network: 'base',
    });
    expect(decision.agentId).toBe('agent-1');
    expect(decision.allowed).toBe(true);
  });

  it('is refused once the day is spent, and told what is left', async () => {
    const { client } = fakeSupabase({
      agent: { daily_limit_usd: 10 },
      spends: [{ amount_usd: 9.5, created_at: recently() }],
    });
    const decision = await authoriseAgentSpend(client, {
      payer: AGENT_ADDRESS,
      amountUnits: 1_000_000n, // $1.00
      network: 'base',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('daily_limit');
    expect(decision.remainingUsd).toBeCloseTo(0.5, 2);
  });

  it('does not count a spend that has aged out of the rolling day', async () => {
    const { client } = fakeSupabase({
      agent: { daily_limit_usd: 10 },
      spends: [{ amount_usd: 9.5, created_at: longAgo() }],
    });
    const decision = await authoriseAgentSpend(client, {
      payer: AGENT_ADDRESS,
      amountUnits: 1_000_000n,
      network: 'base',
    });
    expect(decision.allowed).toBe(true);
  });

  it('still counts that old spend against a lifetime limit', async () => {
    const { client } = fakeSupabase({
      agent: { total_limit_usd: 10 },
      spends: [{ amount_usd: 9.5, created_at: longAgo() }],
    });
    const decision = await authoriseAgentSpend(client, {
      payer: AGENT_ADDRESS,
      amountUnits: 1_000_000n,
      network: 'base',
    });
    expect(decision.reason).toBe('total_limit');
  });

  it('is refused while paused, whatever it has left', async () => {
    const { client } = fakeSupabase({ agent: { status: 'paused', daily_limit_usd: 1_000 } });
    const decision = await authoriseAgentSpend(client, {
      payer: AGENT_ADDRESS,
      amountUnits: 1_000_000n,
      network: 'base',
    });
    expect(decision.reason).toBe('agent_paused');
  });

  it('is refused an amount it cannot price, rather than waved through', async () => {
    const { client } = fakeSupabase({ agent: { daily_limit_usd: 1_000 } });
    const decision = await authoriseAgentSpend(client, {
      payer: AGENT_ADDRESS,
      amountUnits: 'not-a-number',
      network: 'base',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('unpriceable_asset');
  });
});

describe('recordAgentSpend', () => {
  it('writes the spend with its nonce, so a retry cannot double-count', async () => {
    const { client, inserted } = fakeSupabase({ agent: { daily_limit_usd: 10 } });
    const decision = await authoriseAgentSpend(client, {
      payer: AGENT_ADDRESS,
      amountUnits: 2_500_000n,
      network: 'base',
      nonce: '0xnonce',
    });
    await recordAgentSpend(client, decision, '0xtx');
    expect(inserted).toEqual([
      {
        agent_wallet_id: 'agent-1',
        amount_usd: 2.5,
        network: 'base',
        nonce: '0xnonce',
        tx_hash: '0xtx',
      },
    ]);
  });

  it('writes nothing for a payer that was not an agent', async () => {
    const { client, inserted } = fakeSupabase({ agent: null });
    const decision = await authoriseAgentSpend(client, {
      payer: '0xsomeoneelse',
      amountUnits: 1_000_000n,
      network: 'base',
    });
    await recordAgentSpend(client, decision, '0xtx');
    expect(inserted).toEqual([]);
  });

  it('never throws, because the money has already moved by then', async () => {
    const { client } = fakeSupabase({ agent: { daily_limit_usd: 10 }, insertFails: true });
    const decision = await authoriseAgentSpend(client, {
      payer: AGENT_ADDRESS,
      amountUnits: 1_000_000n,
      network: 'base',
      nonce: '0xnonce',
    });
    // A throw here would surface as a settle failure and invite a retry, and
    // the retry is what would double-spend.
    await expect(recordAgentSpend(client, decision, '0xtx')).resolves.toBeUndefined();
  });
});

describe('usdFromTokenUnits', () => {
  it('reads six-decimal USDC as dollars', () => {
    expect(usdFromTokenUnits(1_000_000n)).toBe(1);
    expect(usdFromTokenUnits('2500000')).toBe(2.5);
    expect(usdFromTokenUnits(0n)).toBe(0);
  });

  it('rounds a sub-cent tail to the nearest cent', () => {
    expect(usdFromTokenUnits(1_004_900n)).toBe(1.0);
    expect(usdFromTokenUnits(1_005_000n)).toBe(1.01);
  });

  it('refuses anything it cannot price, rather than guessing', () => {
    expect(usdFromTokenUnits('twelve')).toBeNull();
    expect(usdFromTokenUnits(-1n)).toBeNull();
    expect(usdFromTokenUnits(1_000_000n, 18)).toBeNull();
  });

  it('does not lose precision on an amount too large for a double', () => {
    // 10 trillion USDC in micro-units exceeds Number.MAX_SAFE_INTEGER, which is
    // why the division happens in BigInt before it ever becomes a number.
    expect(usdFromTokenUnits(10_000_000_000_000_000_000n)).toBe(10_000_000_000_000);
  });
});

describe('normaliseAddress', () => {
  it('folds case and trims, so a lookup is an equality test', () => {
    expect(normaliseAddress('  0xAbC  ')).toBe('0xabc');
  });
});
