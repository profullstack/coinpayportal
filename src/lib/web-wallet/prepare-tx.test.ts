import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  prepareTransaction,
  TX_EXPIRATION_MS,
  CHAIN_IDS,
  USDC_CONTRACTS,
  fetchUTXOs,
} from './prepare-tx';

// ──────────────────────────────────────────────
// Mock fetch
// ──────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ──────────────────────────────────────────────
// Mock estimateFees
// ──────────────────────────────────────────────

vi.mock('./fees', () => ({
  estimateFees: vi.fn().mockResolvedValue({
    low: {
      chain: 'ETH',
      fee: '0.0001',
      feeCurrency: 'ETH',
      priority: 'low',
      gasLimit: 21000,
      gasPrice: '20000000000',
      maxFeePerGas: '20000000000',
      maxPriorityFeePerGas: '1000000000',
    },
    medium: {
      chain: 'ETH',
      fee: '0.0002',
      feeCurrency: 'ETH',
      priority: 'medium',
      gasLimit: 21000,
      gasPrice: '30000000000',
      maxFeePerGas: '30000000000',
      maxPriorityFeePerGas: '2000000000',
    },
    high: {
      chain: 'ETH',
      fee: '0.0003',
      feeCurrency: 'ETH',
      priority: 'high',
      gasLimit: 21000,
      gasPrice: '40000000000',
      maxFeePerGas: '40000000000',
      maxPriorityFeePerGas: '3000000000',
    },
  }),
}));

// ──────────────────────────────────────────────
// Helper: mock supabase
// ──────────────────────────────────────────────

function createMockSupabase(overrides: {
  addressResult?: any;
  addressError?: any;
  insertResult?: any;
  insertError?: any;
} = {}) {
  const singleInsert = vi.fn().mockResolvedValue({
    data: overrides.insertResult ?? { id: 'tx-123' },
    error: overrides.insertError ?? null,
  });
  const selectInsert = vi.fn().mockReturnValue({ single: singleInsert });
  const insertFn = vi.fn().mockReturnValue({ select: selectInsert });

  const singleAddr = vi.fn().mockResolvedValue({
    data: overrides.addressResult ?? { id: 'addr-1', address: '0xSENDER', chain: 'ETH' },
    error: overrides.addressError ?? null,
  });
  const eqActive = vi.fn().mockReturnValue({ single: singleAddr });
  const eqChain = vi.fn().mockReturnValue({ eq: eqActive });
  const eqAddr = vi.fn().mockReturnValue({ eq: eqChain });
  const eqWallet = vi.fn().mockReturnValue({ eq: eqAddr });
  const selectAddr = vi.fn().mockReturnValue({ eq: eqWallet });

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'wallet_addresses') return { select: selectAddr };
      if (table === 'wallet_transactions') return { insert: insertFn };
      return {};
    }),
  } as any;
}

