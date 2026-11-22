import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compareDecimal, fromBaseUnits, isPositiveDecimal, toBaseUnits } from './decimal';
import { getAsset, normalizeAsset } from './assets';
import { evaluatePolicy } from './policy';
import { canTransition, isCancellable, isTerminal } from './state';
import { routeQuotes, setAdapters } from './router';
import { ExchangeError, type ExchangeAdapter, type ExchangeQuote } from './types';

const env = process.env;
beforeEach(() => {
  process.env = { ...env, EXCHANGE_ENGINE_ENABLED: 'true' };
});
afterEach(() => {
  process.env = env;
  setAdapters(null);
});

describe('decimal', () => {
  it('converts exactly, never via float', () => {
    expect(toBaseUnits('0.1', 8)).toBe(10_000_000n);
    expect(toBaseUnits('1.123456789', 8)).toBe(112_345_678n); // truncates
    expect(fromBaseUnits(35_339_815n, 8)).toBe('0.35339815');
    expect(fromBaseUnits('100000000', 8)).toBe('1');
    expect(fromBaseUnits(0n, 8)).toBe('0');
  });
  it('rejects non-decimals and zero', () => {
    expect(isPositiveDecimal('1e5')).toBe(false);
    expect(isPositiveDecimal('-1')).toBe(false);
    expect(isPositiveDecimal('0.000')).toBe(false);
    expect(isPositiveDecimal('0.01')).toBe(true);
  });
  it('compares exactly', () => {
    expect(compareDecimal('0.30000000000000001', '0.3')).toBe(1);
    expect(compareDecimal('1.0', '1')).toBe(0);
  });
});

describe('assets', () => {
  it('maps legacy aliases and refuses unknowns', () => {
    expect(normalizeAsset('usdc')).toBe('USDC_ETH');
    expect(normalizeAsset('btc')).toBe('BTC');
    expect(normalizeAsset('SHIB')).toBeNull();
  });
  it('uses THORChain pool ids in their upper-case form', () => {
    expect(getAsset('USDC_BASE')?.thorchain).toBe('BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913');
    expect(getAsset('USDT_ETH')?.thorchain).toBe('ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7');
    expect(getAsset('POL')?.thorchain).toBeUndefined();
  });
});

describe('policy', () => {
  const base = { rail: 'crypto_crypto' as const, from: 'BTC', to: 'ETH' };
  it('is off unless explicitly enabled', () => {
    delete process.env.EXCHANGE_ENGINE_ENABLED;
    expect(evaluatePolicy(base)).toMatchObject({ allow: false, reason: 'engine_disabled' });
  });
  it('allows crypto with unknown country', () => {
    expect(evaluatePolicy({ ...base, country: null })).toMatchObject({ allow: true });
  });
  it('blocks sanctioned countries', () => {
    expect(evaluatePolicy({ ...base, country: 'kp' })).toMatchObject({ allow: false, reason: 'jurisdiction_blocked' });
  });
  it('fails closed on every fiat rail', () => {
    expect(evaluatePolicy({ ...base, rail: 'fiat_crypto' })).toMatchObject({ allow: false, reason: 'jurisdiction_unknown' });
    expect(evaluatePolicy({ ...base, rail: 'fiat_crypto', country: 'US' })).toMatchObject({ allow: false, reason: 'fiat_jurisdiction_not_approved' });
    process.env.EXCHANGE_FIAT_APPROVED_JURISDICTIONS = 'US';
    expect(evaluatePolicy({ ...base, rail: 'crypto_fiat', country: 'US' })).toMatchObject({ allow: false, reason: 'fiat_provider_not_integrated' });
  });
  it('honours kill switches', () => {
    process.env.EXCHANGE_DISABLED_ASSETS = 'eth';
    expect(evaluatePolicy(base)).toMatchObject({ allow: false, reason: 'asset_disabled' });
    delete process.env.EXCHANGE_DISABLED_ASSETS;
    process.env.EXCHANGE_DISABLED_PROVIDERS = 'thorchain';
    expect(evaluatePolicy({ ...base, provider: 'thorchain' })).toMatchObject({ allow: false, reason: 'provider_disabled' });
    expect(evaluatePolicy({ ...base, provider: 'changenow' })).toMatchObject({ allow: true });
  });
});

