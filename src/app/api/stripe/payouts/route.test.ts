import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import { NextRequest } from 'next/server';

const mockFrom = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: vi.fn(),
}));

vi.mock('@/lib/secrets', () => ({
  getJwtSecret: vi.fn(() => 'test-secret'),
}));

vi.mock('stripe', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      payouts: {
        create: vi.fn().mockResolvedValue({
          id: 'po_stripe_123',
          amount: 5000,
          currency: 'usd',
          status: 'pending',
          arrival_date: 1700000000,
          description: 'Test payout',
        }),
      },
    })),
  };
});

import { verifyToken } from '@/lib/auth/jwt';

function makeChain(resolvedValue: { data: any; error: any; count?: number }) {
  const chain: any = {};
  for (const method of ['select', 'eq', 'not', 'gte', 'lt', 'order', 'range', 'single', 'limit', 'insert']) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: any) => Promise.resolve(resolvedValue).then(resolve);
  return chain;
}

const mockPayouts = [
  {
    id: 'po-1',
    stripe_payout_id: 'po_stripe_1',
    amount: 5000,
    currency: 'usd',
    status: 'paid',
    arrival_date: '2026-02-15T00:00:00Z',
    created_at: '2026-02-13T00:00:00Z',
    updated_at: '2026-02-13T00:00:00Z',
  },
];

describe('GET /api/stripe/payouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('should require authorization header', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/payouts');
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it('should reject invalid JWT token', async () => {
    (verifyToken as any).mockImplementation(() => { throw new Error('bad'); });
    const request = new NextRequest('http://localhost:3000/api/stripe/payouts', {
      headers: { authorization: 'Bearer bad' },
    });
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it('should list payouts successfully', async () => {
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    mockFrom.mockImplementation(() => makeChain({ data: mockPayouts, error: null, count: 1 }));

    const request = new NextRequest('http://localhost:3000/api/stripe/payouts', {
      headers: { authorization: 'Bearer valid' },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.payouts).toHaveLength(1);
    expect(data.payouts[0].amount_usd).toBe('50.00');
  });

  it('should handle filter parameters', async () => {
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    mockFrom.mockImplementation(() => makeChain({ data: [], error: null, count: 0 }));

    const request = new NextRequest(
      'http://localhost:3000/api/stripe/payouts?status=paid&limit=10',
      { headers: { authorization: 'Bearer valid' } }
    );
    const response = await GET(request);
    expect(response.status).toBe(200);
  });
});

describe('POST /api/stripe/payouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  });

  it('should require authorization header', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/payouts', {
      method: 'POST',
      body: JSON.stringify({ amount: 5000 }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('should require a valid amount', async () => {
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    const request = new NextRequest('http://localhost:3000/api/stripe/payouts', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ amount: 0 }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('should create a payout successfully', async () => {
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    
    const insertChain: any = {};
    for (const method of ['select', 'eq', 'not', 'limit', 'single', 'insert']) {
      insertChain[method] = vi.fn().mockReturnValue(insertChain);
    }
    
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'businesses') {
        return makeChain({
          data: { stripe_account_id: 'acct_123' },
          error: null,
        });
      }
      // stripe_payouts insert
      insertChain.then = (resolve: any) =>
        Promise.resolve({
          data: { id: 'po-db-1', created_at: '2026-02-13T00:00:00Z' },
          error: null,
        }).then(resolve);
      return insertChain;
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/payouts', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ amount: 5000, description: 'Test payout' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.payout.amount_cents).toBe(5000);
    expect(data.payout.stripe_payout_id).toBe('po_stripe_123');
  });

  it('should fail without connected Stripe account', async () => {
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    mockFrom.mockImplementation(() => makeChain({ data: null, error: { message: 'not found' } }));

    const request = new NextRequest('http://localhost:3000/api/stripe/payouts', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ amount: 5000 }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Stripe');
  });
});
