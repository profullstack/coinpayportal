import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';

// Mock supabase
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, _val: string) => ({
          order: () => ({
            data: [
              {
                id: 'cred-1',
                type: 'TaskCompletion',
                subject_did: 'did:key:z6MkTest123',
                issuer_did: 'did:key:z6MkIssuer456',
                claims: { score: 95 },
                created_at: '2025-01-01T00:00:00Z',
                revoked: false,
              },
            ],
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

describe('GET /api/reputation/credentials', () => {
  it('returns 400 when no DID provided', async () => {
    const req = new NextRequest('http://localhost/api/reputation/credentials');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it('returns 400 for invalid DID format', async () => {
    const req = new NextRequest('http://localhost/api/reputation/credentials?did=invalid');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns credentials for valid DID', async () => {
    const req = new NextRequest('http://localhost/api/reputation/credentials?did=did:key:z6MkTest123');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.credentials).toHaveLength(1);
    expect(data.credentials[0].id).toBe('cred-1');
  });
});