describe('state machine', () => {
  it('walks the happy path', () => {
    expect(canTransition('created', 'awaiting_user_action')).toBe(true);
    expect(canTransition('awaiting_user_action', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'pending')).toBe(true);
    expect(canTransition('pending', 'completed')).toBe(true);
  });
  it('never leaves a terminal state or goes backwards', () => {
    for (const t of ['completed', 'failed', 'refunded', 'expired', 'cancelled'] as const) {
      expect(isTerminal(t)).toBe(true);
      expect(canTransition(t, 'pending')).toBe(false);
    }
    expect(canTransition('pending', 'awaiting_user_action')).toBe(false);
    expect(canTransition('submitted', 'cancelled')).toBe(false);
  });
  it('only lets the user cancel before sending', () => {
    expect(isCancellable('awaiting_user_action')).toBe(true);
    expect(isCancellable('submitted')).toBe(false);
  });
});

function fakeAdapter(id: 'thorchain' | 'changenow', out: string | Error, opts: Partial<ExchangeAdapter> = {}): ExchangeAdapter {
  return {
    id,
    label: id,
    isConfigured: () => true,
    supports: () => true,
    quote: vi.fn(async (req) => {
      if (out instanceof Error) throw out;
      return {
        provider: id, from: req.from, to: req.to, amountIn: req.amount, expectedAmountOut: out,
        fees: {}, expiresAt: null, etaSeconds: null,
        verification: id === 'changenow' ? 'provider_may_require' : 'none', warnings: [], route: {},
      } satisfies ExchangeQuote;
    }),
    createOrder: vi.fn(),
    getStatus: vi.fn(),
    ...opts,
  };
}

describe('router', () => {
  const req = { from: 'BTC', to: 'ETH', amount: '0.01' };

  it('ranks by delivered amount, exactly', async () => {
    setAdapters([fakeAdapter('thorchain', '0.35339815'), fakeAdapter('changenow', '0.35339816')]);
    const r = await routeQuotes(req);
    expect(r.quotes.map((q) => q.provider)).toEqual(['changenow', 'thorchain']);
  });

  it('prefers no-verification providers on a tie', async () => {
    setAdapters([fakeAdapter('changenow', '1'), fakeAdapter('thorchain', '1')]);
    expect((await routeQuotes(req)).quotes[0].provider).toBe('thorchain');
  });

  it('reports a failing provider without failing the request', async () => {
    setAdapters([
      fakeAdapter('thorchain', new ExchangeError('amount less than dust threshold', 'below_minimum')),
      fakeAdapter('changenow', '0.3'),
    ]);
    const r = await routeQuotes(req);
    expect(r.quotes).toHaveLength(1);
    expect(r.unavailable).toEqual([{ provider: 'thorchain', reason: 'amount less than dust threshold', code: 'below_minimum' }]);
  });

  it('skips unconfigured and killed providers before calling them', async () => {
    const cn = fakeAdapter('changenow', '1', { isConfigured: () => false });
    const tc = fakeAdapter('thorchain', '1');
    process.env.EXCHANGE_DISABLED_PROVIDERS = 'thorchain';
    setAdapters([tc, cn]);
    const r = await routeQuotes(req);
    expect(r.quotes).toHaveLength(0);
    expect(tc.quote).not.toHaveBeenCalled();
    expect(cn.quote).not.toHaveBeenCalled();
    expect(r.unavailable.map((u) => u.reason).sort()).toEqual(['not_configured', 'provider_disabled']);
  });

  it('refuses outright when the policy denies the request', async () => {
    setAdapters([fakeAdapter('thorchain', '1')]);
    await expect(routeQuotes({ ...req, country: 'IR' })).rejects.toMatchObject({ code: 'policy_denied' });
  });
});
