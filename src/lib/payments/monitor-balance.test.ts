import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkBalance, primeSolanaBalances, processPayment, resetSolBalanceCache } from './monitor-balance';

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

/**
 * BL-01 (High, 2026-08-19 audit).
 *
 * Every balance lookup answered `{ balance: 0 }` on an RPC error, exactly as it
 * does for an address that has genuinely received nothing. `processPayment`
 * acted on that: a payment past its expiry window at the moment a provider
 * happened to be down was marked `expired` even though the customer had paid in
 * full. No attacker required, and no automatic recovery — the funds sat at an
 * address belonging to a payment the platform had written off.
 */
describe('processPayment expiry', () => {
  const mockFetch = vi.fn();

  function makeSupabase() {
    const updates: Array<Record<string, unknown>> = [];
    const client = {
      from: () => ({
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          const query = {
            eq: () => query,
            select: () => query,
            maybeSingle: async () => ({ data: { id: 'pay-1' }, error: null }),
          };
          return query;
        },
      }),
    };
    return { client: client as never, updates };
  }

  const expiredPayment = {
    id: 'pay-1',
    payment_address: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
    blockchain: 'SOL',
    crypto_amount: '1.5',
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  };

  beforeEach(() => {
    resetSolBalanceCache();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not expire a payment whose balance could not be read', async () => {
    // The provider is down. Nothing here says the customer did not pay.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => 'Connection rate limits exceeded',
    });

    const { client, updates } = makeSupabase();
    const result = await processPayment(client, expiredPayment as never);

    expect(result.expired).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('still expires a payment the chain confirms is unpaid', async () => {
    mockFetch.mockResolvedValue(jsonOk({ result: { value: 0 } }));

    const { client, updates } = makeSupabase();
    const result = await processPayment(client, expiredPayment as never);

    expect(result.expired).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe('expired');
  });
});

/**
 * #290.
 *
 * A SOL invoice settled with nothing behind it: the payment reported
 * `confirmed`, `tx_hash` was null, and `getSignaturesForAddress` returned an
 * empty result for the derived address. The funding-signature lookup was
 * best-effort — a failed lookup, a malformed answer and "this address has never
 * been transacted with" all fell through to the same `{ balance, txHash:
 * undefined }`, and a settling balance confirmed the payment with no evidence
 * that any money had arrived.
 *
 * Lamports only reach an address by transaction, so a positive balance next to
 * an empty signature list is two RPC reads contradicting each other. Neither is
 * worth settling on.
 */
