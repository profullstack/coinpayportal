/**
 * A bounded TTL cache for whole explorer results.
 *
 * WHY THIS EXISTS ALONGSIDE rpc-cache.ts. That one caches individual JSON-RPC
 * reads and is wired into the EVM adapter only, because it keys on Ethereum
 * method names. The other two adapters do not speak JSON-RPC in any shared
 * shape: `utxo` fetches REST from Blockstream and Blockchair, `misc` posts
 * Solana RPC, XRP's own envelope and Koios REST — three payloads with nothing
 * in common to key on. Plumbing a per-call cache into each meant three
 * different key schemes and three chances to cache a mempool answer forever.
 *
 * So this caches one level up, where every family already agrees: the
 * `ExplorerTransaction` / `ExplorerAddress` / `ExplorerBlock` a page renders.
 * The finality signal lives on those objects (`status`, `confirmations`), which
 * is a more reliable thing to read than a method name, and one wrapper in
 * index.ts covers all nine chains.
 *
 * Measured 2026-09-08/09: of ~19,300 explorer page views a day from one
 * scraper, roughly 59% landed on the two uncached families -- Solana alone was
 * the largest single bucket at 5,184.
 *
 * ON WHAT THIS DOES NOT FIX. That scraper requests ~19,329 distinct paths in
 * 19,279 views: it essentially never asks for the same URL twice, so its hit
 * rate here is near zero. A cache is not the answer to it and was never going
 * to be -- the throttle and the 402 are. This is here because repeat traffic
 * (a person refreshing, a link that gets shared, a second scraper covering
 * ground the first already walked) should not re-query a chain for an answer
 * that cannot have changed.
 */

import type { ExplorerAddress, ExplorerBlock, ExplorerTransaction } from './types';
import { NotFoundError } from './types';

/** Same budget and reasoning as rpc-cache.ts: a few MB at worst. */
const MAX_ENTRIES = 5_000;

const CONFIRMED_TTL_MS = 60 * 60 * 1000;
/**
 * Blocks are immutable in practice but not in principle. Ten minutes is long
 * enough to absorb a burst and short enough that a reorged block near the tip
 * corrects itself while anyone is still looking -- and this is a payments
 * company, so an hour of confidently wrong chain data is not a trade worth
 * making for a cache hit.
 */
const BLOCK_TTL_MS = 10 * 60 * 1000;
/** Balances and history move; matches rpc-cache's own balance TTL. */
const ADDRESS_TTL_MS = 15 * 1000;
/** In the mempool, so the next look could legitimately differ. */
const UNSETTLED_TTL_MS = 5 * 1000;
/**
 * A hash that does not exist upstream.
 *
 * Short, but not zero: walking invented hashes is exactly what a scraper does,
 * and a miss is the expensive case. Held briefly so a loop over the same bogus
 * id costs one upstream call per interval rather than one per request.
 */
const NOT_FOUND_TTL_MS = 30 * 1000;

interface Entry {
  value?: unknown;
  /** A NotFoundError, replayed on hit so a 404 loop does not stampede either. */
  notFound?: boolean;
  expiresAt: number;
}

const cache = new Map<string, Entry>();

export function resultCacheKey(chainId: string, kind: string, id: string): string {
  return `${chainId}|${kind}|${id}`;
}

/** How long a transaction may be held: only once it is in a block. */
export function transactionTtl(tx: ExplorerTransaction): number {
  if (tx.status === 'pending') return UNSETTLED_TTL_MS;
  // `confirmations` is null on chains that do not report it; status having
  // settled is the signal there, and re-reading a settled transaction an hour
  // later cannot produce a different answer.
  if (tx.confirmations !== null && tx.confirmations < 1) return UNSETTLED_TTL_MS;
  return CONFIRMED_TTL_MS;
}

export const addressTtl = (_address: ExplorerAddress): number => ADDRESS_TTL_MS;
export const blockTtl = (_block: ExplorerBlock): number => BLOCK_TTL_MS;

function evictIfFull(): void {
  if (cache.size < MAX_ENTRIES) return;
  // Map preserves insertion order, so the first key is the oldest write.
  const oldest = cache.keys().next();
  if (!oldest.done) cache.delete(oldest.value);
}

function write(key: string, entry: Entry): void {
  evictIfFull();
  cache.delete(key); // re-insert so eviction order tracks last write
  cache.set(key, entry);
}

/**
 * Serve `key` from cache, or load it and remember the answer for as long as
 * `ttl` says it stays true.
 *
 * Only NotFoundError is remembered as a failure. An upstream that is merely
 * down must not be cached: the page renders "not answering" for that case and
 * holding onto it would keep saying so after the provider came back.
 */
export async function remember<T>(
  key: string,
  load: () => Promise<T>,
  ttl: (value: T) => number
): Promise<T> {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    if (entry.notFound) throw new NotFoundError();
    return entry.value as T;
  }
  if (entry) cache.delete(key);

  try {
    const value = await load();
    const ms = ttl(value);
    if (ms > 0) write(key, { value, expiresAt: Date.now() + ms });
    return value;
  } catch (err) {
    if (err instanceof NotFoundError) {
      write(key, { notFound: true, expiresAt: Date.now() + NOT_FOUND_TTL_MS });
    }
    throw err;
  }
}

/** Test seam. */
export function clearResultCache(): void {
  cache.clear();
}

export const resultCacheSize = (): number => cache.size;
