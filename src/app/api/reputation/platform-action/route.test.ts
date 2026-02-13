import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockInsert = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'reputation_issuers') {
        return {
          select: (...args: unknown[]) => {
            mockSelect(...args);
            return {
              eq: (...eqArgs: unknown[]) => {
                mockEq(...eqArgs);
                return {
                  eq: (...eq2Args: unknown[]) => {
                    mockEq(...eq2Args);
                    return { single: () => mockSingle() };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'reputation_receipts') {
        return {
          insert: (data: unknown) => {
            mockInsert(data);
            return {
              select: () => ({
                single: () => ({ data: { ...data as object, id: 'test-id' }, error: null }),
              }),
            };
          },
        };
      }
      return {};
    },
  }),
}));

import { POST } from './route';

function makeRequest(body: object, apiKey?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
  return new Request('http://localhost/api/reputation/platform-action', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

describe('POST /api/reputation/platform-action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects requests without auth', async () => {
    const res = await POST(makeRequest({ agent_did: 'did:key:z6Mk123' }));
    expect(res.status).toBe(401);
  });

  it('rejects invalid API key', async () => {
    mockSingle.mockReturnValue({ data: null });
    const res = await POST(makeRequest({ agent_did: 'did:key:z6Mk123' }, 'bad-key'));
    expect(res.status).toBe(401);
  });

  it('rejects invalid action_category', async () => {
    mockSingle.mockReturnValue({ data: { did: 'did:web:ugig.net', name: 'ugig.net' } });
    const res = await POST(makeRequest({
      agent_did: 'did:key:z6Mk123',
      action_category: 'invalid.category',
    }, 'valid-key'));
    expect(res.status).toBe(400);
  });

  it('rejects invalid agent DID', async () => {
    mockSingle.mockReturnValue({ data: { did: 'did:web:ugig.net', name: 'ugig.net' } });
    const res = await POST(makeRequest({
      agent_did: 'not-a-did',
      action_category: 'social.post',
    }, 'valid-key'));
    expect(res.status).toBe(400);
  });

  it('accepts valid platform action', async () => {
    mockSingle.mockReturnValue({ data: { did: 'did:web:ugig.net', name: 'ugig.net' } });
    const res = await POST(makeRequest({
      agent_did: 'did:key:z6Mk123abc',
      action_category: 'social.post',
      action_type: 'feed_post',
      metadata: { platform: 'ugig.net', post_id: '123' },
    }, 'valid-key'));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.receipt_id).toBeDefined();
  });

  it('accepts economic actions with value_usd', async () => {
    mockSingle.mockReturnValue({ data: { did: 'did:web:ugig.net', name: 'ugig.net' } });
    const res = await POST(makeRequest({
      agent_did: 'did:key:z6Mk123abc',
      action_category: 'productivity.completion',
      value_usd: 150,
      metadata: { gig_id: 'gig-456' },
    }, 'valid-key'));
    expect(res.status).toBe(201);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 150 })
    );
  });
});