describe('prepareTransaction', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ──────────────────────────────────────────────
  // Validation
  // ──────────────────────────────────────────────

  describe('validation', () => {
    it('should reject invalid chain', async () => {
      const supabase = createMockSupabase();
      const result = await prepareTransaction(supabase, 'w1', {
        from_address: '0xSENDER',
        to_address: '0xRECEIVER',
        chain: 'FAKE_CHAIN',
        amount: '1',
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('INVALID_CHAIN');
    });

    it('should reject invalid amount (zero)', async () => {
      const supabase = createMockSupabase();
      const result = await prepareTransaction(supabase, 'w1', {
        from_address: '0xSENDER',
        to_address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        chain: 'ETH',
        amount: '0',
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('INVALID_AMOUNT');
    });

    it('should reject invalid amount (negative)', async () => {
      const supabase = createMockSupabase();
      const result = await prepareTransaction(supabase, 'w1', {
        from_address: '0xSENDER',
        to_address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        chain: 'ETH',
        amount: '-1',
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('INVALID_AMOUNT');
    });

    it('should reject invalid amount (NaN)', async () => {
      const supabase = createMockSupabase();
      const result = await prepareTransaction(supabase, 'w1', {
        from_address: '0xSENDER',
        to_address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        chain: 'ETH',
        amount: 'abc',
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('INVALID_AMOUNT');
    });

    it('should reject if from_address not in wallet', async () => {
      const supabase = createMockSupabase({
        addressResult: null,
        addressError: { code: 'PGRST116' },
      });
      const result = await prepareTransaction(supabase, 'w1', {
        from_address: '0xSENDER',
        to_address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        chain: 'ETH',
        amount: '1',
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('ADDRESS_NOT_FOUND');
    });
  });

  // ──────────────────────────────────────────────
  // EVM Preparation
  // ──────────────────────────────────────────────

  describe('EVM', () => {
    it('should prepare ETH transaction with nonce', async () => {
      const supabase = createMockSupabase();

      // Mock nonce fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x5', id: 1 }), // nonce = 5
      });

      const result = await prepareTransaction(supabase, 'w1', {
        from_address: '0xSENDER',
        to_address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        chain: 'ETH',
        amount: '1.5',
        priority: 'medium',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.chain).toBe('ETH');
        expect(result.data.from_address).toBe('0xSENDER');
        expect(result.data.amount).toBe('1.5');
        expect(result.data.tx_id).toBe('tx-123');
        expect(result.data.unsigned_tx.type).toBe('evm');
        if (result.data.unsigned_tx.type === 'evm') {
          expect(result.data.unsigned_tx.nonce).toBe(5);
          expect(result.data.unsigned_tx.chainId).toBe(1);
          expect(result.data.unsigned_tx.gasLimit).toBe(21000);
        }
      }
    });

    it('should prepare POL transaction', async () => {
      const supabase = createMockSupabase({
        addressResult: { id: 'addr-1', address: '0xSENDER', chain: 'POL' },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x0', id: 1 }),
      });

      const result = await prepareTransaction(supabase, 'w1', {
        from_address: '0xSENDER',
        to_address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        chain: 'POL',
        amount: '100',
      });

      expect(result.success).toBe(true);
      if (result.success && result.data.unsigned_tx.type === 'evm') {
        expect(result.data.unsigned_tx.chainId).toBe(137);
      }
    });

    it('should handle nonce fetch failure', async () => {
      const supabase = createMockSupabase();

      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const result = await prepareTransaction(supabase, 'w1', {
        from_address: '0xSENDER',
        to_address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        chain: 'ETH',
        amount: '1',
      });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('PREPARE_FAILED');
    });

    it('should handle DB insert failure', async () => {
      const supabase = createMockSupabase({
        insertResult: null,
        insertError: { message: 'DB error' },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x0', id: 1 }),
      });

      const result = await prepareTransaction(supabase, 'w1', {
        from_address: '0xSENDER',
        to_address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        chain: 'ETH',
        amount: '1',
      });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('DB_ERROR');
    });
  });

  // ──────────────────────────────────────────────
  // BTC Preparation
  // ──────────────────────────────────────────────

  describe('BTC', () => {
    it('should prepare BTC transaction with UTXOs', async () => {
      const supabase = createMockSupabase({
        addressResult: { id: 'addr-1', address: '1BTCaddr', chain: 'BTC' },
      });

      // Mock UTXO fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          { txid: 'utxo1', vout: 0, value: 100000000 }, // 1 BTC
          { txid: 'utxo2', vout: 1, value: 50000000 },  // 0.5 BTC
        ]),
      });

      const result = await prepareTransaction(supabase, 'w1', {
        from_address: '1BTCaddr',
        to_address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        chain: 'BTC',
        amount: '0.1',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.unsigned_tx.type).toBe('btc');
        if (result.data.unsigned_tx.type === 'btc') {
          expect(result.data.unsigned_tx.inputs.length).toBe(2);
          expect(result.data.unsigned_tx.outputs.length).toBe(2); // recipient + change
        }
      }
    });

    it('should fail if no UTXOs available', async () => {
      const supabase = createMockSupabase({
        addressResult: { id: 'addr-1', address: '1BTCaddr', chain: 'BTC' },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([]),
      });

      const result = await prepareTransaction(supabase, 'w1', {
        from_address: '1BTCaddr',
        to_address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        chain: 'BTC',
        amount: '0.1',
      });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('PREPARE_FAILED');
    });

    it('should fail if insufficient funds', async () => {
      const supabase = createMockSupabase({
        addressResult: { id: 'addr-1', address: '1BTCaddr', chain: 'BTC' },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([{ txid: 'utxo1', vout: 0, value: 1000 }]), // 0.00001 BTC
      });

      const result = await prepareTransaction(supabase, 'w1', {
        from_address: '1BTCaddr',
        to_address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        chain: 'BTC',
        amount: '1',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('PREPARE_FAILED');
        expect(result.error).toContain('Insufficient funds');
      }
    });
  });

  // ──────────────────────────────────────────────
  // SOL Preparation
  // ──────────────────────────────────────────────

  describe('SOL', () => {
    it('should prepare SOL transaction with blockhash', async () => {
      const supabase = createMockSupabase({
        addressResult: { id: 'addr-1', address: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV', chain: 'SOL' },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: {
            value: {
              blockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N',
              lastValidBlockHeight: 200000000,
            },
          },
          id: 1,
        }),
      });

      const result = await prepareTransaction(supabase, 'w1', {
        from_address: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
        to_address: 'FxkPpN3Nt1NHFxJ2ECE3dwXeGujhzVJAqwnMBKwfpump',
        chain: 'SOL',
        amount: '1.5',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.unsigned_tx.type).toBe('sol');
        if (result.data.unsigned_tx.type === 'sol') {
          expect(result.data.unsigned_tx.recentBlockhash).toBe('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N');
          expect(result.data.unsigned_tx.feePayer).toBe('7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV');
          expect(result.data.unsigned_tx.instructions.length).toBe(1);
        }
      }
    });

    it('should handle blockhash fetch failure', async () => {
      const supabase = createMockSupabase({
        addressResult: { id: 'addr-1', address: 'SOLaddr', chain: 'SOL' },
      });

      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const result = await prepareTransaction(supabase, 'w1', {
        from_address: 'SOLaddr',
        to_address: 'FxkPpN3Nt1NHFxJ2ECE3dwXeGujhzVJAqwnMBKwfpump',
        chain: 'SOL',
        amount: '1',
      });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('PREPARE_FAILED');
    });
  });

  // ──────────────────────────────────────────────
  // Expiration
  // ──────────────────────────────────────────────

  describe('expiration', () => {
    it('should set expiration ~5 minutes from now', async () => {
      const supabase = createMockSupabase();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x0', id: 1 }),
      });

      const before = Date.now();
      const result = await prepareTransaction(supabase, 'w1', {
        from_address: '0xSENDER',
        to_address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        chain: 'ETH',
        amount: '1',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const expiresAt = new Date(result.data.expires_at).getTime();
        expect(expiresAt).toBeGreaterThanOrEqual(before + TX_EXPIRATION_MS - 1000);
        expect(expiresAt).toBeLessThanOrEqual(before + TX_EXPIRATION_MS + 1000);
      }
    });
  });
});

// ──────────────────────────────────────────────
// fetchUTXOs
// ──────────────────────────────────────────────

describe('fetchUTXOs', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should fetch BTC UTXOs from Blockstream', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { txid: 'abc', vout: 0, value: 50000 },
        { txid: 'def', vout: 1, value: 30000 },
      ]),
    });

    const utxos = await fetchUTXOs('1addr', 'BTC');
    expect(utxos).toHaveLength(2);
    expect(utxos[0].txid).toBe('abc');
    expect(utxos[0].value).toBe(50000);
  });

  it('should throw on BTC UTXO fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(fetchUTXOs('1addr', 'BTC')).rejects.toThrow('UTXO fetch failed');
  });
});

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

describe('constants', () => {
  it('should have correct chain IDs', () => {
    expect(CHAIN_IDS.ETH).toBe(1);
    expect(CHAIN_IDS.POL).toBe(137);
    expect(CHAIN_IDS.USDC_ETH).toBe(1);
    expect(CHAIN_IDS.USDC_POL).toBe(137);
  });

  it('should have correct USDC contract addresses', () => {
    expect(USDC_CONTRACTS.USDC_ETH).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    expect(USDC_CONTRACTS.USDC_POL).toBe('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
  });

  it('should have correct TX expiration', () => {
    expect(TX_EXPIRATION_MS).toBe(5 * 60 * 1000);
  });
});
