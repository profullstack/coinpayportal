import { describe, it, expect, vi, beforeEach } from 'vitest';
import { broadcastTransaction, EXPLORER_URLS, withRetry } from './broadcast';

// ──────────────────────────────────────────────
// Mock fetch
// ──────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ──────────────────────────────────────────────
// Helper: mock supabase
// ──────────────────────────────────────────────

function createMockSupabase(overrides: {
  txRecord?: any;
  txError?: any;
  updateError?: any;
} = {}) {
  const defaultTx = {
    id: 'tx-123',
    wallet_id: 'w1',
    chain: 'ETH',
    status: 'pending',
    from_address: '0xSENDER',
    to_address: '0xRECEIVER',
    amount: '1',
    metadata: {
      unsigned_tx: { type: 'evm' },
      priority: 'medium',
      expires_at: new Date(Date.now() + 300_000).toISOString(), // 5 min from now
    },
  };

  const updateEq = vi.fn().mockResolvedValue({ error: overrides.updateError ?? null });
  const updateFn = vi.fn().mockReturnValue({ eq: updateEq });

  const singleFn = vi.fn().mockResolvedValue({
    data: overrides.txRecord ?? defaultTx,
    error: overrides.txError ?? null,
  });
  const eqWallet = vi.fn().mockReturnValue({ single: singleFn });
  const eqId = vi.fn().mockReturnValue({ eq: eqWallet });
  const selectFn = vi.fn().mockReturnValue({ eq: eqId });

  return {
    from: vi.fn().mockReturnValue({
      select: selectFn,
      update: updateFn,
    }),
  } as any;
}

