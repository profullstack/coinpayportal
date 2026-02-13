import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';

// Mock dependencies
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

vi.mock('@/lib/business/service', () => ({
  listBusinesses: vi.fn(),
}));

import { verifyToken } from '@/lib/auth/jwt';
import { listBusinesses } from '@/lib/business/service';

function makeChain(resolvedValue: { data: any; error: any }) {
  const chain: any = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  // Make it thenable so await resolves
  chain.then = (resolve: any) => Promise.resolve(resolvedValue).then(resolve);
  return chain;
}

describe('GET /api/stripe/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('should require authorization header', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/analytics');
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it('should reject invalid JWT token', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/analytics', {
      headers: { authorization: 'Bearer invalid-token' },
    });
    (verifyToken as any).mockImplementation(() => { throw new Error('Invalid token'); });

    const response = await GET(request);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe('Invalid or expired token');
  });

  it('should return empty analytics when merchant has no businesses', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/analytics', {
      headers: { authorization: 'Bearer valid-token' },
    });
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    (listBusinesses as any).mockResolvedValue({ success: true, businesses: [] });

    const response = await GET(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.analytics.combined.total_transactions).toBe(0);
  });

  it('should calculate combined analytics correctly', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/analytics', {
      headers: { authorization: 'Bearer valid-token' },
    });
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    (listBusinesses as any).mockResolvedValue({
      success: true,
      businesses: [{ id: 'biz-1' }],
    });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // crypto payments
        return makeChain({
          data: [
            { status: 'completed', amount_usd: '100.00', fee_usd: '1.00' },
            { status: 'completed', amount_usd: '200.00', fee_usd: '2.00' },
            { status: 'pending', amount_usd: '50.00', fee_usd: '0.50' },
          ],
          error: null,
        });
      } else {
        // card transactions
        return makeChain({
          data: [
            { status: 'succeeded', amount: 15000, currency: 'usd', platform_fee: 150, stripe_fee: 75 },
            { status: 'succeeded', amount: 25000, currency: 'usd', platform_fee: 250, stripe_fee: 125 },
          ],
          error: null,
        });
      }
    });

    const response = await GET(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.analytics.crypto.total_transactions).toBe(3);
    expect(data.analytics.card.total_transactions).toBe(2);
    expect(data.analytics.combined.total_transactions).toBe(5);
  });

  it('should filter by business_id when provided', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/analytics?business_id=biz-1', {
      headers: { authorization: 'Bearer valid-token' },
    });
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    (listBusinesses as any).mockResolvedValue({
      success: true,
      businesses: [{ id: 'biz-1' }, { id: 'biz-2' }],
    });
    mockFrom.mockImplementation(() => makeChain({ data: [], error: null }));

    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it('should return 404 for non-owned business_id', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/analytics?business_id=not-mine', {
      headers: { authorization: 'Bearer valid-token' },
    });
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    (listBusinesses as any).mockResolvedValue({
      success: true,
      businesses: [{ id: 'biz-1' }],
    });

    const response = await GET(request);
    expect(response.status).toBe(404);
  });

  it('should handle database errors gracefully', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/analytics', {
      headers: { authorization: 'Bearer valid-token' },
    });
    (verifyToken as any).mockReturnValue({ userId: 'merchant-1' });
    (listBusinesses as any).mockResolvedValue({
      success: true,
      businesses: [{ id: 'biz-1' }],
    });
    mockFrom.mockImplementation(() => makeChain({ data: null, error: { message: 'db error' } }));

    const response = await GET(request);
    expect(response.status).toBe(500);
  });
});
