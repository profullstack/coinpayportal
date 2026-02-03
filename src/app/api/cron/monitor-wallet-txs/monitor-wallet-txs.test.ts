/**
 * Tests for POST /api/cron/monitor-wallet-txs
 *
 * Verifies the background job that finalizes pending/confirming
 * web-wallet transactions by checking on-chain status.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

// Mock Supabase
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();
const mockNot = vi.fn();
const mockLimit = vi.fn();
const mockOrder = vi.fn();

const mockSupabase = {
  from: vi.fn(() => ({
    select: mockSelect,
    update: mockUpdate,
  })),
};

// Chain the query builder methods
mockSelect.mockReturnValue({
  in: mockIn,
});
mockIn.mockReturnValue({
  not: mockNot,
});
mockNot.mockReturnValue({
  limit: mockLimit,
});
mockLimit.mockReturnValue({
  order: mockOrder,
});

mockUpdate.mockReturnValue({
  eq: mockEq,
});
mockEq.mockReturnValue({
  eq: mockEq,
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupabase,
}));

// Mock fetch for RPC calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Set env vars
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
process.env.CRON_SECRET = 'test-secret';

// Import after mocks
import { POST, GET } from './route';

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/cron/monitor-wallet-txs', {
    method: 'POST',
    headers: {
      'authorization': 'Bearer test-secret',
      ...headers,
    },
  }) as any;
}

describe('POST /api/cron/monitor-wallet-txs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain for query builder
    mockSelect.mockReturnValue({ in: mockIn });
    mockIn.mockReturnValue({ not: mockNot });
    mockNot.mockReturnValue({ limit: mockLimit });
    mockLimit.mockReturnValue({ order: mockOrder });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ eq: mockEq });
  });

  it('should reject unauthorized requests', async () => {
    const req = new Request('http://localhost:3000/api/cron/monitor-wallet-txs', {
      method: 'POST',
      headers: { 'authorization': 'Bearer wrong' },
    }) as any;

    const resp = await POST(req);
    expect(resp.status).toBe(401);
  });

  it('should accept Vercel cron header', async () => {
    mockOrder.mockResolvedValue({ data: [], error: null });

    const req = new Request('http://localhost:3000/api/cron/monitor-wallet-txs', {
      method: 'POST',
      headers: { 'x-vercel-cron': '1' },
    }) as any;

    const resp = await POST(req);
    expect(resp.status).toBe(200);
  });

  it('should return success with empty stats when no pending txs', async () => {
    mockOrder.mockResolvedValue({ data: [], error: null });

    const resp = await POST(makeRequest());
    const body = await resp.json();

    expect(resp.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.stats.checked).toBe(0);
  });

  it('should skip UUID placeholder hashes', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'tx-1',
          wallet_id: 'w-1',
          chain: 'ETH',
          tx_hash: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', // UUID → skip
          status: 'pending',
          confirmations: 0,
          metadata: {},
        },
      ],
      error: null,
    });

    const resp = await POST(makeRequest());
    const body = await resp.json();

    expect(body.stats.checked).toBe(0);
    // No RPC calls should be made
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should confirm a BTC transaction with enough confirmations', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'tx-btc',
          wallet_id: 'w-1',
          chain: 'BTC',
          tx_hash: 'abc123def456',
          status: 'confirming',
          confirmations: 1,
          metadata: {},
        },
      ],
      error: null,
    });

    // Mock Blockstream tx lookup
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        txid: 'abc123def456',
        status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
      }),
    });
    // Mock tip height
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '800005',
    });

    const resp = await POST(makeRequest());
    const body = await resp.json();

    expect(body.stats.confirmed).toBe(1);
    // Verify Supabase update was called
    expect(mockSupabase.from).toHaveBeenCalledWith('wallet_transactions');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'confirmed',
        confirmations: 6,
      })
    );
  });

  it('should mark a failed EVM transaction', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'tx-eth',
          wallet_id: 'w-1',
          chain: 'ETH',
          tx_hash: '0xdeadbeef',
          status: 'confirming',
          confirmations: 0,
          metadata: {},
        },
      ],
      error: null,
    });

    // Mock receipt with status 0x0 (failed)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: {
          blockNumber: '0xF4240',
          status: '0x0', // failed
        },
        id: 1,
      }),
    });
    // Mock block number
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: '0xF4260',
        id: 2,
      }),
    });
    // Mock block for timestamp
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: { timestamp: '0x65A00000' },
        id: 3,
      }),
    });

    const resp = await POST(makeRequest());
    const body = await resp.json();

    expect(body.stats.failed).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('should handle SOL confirmed transaction', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'tx-sol',
          wallet_id: 'w-1',
          chain: 'SOL',
          tx_hash: '5xYz123abc',
          status: 'pending',
          confirmations: 0,
          metadata: {},
        },
      ],
      error: null,
    });

    // Mock Solana getTransaction
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: {
          slot: 250000000,
          meta: { err: null },
          blockTime: 1700000000,
        },
        id: 1,
      }),
    });

    const resp = await POST(makeRequest());
    const body = await resp.json();

    expect(body.stats.confirmed).toBe(1);
  });

  it('should count unchanged transactions when confirmations have not increased', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'tx-eth2',
          wallet_id: 'w-1',
          chain: 'ETH',
          tx_hash: '0xaabbccdd',
          status: 'confirming',
          confirmations: 5,
          metadata: {},
        },
      ],
      error: null,
    });

    // Mock receipt — only 3 confirmations (less than current 5)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: {
          blockNumber: '0xF4240',
          status: '0x1',
        },
        id: 1,
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: '0xF4242', // 3 confirmations
        id: 2,
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: { timestamp: '0x65A00000' },
        id: 3,
      }),
    });

    const resp = await POST(makeRequest());
    const body = await resp.json();

    expect(body.stats.unchanged).toBe(1);
    expect(body.stats.confirmed).toBe(0);
  });

  it('should handle DB fetch errors', async () => {
    mockOrder.mockResolvedValue({
      data: null,
      error: { message: 'connection failed' },
    });

    const resp = await POST(makeRequest());
    expect(resp.status).toBe(500);
  });

  it('GET should work the same as POST (Vercel cron compat)', async () => {
    mockOrder.mockResolvedValue({ data: [], error: null });

    const req = makeRequest();
    const resp = await GET(req);
    expect(resp.status).toBe(200);
  });

  it('should handle RPC failures gracefully (count as errors)', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'tx-fail',
          wallet_id: 'w-1',
          chain: 'ETH',
          tx_hash: '0xbadcafe',
          status: 'pending',
          confirmations: 0,
          metadata: {},
        },
      ],
      error: null,
    });

    // RPC returns error
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const resp = await POST(makeRequest());
    const body = await resp.json();

    expect(body.stats.errors).toBe(1);
    expect(body.stats.confirmed).toBe(0);
  });
});