describe('broadcastTransaction', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubEnv('TATUM_API_KEY', 'test-key');
  });

  // ──────────────────────────────────────────────
  // Validation
  // ──────────────────────────────────────────────

  describe('validation', () => {
    it('should reject invalid chain', async () => {
      const supabase = createMockSupabase();
      const result = await broadcastTransaction(supabase, 'w1', {
        tx_id: 'tx-123',
        signed_tx: '0xSIGNED',
        chain: 'DOGE',
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('INVALID_CHAIN');
    });

    it('should reject empty signed_tx', async () => {
      const supabase = createMockSupabase();
      const result = await broadcastTransaction(supabase, 'w1', {
        tx_id: 'tx-123',
        signed_tx: '',
        chain: 'ETH',
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('MISSING_SIGNED_TX');
    });

    it('should reject if prepared tx not found', async () => {
      const supabase = createMockSupabase({
        txRecord: null,
        txError: { code: 'PGRST116' },
      });
      const result = await broadcastTransaction(supabase, 'w1', {
        tx_id: 'nonexistent',
        signed_tx: '0xSIGNED',
        chain: 'ETH',
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('TX_NOT_FOUND');
    });

    it('should reject already broadcast transactions', async () => {
      const supabase = createMockSupabase({
        txRecord: {
          id: 'tx-123',
          wallet_id: 'w1',
          chain: 'ETH',
          status: 'confirming',
          metadata: {},
        },
      });
      const result = await broadcastTransaction(supabase, 'w1', {
        tx_id: 'tx-123',
        signed_tx: '0xSIGNED',
        chain: 'ETH',
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('TX_ALREADY_PROCESSED');
    });

    it('should reject expired transactions', async () => {
      const supabase = createMockSupabase({
        txRecord: {
          id: 'tx-123',
          wallet_id: 'w1',
          chain: 'ETH',
          status: 'pending',
          metadata: {
            expires_at: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
          },
        },
      });
      const result = await broadcastTransaction(supabase, 'w1', {
        tx_id: 'tx-123',
        signed_tx: '0xSIGNED',
        chain: 'ETH',
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('TX_EXPIRED');
    });
  });

  // ──────────────────────────────────────────────
  // BTC Broadcast
  // ──────────────────────────────────────────────

  describe('BTC', () => {
    it('should broadcast BTC transaction via Blockstream', async () => {
      const supabase = createMockSupabase({
        txRecord: {
          id: 'tx-123',
          wallet_id: 'w1',
          chain: 'BTC',
          status: 'pending',
          metadata: { expires_at: new Date(Date.now() + 300_000).toISOString() },
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'abc123txhash',
      });

      const result = await broadcastTransaction(supabase, 'w1', {
        tx_id: 'tx-123',
        signed_tx: 'raw-btc-hex',
        chain: 'BTC',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tx_hash).toBe('abc123txhash');
        expect(result.data.chain).toBe('BTC');
        expect(result.data.status).toBe('confirming');
        expect(result.data.explorer_url).toBe(EXPLORER_URLS.BTC + 'abc123txhash');
      }
    });

    it('should handle BTC broadcast failure', async () => {
      const supabase = createMockSupabase({
        txRecord: {
          id: 'tx-123',
          wallet_id: 'w1',
          chain: 'BTC',
          status: 'pending',
          metadata: { expires_at: new Date(Date.now() + 300_000).toISOString() },
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Invalid transaction',
      });

      const result = await broadcastTransaction(supabase, 'w1', {
        tx_id: 'tx-123',
        signed_tx: 'invalid-hex',
        chain: 'BTC',
      });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('BROADCAST_FAILED');
    });
  });

  // ──────────────────────────────────────────────
  // EVM Broadcast
  // ──────────────────────────────────────────────

  describe('EVM', () => {
    it('should broadcast ETH transaction via eth_sendRawTransaction', async () => {
      const supabase = createMockSupabase();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: '0xETHtxhash123',
          id: 1,
        }),
      });

      const result = await broadcastTransaction(supabase, 'w1', {
        tx_id: 'tx-123',
        signed_tx: '0xf86c...',
        chain: 'ETH',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tx_hash).toBe('0xETHtxhash123');
        expect(result.data.explorer_url).toContain('etherscan.io');
      }
    });

    it('should broadcast POL transaction', async () => {
      const supabase = createMockSupabase({
        txRecord: {
          id: 'tx-123',
          wallet_id: 'w1',
          chain: 'POL',
          status: 'pending',
          metadata: { expires_at: new Date(Date.now() + 300_000).toISOString() },
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: '0xPOLtxhash',
          id: 1,
        }),
      });

      const result = await broadcastTransaction(supabase, 'w1', {
        tx_id: 'tx-123',
        signed_tx: '0xf86c...',
        chain: 'POL',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.explorer_url).toContain('polygonscan.com');
      }
    });

    it('should handle EVM RPC error', async () => {
      const supabase = createMockSupabase();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'nonce too low' },
          id: 1,
        }),
      });

      const result = await broadcastTransaction(supabase, 'w1', {
        tx_id: 'tx-123',
        signed_tx: '0xf86c...',
        chain: 'ETH',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('BROADCAST_FAILED');
        expect(result.error).toContain('nonce too low');
      }
    });
  });

  // ──────────────────────────────────────────────
  // SOL Broadcast
  // ──────────────────────────────────────────────

  describe('SOL', () => {
    it('should broadcast SOL transaction via sendTransaction', async () => {
      const supabase = createMockSupabase({
        txRecord: {
          id: 'tx-123',
          wallet_id: 'w1',
          chain: 'SOL',
          status: 'pending',
          metadata: { expires_at: new Date(Date.now() + 300_000).toISOString() },
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4',
          id: 1,
        }),
      });

      const result = await broadcastTransaction(supabase, 'w1', {
        tx_id: 'tx-123',
        signed_tx: 'base64encodedtx',
        chain: 'SOL',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tx_hash).toBe('5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4');
        expect(result.data.explorer_url).toContain('explorer.solana.com');
      }
    });

    it('should handle SOL RPC error', async () => {
      const supabase = createMockSupabase({
        txRecord: {
          id: 'tx-123',
          wallet_id: 'w1',
          chain: 'SOL',
          status: 'pending',
          metadata: { expires_at: new Date(Date.now() + 300_000).toISOString() },
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          error: { code: -32002, message: 'insufficient funds for rent' },
          id: 1,
        }),
      });

      const result = await broadcastTransaction(supabase, 'w1', {
        tx_id: 'tx-123',
        signed_tx: 'base64encodedtx',
        chain: 'SOL',
      });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('insufficient funds for rent');
    });
  });

  // ──────────────────────────────────────────────
  // BCH Broadcast
  // ──────────────────────────────────────────────

  describe('BCH', () => {
    it('should broadcast BCH via Tatum', async () => {
      const supabase = createMockSupabase({
        txRecord: {
          id: 'tx-123',
          wallet_id: 'w1',
          chain: 'BCH',
          status: 'pending',
          metadata: { expires_at: new Date(Date.now() + 300_000).toISOString() },
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ txId: 'bch-tx-hash-123' }),
      });

      const result = await broadcastTransaction(supabase, 'w1', {
        tx_id: 'tx-123',
        signed_tx: 'raw-bch-hex',
        chain: 'BCH',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tx_hash).toBe('bch-tx-hash-123');
        expect(result.data.explorer_url).toContain('blockchair.com');
      }
    });
  });
});

// ──────────────────────────────────────────────
// Explorer URLs
// ──────────────────────────────────────────────

describe('EXPLORER_URLS', () => {
  it('should have URLs for all chains', () => {
    expect(EXPLORER_URLS.BTC).toContain('blockstream');
    expect(EXPLORER_URLS.BCH).toContain('blockchair');
    expect(EXPLORER_URLS.ETH).toContain('etherscan');
    expect(EXPLORER_URLS.POL).toContain('polygonscan');
    expect(EXPLORER_URLS.SOL).toContain('solana');
    expect(EXPLORER_URLS.USDC_ETH).toContain('etherscan');
    expect(EXPLORER_URLS.USDC_POL).toContain('polygonscan');
    expect(EXPLORER_URLS.USDC_SOL).toContain('solana');
  });
});

// ──────────────────────────────────────────────
// withRetry
// ──────────────────────────────────────────────

describe('withRetry', () => {
  it('should succeed on first try', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, 3);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on transient error and succeed', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, 3);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should not retry on permanent error (nonce too low)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('nonce too low'));
    await expect(withRetry(fn, 3)).rejects.toThrow('nonce too low');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should not retry on permanent error (insufficient funds)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('insufficient funds'));
    await expect(withRetry(fn, 3)).rejects.toThrow('insufficient funds');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should give up after max retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('server error'));
    await expect(withRetry(fn, 2)).rejects.toThrow('server error');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
