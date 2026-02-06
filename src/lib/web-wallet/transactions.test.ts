import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  scanTransactions,
  getTransactionHistory,
  getTransaction,
  upsertTransactions,
  REQUIRED_CONFIRMATIONS,
} from './transactions';

// ──────────────────────────────────────────────
// Mock fetch
// ──────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ──────────────────────────────────────────────
// scanTransactions
// ──────────────────────────────────────────────

describe('scanTransactions', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('BTC', () => {
    it('should parse BTC transactions from Blockstream', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          {
            txid: 'abc123',
            vin: [{ prevout: { scriptpubkey_address: 'sender-addr' } }],
            vout: [
              { scriptpubkey_address: '1BTC...target', value: 50000000 }, // 0.5 BTC
              { scriptpubkey_address: 'change-addr', value: 10000000 },
            ],
            fee: 10000,
            status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
          },
        ]),
      });

      const txs = await scanTransactions('1BTC...target', 'BTC');
      expect(txs.length).toBe(1);
      expect(txs[0].tx_hash).toBe('abc123');
      expect(txs[0].amount).toBe('0.5');
      expect(txs[0].status).toBe('confirmed');
      expect(txs[0].fee_amount).toBe('0.0001');
    });

    it('should handle pending BTC transactions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          {
            txid: 'pending-tx',
            vin: [{ prevout: { scriptpubkey_address: 'sender' } }],
            vout: [{ scriptpubkey_address: 'target', value: 100000 }],
            status: { confirmed: false },
          },
        ]),
      });

      const txs = await scanTransactions('target', 'BTC');
      expect(txs[0].status).toBe('pending');
      expect(txs[0].confirmations).toBe(0);
    });

    it('should throw on API failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      await expect(scanTransactions('addr', 'BTC')).rejects.toThrow('BTC tx scan failed');
    });
  });

  describe('ETH', () => {
    it('should scan EVM Transfer logs', async () => {
      // First call: eth_blockNumber
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x100000', id: 1 }), // block 1048576
      });

      // Second call: eth_getLogs
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: [
            {
              transactionHash: '0xtx1',
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                '0x000000000000000000000000sender0000000000000000000000000000000000',
                '0x000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f2bd28',
              ],
              data: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000', // 1e18 = 1 ETH
              blockNumber: '0xFFFFF', // 1048575
            },
          ],
          id: 1,
        }),
      });

      const txs = await scanTransactions('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28', 'ETH');
      expect(txs.length).toBe(1);
      expect(txs[0].tx_hash).toBe('0xtx1');
      expect(txs[0].to_address).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28');
    });

    it('should throw on eth_blockNumber failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      await expect(
        scanTransactions('0xaddr', 'ETH')
      ).rejects.toThrow('block number fetch failed');
    });
  });

  describe('SOL', () => {
    it('should scan SOL transactions via getSignaturesForAddress', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: [
            {
              signature: 'sig1abc',
              slot: 200000000,
              blockTime: 1700000000,
              confirmationStatus: 'finalized',
              err: null,
            },
            {
              signature: 'sig2def',
              slot: 200000001,
              blockTime: 1700000060,
              confirmationStatus: 'confirmed',
              err: null,
            },
          ],
          id: 1,
        }),
      });

      const txs = await scanTransactions('7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV', 'SOL');
      expect(txs.length).toBe(2);
      expect(txs[0].tx_hash).toBe('sig1abc');
      expect(txs[0].status).toBe('confirmed');
      expect(txs[1].status).toBe('confirming');
    });

    it('should handle failed SOL transactions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: [
            {
              signature: 'failed-sig',
              slot: 100,
              blockTime: 1700000000,
              confirmationStatus: 'processed',
              err: { InstructionError: [0, 'Custom'] },
            },
          ],
          id: 1,
        }),
      });

      const txs = await scanTransactions('addr', 'SOL');
      expect(txs[0].status).toBe('failed');
    });
  });

  describe('BCH', () => {
    it('should return empty array (simplified scanner)', async () => {
      const txs = await scanTransactions('bitcoincash:qtest', 'BCH');
      expect(txs).toEqual([]);
    });
  });

  describe('unsupported', () => {
    it('should return empty for unsupported chain', async () => {
      const txs = await scanTransactions('addr', 'DOGE' as any);
      expect(txs).toEqual([]);
    });
  });
});

