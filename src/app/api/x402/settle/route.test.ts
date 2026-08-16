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

// Mock Supabase.
//
// Reads resolve through `mockSingle`. Writes are separate: the route claims a
// payment with a conditional `update(...).eq(...).eq('status','verified')
// .select()` before it settles, so an update chain resolves to the claimed
// rows. `setClaimResult` lets a test model losing that race.
const mockSingle = vi.fn();
// Shared spy across every chain, so tests can assert which filters were applied.
const mockEq = vi.fn();
let claimResult: { data: any; error: any } = { data: [{ id: 'p1' }], error: null };

function setClaimResult(result: { data: any; error: any }) {
  claimResult = result;
}

function makeQueryChain() {
  const chain: any = {};
  let isWrite = false;

  for (const method of ['select', 'in', 'order', 'limit', 'not']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.eq = vi.fn((...args: unknown[]) => {
    mockEq(...args);
    return chain;
  });
  chain.single = mockSingle;
  chain.maybeSingle = mockSingle;
  chain.update = vi.fn(() => {
    isWrite = true;
    return chain;
  });
  chain.then = (resolve: any) =>
    Promise.resolve(isWrite ? claimResult : { data: null, error: null }).then(resolve);

  return chain;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: vi.fn(() => makeQueryChain()) }),
}));

// API keys live in `business_api_keys` and are looked up by an HMAC of the raw
// key; the route delegates that to resolveScopedKey. (It used to query a table
// called `api_keys` that does not exist, comparing a raw key to a hash column.)
const mockResolveScopedKey = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/scoped-keys', () => ({
  resolveScopedKey: mockResolveScopedKey,
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
    mockResolveScopedKey.mockResolvedValue({
      keyId: 'key1',
      business: { id: 'biz1', merchant_id: 'm1', name: 'Biz', active: true },
      scopes: [],
    });
    setClaimResult({ data: [{ id: 'p1' }], error: null });
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
    mockResolveScopedKey.mockResolvedValue(null);

    const req = makeRequest({ payment: { payload: { network: 'base' } } });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('should return 400 for missing payment data', async () => {
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid payment data');
  });

  it('should return 400 when verified payment not found', async () => {
    mockSingle
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
        data: { id: 'p1', status: 'settled', tx_hash: '0xold', amount: '5', network: 'base', to_address: '0xhouse', asset: null },
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
        data: { id: 'p1', status: 'verified', amount: '100', network: 'lightning', to_address: 'lnbc-house', asset: null },
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
        data: { id: 'p1', status: 'verified', amount: '100', network: 'lightning', to_address: 'lnbc-house', asset: null },
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
        data: { id: 'p1', status: 'verified', amount: '10', network: 'dogecoin', to_address: 'D-house', asset: null },
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
        data: { id: 'p1', status: 'pending', amount: '10', network: 'base', to_address: '0xhouse', asset: null },
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
        data: { id: 'p1', status: 'verified', amount: '5', network: 'base', to_address: '0xhouse', asset: null },
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
        data: { id: 'p1', status: 'verified', amount: '100000', network: 'bitcoin', to_address: 'bc1qhouse', asset: null },
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
        data: { id: 'p1', status: 'verified', amount: '1000000', network: 'solana', to_address: 'SoLHouse', asset: null },
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
        data: { id: 'p1', status: 'verified', amount: '500', network: 'stripe', to_address: 'acct_house', asset: null },
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
    expect(mockEq).toHaveBeenCalledWith('unique_key', 'pi_test123');
  });

  it('refuses to settle a payment whose record has no recipient', async () => {
    // Settlement verifies the chain against the recipient and amount the proof
    // was verified for. A record missing either cannot be checked, so it must
    // not settle rather than settling unchecked.
    mockSingle.mockResolvedValueOnce({
      data: { id: 'p1', status: 'verified', amount: '5', network: 'base', to_address: null },
      error: null,
    });

    const req = makeRequest({
      payment: { payload: { network: 'base', nonce: '1', txHash: '0xabc' } },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('missing a recipient');
  });

  it('refuses to settle when another request already claimed the payment', async () => {
    // Both requests pass the status reads; only the one that wins the
    // conditional update may settle.
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'p1',
        status: 'verified',
        amount: '100',
        network: 'lightning',
        to_address: 'lnbc-house',
        asset: null,
      },
      error: null,
    });
    setClaimResult({ data: [], error: null });

    const req = makeRequest({
      payment: { payload: { network: 'lightning', scheme: 'bolt12', paymentHash: 'h1' } },
    });
    const res = await POST(req);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('already being settled');
  });

  it('rejects an unauthenticated caller before touching the database', async () => {
    mockResolveScopedKey.mockResolvedValue(null);

    const req = makeRequest({ payment: { payload: { network: 'base' } } });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockSingle).not.toHaveBeenCalled();
  });
});
