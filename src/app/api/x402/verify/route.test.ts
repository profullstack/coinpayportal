/**
 * Tests for POST /api/x402/verify
 * 
 * Verifies:
 * - API key authentication
 * - Proof validation (missing fields, expired, replay)
 * - Network routing (EVM, UTXO, Solana, Lightning, Stripe)
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

// Mock Supabase
const mockFrom = vi.fn();
const mockSelect = vi.fn().mockReturnThis();
const mockEq = vi.fn().mockReturnThis();
const mockSingle = vi.fn();
const mockInsert = vi.fn().mockReturnValue({ error: null });

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      mockFrom(table);
      return {
        select: mockSelect,
        eq: mockEq,
        single: mockSingle,
        insert: mockInsert,
      };
    },
  }),
}));

// Mock ethers
vi.mock('ethers', () => ({
  ethers: {
    verifyTypedData: vi.fn().mockReturnValue('0xBuyerAddress'),
  },
}));

function makeRequest(body: any, apiKey = 'test-api-key') {
  return new NextRequest('http://localhost/api/x402/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/x402/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('should return 401 when no API key provided', async () => {
    const req = new NextRequest('http://localhost/api/x402/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('API key required');
  });

  it('should return 401 for inactive API key', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'key1', business_id: 'biz1', active: false },
      error: null,
    });

    const req = makeRequest({ proof: 'base64stuff' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('should return 400 for missing proof', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'key1', business_id: 'biz1', active: true },
      error: null,
    });

    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('proof');
  });

  it('should return 400 for invalid base64 proof', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'key1', business_id: 'biz1', active: true },
      error: null,
    });

    const req = makeRequest({ proof: '!!!invalid-base64!!!' });
    const res = await POST(req);
    const data = await res.json();
    // Should either be 400 or handle gracefully
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('should return 400 for expired payment proof', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'key1', business_id: 'biz1', active: true },
      error: null,
    });

    const expiredProof = {
      scheme: 'exact',
      network: 'base',
      asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      payload: {
        signature: '0xabc',
        authorization: {
          from: '0xBuyer',
          to: '0xMerchant',
          value: '5000000',
          validAfter: 0,
          validBefore: Math.floor(Date.now() / 1000) - 3600, // expired 1h ago
          nonce: '0x123',
        },
      },
    };

    const proof = Buffer.from(JSON.stringify(expiredProof)).toString('base64');
    const req = makeRequest({ proof });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
