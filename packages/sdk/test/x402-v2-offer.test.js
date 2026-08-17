/**
 * Quoting x402 v2 from the middleware.
 *
 * Verifying v2 proofs is only half of speaking the protocol. A facilitator
 * that can verify v2 but only ever quotes v1 still cannot be paid by anyone,
 * because no standard wallet can read the offer it hands out.
 */
import { describe, it, expect, vi } from 'vitest';
import { createX402Middleware, expectedForProof } from '../src/x402.js';
import { buildPaymentRequiredV2, encodePaymentHeader } from '../src/x402-v2.js';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAYEE = '0x1111111111111111111111111111111111111111';
const PAYER = '0x9dBA414637c611a16BEa6f0796BFcbcBdc410df8';
const RESOURCE = 'http://localhost/premium';

function makeReqRes() {
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
  const req = {
    protocol: 'http',
    originalUrl: '/premium',
    headers: {},
    get: () => 'localhost',
  };
  return { req, res };
}

describe('middleware protocol version', () => {
  it('still quotes v1 by default, so existing payers are not broken', async () => {
    const x402 = createX402Middleware({ apiKey: 'k', payTo: PAYEE });
    const { req, res } = makeReqRes();

    await x402({ amountUsd: 0.01, methods: ['usdc_base'] })(req, res, () => {});

    expect(res.statusCode).toBe(402);
    expect(res.body.x402Version).toBe(1);
    expect(res.body.accepts[0]).toHaveProperty('maxAmountRequired');
  });

  it('quotes a real v2 offer when asked', async () => {
    const x402 = createX402Middleware({ apiKey: 'k', payTo: PAYEE, x402Version: 2 });
    const { req, res } = makeReqRes();

    await x402({ amountUsd: 0.01, methods: ['usdc_base'] })(req, res, () => {});

    expect(res.statusCode).toBe(402);
    expect(res.body.x402Version).toBe(2);

    const [entry] = res.body.accepts;
    expect(entry.network).toBe('eip155:8453');
    expect(entry.amount).toBe('10000');
    expect(entry).not.toHaveProperty('maxAmountRequired');
    expect(entry.extra).toEqual({ name: 'USD Coin', version: '2' });
  });

  it('refuses an unsupported protocol version rather than quoting nonsense', () => {
    expect(() => createX402Middleware({ apiKey: 'k', payTo: PAYEE, x402Version: 3 })).toThrow(
      /unsupported x402version/i,
    );
  });
});

describe('expectedForProof with a v2 proof', () => {
  const offer = buildPaymentRequiredV2({
    payTo: PAYEE,
    amountUsd: 0.01,
    resource: RESOURCE,
    methods: ['usdc_base'],
  });

  function v2Header(overrides = {}) {
    return encodePaymentHeader({
      x402Version: 2,
      scheme: 'exact',
      network: 'eip155:8453',
      payload: {
        signature: '0xsig',
        authorization: {
          from: PAYER,
          to: PAYEE,
          value: '10000',
          validAfter: '0',
          validBefore: '9999999999',
          nonce: '0x' + '11'.repeat(32),
          ...overrides,
        },
      },
    });
  }

  it('finds the offered price for a v2 proof', () => {
    const expected = expectedForProof(v2Header(), offer, RESOURCE);

    expect(expected).not.toBeNull();
    expect(expected.amount).toBe('10000');
    expect(expected.resource).toBe(RESOURCE);
  });

  it('supplies payTo and asset, which v2 verification cannot work without', () => {
    const expected = expectedForProof(v2Header(), offer, RESOURCE);

    // An EIP-3009 signature says nothing about which token it is denominated
    // in, so without the asset there is no domain to verify it against.
    expect(expected.payTo).toBe(PAYEE);
    expect(expected.asset).toBe(USDC_BASE);
  });

  it('takes the price from the offer, never from the proof', () => {
    // Payer claims to owe a single micro-unit.
    const expected = expectedForProof(v2Header({ value: '1' }), offer, RESOURCE);
    expect(expected.amount).toBe('10000');
  });

  it('returns null when the proof names a network that was not offered', () => {
    const header = encodePaymentHeader({
      x402Version: 2,
      network: 'eip155:1',
      payload: {
        signature: '0xsig',
        authorization: { from: PAYER, to: PAYEE, value: '10000', nonce: '0x1' },
      },
    });

    expect(expectedForProof(header, offer, RESOURCE)).toBeNull();
  });

  it('still handles v1 proofs unchanged', () => {
    const v1Offer = {
      accepts: [
        {
          network: 'base',
          asset: USDC_BASE,
          maxAmountRequired: '10000',
          extra: { methodKey: 'usdc_base' },
        },
      ],
    };
    const v1Header = Buffer.from(
      JSON.stringify({ payload: { network: 'base', asset: USDC_BASE, methodKey: 'usdc_base' } }),
    ).toString('base64');

    const expected = expectedForProof(v1Header, v1Offer, RESOURCE);
    expect(expected.amount).toBe('10000');
    // v1 verification does not take these, and must not start receiving them.
    expect(expected.payTo).toBeUndefined();
  });
});
