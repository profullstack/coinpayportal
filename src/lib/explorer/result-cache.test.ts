import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  addressTtl,
  blockTtl,
  clearResultCache,
  remember,
  resultCacheKey,
  resultCacheSize,
  transactionTtl,
} from './result-cache';
import { NotFoundError, UpstreamError } from './types';
import type { ExplorerTransaction } from './types';

const tx = (over: Partial<ExplorerTransaction> = {}): ExplorerTransaction =>
  ({
    hash: '0xabc',
    chainId: 'sol',
    status: 'confirmed',
    confirmations: 12,
    ...over,
  }) as ExplorerTransaction;

describe('explorer result cache', () => {
  beforeEach(() => clearResultCache());

  it('keys on chain, kind and id together', () => {
    expect(resultCacheKey('eth', 'tx', '0xa')).not.toBe(resultCacheKey('pol', 'tx', '0xa'));
    expect(resultCacheKey('eth', 'tx', '0xa')).not.toBe(resultCacheKey('eth', 'block', '0xa'));
    expect(resultCacheKey('eth', 'tx', '0xa')).not.toBe(resultCacheKey('eth', 'tx', '0xb'));
  });

  it('loads once and serves the rest from memory', async () => {
    const load = vi.fn().mockResolvedValue(tx());
    const key = resultCacheKey('sol', 'tx', 'sig');
    expect(await remember(key, load, transactionTtl)).toEqual(tx());
    expect(await remember(key, load, transactionTtl)).toEqual(tx());
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('holds a settled transaction and not a pending one', () => {
    expect(transactionTtl(tx())).toBe(60 * 60 * 1000);
    expect(transactionTtl(tx({ status: 'failed' }))).toBe(60 * 60 * 1000);
    expect(transactionTtl(tx({ status: 'pending' }))).toBe(5_000);
    // Reported as settled but not yet in a block: still unsettled.
    expect(transactionTtl(tx({ confirmations: 0 }))).toBe(5_000);
    // Chains that do not report confirmations are judged on status alone.
    expect(transactionTtl(tx({ confirmations: null }))).toBe(60 * 60 * 1000);
  });

  it('holds a block for minutes and an address for seconds', () => {
    // A balance moves; a block, in practice, does not -- but this is a
    // payments company, so a reorged block corrects itself the same session.
    expect(blockTtl({} as never)).toBe(10 * 60 * 1000);
    expect(addressTtl({} as never)).toBe(15_000);
  });

  it('re-reads once the entry has expired', async () => {
    const load = vi.fn().mockResolvedValue(tx({ status: 'pending' }));
    const key = resultCacheKey('sol', 'tx', 'sig');
    vi.useFakeTimers();
    try {
      await remember(key, load, transactionTtl);
      vi.advanceTimersByTime(5_001);
      await remember(key, load, transactionTtl);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('remembers a not-found, so a loop over invented hashes costs one call', async () => {
    const load = vi.fn().mockRejectedValue(new NotFoundError());
    const key = resultCacheKey('btc', 'tx', 'nonsense');
    await expect(remember(key, load, transactionTtl)).rejects.toBeInstanceOf(NotFoundError);
    await expect(remember(key, load, transactionTtl)).rejects.toBeInstanceOf(NotFoundError);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('never remembers an upstream being down', async () => {
    // The page renders "not answering" for this; holding it would keep saying
    // so after the provider came back.
    const load = vi.fn().mockRejectedValue(new UpstreamError('502'));
    const key = resultCacheKey('xrp', 'tx', 'h');
    await expect(remember(key, load, transactionTtl)).rejects.toBeInstanceOf(UpstreamError);
    await expect(remember(key, load, transactionTtl)).rejects.toBeInstanceOf(UpstreamError);
    expect(load).toHaveBeenCalledTimes(2);
    expect(resultCacheSize()).toBe(0);
  });

  it('is bounded, so walking a hash range cannot grow it without end', async () => {
    for (let i = 0; i < 5_050; i++) {
      await remember(resultCacheKey('sol', 'tx', `sig-${i}`), async () => tx(), transactionTtl);
    }
    expect(resultCacheSize()).toBeLessThanOrEqual(5_000);
  });
});
