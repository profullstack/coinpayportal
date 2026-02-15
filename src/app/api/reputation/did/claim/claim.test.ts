import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock state ─────────────────────────────────────────────────────

let mockAuthResult: { success: boolean; context?: unknown } = {
  success: true,
  context: { type: 'merchant', merchantId: 'merchant-123', email: 'test@test.com' },
};
let mockExistingDid: unknown = null;
let mockInsertResult: { data: unknown; error: unknown } = { data: null, error: null };
let mockInsertedData: unknown = null;

vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: () => Promise.resolve(mockAuthResult),
  isMerchantAuth: (ctx: { type: string }) => ctx.type === 'merchant',
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: mockExistingDid, error: mockExistingDid ? null : { code: 'PGRST116' } }),
        }),
      }),
      insert: (data: unknown) => {
        mockInsertedData = data;
        return {
          select: () => ({
            single: () => Promise.resolve(mockInsertResult),
          }),
        };
      },
    }),
  }),
}));

// ── Helpers ────────────────────────────────────────────────────────

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/reputation/did/claim', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-api-key',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ── Tests ──────────────────────────────────────────────────────────

describe('POST /api/reputation/did/claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockExistingDid = null;
    mockInsertedData = null;
    mockAuthResult = {
      success: true,
      context: { type: 'merchant', merchantId: 'merchant-123', email: 'test@test.com' },
    };
    mockInsertResult = {
      data: {
        did: 'did:key:z6MkTest',
        public_key: 'testpubkey',
        verified: true,
        created_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    };
  });

  it('returns 401 when not authenticated', async () => {
    mockAuthResult = { success: false };
    const { POST } = await import('./route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 409 when merchant already has a DID', async () => {
    mockExistingDid = { did: 'did:key:z6MkExisting', merchant_id: 'merchant-123' };
    const { POST } = await import('./route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('already has a DID');
  });

  it('auto-generates did:key when no body provided', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.did).toMatch(/^did:key:z/);
    expect(json.public_key).toBeDefined();
    expect(json.verified).toBe(true);
  });

  it('stores merchant_id, did, public_key, and verified flag', async () => {
    const { POST } = await import('./route');
    await POST(makeRequest());

    expect(mockInsertedData).toMatchObject({
      merchant_id: 'merchant-123',
      verified: true,
    });
    expect((mockInsertedData as Record<string, unknown>).did).toMatch(/^did:key:z/);
    expect((mockInsertedData as Record<string, unknown>).public_key).toBeDefined();
  });

  it('returns 500 when DB insert fails', async () => {
    mockInsertResult = { data: null, error: { message: 'insert failed' } };
    const { POST } = await import('./route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
  });
});
