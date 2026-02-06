import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchBalance,
  getAddressBalance,
  getWalletBalances,
  _formatBigIntDecimal,
  CACHE_TTL_SECONDS,
} from './balance';

// ──────────────────────────────────────────────
// Mock fetch
// ──────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ──────────────────────────────────────────────
// Mock supabase
// ──────────────────────────────────────────────

function createMockSupabase(overrides: Record<string, any> = {}) {
  const chainResult = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    ...overrides,
  };

  return chainResult;
}

// ──────────────────────────────────────────────
// formatBigIntDecimal
// ──────────────────────────────────────────────

describe('formatBigIntDecimal', () => {
  it('should format zero', () => {
    expect(_formatBigIntDecimal(0n, 18)).toBe('0');
  });

  it('should format 1 ETH (1e18 wei)', () => {
    expect(_formatBigIntDecimal(1000000000000000000n, 18)).toBe('1');
  });

  it('should format 1.5 ETH', () => {
    expect(_formatBigIntDecimal(1500000000000000000n, 18)).toBe('1.5');
  });

  it('should format small amounts', () => {
    // 0.001 ETH = 1e15 wei
    expect(_formatBigIntDecimal(1000000000000000n, 18)).toBe('0.001');
  });

  it('should trim trailing zeros', () => {
    // 1.100000 should be 1.1
    expect(_formatBigIntDecimal(1100000n, 6)).toBe('1.1');
  });

  it('should format USDC (6 decimals)', () => {
    // 100 USDC = 100000000
    expect(_formatBigIntDecimal(100000000n, 6)).toBe('100');
    // 1.50 USDC = 1500000
    expect(_formatBigIntDecimal(1500000n, 6)).toBe('1.5');
    // 0.01 USDC = 10000
    expect(_formatBigIntDecimal(10000n, 6)).toBe('0.01');
  });
});

// ──────────────────────────────────────────────
// fetchBalance - BTC
// ──────────────────────────────────────────────

