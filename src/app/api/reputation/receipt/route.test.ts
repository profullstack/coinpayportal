import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashApiKey } from '@/lib/auth/scoped-keys';

const VALID_KEY = 'cprt_example_0123456789abcdef';
const ISSUER = { id: 'issuer-1', did: 'did:web:Example.com', name: 'example' };

/** Issuer rows keyed by column -> value, as the fake DB sees them. */
let issuerRows: Array<{ id: string; did: string; name: string; active: boolean; api_key: string | null; api_key_hash: string | null }>;
const mockSubmitReceipt = vi.fn();
const mockUpdate = vi.fn();

function issuersTable() {
  const filters: Record<string, unknown> = {};
  const query = {
    select: () => query,
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return query;
    },
    maybeSingle: async () => {
      const row = issuerRows.find((r) =>
        Object.entries(filters).every(([c, v]) => (r as Record<string, unknown>)[c] === v),
      );
      return { data: row ? { id: row.id, did: row.did, name: row.name } : null, error: null };
    },
    update: (data: unknown) => {
      mockUpdate(data);
      return { eq: () => Promise.resolve({ data: null, error: null }) };
    },
  };
  return query;
}

vi.mock('@/lib/supabase/service-client', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'reputation_issuers') return issuersTable();
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock('@/lib/reputation/receipt-service', () => ({
  submitReceipt: (...args: unknown[]) => mockSubmitReceipt(...args),
}));

import { POST } from './route';

function receipt(extra: Record<string, unknown> = {}) {
  return {
    receipt_id: '550e8400-e29b-41d4-a716-446655440000',
    task_id: '550e8400-e29b-41d4-a716-446655440001',
    agent_did: 'did:key:z6MkAgent',
    buyer_did: 'did:key:z6MkBuyer',
    outcome: 'accepted',
    signatures: { escrow_sig: 'sig' },
    ...extra,
  };
}

function makeRequest(body: unknown, authorization?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization) headers.authorization = authorization;
  return new Request('http://localhost/api/reputation/receipt', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

describe('POST /api/reputation/receipt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issuerRows = [
      { ...ISSUER, active: true, api_key: null, api_key_hash: hashApiKey(VALID_KEY) },
    ];
    mockSubmitReceipt.mockResolvedValue({ success: true, receipt: { id: 'r1' } });
  });

  it('returns 401 without an Authorization header', async () => {
    const res = await POST(makeRequest(receipt({ platform_did: ISSUER.did })));
    expect(res.status).toBe(401);
    expect(mockSubmitReceipt).not.toHaveBeenCalled();
  });

  it('returns 401 for a non-Bearer Authorization header', async () => {
    const res = await POST(makeRequest(receipt(), `Basic ${VALID_KEY}`));
    expect(res.status).toBe(401);
    expect(mockSubmitReceipt).not.toHaveBeenCalled();
  });

  it('returns 401 for an unknown key', async () => {
    const res = await POST(makeRequest(receipt(), 'Bearer cprt_bogus_key'));
    expect(res.status).toBe(401);
    expect(mockSubmitReceipt).not.toHaveBeenCalled();
  });

  it('returns 401 for the key of an inactive issuer', async () => {
    issuerRows[0].active = false;
    const res = await POST(makeRequest(receipt(), `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(401);
    expect(mockSubmitReceipt).not.toHaveBeenCalled();
  });

  it('returns 403 when platform_did is another issuer', async () => {
    const res = await POST(
      makeRequest(receipt({ platform_did: 'did:web:ugig.net' }), `Bearer ${VALID_KEY}`),
    );
    expect(res.status).toBe(403);
    expect(mockSubmitReceipt).not.toHaveBeenCalled();
  });

  it('returns 403 when platform_did is not a string', async () => {
    const res = await POST(makeRequest(receipt({ platform_did: 42 }), `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(403);
  });

  it('accepts a receipt whose platform_did is the issuer (did:web host case-insensitive)', async () => {
    const res = await POST(
      makeRequest(receipt({ platform_did: 'did:web:example.com' }), `Bearer ${VALID_KEY}`),
    );
    expect(res.status).toBe(201);
    expect(mockSubmitReceipt).toHaveBeenCalledTimes(1);
  });

  it('defaults platform_did to the issuer DID when omitted', async () => {
    const res = await POST(makeRequest(receipt(), `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(201);
    const submitted = mockSubmitReceipt.mock.calls[0][1] as Record<string, unknown>;
    expect(submitted.platform_did).toBe(ISSUER.did);
  });

  it('authenticates a legacy raw-key issuer and upgrades it to a hash', async () => {
    issuerRows = [{ ...ISSUER, active: true, api_key: VALID_KEY, api_key_hash: null }];
    const res = await POST(makeRequest(receipt(), `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(201);
    expect(mockUpdate).toHaveBeenCalledWith({ api_key_hash: hashApiKey(VALID_KEY), api_key: null });
  });

  it('returns 400 for an invalid JSON body', async () => {
    const res = await POST(makeRequest('{not json', `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the receipt service rejects the receipt', async () => {
    mockSubmitReceipt.mockResolvedValue({ success: false, error: 'Duplicate receipt_id' });
    const res = await POST(makeRequest(receipt(), `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Duplicate receipt_id');
  });
});
