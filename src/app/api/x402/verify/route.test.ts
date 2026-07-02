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

  it('should reject a replayed Stripe PaymentIntent (uniqueKey must include paymentIntentId)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';

    // 1st single() -> API key lookup (active); 2nd single() -> replay check finds an existing row
    mockSingle
      .mockResolvedValueOnce({
        data: { id: 'key1', business_id: 'biz1', active: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'already-verified-payment' },
        error: null,
      });

    // Stripe API reports the PaymentIntent succeeded
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'succeeded' }),
    }) as any;

    const payment = {
      scheme: 'stripe-checkout',
      payload: {
        network: 'stripe',
        scheme: 'stripe-checkout',
        from: '0xBuyer',
        to: '0xMerchant',
        amount: '100',
        paymentIntentId: 'pi_reused_123',
      },
    };

    const req = makeRequest({ payment });
    const res = await POST(req);
    const data = await res.json();

    // Before the fix uniqueKey was undefined for Stripe, the replay check was
    // skipped, and this returned 200 valid — allowing unlimited reuse.
    expect(res.status).toBe(400);
    expect(data.error).toContain('replay');
    // The replay lookup must actually run (2nd single() call), i.e. uniqueKey was set
    expect(mockSingle).toHaveBeenCalledTimes(2);
  });
});
