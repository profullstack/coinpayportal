import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock state ─────────────────────────────────────────────────────

let mockPlatformAuth: { did: string; name: string } | null = {
  did: 'did:web:ugig.net',
  name: 'ugig.net',
};
let mockExistingDid: unknown = null;
let mockMerchant: unknown = null;
let mockInsertError: unknown = null;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'reputation_issuers') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: mockPlatformAuth, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'merchant_dids') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: mockExistingDid, error: null }),
            }),
          }),
          insert: () => Promise.resolve({ error: mockInsertError }),
        };
      }
      if (table === 'merchants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: mockMerchant, error: null }),
            }),
          }),
        };
      }
      return {};
    },
  }),
}));

// ── Helpers ────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/reputation/did/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer cprt_ugig.net_testkey',
    },
    body: JSON.stringify(body),
  });
}

// ── Tests ──────────────────────────────────────────────────────────

describe('POST /api/reputation/did/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockPlatformAuth = { did: 'did:web:ugig.net', name: 'ugig.net' };
    mockExistingDid = null;
    mockMerchant = null;
    mockInsertError = null;
  });

  it('returns 401 with invalid API key', async () => {
    mockPlatformAuth = null;
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ did: 'did:key:z6MkTest' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 with invalid body', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ did: 'not-a-did' }));
    expect(res.status).toBe(400);
  });

  it('returns already registered if DID exists', async () => {
    mockExistingDid = { did: 'did:key:z6MkTest' };
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ did: 'did:key:z6MkTest' }));
    const json = await res.json();
    expect(json.registered).toBe(false);
    expect(json.message).toContain('already registered');
  });

  it('registers new DID successfully', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      makeRequest({
        did: 'did:key:z6MkNewUser',
        public_key: 'testpubkey',
        platform: 'ugig.net',
        email: 'user@test.com',
      })
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.did).toBe('did:key:z6MkNewUser');
    expect(json.registered).toBe(true);
  });

  it('links merchant_id when email matches existing merchant', async () => {
    mockMerchant = { id: 'merchant-456' };
    const { POST } = await import('./route');
    const res = await POST(
      makeRequest({
        did: 'did:key:z6MkLinked',
        email: 'merchant@test.com',
      })
    );
    expect(res.status).toBe(201);
  });

  it('handles insert error gracefully', async () => {
    mockInsertError = { message: 'unique constraint violation' };
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ did: 'did:key:z6MkFail' }));
    const json = await res.json();
    expect(json.registered).toBe(false);
    expect(json.message).toContain('tracked via reputation');
  });
});
