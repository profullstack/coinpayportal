import { describe, it, expect } from 'vitest';
import { NANO_MAINNET_CAIP2, isNanoV2Payment, nanoV2ToV1 } from './nano-v2';
import { isV2Payment } from './v2';
import { RAW_PER_XNO, nanoAddressFromPublicKey } from './nano';

const MERCHANT = nanoAddressFromPublicKey(new Uint8Array(32).fill(7));
const HASH = 'B'.repeat(64);
const PRICE = (RAW_PER_XNO / 1000n).toString(); // 0.001 XNO, derived from the raw unit
const RESOURCE = 'https://merchant.example/api/report';

/** A v2 proof shaped as standard `nano:mainnet` exact payers send it. */
function v2Proof(overrides: Record<string, unknown> = {}, accepted: Record<string, unknown> = {}) {
  return {
    x402Version: 2,
    scheme: 'exact',
    network: NANO_MAINNET_CAIP2,
    resource: { url: RESOURCE },
    accepted: {
      scheme: 'exact',
      network: NANO_MAINNET_CAIP2,
      amount: PRICE,
      asset: 'XNO',
      payTo: MERCHANT,
      maxTimeoutSeconds: 300,
      ...accepted,
    },
    payload: { blockHash: HASH },
    ...overrides,
  };
}

describe('isNanoV2Payment', () => {
  it('claims a v2 proof on nano:mainnet that isV2Payment would send to the EVM verifier', () => {
    const proof = v2Proof();
    // The bug this fixes: x402Version 2 alone routes to verifyV2 (EIP-3009 only).
    expect(isV2Payment(proof)).toBe(true);
    expect(isNanoV2Payment(proof)).toBe(true);
  });

  it('claims a proof that names nano:mainnet only in `accepted`', () => {
    const { network, ...rest } = v2Proof();
    expect(network).toBe(NANO_MAINNET_CAIP2);
    expect(isNanoV2Payment(rest)).toBe(true);
  });

  it('leaves EVM v2 proofs and v1 Nano proofs alone', () => {
    expect(isNanoV2Payment({ x402Version: 2, scheme: 'exact', network: 'eip155:8453', payload: {} })).toBe(false);
    expect(isNanoV2Payment({ payload: { network: 'nano', blockHash: HASH } })).toBe(false);
    expect(isNanoV2Payment(null)).toBe(false);
    expect(isNanoV2Payment('nano:mainnet')).toBe(false);
  });
});

describe('nanoV2ToV1', () => {
  it('produces the v1 Nano proof the existing verifier checks', () => {
    const result = nanoV2ToV1(v2Proof());
    expect(result).toEqual({
      ok: true,
      payment: {
        x402Version: 1,
        scheme: 'exact',
        payload: {
          network: 'nano',
          scheme: 'exact',
          blockHash: HASH,
          to: MERCHANT,
          amount: PRICE,
          asset: 'XNO',
          resource: RESOURCE,
        },
      },
    });
  });

  it('keys the replay identity on the same network as v1, so one block cannot be redeemed twice', () => {
    const result = nanoV2ToV1(v2Proof());
    if (!result.ok) throw new Error(result.error);
    // /verify and /settle use (normalised blockHash, payload.network) as the unique key.
    expect(result.payment.payload.network).toBe('nano');
    expect(result.payment.payload.blockHash).toBe(HASH);
  });

  it('carries the claimed price, recipient and resource for enforcePriceBinding to compare', () => {
    const result = nanoV2ToV1(v2Proof({ resource: undefined }, { resource: RESOURCE, amount: undefined, maxAmountRequired: PRICE }));
    if (!result.ok) throw new Error(result.error);
    expect(result.payment.payload.resource).toBe(RESOURCE);
    expect(result.payment.payload.amount).toBe(PRICE);
    expect(result.payment.payload.to).toBe(MERCHANT);
  });

  it('accepts a resource given as a plain URL string', () => {
    const result = nanoV2ToV1(v2Proof({ resource: RESOURCE }));
    if (!result.ok) throw new Error(result.error);
    expect(result.payment.payload.resource).toBe(RESOURCE);
  });

  it('refuses a proof without `accepted`', () => {
    const { accepted, ...rest } = v2Proof();
    expect(accepted).toBeTruthy();
    const result = nanoV2ToV1(rest);
    expect(result.ok).toBe(false);
  });

  it('refuses a scheme other than exact', () => {
    expect(nanoV2ToV1(v2Proof({ scheme: 'upto' })).ok).toBe(false);
    expect(nanoV2ToV1(v2Proof({}, { scheme: 'upto' })).ok).toBe(false);
  });

  it('refuses a top-level network that disagrees with `accepted`', () => {
    expect(nanoV2ToV1(v2Proof({ network: 'eip155:8453' })).ok).toBe(false);
    expect(nanoV2ToV1(v2Proof({}, { network: 'nano-mainnet' })).ok).toBe(false);
  });

  it('refuses a proof with no block hash, including an unpublished block', () => {
    expect(nanoV2ToV1(v2Proof({ payload: {} })).ok).toBe(false);
    expect(nanoV2ToV1(v2Proof({ payload: { block: { type: 'state' } } })).ok).toBe(false);
    expect(nanoV2ToV1(v2Proof({ payload: { blockHash: '' } })).ok).toBe(false);
  });
});
