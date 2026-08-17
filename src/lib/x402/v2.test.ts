import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

// The token domain is read from the chain. Stub the resolver so these tests
// exercise the verification logic rather than an RPC round-trip.
const mockResolvePermitDomain = vi.hoisted(() => vi.fn());
vi.mock('@/lib/wallets/evm-gas', () => ({
  resolvePermitDomain: mockResolvePermitDomain,
}));

import {
  isV2Payment,
  evmChainId,
  verifyExactEvmV2,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
} from './v2';
import { TRANSFER_WITH_AUTHORIZATION_TYPES as SDK_TYPES } from '../../../packages/sdk/src/x402-v2.js';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAYEE = '0x1111111111111111111111111111111111111111';

// A real key, so signatures are genuinely recovered rather than stubbed.
const wallet = new ethers.Wallet(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);

const DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: USDC_BASE,
};

function authorization(overrides: Record<string, string> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    from: wallet.address,
    to: PAYEE,
    value: '6000',
    validAfter: '0',
    validBefore: String(now + 600),
    nonce: '0x' + '11'.repeat(32),
    ...overrides,
  };
}

async function signedPayment(overrides: Record<string, string> = {}, domain = DOMAIN) {
  const auth = authorization(overrides);
  const signature = await wallet.signTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, auth);
  return {
    x402Version: 2,
    scheme: 'exact',
    network: 'eip155:8453',
    payload: { signature, authorization: auth },
  };
}

const expected = { amount: '6000', payTo: PAYEE, asset: USDC_BASE };

beforeEach(() => {
  vi.clearAllMocks();
  mockResolvePermitDomain.mockResolvedValue(DOMAIN);
});

describe('struct definition', () => {
  it('matches the SDK exactly, or the payer signs what we cannot verify', () => {
    expect(TRANSFER_WITH_AUTHORIZATION_TYPES).toEqual(SDK_TYPES);
  });
});

describe('isV2Payment', () => {
  it('recognises a v2 proof by its nested authorization', () => {
    expect(
      isV2Payment({ payload: { signature: '0xsig', authorization: { nonce: '0x1' } } }),
    ).toBe(true);
  });

  it('recognises an explicit x402Version: 2', () => {
    expect(isV2Payment({ x402Version: 2, payload: {} })).toBe(true);
  });

  it('does not mistake a v1 proof for v2', () => {
    expect(
      isV2Payment({ payload: { network: 'base', to: '0xb', amount: '6000', nonce: '0xabc' } }),
    ).toBe(false);
  });

  it('tolerates junk', () => {
    expect(isV2Payment(null)).toBe(false);
    expect(isV2Payment('nope')).toBe(false);
    expect(isV2Payment({})).toBe(false);
  });
});

describe('evmChainId', () => {
  it('reads CAIP-2 ids', () => {
    expect(evmChainId('eip155:8453')).toBe(8453);
    expect(evmChainId('eip155:1')).toBe(1);
  });

  it('still accepts legacy bare names', () => {
    expect(evmChainId('base')).toBe(8453);
  });

  it('rejects non-EVM networks', () => {
    expect(evmChainId('solana')).toBeNull();
    expect(evmChainId('bitcoin')).toBeNull();
    expect(evmChainId(null)).toBeNull();
  });
});

