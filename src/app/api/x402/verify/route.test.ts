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

const RESOURCE = 'https://api.example.com/premium';

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

    mockSingle.mockResolvedValueOnce({
      data: { id: 'key1', business_id: 'biz1', active: true },
      error: null,
    });

    // Replay is now caught by the unique index on (unique_key, network) rather
    // than a read-then-write check, which two concurrent verifies could both
    // pass and which silently allowed everything when the table was missing.
    mockInsert.mockReturnValueOnce({
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
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
        resource: RESOURCE,
        paymentIntentId: 'pi_reused_123',
      },
    };

    const req = makeRequest({ payment, expected: { amount: '100', resource: RESOURCE } });
    const res = await POST(req);
    const data = await res.json();

    // Before the fix uniqueKey was undefined for Stripe, the replay check was
    // skipped, and this returned 200 valid — allowing unlimited reuse.
    expect(res.status).toBe(400);
    expect(data.error).toContain('replay');
  });

  describe('price and resource binding', () => {
    /**
     * Every test here presents a *validly signed, unused* proof. The old
     * facilitator returned `valid: true` for all of them, because it compared
     * the proof against nothing.
     */
    function activeKey() {
      mockSingle.mockResolvedValueOnce({
        data: { id: 'key1', business_id: 'biz1', active: true },
        error: null,
      });
    }

    function evmPayment(overrides: any = {}) {
      return {
        scheme: 'exact',
        signature: '0xsig',
        payload: {
          network: 'base',
          methodKey: 'usdc_base',
          from: '0xBuyerAddress',
          to: '0xMerchant',
          amount: '10000', // $0.01 in USDC micro-units
          nonce: '0xabc',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          resource: RESOURCE,
          ...overrides,
        },
      };
    }

    it('rejects a proof that underpays the asking price', async () => {
      activeKey();

      // Paid $0.01, resource costs $5.00.
      const req = makeRequest({
        payment: evmPayment(),
        expected: { amount: '5000000', resource: RESOURCE },
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toMatch(/underpayment/i);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('rejects a proof minted for a different resource', async () => {
      activeKey();

      const req = makeRequest({
        payment: evmPayment({ resource: 'https://api.example.com/cheap' }),
        expected: { amount: '10000', resource: RESOURCE },
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toMatch(/resource mismatch/i);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('refuses to verify at all when no price is supplied', async () => {
      activeKey();

      const req = makeRequest({ payment: evmPayment() });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toMatch(/expected/i);
    });

    it('accepts a proof that covers the price for the right resource', async () => {
      activeKey();
      mockInsert.mockReturnValueOnce({ error: null });

      const req = makeRequest({
        payment: evmPayment(),
        expected: { amount: '10000', resource: RESOURCE },
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.valid).toBe(true);
      expect(data.payment.resource).toBe(RESOURCE);
    });

    it('accepts an overpayment', async () => {
      activeKey();
      mockInsert.mockReturnValueOnce({ error: null });

      const req = makeRequest({
        payment: evmPayment({ amount: '20000' }),
        expected: { amount: '10000', resource: RESOURCE },
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
    });

    it('compares amounts as integers, not floats', async () => {
      activeKey();

      // Both round to the same float64; as integers the proof is 1 wei short.
      const owed = '10000000000000000000000';
      const paid = '9999999999999999999999';

      const req = makeRequest({
        payment: evmPayment({ network: 'ethereum', methodKey: 'eth', amount: paid }),
        expected: { amount: owed, resource: RESOURCE },
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toMatch(/underpayment/i);
    });

    it('fails closed when the payment cannot be recorded', async () => {
      activeKey();

      // The x402_payments table was missing in production entirely. Reporting
      // `valid: true` on an unrecorded payment makes a proof reusable forever.
      mockInsert.mockReturnValueOnce({
        error: { code: '42P01', message: 'relation "x402_payments" does not exist' },
      });

      const req = makeRequest({
        payment: evmPayment(),
        expected: { amount: '10000', resource: RESOURCE },
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.valid).toBeUndefined();
    });

    it('rejects a proof with no replay identity', async () => {
      activeKey();

      const payment = evmPayment();
      delete payment.payload.nonce;

      const req = makeRequest({
        payment,
        expected: { amount: '10000', resource: RESOURCE },
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toMatch(/replay-checked/i);
    });
  });
});
