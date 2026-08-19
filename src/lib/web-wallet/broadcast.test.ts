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
        chain: 'FAKE_CHAIN',
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

    /**
     * Every rejected Solana transaction carries the same `message` —
     * "Transaction simulation failed" — so a payer used to get one
     * indistinguishable error whether their wallet was empty, their blockhash
     * had aged out, or something else entirely. The cause lives in
     * `error.data`, which was being thrown away.
     */
    async function solError(data: unknown) {
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
          error: { code: -32002, message: 'Transaction simulation failed', data },
          id: 1,
        }),
      });
      const result = await broadcastTransaction(supabase, 'w1', {
        tx_id: 'tx-123',
        signed_tx: 'base64encodedtx',
        chain: 'SOL',
      });
      expect(result.success).toBe(false);
      return result.success ? '' : result.error;
    }

    it('names an empty wallet instead of "simulation failed"', async () => {
      const error = await solError({
        err: { InstructionError: [0, { Custom: 1 }] },
        logs: ['Program 11111111111111111111111111111111 failed: insufficient lamports 1000, need 5000'],
      });
      expect(error).toMatch(/enough SOL/i);
    });

    it('names an expired blockhash, which is worth retrying', async () => {
      const error = await solError({ err: 'BlockhashNotFound', logs: [] });
      expect(error).toMatch(/blockhash expired/i);
    });

    it('passes through an unfamiliar chain error rather than hiding it', async () => {
      const error = await solError({
        err: { InstructionError: [0, 'ProgramFailedToComplete'] },
        logs: ['Program log: something specific and unexpected'],
      });
      expect(error).toContain('ProgramFailedToComplete');
      expect(error).toContain('something specific and unexpected');
    });

    it('still reports something useful when the chain sends no detail', async () => {
      const error = await solError(undefined);
      expect(error).toContain('Transaction simulation failed');
    });

    it('does not retry a rejected simulation', async () => {
      // The chain has already decided about these exact bytes. Re-sending them
      // cannot change the verdict — it just costs the payer seconds of backoff
      // and four RPC calls on an endpoint we are rationing.
      await solError({ err: 'BlockhashNotFound', logs: [] });
      expect(mockFetch).toHaveBeenCalledTimes(1);
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

/**
 * Regression tests for WW-01 (2026-08-19 audit).
 *
 * `verifySignedTxBinding` compared the RECIPIENT of the signed transaction
 * against the prepared row and never the AMOUNT. A signed transaction paying
 * the right address a different amount was accepted and recorded as the
 * prepared one — and everything downstream hangs off that row: the wallet's own
 * history, the daily spend limit, fee accounting and notifications all
 * described a transaction that did not happen.
 *
 * These use a really-signed transaction, because the existing EVM tests pass a
 * placeholder (`'0xf86c...'`) that cannot be decoded at all.
 */
describe('broadcastTransaction — signed/prepared binding (WW-01)', () => {
  // Well-known Hardhat account #0. Test key, never used for funds.
  const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const TO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

  async function signNative(toAddress: string, etherValue: string) {
    const { Wallet, parseEther } = await import('ethers');
    const wallet = new Wallet(KEY);
    return wallet.signTransaction({
      to: toAddress,
      value: parseEther(etherValue),
      chainId: 1,
      nonce: 0,
      gasLimit: 21000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      type: 2,
    });
  }

  function supabaseFor(prepared: { to_address: string; amount: string }) {
    return createMockSupabase({
      txRecord: {
        id: 'tx-123',
        wallet_id: 'w1',
        chain: 'ETH',
        status: 'pending',
        from_address: '0xSENDER',
        to_address: prepared.to_address,
        amount: prepared.amount,
        metadata: {
          unsigned_tx: { type: 'evm' },
          expires_at: new Date(Date.now() + 300_000).toISOString(),
        },
      },
    });
  }

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('refuses a signed transaction whose amount differs from the prepared one', async () => {
    // Right recipient, 10x the amount. This used to broadcast.
    const signed = await signNative(TO, '10');
    const supabase = supabaseFor({ to_address: TO, amount: '1' });

    const result = await broadcastTransaction(supabase, 'w1', {
      tx_id: 'tx-123',
      signed_tx: signed,
      chain: 'ETH',
    });

    expect(result.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('still refuses a recipient mismatch', async () => {
    const signed = await signNative(TO, '1');
    const supabase = supabaseFor({
      to_address: '0x0000000000000000000000000000000000000009',
      amount: '1',
    });

    const result = await broadcastTransaction(supabase, 'w1', {
      tx_id: 'tx-123',
      signed_tx: signed,
      chain: 'ETH',
    });

    expect(result.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('broadcasts when both recipient and amount match', async () => {
    const signed = await signNative(TO, '1');
    const supabase = supabaseFor({ to_address: TO, amount: '1' });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', result: '0xgoodhash', id: 1 }),
    });

    const result = await broadcastTransaction(supabase, 'w1', {
      tx_id: 'tx-123',
      signed_tx: signed,
      chain: 'ETH',
    });

    expect(result.success).toBe(true);
  });
});

/**
 * Regression tests for WW-03 (2026-08-19 audit).
 *
 * BTC, BCH, SOL and USDC_SOL had NO binding check at all - the decoder reported
 * "no decoder for <chain>" and the broadcast went ahead, so a signed
 * transaction on those chains was never compared against what the platform had
 * prepared and recorded.
 *
 * The binding check reads the transaction OUTPUTS, so these fixtures are built
 * directly with bitcoin.Transaction rather than signed through a PSBT.
 * Signatures live in the inputs and are irrelevant to what is under test.
 */
describe('broadcastTransaction - non-EVM binding (WW-03)', () => {
  const PAYEE = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
  const OTHER = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

  async function btcTxHex(outputs: Array<{ address: string; value: number }>) {
    const bitcoin = await import('bitcoinjs-lib');
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32), 0);
    for (const out of outputs) {
      tx.addOutput(
        bitcoin.address.toOutputScript(out.address, bitcoin.networks.bitcoin),
        out.value
      );
    }
    return tx.toHex();
  }

  function supabaseForBtc(prepared: { to_address: string; amount: string }) {
    return createMockSupabase({
      txRecord: {
        id: 'tx-btc',
        wallet_id: 'w1',
        chain: 'BTC',
        status: 'pending',
        from_address: 'bc1qsender',
        to_address: prepared.to_address,
        amount: prepared.amount,
        metadata: { expires_at: new Date(Date.now() + 300_000).toISOString() },
      },
    });
  }

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('refuses a Bitcoin transaction that pays nothing to the prepared address', async () => {
    const hex = await btcTxHex([{ address: OTHER, value: 100_000 }]);
    const supabase = supabaseForBtc({ to_address: PAYEE, amount: '0.001' });

    const result = await broadcastTransaction(supabase, 'w1', {
      tx_id: 'tx-btc',
      signed_tx: hex,
      chain: 'BTC',
    });

    expect(result.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses a Bitcoin transaction that underpays the prepared amount', async () => {
    const hex = await btcTxHex([{ address: PAYEE, value: 50_000 }]);
    const supabase = supabaseForBtc({ to_address: PAYEE, amount: '0.001' });

    const result = await broadcastTransaction(supabase, 'w1', {
      tx_id: 'tx-btc',
      signed_tx: hex,
      chain: 'BTC',
    });

    expect(result.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('accepts the prepared amount alongside a change output', async () => {
    // A real spend nearly always has change back to the sender, so the check
    // must be "the payee received at least the amount", not "there is exactly
    // one output".
    const hex = await btcTxHex([
      { address: PAYEE, value: 100_000 },
      { address: OTHER, value: 90_000 },
    ]);
    const supabase = supabaseForBtc({ to_address: PAYEE, amount: '0.001' });

    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => 'btc-tx-hash',
      json: async () => ({ result: 'btc-tx-hash' }),
    });

    const result = await broadcastTransaction(supabase, 'w1', {
      tx_id: 'tx-btc',
      signed_tx: hex,
      chain: 'BTC',
    });

    // The binding must not be what stops this one: the broadcast was attempted.
    expect(mockFetch).toHaveBeenCalled();
    void result;
  });
});
