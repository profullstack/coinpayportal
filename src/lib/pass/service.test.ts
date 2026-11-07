import { describe, it, expect } from 'vitest';
import { evaluateDeposits, passFromGrant, priceSymbolForChain } from './service';
import { groupApps, preapprovableScopes } from './apps';

const rate = async (s: string) => ({ BTC: 100_000, ETH: 4_000, SOL: 200 } as Record<string, number>)[s] ?? NaN;

describe('priceSymbolForChain', () => {
  it('treats dollar stablecoins as $1 and maps chains to their coin', () => {
    expect(priceSymbolForChain('USDC_SOL')).toBeNull();
    expect(priceSymbolForChain('USDT_ETH')).toBeNull();
    expect(priceSymbolForChain('BTC')).toBe('BTC');
    expect(priceSymbolForChain('LN')).toBe('BTC');
  });
});

describe('evaluateDeposits', () => {
  const tx = (id: string, chain: string, amount: string, from = 'ext') => ({
    id,
    chain,
    tx_hash: `h-${id}`,
    amount,
    from_address: from,
  });

  it('values deposits in USD and sums them', async () => {
    const { totalUsd, counted } = await evaluateDeposits(
      [tx('1', 'USDC_SOL', '50'), tx('2', 'SOL', '0.25'), tx('3', 'BTC', '0.0001')],
      { credited: new Set(), internalAddresses: new Set(), usdRate: rate },
    );
    expect(counted).toHaveLength(3);
    expect(totalUsd).toBe(110); // 50 + 50 + 10
  });

  it('skips deposits already counted for a pass', async () => {
    const { totalUsd } = await evaluateDeposits([tx('1', 'USDC_SOL', '99')], {
      credited: new Set(['USDC_SOL:h-1']),
      internalAddresses: new Set(),
      usdRate: rate,
    });
    expect(totalUsd).toBe(0);
  });

  it('skips transfers from another CoinPay web wallet, case-insensitively', async () => {
    const { totalUsd } = await evaluateDeposits([tx('1', 'ETH', '1', '0xAbC')], {
      credited: new Set(),
      internalAddresses: new Set(['0xabc']),
      usdRate: rate,
    });
    expect(totalUsd).toBe(0);
  });

  it('counts a transaction once even when two linked wallets both saw it', async () => {
    const t = tx('1', 'USDC_SOL', '60');
    const { totalUsd } = await evaluateDeposits([t, { ...t, id: '2' }], {
      credited: new Set(),
      internalAddresses: new Set(),
      usdRate: rate,
    });
    expect(totalUsd).toBe(60);
  });

  it('ignores a coin with no price instead of guessing', async () => {
    const { totalUsd } = await evaluateDeposits([tx('1', 'DOGE', '1000')], {
      credited: new Set(),
      internalAddresses: new Set(),
      usdRate: rate,
    });
    expect(totalUsd).toBe(0);
  });
});

describe('passFromGrant', () => {
  it('is active until it expires', () => {
    const g = { starts_at: '2026-11-01T00:00:00Z', expires_at: '2026-12-01T00:00:00Z', deposit_usd: '99.00' };
    expect(passFromGrant(g, new Date('2026-11-15T00:00:00Z')).active).toBe(true);
    expect(passFromGrant(g, new Date('2026-12-02T00:00:00Z'))).toMatchObject({ active: false, claimed: true });
    expect(passFromGrant(null)).toEqual({ active: false, claimed: false });
  });
});

describe('apps', () => {
  it('never pre-approves the merchant scope', () => {
    expect(preapprovableScopes(['profile', 'merchant'])).toEqual(['openid', 'profile']);
  });

  it('groups clients by callback host and skips loopback and preview hosts', () => {
    const apps = groupApps(
      [
        { client_id: 'a', name: 'BO', redirect_uris: ['https://bufferoverride.com/cb'], scopes: ['openid'] },
        { client_id: 'b', name: 'BO2', redirect_uris: ['https://bufferoverride.com/cb2'], scopes: ['openid', 'email'] },
        { client_id: 'c', name: 'CLI', redirect_uris: ['http://127.0.0.1:8976/callback'], scopes: ['openid'] },
        { client_id: 'd', name: 'old', redirect_uris: ['https://x.up.railway.app/cb'], scopes: ['openid'] },
      ],
      new Set(['a']),
    );
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ host: 'bufferoverride.com', client_ids: ['a', 'b'], connected: false });
    expect(apps[0].scopes).toEqual(['openid', 'email']);
  });
});