describe('verifyExactEvmV2', () => {
  it('accepts a correctly signed authorization', async () => {
    const result = await verifyExactEvmV2(await signedPayment(), expected);

    expect(result.valid).toBe(true);
    expect(result.payment).toMatchObject({
      from: wallet.address,
      to: PAYEE,
      amount: '6000',
      network: 'eip155:8453',
      uniqueKey: '0x' + '11'.repeat(32),
    });
  });

  it('uses the EIP-3009 nonce as the replay key', async () => {
    const nonce = '0x' + 'ab'.repeat(32);
    const result = await verifyExactEvmV2(await signedPayment({ nonce }), expected);
    expect(result.payment?.uniqueKey).toBe(nonce);
  });

  it('accepts an overpayment', async () => {
    const result = await verifyExactEvmV2(await signedPayment({ value: '9999' }), expected);
    expect(result.valid).toBe(true);
  });

  it('rejects an underpayment', async () => {
    const result = await verifyExactEvmV2(await signedPayment({ value: '5999' }), expected);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/underpayment/i);
  });

  it('compares amounts as integers, not floats', async () => {
    const owed = '10000000000000000000000';
    const paid = '9999999999999999999999';
    const result = await verifyExactEvmV2(await signedPayment({ value: paid }), {
      ...expected,
      amount: owed,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/underpayment/i);
  });

  it('rejects an authorization that pays someone else', async () => {
    const result = await verifyExactEvmV2(
      await signedPayment({ to: '0x2222222222222222222222222222222222222222' }),
      expected,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/is paid to/i);
  });

  it('rejects an expired authorization', async () => {
    const past = String(Math.floor(Date.now() / 1000) - 10);
    const result = await verifyExactEvmV2(await signedPayment({ validBefore: past }), expected);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/expired/i);
  });

  it('rejects an authorization that is not valid yet', async () => {
    const future = String(Math.floor(Date.now() / 1000) + 300);
    const result = await verifyExactEvmV2(await signedPayment({ validAfter: future }), expected);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not valid yet/i);
  });

  it('rejects a signature from a different key', async () => {
    const payment = await signedPayment();
    // Same authorization, but claim a different payer.
    payment.payload.authorization.from = '0x3333333333333333333333333333333333333333';

    const result = await verifyExactEvmV2(payment, expected);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid payment signature/i);
  });

  it('rejects a signature made against a domain the token does not use', async () => {
    // Signed under the old bespoke x402 domain — exactly what a v1 client
    // would produce, and precisely what must not verify.
    const bogus = { name: 'x402', version: '1', chainId: 8453, verifyingContract: USDC_BASE };
    const payment = await signedPayment({}, bogus);

    const result = await verifyExactEvmV2(payment, expected);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid payment signature/i);
  });

  it('does not let the payer nominate the domain', async () => {
    // The chain says the domain is DOMAIN; a proof signed under anything else
    // must fail even if the proof itself claims otherwise.
    mockResolvePermitDomain.mockResolvedValue(DOMAIN);
    const payment = await signedPayment({}, { ...DOMAIN, name: 'Attacker Coin' });

    expect((await verifyExactEvmV2(payment, expected)).valid).toBe(false);
  });

  it('refuses a token with no EIP-712 domain', async () => {
    mockResolvePermitDomain.mockResolvedValue(null);
    const result = await verifyExactEvmV2(await signedPayment(), expected);

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/does not expose an EIP-712 domain/i);
  });

  it('rejects a non-EVM network', async () => {
    const payment = await signedPayment();
    payment.network = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

    const result = await verifyExactEvmV2(payment, expected);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not an evm network/i);
  });

  it('rejects an incomplete authorization', async () => {
    const payment = await signedPayment();
    delete (payment.payload.authorization as Record<string, unknown>).nonce;

    const result = await verifyExactEvmV2(payment, expected);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/missing `nonce`/i);
  });

  it('rejects a proof with no signature', async () => {
    const payment = await signedPayment();
    delete (payment.payload as Record<string, unknown>).signature;

    const result = await verifyExactEvmV2(payment, expected);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/authorization and payload.signature/i);
  });

  it('refuses when the asset is unknown, since the domain cannot be resolved', async () => {
    const result = await verifyExactEvmV2(await signedPayment(), { ...expected, asset: '' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/expected\.asset/i);
  });

  it('reports a malformed signature rather than throwing', async () => {
    const payment = await signedPayment();
    payment.payload.signature = '0xdeadbeef';

    const result = await verifyExactEvmV2(payment, expected);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/malformed signature/i);
  });
});
