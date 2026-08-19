import { describe, it, expect, vi } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';

/**
 * The route selects an explicit public projection and caps the row count, so
 * the double records the column list it was asked for and terminates at
 * `.limit()`.
 *
 * CP-014: this endpoint is unauthenticated by design — a reputation graph is
 * only useful if a counterparty can check it before transacting — but it used
 * `select('*')`, handing out `amount`, `buyer_did` and `escrow_tx` for every job
 * any named DID had ever done.
 */
const selectedColumns = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: (cols: string) => {
        selectedColumns(cols);
        return {
          eq: () => ({
            order: () => ({
              limit: () => ({
                data: [
                  {
                    receipt_id: 'receipt-1',
                    agent_did: 'did:key:z6MkTest123',
                    category: 'coding',
                    action_category: 'delivery',
                    action_type: 'task',
                    outcome: 'accepted',
                    dispute: false,
                    currency: 'USD',
                    created_at: '2025-01-01T00:00:00Z',
                    finalized_at: '2025-01-02T00:00:00Z',
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      },
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
    expect(data.receipts[0].outcome).toBe('accepted');
  });

  it('never asks for the commercially sensitive columns', async () => {
    const req = new NextRequest('http://localhost/api/reputation/receipts?did=did:key:z6MkTest123');
    await GET(req);

    const cols = selectedColumns.mock.calls.at(-1)![0] as string;
    expect(cols).not.toBe('*');
    for (const secret of ['amount', 'escrow_tx', 'buyer_did', 'platform_did', 'signatures']) {
      expect(cols).not.toContain(secret);
    }
    // Still returns what a trust decision actually needs.
    for (const public_ of ['outcome', 'dispute', 'category', 'created_at']) {
      expect(cols).toContain(public_);
    }
  });
});
