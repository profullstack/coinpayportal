/**
 * Monitor Payments Cron Route Tests
 *
 * Tests for the escrow monitoring logic in the cron handler,
 * including auto-refund of expired funded escrows.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock Setup ──────────────────────────────────────────────

// The mock supabase that createClient will return
const mockSupabase = {
  from: vi.fn(),
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

// Mock bitcoinjs-lib to avoid native module issues
vi.mock('bitcoinjs-lib', () => ({
  crypto: {
    hash256: vi.fn(() => Buffer.alloc(32)),
  },
}));

// Mock env before module loads
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
process.env.INTERNAL_API_KEY = 'test-internal-key';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

// Import after mocks
import { GET } from './route';

// ── Helpers ──────────────────────────────────────────────

function createMockProxy(data: unknown = [], error: unknown = null) {
  const result = { data, error };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(result);
      }
      // Any chained method returns the same proxy
      return vi.fn(() => new Proxy({}, handler));
    },
  };
  return new Proxy({}, handler);
}

/**
 * Set up supabase mock for escrow monitoring.
 * 
 * The monitor calls supabase.from() in this order:
 * 1. payments (pending payments)
 * 2. escrows (status=created, pending)
 * 3. escrows (status=funded + expired — auto-refund)
 * 4. escrows (status=released — settlement)
 * 5. escrows (status=refunded — on-chain refund)
 * Plus update/insert calls within loops.
 */
function setupMocks(options: {
  pendingPayments?: unknown[];
  pendingEscrows?: unknown[];
  expiredFundedEscrows?: unknown[];
  releasedEscrows?: unknown[];
  refundedEscrows?: unknown[];
}) {
  let escrowSelectCount = 0;

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'payments') {
      return createMockProxy(options.pendingPayments || []);
    }

    if (table === 'escrows') {
      escrowSelectCount++;
      // Route by call order:
      // 1st = pending (created), 2nd = expired funded, 3rd = released, 4th = refunded
      // Additional calls are updates from within loops — just succeed
      switch (escrowSelectCount) {
        case 1: return createMockProxy(options.pendingEscrows || []);
        case 2: return createMockProxy(options.expiredFundedEscrows || []);
        case 3: return createMockProxy(options.releasedEscrows || []);
        case 4: return createMockProxy(options.refundedEscrows || []);
        default: return createMockProxy(null);
      }
    }

    // escrow_events, payment_forwarding_logs, etc
    return createMockProxy(null);
  });
}

function createCronRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/cron/monitor-payments', {
    headers: { authorization: 'Bearer test-internal-key' },
  });
}

// Save/restore global fetch
const originalFetch = global.fetch;
const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();

  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ result: { value: 0 } }),
    text: async () => '',
    status: 200,
  });

  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ── Tests ──────────────────────────────────────────────

