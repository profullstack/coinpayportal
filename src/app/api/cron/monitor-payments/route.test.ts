/**
 * Monitor Payments Cron Route Tests
 *
 * Tests for the payment and escrow monitoring logic,
 * including auto-refund of expired funded escrows.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock Setup ──────────────────────────────────────────────

const mockSupabase = {
  from: vi.fn(),
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

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

import { GET } from './route';

// ── Helpers ──────────────────────────────────────────────

function createMockProxy(data: unknown = [], error: unknown = null) {
  const result = { data, error };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(result);
      }
      return vi.fn(() => new Proxy({}, handler));
    },
  };
  return new Proxy({}, handler);
}

/**
 * Set up supabase mock for monitoring.
 *
 * Call order for from():
 * 1. payments (pending)
 * 2. escrows (status=created)
 * 3. escrows (status=funded, expired)
 * 4. escrows (status=released)
 * 5. escrows (status=refunded)
 * + update/insert calls within loops
 */
function setupMocks(options: {
  pendingPayments?: unknown[];
  pendingEscrows?: unknown[];
  expiredFundedEscrows?: unknown[];
  releasedEscrows?: unknown[];
  refundedEscrows?: unknown[];
}) {
  let paymentCount = 0;
  let escrowCount = 0;

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'payments') {
      paymentCount++;
      if (paymentCount === 1) return createMockProxy(options.pendingPayments || []);
      return createMockProxy(null);
    }

    if (table === 'escrows') {
      escrowCount++;
      switch (escrowCount) {
        case 1: return createMockProxy(options.pendingEscrows || []);
        case 2: return createMockProxy(options.expiredFundedEscrows || []);
        case 3: return createMockProxy(options.releasedEscrows || []);
        case 4: return createMockProxy(options.refundedEscrows || []);
        default: return createMockProxy(null);
      }
    }

    return createMockProxy(null);
  });
}

function createCronRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/cron/monitor-payments', {
    headers: { authorization: 'Bearer test-internal-key' },
  });
}

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

