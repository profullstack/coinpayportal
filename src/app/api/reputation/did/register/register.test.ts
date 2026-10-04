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
// Whether the named merchant was provisioned by THIS platform. Null = not ours,
// which is the case that must register the DID unlinked (L7A-02 / V-02).
let mockPlatformLink: unknown = null;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'reputation_issuers') {
        // Lookup is hash-first now, so the chain must terminate at
        // `maybeSingle` as well as `single`.
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: mockPlatformAuth, error: null }),
                maybeSingle: () => Promise.resolve({ data: mockPlatformAuth, error: null }),
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
      if (table === 'businesses') {
        // platformMayManageMerchant: is this merchant one THIS platform
        // provisioned? Null means no, so the DID registers unlinked.
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve({ data: mockPlatformLink, error: null }),
                }),
              }),
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
    mockPlatformLink = null;
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

  it('does NOT link a merchant this platform did not provision', async () => {
    // L7A-02 / V-02 / REP-F1A-02: an email match alone used to bind an
    // arbitrary DID to that account with verified:true, letting a caller plant
    // a hostile DID on a victim — ideally before the victim claimed their own,
    // since the first registration wins. The DID still registers, unlinked.
    mockMerchant = { id: 'merchant-456', auth_provider: 'self' };
    mockPlatformLink = null;
    const { POST } = await import('./route');
    const res = await POST(
      makeRequest({
        did: 'did:key:z6MkLinked',
        email: 'merchant@test.com',
      })
    );
    expect(res.status).toBe(201);
  });

  it('links a merchant this platform did provision', async () => {
    mockMerchant = { id: 'merchant-456', auth_provider: 'platform' };
    mockPlatformLink = { id: 'biz-1' };
    const { POST } = await import('./route');
    const res = await POST(
      makeRequest({
        did: 'did:key:z6MkOurUser',
        email: 'ourusr@test.com',
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
