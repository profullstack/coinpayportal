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
import { createHash } from 'crypto';

// Mock Supabase
const mockFrom = vi.fn();
const mockSelect = vi.fn().mockReturnThis();
const mockEq = vi.fn().mockReturnThis();
const mockSingle = vi.fn();
// The Lightning verifier reads `ln_payments` to confirm a real settled invoice
// exists, so the double needs a `maybeSingle`. Default: no such payment.
const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
const mockInsert = vi.fn().mockReturnValue({ error: null });

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      mockFrom(table);
      return {
        select: mockSelect,
        eq: mockEq,
        single: mockSingle,
        maybeSingle: mockMaybeSingle,
        insert: mockInsert,
      };
    },
  }),
}));

// API keys live in `business_api_keys` and are matched by an HMAC of the raw
// key; the route delegates that to resolveScopedKey. (It used to query a table
// called `api_keys` that does not exist, comparing a raw key to a hash column,
// so the "authentication" was whatever that failed query happened to return.)
const mockResolveScopedKey = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/scoped-keys', () => ({
  resolveScopedKey: mockResolveScopedKey,
  // The routes now check the key's scopes, which were resolved and then ignored
  // — so any valid key, including a read-only one, could verify and settle
  // payments. Real implementation, so a test that grants the wrong scope fails.
  scopesSatisfy: (granted: string[], required: string) =>
    granted.includes('*') || granted.includes(required),
}));

