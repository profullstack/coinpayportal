import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

vi.mock('./system-wallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./system-wallet')>();
  const { randomBytes } = await import('crypto');
  // Generated per run rather than written as a literal: a hardcoded 32-byte hex
  // string here is a valid secp256k1 key, so it reads as a committed credential
  // to secret scanners even though it is only a fixture. getGasRelayer just
  // needs the key to be well-formed — the assertions are on the address and
  // balance the mock returns.
  const key = randomBytes(32).toString('hex');
  return {
    ...actual,
    deriveGasRelayerWallet: vi.fn(() => ({
      address: '0x1111111111111111111111111111111111111111',
      privateKey: key,
    })),
  };
});

import { computeGasReserve, resolvePermitDomain, getGasRelayer } from './evm-gas';

describe('computeGasReserve', () => {
  it('withholds the surcharge share of the token amount', () => {
    // $140 invoice + $0.038 network fee, quoted as 140.038 USDC.
    const reserve = computeGasReserve(140.038, { network_fee_usd: 0.038, total_amount_usd: 140.038 });
    expect(reserve).toBeCloseTo(0.038, 6);
  });

  it('leaves the merchant whole after the split', () => {
    // The point of the reserve: merchant should net the original invoice
    // amount, not 99% of invoice-plus-surcharge.
    const cryptoAmount = 140.038;
    const reserve = computeGasReserve(cryptoAmount, {
      network_fee_usd: 0.038,
      total_amount_usd: 140.038,
    });
    const merchant = (cryptoAmount - reserve) * 0.99;
    expect(merchant).toBeCloseTo(138.6, 1);
  });

  it('returns 0 when the metadata has no surcharge, so old payments split unchanged', () => {
    expect(computeGasReserve(100, {})).toBe(0);
    expect(computeGasReserve(100, null)).toBe(0);
    expect(computeGasReserve(100, { network_fee_usd: 0, total_amount_usd: 100 })).toBe(0);
  });

  it('ignores malformed metadata rather than eating the payment', () => {
    expect(computeGasReserve(100, { network_fee_usd: 'abc', total_amount_usd: 100 })).toBe(0);
    expect(computeGasReserve(100, { network_fee_usd: 5, total_amount_usd: 0 })).toBe(0);
    expect(computeGasReserve(100, { network_fee_usd: -5, total_amount_usd: 100 })).toBe(0);
  });

  it('never withholds more than half, however wrong the metadata is', () => {
    // A surcharge larger than the payment would otherwise leave the merchant
    // with nothing; cap it well before that.
    expect(computeGasReserve(100, { network_fee_usd: 900, total_amount_usd: 100 })).toBe(50);
  });
});

describe('resolvePermitDomain', () => {
  const chainId = 1n;
  const verifyingContract = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

  function tokenStub(overrides: Record<string, any>) {
    return {
      getAddress: async () => verifyingContract,
      name: async () => 'USD Coin',
      ...overrides,
    } as any;
  }

  it('picks the version whose domain hash the contract confirms', async () => {
    const expected = { name: 'USD Coin', version: '2', chainId, verifyingContract };
    const token = tokenStub({
      DOMAIN_SEPARATOR: async () => ethers.TypedDataEncoder.hashDomain(expected),
      version: async () => { throw new Error('not exposed'); },
    });

    const domain = await resolvePermitDomain(token, chainId);
    expect(domain).toMatchObject({ version: '2', name: 'USD Coin' });
  });

  it('matches version 1 tokens too', async () => {
    const expected = { name: 'USD Coin', version: '1', chainId, verifyingContract };
    const token = tokenStub({
      DOMAIN_SEPARATOR: async () => ethers.TypedDataEncoder.hashDomain(expected),
      version: async () => { throw new Error('not exposed'); },
    });

    expect(await resolvePermitDomain(token, chainId)).toMatchObject({ version: '1' });
  });

  it('returns null when no candidate matches, so the caller falls back', async () => {
    const token = tokenStub({
      DOMAIN_SEPARATOR: async () => ethers.keccak256(ethers.toUtf8Bytes('something else')),
      version: async () => { throw new Error('not exposed'); },
    });

    expect(await resolvePermitDomain(token, chainId)).toBeNull();
  });

  it('returns null for a token with no DOMAIN_SEPARATOR at all (e.g. USDT)', async () => {
    const token = tokenStub({
      DOMAIN_SEPARATOR: async () => { throw new Error('no such method'); },
    });

    expect(await resolvePermitDomain(token, chainId)).toBeNull();
  });
});

describe('getGasRelayer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the relayer balance so callers can report a broke float', async () => {
    const provider = {
      getBalance: vi.fn().mockResolvedValue(5_000_000_000_000_000n),
    } as any;

    const relayer = await getGasRelayer('USDC_ETH' as any, provider);

    expect(relayer.address).toBe('0x1111111111111111111111111111111111111111');
    expect(relayer.balance).toBe(5_000_000_000_000_000n);
    expect(provider.getBalance).toHaveBeenCalledWith('0x1111111111111111111111111111111111111111');
  });
});
