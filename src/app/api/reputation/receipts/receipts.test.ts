import { describe, it, expect, vi } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            data: [
              {
                id: 'receipt-1',
                agent_did: 'did:key:z6MkTest123',
                buyer_did: 'did:key:z6MkBuyer456',
                task_type: 'coding',
                amount: 100,
                currency: 'USD',
                status: 'accepted',
                created_at: '2025-01-01T00:00:00Z',
              },
            ],
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

describe('GET /api/reputation/receipts', () => {
  it('returns 400 when no DID provided', async () => {
    const req = new NextRequest('http://localhost/api/reputation/receipts');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid DID', async () => {
    const req = new NextRequest('http://localhost/api/reputation/receipts?did=bad');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns receipts for valid DID', async () => {
    const req = new NextRequest('http://localhost/api/reputation/receipts?did=did:key:z6MkTest123');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.receipts).toHaveLength(1);
    expect(data.receipts[0].status).toBe('accepted');
  });
});
