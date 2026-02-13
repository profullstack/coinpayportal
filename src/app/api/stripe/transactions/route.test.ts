import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
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

import { verifyToken } from '@/lib/auth/jwt';

function makeChain(resolvedValue: { data: any; error: any; count?: number }) {
  const chain: any = {};
  for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'range', 'single', 'limit']) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: any) => Promise.resolve(resolvedValue).then(resolve);
  return chain;
}

const mockTransactions = [
  {
    id: 'txn-1',
    business_id: 'biz-1',
    amount: 10000,
    currency: 'usd',
    platform_fee_amount: 100,
    stripe_fee_amount: 50,
    net_to_merchant: 9850,
    status: 'succeeded',
    rail: 'card',
    created_at: '2026-02-13T00:00:00Z',
    businesses: { name: 'Test Biz' },
  },
];

describe('GET /api/stripe/transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('should require authorization header', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/transactions');
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it('should reject invalid JWT token', async () => {
    (verifyToken as any).mockImplementation(() => { throw new Error('bad'); });
    const request = new NextRequest('http://localhost:3000/api/stripe/transactions', {
      headers: { authorization: 'Bearer bad' },
    });
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it('should list transactions successfully', async () => {
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    mockFrom.mockImplementation(() => makeChain({ data: mockTransactions, error: null, count: 1 }));

    const request = new NextRequest('http://localhost:3000/api/stripe/transactions', {
      headers: { authorization: 'Bearer valid' },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  it('should handle pagination parameters', async () => {
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    mockFrom.mockImplementation(() => makeChain({ data: [], error: null, count: 0 }));

    const request = new NextRequest('http://localhost:3000/api/stripe/transactions?limit=10&offset=20', {
      headers: { authorization: 'Bearer valid' },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it('should filter by business_id when provided', async () => {
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    
    mockFrom.mockImplementation((table: string) => {
      if (table === 'businesses') {
        return makeChain({ data: { id: 'biz-1' }, error: null });
      }
      // stripe_transactions
      return makeChain({ data: mockTransactions, error: null, count: 1 });
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/transactions?business_id=biz-1', {
      headers: { authorization: 'Bearer valid' },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it('should reject access to non-owned business', async () => {
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    mockFrom.mockImplementation(() => makeChain({ data: null, error: { code: 'PGRST116', message: 'not found' } }));

    const request = new NextRequest('http://localhost:3000/api/stripe/transactions?business_id=not-mine', {
      headers: { authorization: 'Bearer valid' },
    });
    const response = await GET(request);
    expect(response.status).toBe(403);
  });

  it('should filter by status when provided', async () => {
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    mockFrom.mockImplementation(() => makeChain({ data: [], error: null, count: 0 }));

    const request = new NextRequest('http://localhost:3000/api/stripe/transactions?status=succeeded', {
      headers: { authorization: 'Bearer valid' },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it('should limit maximum results per page', async () => {
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    mockFrom.mockImplementation(() => makeChain({ data: [], error: null, count: 0 }));

    const request = new NextRequest('http://localhost:3000/api/stripe/transactions?limit=500', {
      headers: { authorization: 'Bearer valid' },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it('should handle database errors gracefully', async () => {
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    mockFrom.mockImplementation(() => makeChain({ data: null, error: { message: 'db error' } }));

    const request = new NextRequest('http://localhost:3000/api/stripe/transactions', {
      headers: { authorization: 'Bearer valid' },
    });
    const response = await GET(request);
    expect(response.status).toBe(500);
  });
});
