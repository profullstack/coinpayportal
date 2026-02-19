/**
 * Tests for POST /api/x402/settle
 * 
 * Verifies:
 * - API key authentication
 * - Commission calculation (0.5% paid / 1% free tier)
 * - EVM, UTXO, Solana, Lightning, and Stripe settlement routing
 * - Error handling (missing data, already settled, etc.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

// Mock Supabase
const mockSelect = vi.fn().mockReturnThis();
const mockEq = vi.fn().mockReturnThis();
const mockSingle = vi.fn();
const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) });

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: vi.fn().mockReturnValue({
      select: mockSelect,
      eq: mockEq,
      single: mockSingle,
      update: mockUpdate,
    }),
  }),
}));

// Mock entitlements
vi.mock('@/lib/entitlements/service', () => ({
  isBusinessPaidTier: vi.fn().mockResolvedValue(true),
}));

// Mock fees
vi.mock('@/lib/payments/fees', () => ({
  splitTieredPayment: vi.fn((amount: number, isPaid: boolean) => ({
    merchantAmount: isPaid ? amount * 0.995 : amount * 0.99,
    platformFee: isPaid ? amount * 0.005 : amount * 0.01,
    total: amount,
    feePercentage: isPaid ? 0.005 : 0.01,
  })),
}));

function makeRequest(body: any, apiKey = 'test-api-key') {
  return new NextRequest('http://localhost/api/x402/settle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/x402/settle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('should return 401 when no API key provided', async () => {
    const req = new NextRequest('http://localhost/api/x402/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('API key required');
  });

  it('should return 401 for invalid API key', async () => {
    // First call: api_keys lookup fails
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

    const req = makeRequest({ payment: { payload: { network: 'base' } } });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('should return 400 for missing payment data', async () => {
    // api_keys lookup succeeds
    mockSingle.mockResolvedValueOnce({
      data: { id: 'key1', business_id: 'biz1', active: true },
      error: null,
    });

    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid payment data');
  });

  it('should return 400 when verified payment not found', async () => {
    // api_keys lookup
    mockSingle
      .mockResolvedValueOnce({
        data: { id: 'key1', business_id: 'biz1', active: true },
        error: null,
      })
      // x402_payments lookup fails
      .mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

    const req = makeRequest({
      payment: {
        payload: { network: 'base', nonce: '123', txHash: '0xabc' },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Payment not found');
  });

  it('should return 409 when payment already settled', async () => {
    mockSingle
      .mockResolvedValueOnce({
        data: { id: 'key1', business_id: 'biz1', active: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'p1', status: 'settled', tx_hash: '0xold', amount: '5.00', network: 'base' },
        error: null,
      });

    const req = makeRequest({
      payment: {
        payload: { network: 'base', nonce: '123' },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain('already settled');
  });

  it('should settle Lightning payment instantly', async () => {
    mockSingle
      .mockResolvedValueOnce({
        data: { id: 'key1', business_id: 'biz1', active: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'p1', status: 'verified', amount: '100', network: 'lightning' },
        error: null,
      });

    const req = makeRequest({
      payment: {
        payload: {
          network: 'lightning',
          scheme: 'bolt12',
          paymentHash: 'hash123',
          preimage: 'pre123',
        },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.settled).toBe(true);
    expect(data.txHash).toBe('hash123');
    expect(data.commission).toBeDefined();
    expect(data.commission.rate).toBe('0.5%');
    expect(data.commission.tier).toBe('professional');
  });

  it('should include commission breakdown in response', async () => {
    mockSingle
      .mockResolvedValueOnce({
        data: { id: 'key1', business_id: 'biz1', active: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'p1', status: 'verified', amount: '100', network: 'lightning' },
        error: null,
      });

    const req = makeRequest({
      payment: {
        payload: {
          network: 'lightning',
          scheme: 'bolt12',
          paymentHash: 'hash456',
        },
      },
    });
    const res = await POST(req);
    const data = await res.json();

    expect(data.commission.merchantAmount).toBeDefined();
    expect(data.commission.platformFee).toBeDefined();
    expect(parseFloat(data.commission.merchantAmount)).toBeGreaterThan(0);
    expect(parseFloat(data.commission.platformFee)).toBeGreaterThan(0);
  });

  it('should return 400 for unsupported network', async () => {
    mockSingle
      .mockResolvedValueOnce({
        data: { id: 'key1', business_id: 'biz1', active: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'p1', status: 'verified', amount: '10', network: 'dogecoin' },
        error: null,
      });

    const req = makeRequest({
      payment: {
        payload: { network: 'dogecoin', scheme: 'exact' },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Unsupported network');
  });

  it('should return 400 for non-verified payment status', async () => {
    mockSingle
      .mockResolvedValueOnce({
        data: { id: 'key1', business_id: 'biz1', active: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'p1', status: 'pending', amount: '10', network: 'base' },
        error: null,
      });

    const req = makeRequest({
      payment: {
        payload: { network: 'base', nonce: '123' },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Cannot settle payment in status: pending');
  });

  it('should return 500 for EVM settlement with missing txHash', async () => {
    mockSingle
      .mockResolvedValueOnce({
        data: { id: 'key1', business_id: 'biz1', active: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'p1', status: 'verified', amount: '5', network: 'base' },
        error: null,
      });

    const req = makeRequest({
      payment: {
        payload: { network: 'base', scheme: 'exact' },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.details).toContain('Missing txHash');
  });

  it('should return 500 for UTXO settlement with missing txId', async () => {
    mockSingle
      .mockResolvedValueOnce({
        data: { id: 'key1', business_id: 'biz1', active: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'p1', status: 'verified', amount: '0.001', network: 'bitcoin' },
        error: null,
      });

    const req = makeRequest({
      payment: {
        payload: { network: 'bitcoin', scheme: 'exact' },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.details).toContain('Missing txId');
  });

  it('should return 500 for Solana settlement with missing txSignature', async () => {
    mockSingle
      .mockResolvedValueOnce({
        data: { id: 'key1', business_id: 'biz1', active: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'p1', status: 'verified', amount: '1', network: 'solana' },
        error: null,
      });

    const req = makeRequest({
      payment: {
        payload: { network: 'solana', scheme: 'exact' },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.details).toContain('Missing txSignature');
  });

  it('should handle Stripe settlement with missing secret key', async () => {
    delete process.env.STRIPE_SECRET_KEY;

    mockSingle
      .mockResolvedValueOnce({
        data: { id: 'key1', business_id: 'biz1', active: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'p1', status: 'verified', amount: '5', network: 'stripe' },
        error: null,
      });

    const req = makeRequest({
      payment: {
        payload: {
          network: 'stripe',
          scheme: 'stripe-checkout',
          paymentIntentId: 'pi_test123',
        },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.details).toContain('Stripe not configured');
  });
});
