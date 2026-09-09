import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The polling set for wallet transactions had no age bound, so a transaction
 * that was never mined stayed in it forever and cost RPC calls on every cycle
 * of every replica. These cover the bound that retires it.
 */

const ORIGINAL_ENV = { ...process.env };

interface Recorded {
  gte: Array<[string, string]>;
  lt: Array<[string, string]>;
}

/**
 * Minimal PostgREST-shaped mock. The select page resolves on `.order()` (the
 * last call in the cycle's query); the head/count query resolves on `.lt()`.
 */
function makeSupabase(rows: unknown[], staleCount: number) {
  const recorded: Recorded = { gte: [], lt: [] };

  const makeChain = (): any => {
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'limit', 'update', 'eq']) {
      chain[m] = vi.fn(() => chain);
    }
    chain.gte = vi.fn((col: string, val: string) => {
      recorded.gte.push([col, val]);
      return chain;
    });
    chain.lt = vi.fn((col: string, val: string) => {
      recorded.lt.push([col, val]);
      // The stale-count query ends here.
      return Object.assign(Promise.resolve({ count: staleCount, error: null }), chain);
    });
    chain.order = vi.fn(() => Promise.resolve({ data: rows, error: null }));
    return chain;
  };

  return { supabase: { from: vi.fn(() => makeChain()) }, recorded };
}

const FRESH_HASH = '0xfeed0000000000000000000000000000000000000000000000000000000000ff';

describe('runWalletTxCycle age bound', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ETHEREUM_RPC_URL: 'https://rpc.test/eth' };
    global.fetch = vi.fn();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('bounds the polled set to the last 24 hours by default', async () => {
    const { runWalletTxCycle } = await import('./tx-finalize');
    const { supabase, recorded } = makeSupabase([], 0);

    const before = Date.now();
    await runWalletTxCycle(supabase);
    const after = Date.now();

    const createdAtBound = recorded.gte.find(([col]) => col === 'created_at');
    expect(createdAtBound).toBeDefined();

    const cutoff = new Date(createdAtBound![1]).getTime();
    const DAY = 24 * 60 * 60 * 1000;
    expect(cutoff).toBeGreaterThanOrEqual(before - DAY - 5_000);
    expect(cutoff).toBeLessThanOrEqual(after - DAY + 5_000);
  });

  it('honours WALLET_TX_MAX_TRACKING_MS', async () => {
    process.env.WALLET_TX_MAX_TRACKING_MS = String(60 * 60 * 1000); // 1h
    const { runWalletTxCycle } = await import('./tx-finalize');
    const { supabase, recorded } = makeSupabase([], 0);

    const before = Date.now();
    await runWalletTxCycle(supabase);

    const cutoff = new Date(recorded.gte.find(([c]) => c === 'created_at')![1]).getTime();
    expect(cutoff).toBeGreaterThan(before - 2 * 60 * 60 * 1000);
    expect(cutoff).toBeLessThanOrEqual(before - 60 * 60 * 1000 + 5_000);
  });

  it('reports how many rows it is deliberately not polling', async () => {
    const { runWalletTxCycle } = await import('./tx-finalize');
    const { supabase, recorded } = makeSupabase([], 219);

    const stats = await runWalletTxCycle(supabase);

    expect(stats.staleSkipped).toBe(219);
    // The count query bounds on the other side of the same cutoff.
    expect(recorded.lt.some(([col]) => col === 'created_at')).toBe(true);
  });

  it('spends no RPC calls when every matching row is stale', async () => {
    const { runWalletTxCycle } = await import('./tx-finalize');
    // The age bound already excluded them, so the page comes back empty.
    const { supabase } = makeSupabase([], 219);

    const stats = await runWalletTxCycle(supabase);

    expect(stats.checked).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('still polls a transaction inside the window', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ result: null }), // not yet mined
    });

    const { runWalletTxCycle } = await import('./tx-finalize');
    const { supabase } = makeSupabase(
      [{ id: 'a', wallet_id: 'w', chain: 'ETH', tx_hash: FRESH_HASH, status: 'pending', confirmations: 0, metadata: null }],
      0
    );

    const stats = await runWalletTxCycle(supabase);

    expect(stats.checked).toBe(1);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('a stale-count failure does not take the cycle down', async () => {
    const { runWalletTxCycle } = await import('./tx-finalize');
    const { supabase } = makeSupabase([], 0);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Make only the head/count query throw.
    let call = 0;
    (supabase.from as any).mockImplementation(() => {
      call++;
      const chain: any = {};
      for (const m of ['select', 'in', 'not', 'limit', 'gte']) chain[m] = vi.fn(() => chain);
      chain.order = vi.fn(() => Promise.resolve({ data: [], error: null }));
      chain.lt = vi.fn(() => {
        throw new Error('count exploded');
      });
      return chain;
    });

    await expect(runWalletTxCycle(supabase)).resolves.toMatchObject({ staleSkipped: 0 });
    expect(call).toBeGreaterThan(0);
  });
});
