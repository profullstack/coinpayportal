import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock data
const mockMerchant = { id: 'merchant-123', email: 'test@test.com' };
const mockIssuer = {
  id: 'issuer-1',
  did: 'did:web:example.com',
  name: 'example',
  domain: 'example.com',
  active: true,
  api_key: 'cprt_example_abcdef1234567890abcdef1234567890abcdef1234567890',
  created_at: '2026-01-01T00:00:00Z',
  merchant_id: 'merchant-123',
};

// Track mock calls
let mockInsertData: unknown = null;
let mockUpdateData: unknown = null;
let mockAuthResult = { success: true, context: { type: 'merchant' as const, merchantId: 'merchant-123', email: 'test@test.com' } };
let mockSelectResult: { data: unknown; error: unknown } = { data: mockIssuer, error: null };
let mockListResult: { data: unknown; error: unknown } = { data: [mockIssuer], error: null };

vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: () => Promise.resolve(mockAuthResult),
  isMerchantAuth: (ctx: { type: string }) => ctx.type === 'merchant',
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: (data: unknown) => {
        mockInsertData = data;
        return {
          select: () => ({
            single: () => mockSelectResult,
          }),
        };
      },
      select: () => ({
        eq: () => ({
          order: () => mockListResult,
          eq: () => ({
            single: () => mockSelectResult,
          }),
        }),
      }),
      update: (data: unknown) => {
        mockUpdateData = data;
        return {
          eq: () => ({
            eq: () => ({
              select: () => ({
                single: () => mockSelectResult,
              }),
            }),
            select: () => ({
              single: () => mockSelectResult,
            }),
          }),
        };
      },
    }),
  }),
}));

import { POST, GET } from './route';

function makeRequest(method: string, body?: object, token = 'valid-token') {
  const headers: Record<string, string> = {};
  if (token) headers['authorization'] = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';

  const url = 'http://localhost/api/reputation/issuers';
  const init: RequestInit = { method, headers };
  if (body) init.body = JSON.stringify(body);

  return new Request(url, init) as unknown as import('next/server').NextRequest;
}

describe('POST /api/reputation/issuers', () => {
  beforeEach(() => {
    mockInsertData = null;
    mockAuthResult = { success: true, context: { type: 'merchant', merchantId: 'merchant-123', email: 'test@test.com' } };
    mockSelectResult = { data: mockIssuer, error: null };
  });

  it('should register a new issuer', async () => {
    const req = makeRequest('POST', { name: 'example', domain: 'example.com' });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.api_key).toMatch(/^cprt_example_/);
    expect(data.issuer).toBeDefined();
  });

  it('should auto-generate DID from domain', async () => {
    const req = makeRequest('POST', { name: 'myapp', domain: 'myapp.com' });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.success).toBe(true);
  });

  it('should reject without auth', async () => {
    mockAuthResult = { success: false, context: undefined as never } as typeof mockAuthResult;
    const req = makeRequest('POST', { name: 'example', domain: 'example.com' });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('should reject invalid name', async () => {
    const req = makeRequest('POST', { name: 'bad name!', domain: 'example.com' });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('should handle duplicate DID conflict', async () => {
    mockSelectResult = { data: null, error: { code: '23505', message: 'duplicate' } };
    const req = makeRequest('POST', { name: 'example', domain: 'example.com' });
    const res = await POST(req);

    expect(res.status).toBe(409);
  });
});

describe('GET /api/reputation/issuers', () => {
  beforeEach(() => {
    mockAuthResult = { success: true, context: { type: 'merchant', merchantId: 'merchant-123', email: 'test@test.com' } };
    mockListResult = { data: [mockIssuer], error: null };
  });

  it('should list issuers with masked keys', async () => {
    const req = makeRequest('GET');
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.issuers).toHaveLength(1);
    expect(data.issuers[0].api_key).toMatch(/^\.\.\./);
    expect(data.issuers[0].api_key).toHaveLength(11); // "..." + 8 chars
  });

  it('should reject without auth', async () => {
    mockAuthResult = { success: false, context: undefined as never } as typeof mockAuthResult;
    const req = makeRequest('GET');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });
});
