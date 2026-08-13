/**
 * x402 price/resource binding tests
 * Testing Framework: Vitest
 *
 * Regression cover for the hole where a payment proof was bound to neither the
 * price nor the resource it bought. The facilitator checked that a proof was
 * well-signed and unused, and nothing else — so a proof minted for a $0.01
 * endpoint unlocked a $5.00 one.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildPaymentRequired,
  createX402Middleware,
  expectedForProof,
  verifyX402Payment,
} from '../src/x402.js';

const RATES = { BTC: 65000, ETH: 3500, SOL: 150, POL: 0.5, BCH: 350 };

const PAY_TO = {
  ethereum: '0xMerchantEth',
  bitcoin: 'bc1qmerchant',
  solana: 'So1Merchant',
};

/** Encode a payer proof the way the X-PAYMENT header carries it. */
function encodeProof(payload, extra = {}) {
  return Buffer.from(JSON.stringify({ scheme: 'exact', ...extra, payload })).toString('base64');
}

/** Minimal Express-ish req/res pair. */
function makeReqRes(paymentHeader, url = '/premium') {
  const req = {
    headers: paymentHeader ? { 'x-payment': paymentHeader } : {},
    protocol: 'https',
    originalUrl: url,
    get: () => 'api.example.com',
  };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return { req, res };
}

describe('expectedForProof', () => {
  const offer = buildPaymentRequired({
    payTo: PAY_TO,
    amountUsd: 5.0,
    rates: RATES,
    methods: ['eth', 'usdc_eth', 'btc'],
    resource: 'https://api.example.com/premium',
  });

  it('prices a proof by its declared methodKey', () => {
    const proof = encodeProof({ network: 'ethereum', methodKey: 'usdc_eth', amount: '5000000' });
    const expected = expectedForProof(proof, offer, 'https://api.example.com/premium');

    // $5.00 of USDC is 5000000 micro-units, not the ETH-denominated price.
    expect(expected.amount).toBe('5000000');
    expect(expected.resource).toBe('https://api.example.com/premium');
  });

  it('does not confuse two assets that share a network', () => {
    const ethProof = encodeProof({ network: 'ethereum', methodKey: 'eth', amount: '1' });
    const ethExpected = expectedForProof(ethProof, offer, 'https://api.example.com/premium');
    const usdcExpected = expectedForProof(
      encodeProof({ network: 'ethereum', methodKey: 'usdc_eth', amount: '1' }),
      offer,
      'https://api.example.com/premium'
    );

    // ETH is 18 decimals, USDC is 6 — collapsing them would misprice by 1e12.
    expect(ethExpected.amount).not.toBe(usdcExpected.amount);
  });

  it('returns null for a proof on a network that was never offered', () => {
    const proof = encodeProof({ network: 'solana', methodKey: 'sol', amount: '1' });
    expect(expectedForProof(proof, offer, 'https://api.example.com/premium')).toBeNull();
  });

  it('returns null for a malformed header rather than guessing a price', () => {
    expect(expectedForProof('!!!not-base64!!!', offer, 'r')).toBeNull();
  });
});

describe('verifyX402Payment', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to verify without an expected price', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const proof = encodeProof({ network: 'ethereum', amount: '1' });
    const result = await verifyX402Payment(proof, { apiKey: 'cp_test' });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/expected/i);
    // It must not reach the facilitator at all — there is nothing to check.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the expected amount and resource to the facilitator', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ valid: true, payment: { amount: '5000000' } }),
    });
    global.fetch = fetchSpy;

    const proof = encodeProof({ network: 'ethereum', amount: '5000000' });
    await verifyX402Payment(proof, {
      apiKey: 'cp_test',
      expected: { amount: '5000000', resource: 'https://api.example.com/premium' },
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.expected).toEqual({
      amount: '5000000',
      resource: 'https://api.example.com/premium',
    });
  });
});

describe('x402 middleware price binding', () => {
  let middleware;
  let fetchSpy;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ valid: true, payment: { pendingConfirmation: false } }),
    });
    global.fetch = fetchSpy;

    const x402 = createX402Middleware({
      apiKey: 'cp_test',
      payTo: PAY_TO,
      rates: RATES,
      methods: ['usdc_eth'],
    });
    middleware = x402({ amountUsd: 5.0 });
  });

  it('still answers an unpaid request with a 402 offer', async () => {
    const { req, res } = makeReqRes(null);
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(402);
    expect(res.body.accepts.length).toBeGreaterThan(0);
    expect(next).not.toHaveBeenCalled();
  });

  it('tells the facilitator the asking price for a paid request', async () => {
    const proof = encodeProof({ network: 'ethereum', methodKey: 'usdc_eth', amount: '5000000' });
    const { req, res } = makeReqRes(proof);
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    // $5.00 in USDC micro-units, and the URL being bought.
    expect(body.expected.amount).toBe('5000000');
    expect(body.expected.resource).toBe('https://api.example.com/premium');
  });

  it('rejects a proof for a method that was never offered', async () => {
    // Bitcoin is not in `methods`, so there is no advertised price to hold
    // this proof to. Previously it was forwarded and verified anyway.
    const proof = encodeProof({ network: 'bitcoin', methodKey: 'btc', amount: '1' });
    const { req, res } = makeReqRes(proof);
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(402);
    expect(next).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not serve content on an unconfirmed payment by default', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ valid: true, payment: { pendingConfirmation: true } }),
    });

    const proof = encodeProof({ network: 'ethereum', methodKey: 'usdc_eth', amount: '5000000' });
    const { req, res } = makeReqRes(proof);
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(402);
    expect(res.body.error).toMatch(/not confirmed/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('serves an unconfirmed payment when the merchant opts in', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ valid: true, payment: { pendingConfirmation: true } }),
    });

    const x402 = createX402Middleware({
      apiKey: 'cp_test',
      payTo: PAY_TO,
      rates: RATES,
      methods: ['usdc_eth'],
      allowPendingConfirmation: true,
    });
    const permissive = x402({ amountUsd: 5.0 });

    const proof = encodeProof({ network: 'ethereum', methodKey: 'usdc_eth', amount: '5000000' });
    const { req, res } = makeReqRes(proof);
    const next = vi.fn();

    await permissive(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('prices each route independently, so a cheap proof cannot buy an expensive route', async () => {
    const x402 = createX402Middleware({
      apiKey: 'cp_test',
      payTo: PAY_TO,
      rates: RATES,
      methods: ['usdc_eth'],
    });
    const cheap = x402({ amountUsd: 0.01 });
    const pricey = x402({ amountUsd: 5.0 });

    const proof = encodeProof({ network: 'ethereum', methodKey: 'usdc_eth', amount: '10000' });

    const cheapCall = makeReqRes(proof, '/cheap');
    await cheap(cheapCall.req, cheapCall.res, vi.fn());
    const cheapExpected = JSON.parse(fetchSpy.mock.calls[0][1].body).expected;

    fetchSpy.mockClear();
    const priceyCall = makeReqRes(proof, '/premium');
    await pricey(priceyCall.req, priceyCall.res, vi.fn());
    const priceyExpected = JSON.parse(fetchSpy.mock.calls[0][1].body).expected;

    // The $0.01 proof is presented to both routes; the facilitator is told the
    // real price of each, which is what makes the underpayment detectable.
    expect(cheapExpected.amount).toBe('10000');
    expect(priceyExpected.amount).toBe('5000000');
    expect(cheapExpected.resource).not.toBe(priceyExpected.resource);
  });
});