describe('SOL settlement requires a funding transaction', () => {
  const mockFetch = vi.fn();

  function makeSupabase() {
    const updates: Array<Record<string, unknown>> = [];
    const client = {
      from: () => ({
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          const query = {
            eq: () => query,
            select: () => query,
            maybeSingle: async () => ({ data: { id: 'pay-290' }, error: null }),
          };
          return query;
        },
      }),
    };
    return { client: client as never, updates };
  }

  /** Answers `getBalance` with `lamports` and `getSignaturesForAddress` with `signatures`. */
  function mockChain(lamports: number, signatures: unknown) {
    mockFetch.mockImplementation(async (_url: string, init: any) => {
      const { method } = JSON.parse(init.body);
      if (method === 'getSignaturesForAddress') {
        if (signatures === 'unavailable') {
          return { ok: false, status: 503, json: async () => ({}), text: async () => 'upstream down' };
        }
        return jsonOk({ result: signatures });
      }
      return jsonOk({ result: { value: lamports } });
    });
  }

  const pendingPayment = {
    id: 'pay-290',
    payment_address: ADDRESSES[0],
    blockchain: 'SOL',
    crypto_amount: '1.5',
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  };

  beforeEach(() => {
    resetSolBalanceCache();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports a balance with no funding transaction as unreadable', async () => {
    mockChain(1_500_000_000, []);

    const result = await checkBalance(ADDRESSES[0], 'SOL');

    expect(result.balance).toBe(0);
    expect(result.error).toMatch(/no funding transaction/);
  });

  it('does not confirm a payment whose balance no transaction delivered', async () => {
    mockChain(1_500_000_000, []);
    const { client, updates } = makeSupabase();

    const result = await processPayment(client, pendingPayment as never);

    expect(result.confirmed).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('does not expire that payment either — the reading is what is in doubt', async () => {
    mockChain(1_500_000_000, []);
    const { client, updates } = makeSupabase();

    const result = await processPayment(
      client,
      { ...pendingPayment, expires_at: new Date(Date.now() - 60_000).toISOString() } as never
    );

    expect(result.expired).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('refuses to settle when the signature lookup itself fails', async () => {
    mockChain(1_500_000_000, 'unavailable');

    const result = await checkBalance(ADDRESSES[0], 'SOL');

    expect(result.balance).toBe(0);
    expect(result.error).toMatch(/signature lookup 503/);
  });

  it('refuses to settle on a signature response that is not a list', async () => {
    // An RPC-level error body carries no `result` array. That is the lookup
    // failing, not the chain saying the address is untouched.
    mockChain(1_500_000_000, undefined);

    const result = await checkBalance(ADDRESSES[0], 'SOL');

    expect(result.balance).toBe(0);
    expect(result.error).toMatch(/no result/);
  });

  it('still settles a genuinely funded address, and records its tx hash', async () => {
    // The control: the fix must not make real payments unsettleable.
    mockChain(1_500_000_000, [{ signature: 'sig-real' }]);
    const { client, updates } = makeSupabase();

    const balanceResult = await checkBalance(ADDRESSES[0], 'SOL');
    expect(balanceResult.balance).toBe(1.5);
    expect(balanceResult.txHash).toBe('sig-real');
    expect(balanceResult.error).toBeUndefined();

    const result = await processPayment(client, pendingPayment as never);

    expect(result.confirmed).toBe(true);
    expect(updates[0]).toMatchObject({ status: 'confirmed', tx_hash: 'sig-real' });
  });

  it('applies to the primed path too, which is how the monitor reads balances', async () => {
    // A cycle primes balances in one batched call; the per-address check then
    // reads the cache. Both paths share `solanaBalanceResult`, so the evidence
    // requirement has to hold on the primed side as well.
    mockFetch.mockResolvedValueOnce(
      jsonOk({ jsonrpc: '2.0', result: { value: [{ lamports: 1_500_000_000 }] }, id: 1 })
    );
    await primeSolanaBalances([ADDRESSES[0]], 'https://rpc.example');

    mockFetch.mockResolvedValue(jsonOk({ jsonrpc: '2.0', result: [], id: 1 }));

    const result = await checkBalance(ADDRESSES[0], 'SOL');

    expect(result.balance).toBe(0);
    expect(result.error).toMatch(/no funding transaction/);
  });
});

describe('processPayment transition ownership', () => {
  const mockFetch = vi.fn();
  const forwardUrl = 'http://monitor.example/api/payments/pay-cas/forward';
  const payment = {
    id: 'pay-cas',
    business_id: 'business-cas',
    blockchain: 'ETH',
    crypto_amount: 1,
    payment_address: '0x1111111111111111111111111111111111111111',
    merchant_wallet_address: '0x2222222222222222222222222222222222222222',
    created_at: '2026-01-01T00:00:00Z',
    expires_at: '2020-01-01T00:00:00Z',
  };
  const paths = [
    { name: 'expiry without an address', address: '', balance: '0x0', status: 'expired' },
    { name: 'expiry after an unpaid balance', address: payment.payment_address, balance: '0x0', status: 'expired' },
    { name: 'confirmation', address: payment.payment_address, balance: '0xde0b6b3a7640000', status: 'confirmed' },
  ];

  function makeSupabase(data: { id: string } | null, error: { message: string } | null = null) {
    const query = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    };
    const update = vi.fn().mockReturnValue(query);
    const client = { from: vi.fn().mockReturnValue({ update }) };
    return { client, query, update };
  }

  function mockChain(balance: string) {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === forwardUrl) return jsonOk({ success: true });
      return jsonOk({ result: balance });
    });
  }

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    vi.stubEnv('INTERNAL_API_KEY', 'synthetic-monitor-test-key');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://monitor.example');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(paths)('does not report or forward a lost CAS for $name', async ({ address, balance }) => {
    mockChain(balance);
    const { client, query } = makeSupabase(null);

    const result = await processPayment(client, { ...payment, payment_address: address } as never);

    expect(result).toEqual({ confirmed: false, expired: false });
    expect(query.eq.mock.calls).toEqual([['id', payment.id], ['status', 'pending']]);
    expect(query.select).toHaveBeenCalledWith('id');
    expect(query.maybeSingle).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls.filter(([url]) => url === forwardUrl)).toHaveLength(0);
  });

  it.each(paths)('surfaces a database error without forwarding for $name', async ({ address, balance }) => {
    mockChain(balance);
    const { client } = makeSupabase(null, { message: 'synthetic database write failure' });

    await expect(processPayment(client, { ...payment, payment_address: address } as never))
      .rejects.toThrow('synthetic database write failure');
    expect(mockFetch.mock.calls.filter(([url]) => url === forwardUrl)).toHaveLength(0);
  });

  it.each(paths.slice(0, 2))('reports a winning CAS for $name', async ({ address, balance }) => {
    mockChain(balance);
    const { client, query, update } = makeSupabase({ id: payment.id });

    const result = await processPayment(client, { ...payment, payment_address: address } as never);

    expect(result).toEqual({ confirmed: false, expired: true });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }));
    expect(query.eq.mock.calls).toEqual([['id', payment.id], ['status', 'pending']]);
    expect(query.maybeSingle).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls.filter(([url]) => url === forwardUrl)).toHaveLength(0);
  });

  it('forwards exactly once when one confirmation wins and a stale snapshot loses', async () => {
    mockChain('0xde0b6b3a7640000');
    const { client, query } = makeSupabase(null);
    query.maybeSingle.mockResolvedValueOnce({ data: { id: payment.id }, error: null });

    expect(await processPayment(client, payment as never)).toEqual({ confirmed: true, expired: false });
    expect(await processPayment(client, payment as never)).toEqual({ confirmed: false, expired: false });

    expect(query.maybeSingle).toHaveBeenCalledTimes(2);
    expect(query.eq.mock.calls).toEqual([
      ['id', payment.id], ['status', 'pending'],
      ['id', payment.id], ['status', 'pending'],
    ]);
    const forwards = mockFetch.mock.calls.filter(([url]) => url === forwardUrl);
    expect(forwards).toHaveLength(1);
    expect(forwards[0][1]).toMatchObject({
      method: 'POST', headers: { Authorization: 'Bearer synthetic-monitor-test-key' },
    });
  });
});