// Mock ethers
// The v2 verifier does real cryptography against a real token domain and is
// covered in src/lib/x402/v2.test.ts. Here only the route's own behaviour is
// under test — what it demands, what it records, how it answers — so the
// verdict is stubbed. `isV2Payment` stays real, because routing to the v2 path
// at all is part of what these tests check.
const mockVerifyExactEvmV2 = vi.hoisted(() => vi.fn());
vi.mock('@/lib/x402/v2', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/x402/v2')>()),
  verifyExactEvmV2: mockVerifyExactEvmV2,
}));

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
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockResolveScopedKey.mockResolvedValue({
      keyId: 'key1',
      business: { id: 'biz1', merchant_id: 'm1', name: 'Biz', active: true },
      scopes: ['payments:create'],
    });
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
    // resolveScopedKey returns null for revoked keys and inactive businesses.
    mockResolveScopedKey.mockResolvedValue(null);

    const req = makeRequest({ proof: 'base64stuff' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('should return 400 for missing proof', async () => {
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('proof');
  });

  it('should return 400 for invalid base64 proof', async () => {
    const req = makeRequest({ proof: '!!!invalid-base64!!!' });
    const res = await POST(req);
    const data = await res.json();
    // Should either be 400 or handle gracefully
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('should return 400 for expired payment proof', async () => {
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

    // Replay is now caught by the unique index on (unique_key, network) rather
    // than a read-then-write check, which two concurrent verifies could both
    // pass and which silently allowed everything when the table was missing.
    mockInsert.mockReturnValueOnce({
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    // Stripe API reports the PaymentIntent succeeded
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'succeeded', amount_received: 100 }),
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

    const req = makeRequest({ payment, expected: { amount: '100', resource: RESOURCE, payTo: '0xMerchant' } });
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
        expected: { amount: '5000000', resource: RESOURCE, payTo: '0xMerchant' },
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
        expected: { amount: '10000', resource: RESOURCE, payTo: '0xMerchant' },
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
        expected: { amount: '10000', resource: RESOURCE, payTo: '0xMerchant' },
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
        expected: { amount: '10000', resource: RESOURCE, payTo: '0xMerchant' },
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
        expected: { amount: owed, resource: RESOURCE, payTo: '0xMerchant' },
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
        expected: { amount: '10000', resource: RESOURCE, payTo: '0xMerchant' },
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
        expected: { amount: '10000', resource: RESOURCE, payTo: '0xMerchant' },
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toMatch(/replay-checked/i);
    });
  });

  /**
   * How the payee is stored decides whether settlement can ever find it.
   *
   * The payee used to be written as `payload.to.toLowerCase()` for every
   * network. `/settle` then compares that stored string against the address
   * the chain reports, which is in its true case — so on Bitcoin and Solana
   * the two could never be equal, no output was ever attributed to the payee,
   * and settlement failed as an underpayment on a transaction that had
   * actually paid in full.
   */
  describe('payee storage casing', () => {
    const BTC_PAYEE = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
    const SOL_PAYEE = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const EVM_PAYEE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

    function storedRow() {
      expect(mockInsert).toHaveBeenCalled();
      return mockInsert.mock.calls.at(-1)![0];
    }

    it('stores a Bitcoin payee in its exact case', async () => {
      mockInsert.mockReturnValueOnce({ error: null });

      const req = makeRequest({
        payment: {
          scheme: 'exact',
          payload: {
            network: 'bitcoin',
            from: '1PayerAddressXXXXXXXXXXXXXXXXXXXXXX',
            to: BTC_PAYEE,
            amount: '100000',
            txId: 'btctx',
            resource: RESOURCE,
          },
        },
        expected: { amount: '100000', resource: RESOURCE, payTo: BTC_PAYEE },
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(storedRow().to_address).toBe(BTC_PAYEE);
    });

    it('stores a Solana payee in its exact case', async () => {
      mockInsert.mockReturnValueOnce({ error: null });

      const req = makeRequest({
        payment: {
          scheme: 'exact',
          payload: {
            network: 'solana',
            from: 'PayerXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
            to: SOL_PAYEE,
            amount: '1000000',
            txSignature: 'soltx',
            resource: RESOURCE,
          },
        },
        expected: { amount: '1000000', resource: RESOURCE, payTo: SOL_PAYEE },
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(storedRow().to_address).toBe(SOL_PAYEE);
    });

    it('still lowercases EVM payees, where case is not significant', async () => {
      mockInsert.mockReturnValueOnce({ error: null });

      const req = makeRequest({
        payment: {
          scheme: 'exact',
          signature: '0xsig',
          payload: {
            network: 'base',
            from: '0xBuyerAddress',
            to: EVM_PAYEE,
            amount: '10000',
            nonce: '0xabc',
            asset: EVM_PAYEE,
            resource: RESOURCE,
          },
        },
        expected: { amount: '10000', resource: RESOURCE, payTo: EVM_PAYEE },
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(storedRow().to_address).toBe(EVM_PAYEE.toLowerCase());
    });
  });
});

/**
 * x402 v2 (EIP-3009) proofs.
 *
 * A v2 proof carries no `resource` field — EIP-3009 has nowhere to put one —
 * so it cannot go through the v1 price/resource binding and takes its own
 * path. These cover what that path demands and what it writes.
 */
describe('POST /api/x402/verify — v2 (EIP-3009) proofs', () => {
  const NONCE = '0x' + '11'.repeat(32);
  const PAYER = '0x9dBA414637c611a16BEa6f0796BFcbcBdc410df8';
  const V2_PAYEE = '0x1111111111111111111111111111111111111111';
  const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

  function v2Payment() {
    return {
      x402Version: 2,
      scheme: 'exact',
      network: 'eip155:8453',
      payload: {
        signature: '0xsig',
        authorization: {
          from: PAYER,
          to: V2_PAYEE,
          value: '6000',
          validAfter: '0',
          validBefore: String(Math.floor(Date.now() / 1000) + 600),
          nonce: NONCE,
        },
      },
    };
  }

  function fullExpectation(overrides: Record<string, unknown> = {}) {
    return { amount: '6000', resource: RESOURCE, payTo: V2_PAYEE, asset: USDC_BASE, ...overrides };
  }

  function storedRow() {
    expect(mockInsert).toHaveBeenCalled();
    return mockInsert.mock.calls.at(-1)![0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockResolveScopedKey.mockResolvedValue({
      keyId: 'key1',
      business: { id: 'biz1', merchant_id: 'm1', name: 'Biz', active: true },
      scopes: ['payments:create'],
    });
    mockVerifyExactEvmV2.mockResolvedValue({
      valid: true,
      payment: {
        from: PAYER,
        to: V2_PAYEE,
        amount: '6000',
        asset: USDC_BASE,
        network: 'eip155:8453',
        uniqueKey: NONCE,
        validBefore: '9999999999',
      },
    });
    mockInsert.mockReturnValue({ error: null });
  });

  it('verifies a v2 proof and answers with x402Version 2', async () => {
    const res = await POST(makeRequest({ payment: v2Payment(), expected: fullExpectation() }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.valid).toBe(true);
    expect(data.x402Version).toBe(2);
    expect(data.payment.network).toBe('eip155:8453');
  });

  it('records the EIP-3009 nonce as the replay key', async () => {
    await POST(makeRequest({ payment: v2Payment(), expected: fullExpectation() }));
    expect(storedRow().unique_key).toBe(NONCE);
  });

  it('records the resource even though the signature cannot bind it', async () => {
    await POST(makeRequest({ payment: v2Payment(), expected: fullExpectation() }));
    expect(storedRow().resource).toBe(RESOURCE);
  });

  it('never marks a v2 proof as pending — the signature is final', async () => {
    const res = await POST(makeRequest({ payment: v2Payment(), expected: fullExpectation() }));
    const data = await res.json();

    expect(data.payment.pendingConfirmation).toBe(false);
    expect(data.payment.amountAuthenticated).toBe(true);
    expect(storedRow().pending_confirmation).toBe(false);
  });

  it.each(['amount', 'resource', 'payTo', 'asset'])(
    'refuses when expected.%s is missing',
    async (field) => {
      const expected = fullExpectation();
      delete (expected as Record<string, unknown>)[field];

      const res = await POST(makeRequest({ payment: v2Payment(), expected }));
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain(field);
      expect(mockInsert).not.toHaveBeenCalled();
    },
  );

  it('passes the payee and asset through to the verifier', async () => {
    await POST(makeRequest({ payment: v2Payment(), expected: fullExpectation() }));

    expect(mockVerifyExactEvmV2).toHaveBeenCalledWith(expect.anything(), {
      amount: '6000',
      payTo: V2_PAYEE,
      asset: USDC_BASE,
    });
  });

  it("surfaces the verifier's rejection", async () => {
    mockVerifyExactEvmV2.mockResolvedValue({ valid: false, error: 'Invalid payment signature' });

    const res = await POST(makeRequest({ payment: v2Payment(), expected: fullExpectation() }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid payment signature/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('reports a replayed nonce', async () => {
    mockInsert.mockReturnValue({ error: { code: '23505', message: 'duplicate key' } });

    const res = await POST(makeRequest({ payment: v2Payment(), expected: fullExpectation() }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/replay/i);
  });

  it('fails closed when the proof cannot be recorded', async () => {
    mockInsert.mockReturnValue({ error: { code: '42P01', message: 'missing table' } });

    const res = await POST(makeRequest({ payment: v2Payment(), expected: fullExpectation() }));

    expect(res.status).toBe(503);
    expect((await res.json()).valid).toBeUndefined();
  });

  it('does not store the raw signature', async () => {
    await POST(makeRequest({ payment: v2Payment(), expected: fullExpectation() }));
    expect(storedRow().raw_proof).toContain('_redacted');
  });
});

/**
 * Regression tests for the 2026-08-19 audit's x402 findings.
 *
 * F-1.3-01 (Critical) — the Lightning proof was checked against itself:
 *   `sha256(preimage) === paymentHash`, both fields supplied by the payer. Any
 *   32 random bytes minted a valid proof for any amount, so every paid resource
 *   on this rail was free.
 * REC-C-01 (High)     — `scheme` and `network` are independent attacker-set
 *   fields, and dispatch fired on either. A proof labelled `bolt12`/`ethereum`
 *   took the Lightning branch while the response claimed `amountAuthenticated`,
 *   because that flag derives from the network.
 * F-1.3-02 (High)     — nothing compared the proof's recipient against the
 *   merchant, so a buyer could pay themselves.
 * F-1.3-03 (High)     — the asset was never pinned, so a worthless token
 *   satisfied the price.
 * R3-X1 (Medium)      — the Stripe branch checked the PaymentIntent's status
 *   but never its amount.
 */
describe('POST /api/x402/verify — audit regressions', () => {
  const MERCHANT = '0xMerchant';

  beforeEach(() => {
    vi.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockResolveScopedKey.mockResolvedValue({
      keyId: 'key1',
      business: { id: 'biz1', merchant_id: 'm1', name: 'Biz', active: true },
      scopes: ['payments:create'],
    });
  });

  function lightningPayment(overrides: any = {}) {
    return {
      scheme: 'bolt12',
      payload: {
        network: 'lightning',
        scheme: 'bolt12',
        from: 'payer',
        to: MERCHANT,
        amount: '1000',
        resource: RESOURCE,
        // A self-consistent pair: sha256('') over an empty buffer. The point is
        // that the payer can always produce one.
        preimage: 'aa',
        paymentHash: createHash('sha256').update(Buffer.from('aa', 'hex')).digest('hex'),
        ...overrides,
      },
    };
  }

  const lightningExpectation = { amount: '1000', resource: RESOURCE, payTo: MERCHANT };

  it('rejects a self-certifying Lightning proof with no matching received payment', async () => {
    // The hash genuinely matches the preimage. That is the whole of what the
    // old check established, and it is worth nothing on its own.
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await POST(makeRequest({ payment: lightningPayment(), expected: lightningExpectation }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no settled lightning payment/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('accepts a Lightning proof backed by a settled incoming payment', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        payment_hash: lightningPayment().payload.paymentHash,
        business_id: 'biz1',
        direction: 'incoming',
        status: 'settled',
        amount_msat: 1000,
        preimage: 'aa',
      },
      error: null,
    });
    mockInsert.mockReturnValueOnce({ error: null });

    const res = await POST(makeRequest({ payment: lightningPayment(), expected: lightningExpectation }));

    expect(res.status).toBe(200);
    expect((await res.json()).valid).toBe(true);
  });

  it('rejects a Lightning payment that belongs to another business', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        payment_hash: lightningPayment().payload.paymentHash,
        business_id: 'someone-else',
        direction: 'incoming',
        status: 'settled',
        amount_msat: 1000,
      },
      error: null,
    });

    const res = await POST(makeRequest({ payment: lightningPayment(), expected: lightningExpectation }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/different business/i);
  });

  it('rejects a Lightning payment smaller than the asking price', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        payment_hash: lightningPayment().payload.paymentHash,
        business_id: 'biz1',
        direction: 'incoming',
        status: 'settled',
        amount_msat: 1,
      },
      error: null,
    });

    const res = await POST(makeRequest({ payment: lightningPayment(), expected: lightningExpectation }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/underpayment/i);
  });

  it('fails closed when the Lightning ledger cannot be read', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'connection refused' } });

    const res = await POST(makeRequest({ payment: lightningPayment(), expected: lightningExpectation }));

    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('refuses a bolt12 scheme on an EVM network instead of routing it to Lightning', async () => {
    // The combination that made REC-C-01 worse than a routing bug: the weakest
    // verifier ran, and the answer reported `amountAuthenticated: true`.
    const res = await POST(
      makeRequest({
        payment: lightningPayment({ network: 'ethereum' }),
        expected: { amount: '1000', resource: RESOURCE, payTo: MERCHANT },
      })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not valid on ethereum/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('refuses an unknown network outright', async () => {
    const res = await POST(
      makeRequest({
        payment: lightningPayment({ network: 'dogecoin', scheme: 'exact' }),
        expected: { amount: '1000', resource: RESOURCE, payTo: MERCHANT },
      })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unsupported network/i);
  });

  it('refuses to verify when the merchant does not say who should be paid', async () => {
    const res = await POST(
      makeRequest({ payment: lightningPayment(), expected: { amount: '1000', resource: RESOURCE } })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/expected\.payTo/i);
  });

  it('rejects a proof that pays someone other than the merchant', async () => {
    // The buyer pays themselves; amount and resource are both correct.
    const res = await POST(
      makeRequest({
        payment: lightningPayment({ to: '0xTheBuyersOwnAddress' }),
        expected: lightningExpectation,
      })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/recipient mismatch/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects a proof denominated in an asset the merchant did not price', async () => {
    const res = await POST(
      makeRequest({
        payment: lightningPayment({ asset: 'WORTHLESSCOIN' }),
        expected: { ...lightningExpectation, asset: 'USDC' },
      })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/asset mismatch/i);
  });

  it('rejects a Stripe proof whose PaymentIntent charged less than the price', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    // A real, succeeded, one-cent PaymentIntent — presented for a $50 resource.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'succeeded', amount_received: 1 }),
    }) as any;

    const res = await POST(
      makeRequest({
        payment: {
          scheme: 'stripe-checkout',
          payload: {
            network: 'stripe',
            scheme: 'stripe-checkout',
            from: 'buyer',
            to: MERCHANT,
            amount: '5000',
            resource: RESOURCE,
            paymentIntentId: 'pi_cheap',
          },
        },
        expected: { amount: '5000', resource: RESOURCE, payTo: MERCHANT },
      })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/underpayment/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

/**
 * Regression test for REC-C-03 (2026-08-19 audit).
 *
 * `resolveScopedKey` returns the key's scopes and both x402 routes ignored
 * them, so any valid key — including a read-only `wallet:read` one issued to an
 * integrator for a single narrow job — could verify and settle payments. On the
 * Stripe rail that means capturing real PaymentIntents.
 */
describe('POST /api/x402/verify — key scopes (REC-C-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('refuses a read-only key', async () => {
    mockResolveScopedKey.mockResolvedValue({
      keyId: 'key1',
      business: { id: 'biz1', merchant_id: 'm1', name: 'Biz', active: true },
      scopes: ['wallet:read'],
    });

    const res = await POST(
      makeRequest({
        payment: { scheme: 'exact', payload: { network: 'base', to: '0xM', amount: '1', resource: 'r' } },
        expected: { amount: '1', resource: 'r', payTo: '0xM' },
      })
    );

    expect(res.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('accepts a wildcard (legacy) key', async () => {
    mockResolveScopedKey.mockResolvedValue({
      keyId: 'key1',
      business: { id: 'biz1', merchant_id: 'm1', name: 'Biz', active: true },
      scopes: ['*'],
    });

    const res = await POST(
      makeRequest({
        payment: { scheme: 'exact', payload: { network: 'base', to: '0xM', amount: '1', resource: 'r' } },
        expected: { amount: '1', resource: 'r', payTo: '0xM' },
      })
    );

    // Past the scope gate — whatever it answers, it is not a 403 for scopes.
    expect(res.status).not.toBe(403);
  });
});
