/**
 * RateCache behaviour that protects the IP rate limit on `GET /api/rates`:
 * fresh quotes are reused, concurrent asks share one request, and failures are
 * not cached as a permanent "no rate".
 */

import { describe, it, expect, vi } from 'vitest';

import { RateCache } from '../rates.js';

function fakeApi(rate = 60000) {
  const getRate = vi.fn(async () => rate);
  return { api: { getRate }, getRate };
}

describe('RateCache', () => {
  it('fetches once per pair inside the TTL', async () => {
    const { api, getRate } = fakeApi();
    let now = 1_000_000;
    const cache = new RateCache(api, 60_000, () => now);

    expect((await cache.get('BTC', 'USD')).rate).toBe(60000);
    now += 30_000;
    expect((await cache.get('BTC', 'USD')).rate).toBe(60000);
    expect(getRate).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the quote goes stale', async () => {
    const { api, getRate } = fakeApi();
    let now = 1_000_000;
    const cache = new RateCache(api, 60_000, () => now);

    await cache.get('BTC', 'USD');
    now += 60_001;
    await cache.get('BTC', 'USD');
    expect(getRate).toHaveBeenCalledTimes(2);
  });

  it('keys on the fiat currency, not just the coin', async () => {
    const { api, getRate } = fakeApi();
    const cache = new RateCache(api, 60_000, () => 0);

    await cache.get('BTC', 'USD');
    await cache.get('BTC', 'EUR');
    expect(getRate).toHaveBeenCalledTimes(2);
    expect(getRate).toHaveBeenCalledWith('BTC', 'EUR');
  });

  it('shares a single in-flight request between concurrent callers', async () => {
    let release!: (v: number) => void;
    const getRate = vi.fn(() => new Promise<number>((resolve) => { release = resolve; }));
    const cache = new RateCache({ getRate }, 60_000, () => 0);

    const both = Promise.all([cache.get('ETH', 'USD'), cache.get('ETH', 'USD')]);
    release(3000);
    const [a, b] = await both;

    expect(getRate).toHaveBeenCalledTimes(1);
    expect(a.rate).toBe(3000);
    expect(b).toEqual(a);
  });

  it('does not cache a failure — the next ask retries', async () => {
    const getRate = vi
      .fn<(coin: string, fiat: string) => Promise<number>>()
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce(42);
    const cache = new RateCache({ getRate }, 60_000, () => 0);

    await expect(cache.get('SOL', 'USD')).rejects.toThrow('rate limited');
    expect((await cache.get('SOL', 'USD')).rate).toBe(42);
    expect(getRate).toHaveBeenCalledTimes(2);
  });

  it('peek never fetches and expires with the TTL', async () => {
    const { api, getRate } = fakeApi();
    let now = 0;
    const cache = new RateCache(api, 60_000, () => now);

    expect(cache.peek('BTC', 'USD')).toBeUndefined();
    await cache.get('BTC', 'USD');
    expect(cache.peek('BTC', 'USD')?.rate).toBe(60000);
    now += 60_001;
    expect(cache.peek('BTC', 'USD')).toBeUndefined();
    expect(getRate).toHaveBeenCalledTimes(1);
  });

  it('normalizes coin case so BTC and btc share an entry', async () => {
    const { api, getRate } = fakeApi();
    const cache = new RateCache(api, 60_000, () => 0);

    await cache.get('BTC', 'USD');
    await cache.get('btc', 'USD');
    expect(getRate).toHaveBeenCalledTimes(1);
  });
});
