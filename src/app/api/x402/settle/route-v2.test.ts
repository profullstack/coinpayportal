/**
 * POST /api/x402/settle with a v2 (EIP-3009) proof.
 *
 * A v2 proof names its chain as CAIP-2 (`eip155:8453`), which the v1 network
 * table does not list, and the v1 scheme check ran on every proof — so every
 * v2 proof was refused at the door with "Unsupported network: eip155:8453"
 * after verify had already accepted and recorded it. Measured live on
 * 2026-09-05 by paying rssamplifier.com's gateway from a Node client: the
 * buyer's authorization was verified, nothing settled, and the gateway
 * answered 402. These tests hold the door open for v2 and closed for the
 * shapes it should still refuse.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

const mockSingle = vi.fn();
const mockEq = vi.fn();

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
  // The settle claim is a conditional update that must return the claimed row.
  chain.then = (resolve: any) =>
    Promise.resolve(isWrite ? { data: [{ id: 'p1' }], error: null } : { data: null, error: null }).then(resolve);
  return chain;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: vi.fn(() => makeQueryChain()) }),
}));

const mockResolveScopedKey = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/scoped-keys', () => ({
  resolveScopedKey: mockResolveScopedKey,
  scopesSatisfy: (granted: string[], required: string) => granted.includes('*') || granted.includes(required),
}));

vi.mock('@/lib/entitlements/service', () => ({
  isBusinessPaidTier: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/payments/fees', () => ({
  splitTieredPayment: vi.fn((amount: number) => ({
    merchantAmount: amount * 0.995,
    platformFee: amount * 0.005,
    total: amount,
    feePercentage: 0.005,
  })),
}));

// The v2 settler broadcasts through the gas relayer, which a unit test must
// not reach. The route imports it lazily; vi.mock covers dynamic imports too.
const mockSettleExactEvmV2 = vi.hoisted(() => vi.fn());
vi.mock('@/lib/x402/settle-v2', () => ({ settleExactEvmV2: mockSettleExactEvmV2 }));

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/x402/settle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/x402/settle — v2 (EIP-3009) proofs name their chain as CAIP-2', () => {
  const NONCE = '0x' + '22'.repeat(32);
  const PAYER = '0x9dBA414637c611a16BEa6f0796BFcbcBdc410df8';
  const PAYEE = '0xCC3b072391AE7A8d10cF00DdC5F61DB2cA5541E5';
  const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

  function v2Payment(overrides: Record<string, unknown> = {}) {
    return {
      x402Version: 2,
      scheme: 'exact',
      network: 'eip155:8453',
      payload: {
        signature: '0xsig',
        authorization: {
          from: PAYER,
          to: PAYEE,
          value: '1000000',
          validAfter: '0',
          validBefore: String(Math.floor(Date.now() / 1000) + 600),
          nonce: NONCE,
        },
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockSingle.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockResolveScopedKey.mockResolvedValue({
      keyId: 'key1',
      business: { id: 'biz1', merchant_id: 'm1', name: 'Biz', active: true },
      scopes: ['payments:create'],
    });
    mockSingle.mockResolvedValue({
      data: {
        id: 'p1',
        status: 'verified',
        amount: '1000000',
        network: 'eip155:8453',
        to_address: PAYEE,
        asset: USDC_BASE,
        unique_key: NONCE,
      },
      error: null,
    });
    mockSettleExactEvmV2.mockResolvedValue({ txHash: '0xabc' });
  });

  it('settles a v2 proof on eip155:8453 instead of refusing the network', async () => {
    const res = await POST(makeRequest({ payment: v2Payment() }));
    const data = await res.json();

    expect(data.error).toBeUndefined();
    expect(res.status).toBe(200);
    expect(mockSettleExactEvmV2).toHaveBeenCalledWith(
      expect.objectContaining({ network: 'eip155:8453', asset: USDC_BASE, signature: '0xsig' }),
    );
    // The ledger row is looked up under the CAIP-2 name verify stored it as,
    // keyed by the EIP-3009 nonce.
    expect(mockEq).toHaveBeenCalledWith('network', 'eip155:8453');
    expect(mockEq).toHaveBeenCalledWith('unique_key', NONCE);
  });

  it('still refuses a v2 proof whose scheme is not exact', async () => {
    const res = await POST(makeRequest({ payment: v2Payment({ scheme: 'upto' }) }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('not valid for an x402 v2 proof');
    expect(mockSettleExactEvmV2).not.toHaveBeenCalled();
  });

  it('still refuses a v2 proof on a chain settlement cannot reach', async () => {
    const res = await POST(
      makeRequest({ payment: v2Payment({ network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' }) }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Unsupported network');
    expect(mockSettleExactEvmV2).not.toHaveBeenCalled();
  });

  it('a v1 proof still goes through the v1 network table', async () => {
    mockSingle.mockResolvedValue({
      data: { id: 'p1', status: 'verified', amount: '10', network: 'dogecoin', to_address: 'D-house', asset: null },
      error: null,
    });
    const res = await POST(makeRequest({ payment: { payload: { network: 'dogecoin', scheme: 'exact' } } }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Unsupported network');
  });
});
