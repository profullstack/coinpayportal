import { describe, it, expect } from 'vitest';
import {
  X402_VERSION,
  CAIP2,
  toCaip2,
  fromCaip2,
  evmChainId,
  buildEip3009Domain,
  buildAuthorization,
  buildExactEvmPayment,
  encodePaymentHeader,
  decodePaymentHeader,
  selectAcceptEntry,
  requiredAmount,
  randomNonce,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  tokenDomain,
  V2_METHODS,
  buildPaymentRequiredV2,
} from '../src/x402-v2.js';

// USDC on Base, exactly as it appears in live discovery data.
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

describe('protocol version', () => {
  it('is 2, matching the ecosystem', () => {
    expect(X402_VERSION).toBe(2);
  });
});

describe('CAIP-2 network identifiers', () => {
  it('maps our chains to the ids other facilitators publish', () => {
    expect(CAIP2.base).toBe('eip155:8453');
    expect(CAIP2.ethereum).toBe('eip155:1');
    expect(CAIP2.polygon).toBe('eip155:137');
    expect(CAIP2.solana).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
  });

  it('translates bare legacy names', () => {
    expect(toCaip2('base')).toBe('eip155:8453');
    expect(fromCaip2('eip155:8453')).toBe('base');
  });

  it('passes through ids that are already CAIP-2', () => {
    expect(toCaip2('eip155:8453')).toBe('eip155:8453');
  });

  it('leaves unknown networks alone rather than inventing an id', () => {
    expect(toCaip2('bitcoin-cash')).toBe('bitcoin-cash');
    expect(toCaip2('lightning')).toBe('lightning');
  });

  it('extracts the numeric chain id only for eip155 chains', () => {
    expect(evmChainId('base')).toBe(8453);
    expect(evmChainId('eip155:137')).toBe(137);
    expect(evmChainId('solana')).toBeNull();
    expect(evmChainId('bitcoin')).toBeNull();
  });
});

describe('EIP-3009 domain', () => {
  it('uses the TOKEN as verifyingContract, not a bespoke x402 domain', () => {
    const domain = buildEip3009Domain({
      network: 'base',
      asset: USDC_BASE,
      name: 'USD Coin',
      version: '2',
    });

    expect(domain).toEqual({
      name: 'USD Coin',
      version: '2',
      chainId: 8453,
      verifyingContract: USDC_BASE,
    });
    // The old dialect used name 'x402' — the whole reason nothing interoperated.
    expect(domain.name).not.toBe('x402');
  });

  it('refuses to guess the token name or version', () => {
    expect(() => buildEip3009Domain({ network: 'base', asset: USDC_BASE, name: 'USD Coin' })).toThrow(
      /name and version/i,
    );
  });

  it('refuses a non-EVM network', () => {
    expect(() =>
      buildEip3009Domain({ network: 'solana', asset: USDC_BASE, name: 'x', version: '1' }),
    ).toThrow(/not an evm network/i);
  });

  it('refuses a missing token address', () => {
    expect(() => buildEip3009Domain({ network: 'base', name: 'x', version: '1' })).toThrow(
      /verifyingContract/i,
    );
  });

  it('declares the exact EIP-3009 struct', () => {
    expect(TRANSFER_WITH_AUTHORIZATION_TYPES.TransferWithAuthorization).toEqual([
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ]);
  });
});