// ──────────────────────────────────────────────
// REQUIRED_CONFIRMATIONS
// ──────────────────────────────────────────────

describe('REQUIRED_CONFIRMATIONS', () => {
  it('should have correct values for all chains', () => {
    expect(REQUIRED_CONFIRMATIONS.BTC).toBe(3);
    expect(REQUIRED_CONFIRMATIONS.BCH).toBe(6);
    expect(REQUIRED_CONFIRMATIONS.ETH).toBe(12);
    expect(REQUIRED_CONFIRMATIONS.POL).toBe(128);
    expect(REQUIRED_CONFIRMATIONS.SOL).toBe(32);
    expect(REQUIRED_CONFIRMATIONS.USDC_ETH).toBe(12);
    expect(REQUIRED_CONFIRMATIONS.USDC_POL).toBe(128);
    expect(REQUIRED_CONFIRMATIONS.USDC_SOL).toBe(32);
  });
});

// ──────────────────────────────────────────────
// getTransactionHistory (DB operations)
// ──────────────────────────────────────────────

describe('getTransactionHistory', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should return transactions with pagination', async () => {
    const mockTxs = [
      {
        id: 'tx1',
        wallet_id: 'w1',
        chain: 'ETH',
        tx_hash: '0xabc',
        direction: 'incoming',
        status: 'confirmed',
        amount: '1.5',
        from_address: '0xsender',
        to_address: '0xreceiver',
        created_at: '2026-01-31T00:00:00Z',
      },
    ];

    const rangeFn = vi.fn().mockResolvedValue({ data: mockTxs, count: 1, error: null });
    const orderFn = vi.fn().mockReturnValue({ range: rangeFn });
    const eqFn = vi.fn().mockReturnValue({ order: orderFn });
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn });

    const supabase = {
      from: vi.fn().mockReturnValue({ select: selectFn }),
    } as any;

    const result = await getTransactionHistory(supabase, 'w1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transactions).toHaveLength(1);
      expect(result.data.total).toBe(1);
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });

  it('should apply chain filter', async () => {
    const chainEq = vi.fn().mockResolvedValue({ data: [], count: 0, error: null });
    const rangeFn = vi.fn().mockReturnValue({ eq: chainEq });
    const orderFn = vi.fn().mockReturnValue({ range: rangeFn });
    const eqFn = vi.fn().mockReturnValue({ order: orderFn });
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn });

    const supabase = {
      from: vi.fn().mockReturnValue({ select: selectFn }),
    } as any;

    const result = await getTransactionHistory(supabase, 'w1', { chain: 'ETH' });
    expect(result.success).toBe(true);
    // Verify chain eq was called
    expect(chainEq).toHaveBeenCalled();
  });

  it('should enforce max limit of 100', async () => {
    const rangeFn = vi.fn().mockResolvedValue({ data: [], count: 0, error: null });
    const orderFn = vi.fn().mockReturnValue({ range: rangeFn });
    const eqFn = vi.fn().mockReturnValue({ order: orderFn });
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn });

    const supabase = {
      from: vi.fn().mockReturnValue({ select: selectFn }),
    } as any;

    const result = await getTransactionHistory(supabase, 'w1', { limit: 500 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(100); // Capped at 100
    }
  });

  it('should handle DB error', async () => {
    const rangeFn = vi.fn().mockResolvedValue({ data: null, count: null, error: { message: 'fail' } });
    const orderFn = vi.fn().mockReturnValue({ range: rangeFn });
    const eqFn = vi.fn().mockReturnValue({ order: orderFn });
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn });

    const supabase = {
      from: vi.fn().mockReturnValue({ select: selectFn }),
    } as any;

    const result = await getTransactionHistory(supabase, 'w1');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('DB_ERROR');
    }
  });
});

