/**
 * A small bounded TTL cache for explorer JSON-RPC reads.
 *
 * The explorer is a public, unauthenticated, `force-dynamic` page: every view
 * of `/explorer/eth/tx/0x…` re-queried the chain, and a single transaction page
 * costs three calls (`eth_getTransactionByHash`, `eth_getTransactionReceipt`,
 * `eth_blockNumber`). Nothing deduplicated a hundred requests for the same
 * hash, so anyone pointing a scraper at it spent our Infura quota at whatever
 * rate they liked.
 *
 * Most of what an explorer serves is immutable. A mined transaction, its
 * receipt and a block never change, so they can be held for a long time; only
 * the chain tip and account balances actually move. That distinction is the
 * whole design here — see `ttlFor`.
 *
 * The cap matters as much as the TTL. Someone walking a range of transaction
 * hashes would otherwise grow this map without bound, turning a request-rate
 * problem into a memory one. Entries are evicted oldest-first at
 * `MAX_ENTRIES`, which for the read sizes here is a few MB at worst.
 */

/** Roughly a day of typical explorer traffic, and bounded well below heap. */
const MAX_ENTRIES = 5_000;

const IMMUTABLE_TTL_MS = 60 * 60 * 1000; // mined tx, receipt, block
const TIP_TTL_MS = 10 * 1000; // eth_blockNumber
const BALANCE_TTL_MS = 15 * 1000; // eth_getBalance
/**
 * Short, but not zero. A miss is the expensive case, so an unmined hash that a
 * scraper requests in a loop still costs one upstream call per interval rather
 * than one per request.
 */
const UNSETTLED_TTL_MS = 5 * 1000;

interface Entry {
  value: unknown;
  /** An upstream rejection, replayed on hit so failures do not stampede either. */
  error?: unknown;
  expiresAt: number;
}

const cache = new Map<string, Entry>();

export function explorerCacheKey(chainId: string, method: string, params: unknown[]): string {
  return `${chainId}|${method}|${JSON.stringify(params)}`;
}

/**
 * How long a result for `method` may be held.
 *
 * A transaction or receipt is only immutable once it is in a block. Looking one
 * up while it is still in the mempool returns a body with a null `blockNumber`,
 * and caching that for an hour would leave the page insisting a long-confirmed
 * transaction is still pending. So finality is read off the payload rather than
 * assumed from the method name.
 */
export function ttlFor(method: string, value: unknown): number {
  switch (method) {
    case 'eth_blockNumber':
      return TIP_TTL_MS;
    case 'eth_getBalance':
      return BALANCE_TTL_MS;
    case 'eth_getBlockByNumber':
    case 'eth_getBlockByHash':
      return IMMUTABLE_TTL_MS;
    case 'eth_getTransactionByHash': {
      const blockNumber = (value as { blockNumber?: string | null } | null)?.blockNumber;
      return blockNumber ? IMMUTABLE_TTL_MS : UNSETTLED_TTL_MS;
    }
    case 'eth_getTransactionReceipt': {
      // A receipt exists only for a mined transaction, so its presence is the
      // finality signal.
      const blockNumber = (value as { blockNumber?: string | null } | null)?.blockNumber;
      return blockNumber ? IMMUTABLE_TTL_MS : UNSETTLED_TTL_MS;
    }
    default:
      return UNSETTLED_TTL_MS;
  }
}

function evictIfFull(): void {
  if (cache.size < MAX_ENTRIES) return;
  // Map preserves insertion order, so the first key is the oldest write.
  const oldest = cache.keys().next();
  if (!oldest.done) cache.delete(oldest.value);
}

/** Cached value, or `undefined` on a miss. Replays a cached rejection. */
export function readCache(key: string): { hit: boolean; value?: unknown } {
  const entry = cache.get(key);
  if (!entry) return { hit: false };
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return { hit: false };
  }
  if ('error' in entry) throw entry.error;
  return { hit: true, value: entry.value };
}

export function writeCache(key: string, value: unknown, ttlMs: number): void {
  if (ttlMs <= 0) return;
  evictIfFull();
  cache.delete(key); // re-insert so eviction order tracks last write
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Remember a failure briefly.
 *
 * Without this, a hash that reliably 404s upstream is a permanent cache miss —
 * exactly the request a scraper repeats, and exactly the one that costs a call
 * every time.
 */
export function writeCacheError(key: string, error: unknown, ttlMs = UNSETTLED_TTL_MS): void {
  evictIfFull();
  cache.delete(key);
  cache.set(key, { value: undefined, error, expiresAt: Date.now() + ttlMs });
}

/** Test seam. */
export function clearExplorerCache(): void {
  cache.clear();
}

export function explorerCacheSize(): number {
  return cache.size;
}
