import { describe, it, expect, beforeEach } from 'vitest';
import {
  explorerCacheKey,
  readCache,
  writeCache,
  writeCacheError,
  ttlFor,
  clearExplorerCache,
  explorerCacheSize,
} from './rpc-cache';

describe('explorer rpc cache', () => {
  beforeEach(() => clearExplorerCache());

  it('keys on chain, method and params together', () => {
    expect(explorerCacheKey('eth', 'eth_getBalance', ['0xa'])).not.toBe(
      explorerCacheKey('pol', 'eth_getBalance', ['0xa'])
    );
    expect(explorerCacheKey('eth', 'eth_getBalance', ['0xa'])).not.toBe(
      explorerCacheKey('eth', 'eth_getBalance', ['0xb'])
    );
  });

  it('returns a stored value and reports a miss for an unknown key', () => {
    const key = explorerCacheKey('eth', 'eth_blockNumber', []);
    expect(readCache(key).hit).toBe(false);
    writeCache(key, '0x10', 60_000);
    expect(readCache(key)).toEqual({ hit: true, value: '0x10' });
  });

  it('treats an expired entry as a miss', () => {
    const key = explorerCacheKey('eth', 'eth_blockNumber', []);
    writeCache(key, '0x10', -1); // ttl <= 0 is never stored
    expect(readCache(key).hit).toBe(false);
  });

  it('replays a cached rejection instead of re-querying', () => {
    const key = explorerCacheKey('eth', 'eth_getTransactionByHash', ['0xdead']);
    const err = new Error('not found');
    writeCacheError(key, err, 60_000);
    expect(() => readCache(key)).toThrow('not found');
  });

  describe('ttlFor', () => {
    it('holds a mined transaction far longer than an unmined one', () => {
      const mined = ttlFor('eth_getTransactionByHash', { blockNumber: '0x123' });
      const pending = ttlFor('eth_getTransactionByHash', { blockNumber: null });
      expect(mined).toBeGreaterThan(pending);
      expect(pending).toBeGreaterThan(0);
    });

    it('does not hold a pending transaction long enough to look stuck', () => {
      // The failure this guards: caching a mempool lookup for an hour leaves
      // the page calling a long-confirmed transaction "pending".
      expect(ttlFor('eth_getTransactionByHash', { blockNumber: null })).toBeLessThanOrEqual(30_000);
    });

    it('keeps the chain tip and balances short-lived', () => {
      expect(ttlFor('eth_blockNumber', '0x1')).toBeLessThanOrEqual(30_000);
      expect(ttlFor('eth_getBalance', '0x1')).toBeLessThanOrEqual(30_000);
    });

    it('treats blocks as immutable', () => {
      expect(ttlFor('eth_getBlockByNumber', {})).toBeGreaterThan(60_000);
      expect(ttlFor('eth_getBlockByHash', {})).toBeGreaterThan(60_000);
    });

    it('holds a receipt only once it carries a block', () => {
      expect(ttlFor('eth_getTransactionReceipt', { blockNumber: '0x1' })).toBeGreaterThan(60_000);
      expect(ttlFor('eth_getTransactionReceipt', {})).toBeLessThanOrEqual(30_000);
    });
  });

  it('stays bounded when a scraper walks distinct hashes', () => {
    // The point of the cap: an unbounded map would turn a request-rate problem
    // into a memory one.
    for (let i = 0; i < 6_000; i++) {
      writeCache(explorerCacheKey('eth', 'eth_getTransactionByHash', [`0x${i}`]), { blockNumber: '0x1' }, 60_000);
    }
    expect(explorerCacheSize()).toBeLessThanOrEqual(5_000);
  });
});
