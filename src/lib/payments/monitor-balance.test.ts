import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkBalance, primeSolanaBalances, resetSolBalanceCache } from './monitor-balance';

/**
 * The failure these guard: the monitor checked pending payments one at a time
 * and each SOL payment cost its own `getBalance` call. Roughly 50 pending
 * payments every 15 seconds sat permanently on Solana's public-endpoint limit,
 * so nearly every balance check came back "Connection rate limits exceeded" —
 * and a rate-limited check reports a funded address as empty.
 */

const ADDRESSES = [
  '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
  'BxtftDrpgc8PwqWmuaBYW2ofBcwoQh9WS2rq5ern1Z98',
  '3xd6Zs25BRV67cVo5MEHyYZzEaAq9RWNUpFHDn3Q44ed',
];

function jsonOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => '' };
}

describe('primeSolanaBalances', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    resetSolBalanceCache();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches a whole cycle of addresses in one RPC call', async () => {
    mockFetch.mockResolvedValue(
      jsonOk({ jsonrpc: '2.0', result: { value: ADDRESSES.map(() => ({ lamports: 0 })) }, id: 1 })
    );

    await primeSolanaBalances(ADDRESSES, 'https://rpc.example');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe('getMultipleAccounts');
    expect(body.params[0]).toEqual(ADDRESSES);
  });

  it('serves primed balances without another RPC call', async () => {
    mockFetch.mockResolvedValue(
      jsonOk({
        jsonrpc: '2.0',
        result: { value: [{ lamports: 0 }, { lamports: 0 }, { lamports: 0 }] },
        id: 1,
      })
    );
    await primeSolanaBalances(ADDRESSES, 'https://rpc.example');
    mockFetch.mockClear();

    for (const address of ADDRESSES) {
      const result = await checkBalance(address, 'SOL');
      expect(result.balance).toBe(0);
    }

    // Three balance checks, zero extra requests — the whole point.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reports a primed non-zero balance in SOL, not lamports', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonOk({ jsonrpc: '2.0', result: { value: [{ lamports: 1_500_000_000 }] }, id: 1 })
    );
    await primeSolanaBalances([ADDRESSES[0]], 'https://rpc.example');

    // Funded addresses still look up their signature, which is a small
    // fraction of the pending set.
    mockFetch.mockResolvedValue(
      jsonOk({ jsonrpc: '2.0', result: [{ signature: 'sig-1' }], id: 1 })
    );

    const result = await checkBalance(ADDRESSES[0], 'SOL');
    expect(result.balance).toBe(1.5);
    expect(result.txHash).toBe('sig-1');
  });

  it('treats a missing account as an empty address', async () => {
    // getMultipleAccounts returns null for accounts that do not exist yet,
    // which for a payment address just means nothing has arrived.
    mockFetch.mockResolvedValue(
      jsonOk({ jsonrpc: '2.0', result: { value: [null] }, id: 1 })
    );
    await primeSolanaBalances([ADDRESSES[0]], 'https://rpc.example');
    mockFetch.mockClear();

    const result = await checkBalance(ADDRESSES[0], 'SOL');
    expect(result.balance).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('chunks past the 100-account limit rather than sending one huge request', async () => {
    mockFetch.mockImplementation(async (_url: string, init: any) => {
      const ids = JSON.parse(init.body).params[0] as string[];
      return jsonOk({ jsonrpc: '2.0', result: { value: ids.map(() => ({ lamports: 0 })) }, id: 1 });
    });

    const many = Array.from({ length: 250 }, (_, i) => `addr-${i}`);
    await primeSolanaBalances(many, 'https://rpc.example');

    expect(mockFetch).toHaveBeenCalledTimes(3);
    for (const call of mockFetch.mock.calls) {
      expect(JSON.parse(call[1].body).params[0].length).toBeLessThanOrEqual(100);
    }
  });

  it('falls back to a single lookup when priming fails', async () => {
    // A failed prime is an optimisation miss, not an outage — the per-address
    // path must still work.
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limited' });
    await primeSolanaBalances([ADDRESSES[0]], 'https://rpc.example');
    mockFetch.mockClear();

    mockFetch.mockResolvedValue(
      jsonOk({ jsonrpc: '2.0', result: { value: 0 }, id: 1 })
    );
    const result = await checkBalance(ADDRESSES[0], 'SOL');

    expect(result.balance).toBe(0);
    expect(mockFetch).toHaveBeenCalled();
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).method).toBe('getBalance');
  });

  it('ignores duplicate and empty addresses', async () => {
    mockFetch.mockImplementation(async (_url: string, init: any) => {
      const ids = JSON.parse(init.body).params[0] as string[];
      return jsonOk({ jsonrpc: '2.0', result: { value: ids.map(() => ({ lamports: 0 })) }, id: 1 });
    });

    await primeSolanaBalances([ADDRESSES[0], ADDRESSES[0], '', ADDRESSES[1]], 'https://rpc.example');

    expect(JSON.parse(mockFetch.mock.calls[0][1].body).params[0]).toEqual([
      ADDRESSES[0],
      ADDRESSES[1],
    ]);
  });

  it('does nothing at all when there is nothing to prime', async () => {
    await primeSolanaBalances([], 'https://rpc.example');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