describe('Monitor Payments - Authentication', () => {
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

describe('Monitor Payments - Payment Monitoring', () => {
  it('should process pending payments and return stats', async () => {
    setupMocks({});
    const response = await GET(createCronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.stats).toBeDefined();
    expect(body.stats.checked).toBe(0);
  });

  it('should check balance for pending payments', async () => {
    const payment = {
      id: 'pay-1',
      business_id: 'biz-1',
      blockchain: 'SOL',
      crypto_amount: 1.0,
      status: 'pending',
      payment_address: 'SoLAddr123',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      merchant_wallet_address: 'MerchantAddr',
    };

    setupMocks({ pendingPayments: [payment] });

    mockFetch.mockImplementation(async (_url: string, opts?: RequestInit) => {
      const body = opts?.body ? JSON.parse(opts.body as string) : {};
      if (body.method === 'getBalance') {
        return { ok: true, json: async () => ({ result: { value: 0 } }) };
      }
      return { ok: true, json: async () => ({}), text: async () => '', status: 200 };
    });

    const response = await GET(createCronRequest());
    const body = await response.json();
    expect(body.stats.checked).toBe(1);
  });
});

describe('Monitor Payments - Escrow Step 1: Pending Escrows', () => {
  it('should process expired unfunded escrows', async () => {
    const expiredEscrow = {
      id: 'esc-1',
      escrow_address: 'Addr1',
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
    // Escrow table should have been called for the update
    const escrowCalls = mockSupabase.from.mock.calls.filter(([t]: [string]) => t === 'escrows');
    expect(escrowCalls.length).toBeGreaterThanOrEqual(2); // select + update
  });

  it('should check balance for non-expired pending escrows', async () => {
    const pendingEscrow = {
      id: 'esc-2',
      escrow_address: 'SoLAddr',
      chain: 'SOL',
      amount: 1.0,
      status: 'created',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };

    setupMocks({ pendingEscrows: [pendingEscrow] });

    mockFetch.mockImplementation(async (_url: string, opts?: RequestInit) => {
      const body = opts?.body ? JSON.parse(opts.body as string) : {};
      if (body.method === 'getBalance') {
        return { ok: true, json: async () => ({ result: { value: 1_000_000_000 } }) };
      }
      return { ok: true, json: async () => ({}), text: async () => '', status: 200 };
    });

    const response = await GET(createCronRequest());
    expect(response.status).toBe(200);

    const rpcCalls = mockFetch.mock.calls.filter(([_url, opts]: [string, RequestInit?]) => {
      if (!opts?.body) return false;
      try { return JSON.parse(opts.body as string).method === 'getBalance'; }
      catch { return false; }
    });
    expect(rpcCalls.length).toBe(1);
  });
});

describe('Monitor Payments - Escrow Step 1b: Auto-refund Expired Funded', () => {
  it('should mark expired funded escrows as refunded', async () => {
    const escrow = {
      id: 'esc-funded-exp-1',
      escrow_address: 'EscAddr',
      chain: 'SOL',
      amount: 1.0,
      deposited_amount: 1.0,
      depositor_address: 'DepAddr',
      expires_at: new Date(Date.now() - 3600000).toISOString(),
    };

    setupMocks({ expiredFundedEscrows: [escrow] });
    const response = await GET(createCronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    const eventCalls = mockSupabase.from.mock.calls.filter(([t]: [string]) => t === 'escrow_events');
    expect(eventCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle multiple expired funded escrows', async () => {
    const escrows = [
      { id: 'e1', escrow_address: 'A1', chain: 'SOL', amount: 0.5, deposited_amount: 0.5, depositor_address: 'D1', expires_at: new Date(Date.now() - 7200000).toISOString() },
      { id: 'e2', escrow_address: 'A2', chain: 'ETH', amount: 0.1, deposited_amount: 0.1, depositor_address: 'D2', expires_at: new Date(Date.now() - 3600000).toISOString() },
    ];

    setupMocks({ expiredFundedEscrows: escrows });
    const response = await GET(createCronRequest());

    expect(response.status).toBe(200);
    const eventCalls = mockSupabase.from.mock.calls.filter(([t]: [string]) => t === 'escrow_events');
    expect(eventCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('should skip when no expired funded escrows exist', async () => {
    setupMocks({ expiredFundedEscrows: [] });
    const response = await GET(createCronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    const eventCalls = mockSupabase.from.mock.calls.filter(([t]: [string]) => t === 'escrow_events');
    expect(eventCalls.length).toBe(0);
  });
});

describe('Monitor Payments - Escrow Step 2: Settlement', () => {
  it('should call settle endpoint for released escrows', async () => {
    const escrow = {
      id: 'esc-rel-1',
      escrow_address: 'Addr',
      escrow_address_id: 'aid-1',
      chain: 'SOL',
      amount: 1.0,
      deposited_amount: 1.0,
      fee_amount: 0.01,
      beneficiary_address: 'BenAddr',
      business_id: 'biz-1',
    };

    setupMocks({ releasedEscrows: [escrow] });

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
    expect(settleCalls[0][0]).toContain('esc-rel-1');
  });
});

describe('Monitor Payments - Escrow Step 3: On-chain Refund', () => {
  it('should call settle endpoint with refund action', async () => {
    const escrow = {
      id: 'esc-ref-1',
      escrow_address: 'Addr',
      escrow_address_id: 'aid-1',
      chain: 'SOL',
      deposited_amount: 1.0,
      depositor_address: 'DepAddr',
    };

    setupMocks({ refundedEscrows: [escrow] });

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

    const body = JSON.parse(refundCalls[0][1]?.body as string);
    expect(body.action).toBe('refund');
  });
});

describe('Monitor Payments - E2E', () => {
  it('should handle full cycle: expired funded → refund mark → on-chain settle', async () => {
    const escrow = {
      id: 'esc-e2e',
      escrow_address: 'Addr',
      escrow_address_id: 'aid-1',
      chain: 'SOL',
      amount: 2.0,
      deposited_amount: 2.0,
      depositor_address: 'DepAddr',
      expires_at: new Date(Date.now() - 86400000).toISOString(),
    };

    setupMocks({
      expiredFundedEscrows: [escrow],
      refundedEscrows: [escrow],
    });

    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/settle')) {
        return { ok: true, json: async () => ({ success: true, tx_hash: '0xabc' }), status: 200 };
      }
      return { ok: true, json: async () => ({ result: { value: 0 } }), text: async () => '', status: 200 };
    });

    const response = await GET(createCronRequest());
    expect(response.status).toBe(200);

    // Events logged for the refund
    const eventCalls = mockSupabase.from.mock.calls.filter(([t]: [string]) => t === 'escrow_events');
    expect(eventCalls.length).toBeGreaterThanOrEqual(1);

    // Settle called for on-chain refund
    const settleCalls = mockFetch.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url.includes('/settle')
    );
    expect(settleCalls.length).toBe(1);
  });
});