// ──────────────────────────────────────────────
// getTransaction
// ──────────────────────────────────────────────

describe('getTransaction', () => {
  it('should return a single transaction', async () => {
    const singleFn = vi.fn().mockResolvedValue({
      data: {
        id: 'tx1',
        wallet_id: 'w1',
        chain: 'ETH',
        tx_hash: '0xabc',
        direction: 'incoming',
        status: 'confirmed',
        amount: '1.5',
      },
      error: null,
    });
    const eqFn2 = vi.fn().mockReturnValue({ single: singleFn });
    const eqFn1 = vi.fn().mockReturnValue({ eq: eqFn2 });
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn1 });

    const supabase = {
      from: vi.fn().mockReturnValue({ select: selectFn }),
    } as any;

    const result = await getTransaction(supabase, 'w1', 'tx1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tx_hash).toBe('0xabc');
    }
  });

  it('should return TX_NOT_FOUND for nonexistent transaction', async () => {
    const singleFn = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST116' },
    });
    const eqFn2 = vi.fn().mockReturnValue({ single: singleFn });
    const eqFn1 = vi.fn().mockReturnValue({ eq: eqFn2 });
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn1 });

    const supabase = {
      from: vi.fn().mockReturnValue({ select: selectFn }),
    } as any;

    const result = await getTransaction(supabase, 'w1', 'nonexistent');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('TX_NOT_FOUND');
    }
  });
});

// ──────────────────────────────────────────────
// upsertTransactions
// ──────────────────────────────────────────────

describe('upsertTransactions', () => {
  it('should insert new transactions', async () => {
    const upsertFn = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({ upsert: upsertFn }),
    } as any;

    const rawTxs = [
      {
        tx_hash: '0xabc',
        from_address: '0xsender',
        to_address: '0xreceiver',
        amount: '1.5',
        status: 'confirmed' as const,
        confirmations: 20,
        block_number: 100,
      },
    ];

    const result = await upsertTransactions(supabase, 'w1', 'a1', 'ETH', '0xreceiver', rawTxs);
    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);
  });

  it('should fall back to update on insert conflict', async () => {
    const updateEq2 = vi.fn().mockResolvedValue({ error: null });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const updateFn = vi.fn().mockReturnValue({ eq: updateEq1 });
    const upsertFn = vi.fn().mockResolvedValue({ error: { code: '23505' } }); // unique violation

    const supabase = {
      from: vi.fn().mockImplementation(() => ({
        upsert: upsertFn,
        update: updateFn,
      })),
    } as any;

    const rawTxs = [
      {
        tx_hash: '0xexisting',
        from_address: '0xsender',
        to_address: '0xreceiver',
        amount: '1',
        status: 'confirmed' as const,
        confirmations: 30,
      },
    ];

    const result = await upsertTransactions(supabase, 'w1', 'a1', 'ETH', '0xreceiver', rawTxs);
    expect(result.updated).toBe(1);
  });

  it('should determine direction correctly', async () => {
    const upsertCalls: any[] = [];
    const upsertFn = vi.fn().mockImplementation((record: any) => {
      upsertCalls.push(record);
      return { error: null };
    });

    const supabase = {
      from: vi.fn().mockReturnValue({ upsert: upsertFn }),
    } as any;

    const rawTxs = [
      {
        tx_hash: '0xincoming',
        from_address: '0xsender',
        to_address: '0xMYADDRESS',
        amount: '1',
        status: 'confirmed' as const,
      },
    ];

    await upsertTransactions(supabase, 'w1', 'a1', 'ETH', '0xmyaddress', rawTxs);
    expect(upsertCalls[0].direction).toBe('incoming');
  });
});