describe('Monitor Payments - Escrow Monitoring', () => {
  describe('Authentication', () => {
    it('should reject requests without valid auth', async () => {
      const request = new NextRequest('http://localhost:3000/api/cron/monitor-payments');
      const response = await GET(request);
      expect(response.status).toBe(401);
    });

    it('should accept requests with valid cron secret', async () => {
      setupMocks({});
      const response = await GET(createCronRequest());
      expect(response.status).toBe(200);
    });

    it('should accept Vercel cron requests', async () => {
      setupMocks({});
      const request = new NextRequest('http://localhost:3000/api/cron/monitor-payments', {
        headers: { 'x-vercel-cron': '1' },
      });
      const response = await GET(request);
      expect(response.status).toBe(200);
    });
  });

  describe('Step 1: Pending escrow expiration', () => {
    it('should process pending escrows and return success', async () => {
      const expiredEscrow = {
        id: 'esc-expired-1',
        escrow_address: 'SoLAddress123',
        chain: 'SOL',
        amount: 1.0,
        status: 'created',
        expires_at: new Date(Date.now() - 3600000).toISOString(),
      };

      setupMocks({ pendingEscrows: [expiredEscrow] });
      const response = await GET(createCronRequest());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);

      // Verify escrows table was queried
      const escrowCalls = mockSupabase.from.mock.calls.filter(([t]: [string]) => t === 'escrows');
      expect(escrowCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should check balance for non-expired pending escrows', async () => {
      const pendingEscrow = {
        id: 'esc-pending-1',
        escrow_address: 'SoLFundedAddr',
        chain: 'SOL',
        amount: 1.0,
        status: 'created',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      };

      setupMocks({ pendingEscrows: [pendingEscrow] });

      // Mock Solana balance check
      mockFetch.mockImplementation(async (_url: string, opts?: RequestInit) => {
        const body = opts?.body ? JSON.parse(opts.body as string) : {};
        if (body.method === 'getBalance') {
          return {
            ok: true,
            json: async () => ({ result: { value: 1_000_000_000 } }),
          };
        }
        return { ok: true, json: async () => ({}), text: async () => '', status: 200 };
      });

      const response = await GET(createCronRequest());
      expect(response.status).toBe(200);

      // Verify a Solana RPC call was made
      const rpcCalls = mockFetch.mock.calls.filter(([_url, opts]: [string, RequestInit?]) => {
        if (!opts?.body) return false;
        try {
          const body = JSON.parse(opts.body as string);
          return body.method === 'getBalance';
        } catch { return false; }
      });
      expect(rpcCalls.length).toBe(1);
    });
  });

  describe('Step 1b: Auto-refund expired funded escrows', () => {
    it('should mark expired funded escrows as refunded', async () => {
      const expiredFundedEscrow = {
        id: 'esc-funded-expired-1',
        escrow_address: 'SoLEscrowAddr',
        chain: 'SOL',
        amount: 1.0,
        deposited_amount: 1.0,
        depositor_address: 'SoLDepositorAddr',
        expires_at: new Date(Date.now() - 3600000).toISOString(),
      };

      setupMocks({ expiredFundedEscrows: [expiredFundedEscrow] });
      const response = await GET(createCronRequest());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);

      // Verify escrow_events was called to log the refund event
      const eventCalls = mockSupabase.from.mock.calls.filter(([t]: [string]) => t === 'escrow_events');
      expect(eventCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle multiple expired funded escrows', async () => {
      const escrows = [
        {
          id: 'esc-exp-1',
          escrow_address: 'Addr1',
          chain: 'SOL',
          amount: 0.5,
          deposited_amount: 0.5,
          depositor_address: 'Depositor1',
          expires_at: new Date(Date.now() - 7200000).toISOString(),
        },
        {
          id: 'esc-exp-2',
          escrow_address: 'Addr2',
          chain: 'ETH',
          amount: 0.1,
          deposited_amount: 0.1,
          depositor_address: 'Depositor2',
          expires_at: new Date(Date.now() - 3600000).toISOString(),
        },
      ];

      setupMocks({ expiredFundedEscrows: escrows });
      const response = await GET(createCronRequest());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);

      // Should have logged events for both escrows
      const eventCalls = mockSupabase.from.mock.calls.filter(([t]: [string]) => t === 'escrow_events');
      expect(eventCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('should not refund funded escrows that have not expired', async () => {
      // Query returns empty (no expired funded escrows)
      setupMocks({ expiredFundedEscrows: [] });
      const response = await GET(createCronRequest());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);

      // No escrow_events for refund
      const eventCalls = mockSupabase.from.mock.calls.filter(([t]: [string]) => t === 'escrow_events');
      expect(eventCalls.length).toBe(0);
    });
  });

  describe('Step 2: Released escrow settlement', () => {
    it('should call settle endpoint for released escrows', async () => {
      const releasedEscrow = {
        id: 'esc-released-1',
        escrow_address: 'EscAddr',
        escrow_address_id: 'addr-id-1',
        chain: 'SOL',
        amount: 1.0,
        deposited_amount: 1.0,
        fee_amount: 0.01,
        beneficiary_address: 'BeneficiaryAddr',
        business_id: 'biz-1',
      };

      setupMocks({ releasedEscrows: [releasedEscrow] });

      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/settle')) {
          return { ok: true, json: async () => ({ success: true }), status: 200 };
        }
        return { ok: true, json: async () => ({ result: { value: 0 } }), text: async () => '', status: 200 };
      });

      const response = await GET(createCronRequest());
      expect(response.status).toBe(200);

      const settleCalls = mockFetch.mock.calls.filter(
        ([url]: [string]) => typeof url === 'string' && url.includes('/settle')
      );
      expect(settleCalls.length).toBe(1);
      expect(settleCalls[0][0]).toContain('esc-released-1');
    });
  });

  describe('Step 3: Refunded escrow on-chain transfer', () => {
    it('should call settle endpoint with refund action for refunded escrows', async () => {
      const refundedEscrow = {
        id: 'esc-refunded-1',
        escrow_address: 'EscAddr',
        escrow_address_id: 'addr-id-1',
        chain: 'SOL',
        deposited_amount: 1.0,
        depositor_address: 'DepositorAddr',
      };

      setupMocks({ refundedEscrows: [refundedEscrow] });

      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/settle')) {
          return { ok: true, json: async () => ({ success: true }), status: 200 };
        }
        return { ok: true, json: async () => ({ result: { value: 0 } }), text: async () => '', status: 200 };
      });

      const response = await GET(createCronRequest());
      expect(response.status).toBe(200);

      const refundCalls = mockFetch.mock.calls.filter(
        ([url]: [string]) => typeof url === 'string' && url.includes('/settle')
      );
      expect(refundCalls.length).toBe(1);

      // Verify refund action in body
      const body = JSON.parse(refundCalls[0][1]?.body as string);
      expect(body.action).toBe('refund');
    });
  });

  describe('End-to-end: expired funded escrow flows to on-chain refund', () => {
    it('should mark expired funded escrow as refunded AND trigger on-chain refund in same cycle', async () => {
      const expiredFundedEscrow = {
        id: 'esc-e2e-1',
        escrow_address: 'EscAddr',
        escrow_address_id: 'addr-1',
        chain: 'SOL',
        amount: 2.0,
        deposited_amount: 2.0,
        depositor_address: 'DepAddr',
        expires_at: new Date(Date.now() - 86400000).toISOString(), // expired yesterday
      };

      // The escrow shows up in step 1b (expired funded) AND step 3 (refunded, no settlement_tx)
      setupMocks({
        expiredFundedEscrows: [expiredFundedEscrow],
        refundedEscrows: [expiredFundedEscrow],
      });

      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/settle')) {
          return { ok: true, json: async () => ({ success: true, tx_hash: '0xabc' }), status: 200 };
        }
        return { ok: true, json: async () => ({ result: { value: 0 } }), text: async () => '', status: 200 };
      });

      const response = await GET(createCronRequest());
      const responseBody = await response.json();

      expect(response.status).toBe(200);
      expect(responseBody.success).toBe(true);

      // Step 1b: escrow_events should be logged
      const eventCalls = mockSupabase.from.mock.calls.filter(([t]: [string]) => t === 'escrow_events');
      expect(eventCalls.length).toBeGreaterThanOrEqual(1);

      // Step 3: settle endpoint should be called with refund action
      const settleCalls = mockFetch.mock.calls.filter(
        ([url]: [string]) => typeof url === 'string' && url.includes('/settle')
      );
      expect(settleCalls.length).toBe(1);

      // The refund settle call includes a body with action: 'refund'
      const settleBody = settleCalls[0][1]?.body;
      if (settleBody) {
        expect(JSON.parse(settleBody as string).action).toBe('refund');
      }
    });
  });
});