describe('fetchBalance', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('BTC', () => {
    it('should fetch BTC balance from Blockstream', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          chain_stats: { funded_txo_sum: 150000000, spent_txo_sum: 50000000 },
        }),
      });

      const result = await fetchBalance('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'BTC');
      expect(result).toBe('1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('blockstream.info/api/address/')
      );
    });

    it('should return 0 for empty BTC address', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        }),
      });

      const result = await fetchBalance('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'BTC');
      expect(result).toBe('0');
    });

    it('should throw on BTC API failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      await expect(fetchBalance('addr', 'BTC')).rejects.toThrow('BTC balance fetch failed');
    });
  });

  // ──────────────────────────────────────────────
  // ETH
  // ──────────────────────────────────────────────

  describe('ETH', () => {
    it('should fetch ETH balance via JSON-RPC', async () => {
      // 1 ETH = 0xDE0B6B3A7640000 in hex (1e18)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0xde0b6b3a7640000', id: 1 }),
      });

      const result = await fetchBalance('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28', 'ETH');
      expect(result).toBe('1');
    });

    it('should handle zero ETH balance', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x0', id: 1 }),
      });

      const result = await fetchBalance('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28', 'ETH');
      expect(result).toBe('0');
    });

    it('should throw on RPC error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', error: { message: 'bad request' }, id: 1 }),
      });

      await expect(
        fetchBalance('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28', 'ETH')
      ).rejects.toThrow('RPC error');
    });
  });

  // ──────────────────────────────────────────────
  // POL
  // ──────────────────────────────────────────────

  describe('POL', () => {
    it('should fetch POL balance via JSON-RPC', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x1bc16d674ec80000', id: 1 }), // 2 POL
      });

      const result = await fetchBalance('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28', 'POL');
      expect(parseFloat(result)).toBe(2);
    });
  });

  // ──────────────────────────────────────────────
  // SOL
  // ──────────────────────────────────────────────

  describe('SOL', () => {
    it('should fetch SOL balance via JSON-RPC', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: { value: 5000000000 }, id: 1 }), // 5 SOL
      });

      const result = await fetchBalance('7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV', 'SOL');
      expect(result).toBe('5');
    });

    it('should handle zero SOL balance', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: { value: 0 }, id: 1 }),
      });

      const result = await fetchBalance('7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV', 'SOL');
      expect(result).toBe('0');
    });
  });

  // ──────────────────────────────────────────────
  // USDC_ETH (ERC-20)
  // ──────────────────────────────────────────────

  describe('USDC_ETH', () => {
    it('should fetch USDC balance via eth_call balanceOf', async () => {
      // 100 USDC = 100 * 1e6 = 100000000 = 0x5F5E100
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x0000000000000000000000000000000000000000000000000000000005f5e100', id: 1 }),
      });

      const result = await fetchBalance('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28', 'USDC_ETH');
      expect(result).toBe('100');

      // Verify eth_call was used with balanceOf selector
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.method).toBe('eth_call');
      expect(callBody.params[0].data).toMatch(/^0x70a08231/); // balanceOf selector
      expect(callBody.params[0].to).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    });

    it('should handle zero USDC balance', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x0', id: 1 }),
      });

      const result = await fetchBalance('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28', 'USDC_ETH');
      expect(result).toBe('0');
    });
  });

  // ──────────────────────────────────────────────
  // USDC_POL (ERC-20)
  // ──────────────────────────────────────────────

  describe('USDC_POL', () => {
    it('should fetch USDC on Polygon via eth_call', async () => {
      // 50.5 USDC = 50500000 = 0x30291A0
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x00000000000000000000000000000000000000000000000000000000030291a0', id: 1 }),
      });

      const result = await fetchBalance('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28', 'USDC_POL');
      expect(result).toBe('50.5');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.params[0].to).toBe('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
    });
  });

  // ──────────────────────────────────────────────
  // USDC_SOL (SPL)
  // ──────────────────────────────────────────────

  describe('USDC_SOL', () => {
    it('should fetch USDC on Solana via getTokenAccountsByOwner', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: {
            value: [
              {
                account: {
                  data: {
                    parsed: {
                      info: {
                        tokenAmount: { uiAmount: 250.5 },
                      },
                    },
                  },
                },
              },
            ],
          },
          id: 1,
        }),
      });

      const result = await fetchBalance('7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV', 'USDC_SOL');
      expect(result).toBe('250.5');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.method).toBe('getTokenAccountsByOwner');
      expect(callBody.params[1].mint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    });

    it('should return 0 when no token accounts exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: { value: [] }, id: 1 }),
      });

      const result = await fetchBalance('7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV', 'USDC_SOL');
      expect(result).toBe('0');
    });
  });

  // ──────────────────────────────────────────────
  // BCH
  // ──────────────────────────────────────────────

  describe('BCH', () => {
    it('should throw when all BCH APIs fail', async () => {
      // No API keys set, fullstack.cash returns error
      delete process.env.TATUM_API_KEY;
      delete process.env.CRYPTO_APIS_KEY;
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      await expect(
        fetchBalance('bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a', 'BCH')
      ).rejects.toThrow('All BCH balance APIs failed');
    });
  });

  // ──────────────────────────────────────────────
  // Unsupported chain
  // ──────────────────────────────────────────────

  describe('unsupported chain', () => {
    it('should throw for unknown chain', async () => {
      await expect(fetchBalance('addr', 'SHIB' as any)).rejects.toThrow('Unsupported chain');
    });
  });
});

// ──────────────────────────────────────────────
// getAddressBalance (with Supabase mock)
// ──────────────────────────────────────────────

