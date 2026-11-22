import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThorchainAdapter } from './thorchain';

// Response shapes copied from gateway.liquify.com/chain/thorchain_api on 2026-11-22.
const BTC_TO_ETH = {
  inbound_address: 'bc1q0y356csjsefu3gtqe505he6p40a8dm7kd6ayht',
  fees: { asset: 'ETH.ETH', affiliate: '0', outbound: '14523', liquidity: '70834', total: '85357', slippage_bps: 19, total_bps: 24 },
  expiry: 1795367907,
  dust_threshold: '1000',
  recommended_min_amount_in: '5958',
  memo: '=:e:0x00000000000000000000000000000000000000a1',
  expected_amount_out: '35339815',
  total_swap_seconds: 606,
  notes: 'First output should be to inbound_address...',
};
const INBOUNDS = [
  { chain: 'BTC', address: 'bc1q0y356csjsefu3gtqe505he6p40a8dm7kd6ayht', halted: false },
  { chain: 'ETH', address: '0xf5f4ef1edc78d91ba7ddb8be70435e3735d3a26e', router: '0xD37BbE5744D730a1d98d8DC97c42F0Ca46aD7146', halted: false },
];

function respond(body: unknown, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) } as unknown as Response;
}

const fetchMock = vi.fn();
const env = process.env;

beforeEach(() => {
  process.env = { ...env };
  delete process.env.THORCHAIN_AFFILIATE;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  process.env = env;
  vi.unstubAllGlobals();
});

const a = new ThorchainAdapter();
const req = { from: 'BTC', to: 'ETH', amount: '0.01', destinationAddress: '0x00000000000000000000000000000000000000a1' };

describe('ThorchainAdapter', () => {
  it('supports only assets with a THORChain pool', () => {
    expect(a.supports('BTC', 'USDC_BASE')).toBe(true);
    expect(a.supports('BTC', 'POL')).toBe(false);
    expect(a.supports('BTC', 'BTC')).toBe(false);
  });

  it('quotes in 1e8 units and normalises fees', async () => {
    fetchMock.mockResolvedValueOnce(respond(BTC_TO_ETH));
    const q = await a.quote(req);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toMatch(/\/thorchain\/quote\/swap$/);
    expect(url.searchParams.get('from_asset')).toBe('BTC.BTC');
    expect(url.searchParams.get('to_asset')).toBe('ETH.ETH');
    expect(url.searchParams.get('amount')).toBe('1000000');
    expect(url.searchParams.has('affiliate')).toBe(false);
    expect(q).toMatchObject({
      expectedAmountOut: '0.35339815',
      minAmountIn: '0.00005958',
      expiresAt: 1795367907000,
      etaSeconds: 606,
      verification: 'none',
      fees: { network: '0.00014523', liquidity: '0.00070834', total: '0.00085357', totalBps: 24 },
    });
  });

  it('adds an affiliate only when both env vars are valid', async () => {
    process.env.THORCHAIN_AFFILIATE = 'cp';
    process.env.THORCHAIN_AFFILIATE_BPS = '500'; // over the 100 bps cap: ignored
    fetchMock.mockResolvedValueOnce(respond(BTC_TO_ETH));
    await a.quote(req);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has('affiliate')).toBe(false);
    process.env.THORCHAIN_AFFILIATE_BPS = '30';
    fetchMock.mockResolvedValueOnce(respond(BTC_TO_ETH));
    await a.quote(req);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('affiliate_bps')).toBe('30');
  });

  it('maps dust errors to below_minimum', async () => {
    fetchMock.mockResolvedValueOnce(respond({ code: 3, message: 'amount less than dust threshold: invalid request' }, 400));
    await expect(a.quote({ ...req, amount: '0.000001' })).rejects.toMatchObject({ code: 'below_minimum' });
  });

  it('builds a send-with-memo plan from a fresh quote and a live vault', async () => {
    fetchMock.mockResolvedValueOnce(respond(BTC_TO_ETH)).mockResolvedValueOnce(respond(INBOUNDS));
    const o = await a.createOrder({} as never, req);
    expect(o.providerOrderId).toBeNull();
    expect(o.plan).toEqual({
      kind: 'send_with_memo',
      chain: 'BTC',
      to: BTC_TO_ETH.inbound_address,
      amount: '0.01',
      memo: BTC_TO_ETH.memo,
      router: undefined,
      expiresAt: 1795367907000,
    });
  });

  it('refuses to issue a plan for a halted chain or a rotated vault', async () => {
    fetchMock.mockResolvedValueOnce(respond(BTC_TO_ETH)).mockResolvedValueOnce(respond([{ ...INBOUNDS[0], halted: true }]));
    await expect(a.createOrder({} as never, req)).rejects.toMatchObject({ code: 'provider_unavailable' });
    fetchMock.mockResolvedValueOnce(respond(BTC_TO_ETH)).mockResolvedValueOnce(respond([{ ...INBOUNDS[0], address: 'bc1qother' }]));
    await expect(a.createOrder({} as never, req)).rejects.toThrow(/rotated/);
  });

  describe('getStatus', () => {
    const hash = 'a'.repeat(64);
    it('returns null until a tx hash exists', async () => {
      expect(await a.getStatus({ providerOrderId: null, inTxHash: null, route: {} })).toBeNull();
    });
    it('reports pending once observed', async () => {
      fetchMock.mockResolvedValueOnce(respond({ stages: { inbound_observed: { completed: true }, swap_finalised: { completed: false } } }));
      expect(await a.getStatus({ providerOrderId: null, inTxHash: hash, route: {} })).toEqual({ status: 'pending', providerStatus: 'inbound_observed' });
      expect(fetchMock.mock.calls[0][0]).toContain(`/thorchain/tx/status/${hash.toUpperCase()}`);
    });
    it('completes only with an outbound tx', async () => {
      fetchMock.mockResolvedValueOnce(respond({
        stages: { inbound_observed: { completed: true }, outbound_signed: { completed: true } },
        out_txs: [{ id: 'B'.repeat(64), coins: [{ asset: 'ETH.ETH', amount: '35339815' }], memo: 'OUT:AAAA' }],
      }));
      expect(await a.getStatus({ providerOrderId: null, inTxHash: hash, route: {} })).toEqual({
        status: 'completed', providerStatus: 'outbound_signed', outTxHash: 'B'.repeat(64), amountOut: '0.35339815',
      });
    });
    it('recognises a refund', async () => {
      fetchMock.mockResolvedValueOnce(respond({
        stages: { inbound_observed: { completed: true }, outbound_signed: { completed: true } },
        out_txs: [{ id: 'C'.repeat(64), coins: [{ asset: 'BTC.BTC', amount: '990000' }], memo: 'REFUND:AAAA' }],
      }));
      expect((await a.getStatus({ providerOrderId: null, inTxHash: hash, route: {} }))?.status).toBe('refunded');
    });
  });
});