describe('authorization', () => {
  it('builds a well-formed authorization', () => {
    const auth = buildAuthorization({ from: '0xPayer', to: '0xPayee', value: '6000' });

    expect(auth.from).toBe('0xPayer');
    expect(auth.to).toBe('0xPayee');
    expect(auth.value).toBe('6000');
    expect(auth.validAfter).toBe('0');
    expect(Number(auth.validBefore)).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(auth.nonce).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('leaves validAfter at 0 so clock skew cannot make it briefly invalid', () => {
    expect(buildAuthorization({ from: '0xa', to: '0xb', value: '1' }).validAfter).toBe('0');
  });

  it('keeps large values exact as strings', () => {
    const huge = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    expect(buildAuthorization({ from: '0xa', to: '0xb', value: huge }).value).toBe(huge);
  });

  it('requires from, to and value', () => {
    expect(() => buildAuthorization({ to: '0xb', value: '1' })).toThrow(/from/);
    expect(() => buildAuthorization({ from: '0xa', value: '1' })).toThrow(/to/);
    expect(() => buildAuthorization({ from: '0xa', to: '0xb' })).toThrow(/value/);
  });

  it('mints distinct nonces', () => {
    const seen = new Set(Array.from({ length: 50 }, () => randomNonce()));
    expect(seen.size).toBe(50);
  });
});

describe('payment header encoding', () => {
  it('round-trips a payment', () => {
    const payment = buildExactEvmPayment({
      network: 'base',
      signature: '0xsig',
      authorization: buildAuthorization({ from: '0xa', to: '0xb', value: '6000' }),
    });

    expect(payment.x402Version).toBe(2);
    expect(payment.network).toBe('eip155:8453');
    expect(payment.scheme).toBe('exact');

    expect(decodePaymentHeader(encodePaymentHeader(payment))).toEqual(payment);
  });

  it('survives non-ASCII content', () => {
    const payment = { x402Version: 2, note: 'café — 支払い' };
    expect(decodePaymentHeader(encodePaymentHeader(payment))).toEqual(payment);
  });
});

describe('selecting an accepts entry', () => {
  const accepts = [
    { network: 'bitcoin', payTo: 'bc1q' },
    { network: 'eip155:8453', payTo: '0xb' },
    { network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', payTo: 'So1' },
  ];

  it("honours the merchant's ordering among what the payer supports", () => {
    expect(selectAcceptEntry(accepts, ['eip155:8453', 'bitcoin']).network).toBe('bitcoin');
  });

  it('skips options the payer cannot sign', () => {
    expect(selectAcceptEntry(accepts, ['eip155:8453']).payTo).toBe('0xb');
  });

  it('accepts capabilities given as legacy names', () => {
    expect(selectAcceptEntry(accepts, ['base']).network).toBe('eip155:8453');
  });

  it('returns null when nothing matches', () => {
    expect(selectAcceptEntry(accepts, ['eip155:1'])).toBeNull();
    expect(selectAcceptEntry([], ['base'])).toBeNull();
    expect(selectAcceptEntry(undefined, ['base'])).toBeNull();
  });
});

describe('requiredAmount', () => {
  it('reads the v2 `amount` field', () => {
    expect(requiredAmount({ amount: '6000' })).toBe('6000');
  });

  it('still reads our v1 `maxAmountRequired`, so unmigrated 402s stay payable', () => {
    expect(requiredAmount({ maxAmountRequired: '6000' })).toBe('6000');
  });

  it('prefers `amount` when both are present', () => {
    expect(requiredAmount({ amount: '1', maxAmountRequired: '2' })).toBe('1');
  });

  it('throws when neither is present', () => {
    expect(() => requiredAmount({})).toThrow(/amount/i);
  });
});

describe('token domains', () => {
  it('publishes domains read from the deployed contracts', () => {
    // Verified over JSON-RPC against each deployment, and matching what
    // GoPlausible's discovery index publishes for Base.
    expect(tokenDomain('base', USDC_BASE)).toEqual({ name: 'USD Coin', version: '2' });
    expect(tokenDomain('eip155:1', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')).toEqual({
      name: 'USD Coin',
      version: '2',
    });
    expect(tokenDomain('polygon', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359')).toEqual({
      name: 'USD Coin',
      version: '2',
    });
  });

  it('matches regardless of address casing', () => {
    expect(tokenDomain('base', USDC_BASE.toLowerCase())).toEqual({ name: 'USD Coin', version: '2' });
  });

  it('returns null for a token whose domain we have not read', () => {
    expect(tokenDomain('base', '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toBeNull();
    expect(tokenDomain('base', undefined)).toBeNull();
  });

  it('quotes only tokens, since EIP-3009 cannot authorise native currency', () => {
    for (const method of Object.values(V2_METHODS)) {
      expect(method.asset).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });
});

describe('buildPaymentRequiredV2', () => {
  const payTo = '0x1111111111111111111111111111111111111111';
  const resource = 'https://api.example.com/premium';

  it('emits a v2 body a standard payer can read', () => {
    const body = buildPaymentRequiredV2({ payTo, amountUsd: 0.01, resource });

    expect(body.x402Version).toBe(2);
    expect(body.accepts.length).toBeGreaterThan(0);

    for (const entry of body.accepts) {
      expect(entry.scheme).toBe('exact');
      expect(entry.network).toMatch(/^eip155:\d+$/);
      expect(entry).toHaveProperty('amount');
      expect(entry).not.toHaveProperty('maxAmountRequired');
      expect(entry.extra).toEqual({ name: 'USD Coin', version: '2' });
    }
  });

  it('carries the token domain, without which nothing can be signed', () => {
    const [entry] = buildPaymentRequiredV2({
      payTo,
      amountUsd: 1,
      resource,
      methods: ['usdc_base'],
    }).accepts;

    expect(entry.extra.name).toBe('USD Coin');
    expect(entry.extra.version).toBe('2');
    expect(entry.asset).toBe(USDC_BASE);
  });

  it('converts USD to USDC micro-units', () => {
    const [entry] = buildPaymentRequiredV2({
      payTo,
      amountUsd: 0.05,
      resource,
      methods: ['usdc_base'],
    }).accepts;

    expect(entry.amount).toBe('50000');
  });

  it('rounds a sub-cent price UP, so a quote is never below the asking price', () => {
    const [entry] = buildPaymentRequiredV2({
      payTo,
      amountUsd: 0.0000005,
      resource,
      methods: ['usdc_base'],
    }).accepts;

    expect(entry.amount).toBe('1');
  });

  it('accepts an explicit smallest-unit amount', () => {
    const [entry] = buildPaymentRequiredV2({
      payTo,
      amount: '6000',
      resource,
      methods: ['usdc_base'],
    }).accepts;

    expect(entry.amount).toBe('6000');
  });

  it('resolves a per-network payTo map, by CAIP-2 or legacy name', () => {
    const body = buildPaymentRequiredV2({
      payTo: { 'eip155:8453': '0xBase', polygon: '0xPoly' },
      amountUsd: 1,
      resource,
      methods: ['usdc_base', 'usdc_polygon', 'usdc_eth'],
    });

    const byNetwork = Object.fromEntries(body.accepts.map((a) => [a.network, a.payTo]));
    expect(byNetwork['eip155:8453']).toBe('0xBase');
    expect(byNetwork['eip155:137']).toBe('0xPoly');
    // No Ethereum address supplied, so no Ethereum option is advertised.
    expect(byNetwork['eip155:1']).toBeUndefined();
  });

  it('honours an explicit method list', () => {
    const body = buildPaymentRequiredV2({ payTo, amountUsd: 1, resource, methods: ['usdc_base'] });
    expect(body.accepts).toHaveLength(1);
    expect(body.accepts[0].network).toBe('eip155:8453');
  });

  it('carries the resource so the payer knows what it is buying', () => {
    const [entry] = buildPaymentRequiredV2({ payTo, amountUsd: 1, resource, methods: ['usdc_base'] })
      .accepts;
    expect(entry.resource).toBe(resource);
  });

  it('throws rather than emitting an empty accepts array', () => {
    expect(() =>
      buildPaymentRequiredV2({
        payTo: { 'eip155:1': '0xa' },
        amountUsd: 1,
        resource,
        methods: ['usdc_base'],
      }),
    ).toThrow(/no payable options/i);
  });

  it('requires payTo, resource and a price', () => {
    expect(() => buildPaymentRequiredV2({ amountUsd: 1, resource })).toThrow(/payTo/);
    expect(() => buildPaymentRequiredV2({ payTo, amountUsd: 1 })).toThrow(/resource/);
    expect(() => buildPaymentRequiredV2({ payTo, resource })).toThrow(/amount/);
  });

  it('round-trips: what it quotes, selectAcceptEntry can choose and pay', () => {
    const body = buildPaymentRequiredV2({ payTo, amountUsd: 0.01, resource });
    const entry = selectAcceptEntry(body.accepts, ['eip155:8453']);

    expect(entry).not.toBeNull();
    expect(requiredAmount(entry)).toBe('10000');
    expect(() =>
      buildEip3009Domain({
        network: entry.network,
        asset: entry.asset,
        name: entry.extra.name,
        version: entry.extra.version,
      }),
    ).not.toThrow();
  });
});