describe('getAddressBalance', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should return cached balance when fresh', async () => {
    const freshTimestamp = new Date().toISOString();
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'addr-1',
                  wallet_id: 'w1',
                  chain: 'ETH',
                  address: '0xabc',
                  cached_balance: 1.5,
                  cached_balance_updated_at: freshTimestamp,
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as any;

    const result = await getAddressBalance(supabase, 'w1', 'addr-1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.balance).toBe('1.5');
      expect(result.data.chain).toBe('ETH');
    }
    // fetch should NOT have been called (cache is fresh)
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should refresh stale cache', async () => {
    const staleTimestamp = new Date(Date.now() - (CACHE_TTL_SECONDS + 10) * 1000).toISOString();

    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null });
    const updateFn = vi.fn().mockReturnValue({ eq: updateEq });

    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'addr-1',
                    wallet_id: 'w1',
                    chain: 'ETH',
                    address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28',
                    cached_balance: 0.5,
                    cached_balance_updated_at: staleTimestamp,
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: updateFn,
        };
      }),
    } as any;

    // Mock the ETH balance fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', result: '0xde0b6b3a7640000', id: 1 }), // 1 ETH
    });

    const result = await getAddressBalance(supabase, 'w1', 'addr-1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.balance).toBe('1');
    }
    expect(mockFetch).toHaveBeenCalled();
  });

  it('should return ADDRESS_NOT_FOUND when address does not exist', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
            }),
          }),
        }),
      }),
    } as any;

    const result = await getAddressBalance(supabase, 'w1', 'nonexistent');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('ADDRESS_NOT_FOUND');
    }
  });

  it('should return stale cache when fetch fails', async () => {
    const staleTimestamp = new Date(Date.now() - (CACHE_TTL_SECONDS + 10) * 1000).toISOString();

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'addr-1',
                  wallet_id: 'w1',
                  chain: 'ETH',
                  address: '0xabc',
                  cached_balance: 2.0,
                  cached_balance_updated_at: staleTimestamp,
                },
                error: null,
              }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({ eq: vi.fn() }),
      }),
    } as any;

    // Mock fetch failure
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await getAddressBalance(supabase, 'w1', 'addr-1');
    expect(result.success).toBe(true);
    if (result.success) {
      // Should fall back to stale cached value
      expect(result.data.balance).toBe('2');
    }
  });

  it('should force refresh when forceRefresh is true', async () => {
    const freshTimestamp = new Date().toISOString();

    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'addr-1',
                  wallet_id: 'w1',
                  chain: 'SOL',
                  address: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
                  cached_balance: 1.0,
                  cached_balance_updated_at: freshTimestamp,
                },
                error: null,
              }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({ eq: updateEq }),
      }),
    } as any;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', result: { value: 3000000000 }, id: 1 }), // 3 SOL
    });

    const result = await getAddressBalance(supabase, 'w1', 'addr-1', true);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.balance).toBe('3');
    }
    // Should have fetched despite fresh cache
    expect(mockFetch).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────
// getWalletBalances
// ──────────────────────────────────────────────

describe('getWalletBalances', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should return empty array when no addresses', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    } as any;

    const result = await getWalletBalances(supabase, 'w1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it('should return cached balances when fresh', async () => {
    const freshTimestamp = new Date().toISOString();

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'a1',
                  wallet_id: 'w1',
                  chain: 'BTC',
                  address: '1BTC...',
                  cached_balance: 0.5,
                  cached_balance_updated_at: freshTimestamp,
                  is_active: true,
                },
                {
                  id: 'a2',
                  wallet_id: 'w1',
                  chain: 'ETH',
                  address: '0xETH...',
                  cached_balance: 2.0,
                  cached_balance_updated_at: freshTimestamp,
                  is_active: true,
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    } as any;

    const result = await getWalletBalances(supabase, 'w1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].balance).toBe('0.5');
      expect(result.data[0].chain).toBe('BTC');
      expect(result.data[1].balance).toBe('2');
      expect(result.data[1].chain).toBe('ETH');
    }
    // No fetch calls needed
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should handle DB error', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB down' } }),
          }),
        }),
      }),
    } as any;

    const result = await getWalletBalances(supabase, 'w1');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('DB_ERROR');
    }
  });

  it('should filter by chain when specified', async () => {
    const freshTimestamp = new Date().toISOString();

    // Track the chain filter calls
    const eqCalls: string[] = [];
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation((col: string, val: string) => {
            eqCalls.push(`${col}=${val}`);
            return {
              eq: vi.fn().mockImplementation((col2: string, val2: any) => {
                eqCalls.push(`${col2}=${val2}`);
                // Check if this is chain filter
                if (col2 === 'chain' || eqCalls.length >= 2) {
                  return {
                    eq: vi.fn().mockResolvedValue({
                      data: [{
                        id: 'a1', wallet_id: 'w1', chain: 'ETH', address: '0xETH...',
                        cached_balance: 1.0, cached_balance_updated_at: freshTimestamp, is_active: true,
                      }],
                      error: null,
                    }),
                  };
                }
                return {
                  eq: vi.fn().mockResolvedValue({
                    data: [{
                      id: 'a1', wallet_id: 'w1', chain: 'ETH', address: '0xETH...',
                      cached_balance: 1.0, cached_balance_updated_at: freshTimestamp, is_active: true,
                    }],
                    error: null,
                  }),
                };
              }),
            };
          }),
        }),
      }),
    } as any;

    const result = await getWalletBalances(supabase, 'w1', { chain: 'ETH' });
    expect(result.success).toBe(true);
  });
});
