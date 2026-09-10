/**
 * How many addresses is the explorer scrape actually coming from?
 *
 * This is the one number nothing could answer. The scrape that prompted the
 * throttle ran at ~19,000 explorer views a day and did not slow down when a
 * 100/min per-caller limit went live, which means no single caller reaches
 * 100/min -- but nothing records how many callers there are. `tracker_events`
 * stores no address, and proxy.ts only logs `/api/` routes, so an `/explorer`
 * request appears in no log at all.
 *
 * Without that number, tightening the limit is guesswork. The tiers in
 * proxy.ts now refuse at 30/min and 200/day per address and are demonstrably
 * live -- a probe gets 30 pages and then a 429 -- and the scrape has not
 * slowed at all, which means it is under both. At 200/day each, ~20,000 views
 * a day needs on the order of a hundred addresses.
 *
 * So the useful question is no longer "how many" but "how are they arranged".
 * A hundred addresses inside two /24s is a cloud fleet, and bucketing the
 * limit by /24 instead of by host would collapse it to two callers -- the same
 * move rssamplifier makes by keying a declared crawler on its own bot token.
 * A hundred addresses in a hundred different /24s is a residential proxy pool,
 * and only price reaches that. This counts both so the choice is made on
 * evidence rather than on which story sounds better.
 *
 * So: count in memory, log one line a minute, and store a hash rather than an
 * address. A summary is enough to size a limit and cannot become a log of who
 * read what -- 19,000 lines a day of "this address read this transaction" is
 * a surveillance record we have no reason to keep.
 *
 * Imports nothing Node-only: this runs inside the proxy.
 */

import { clientIp } from '@profullstack/x402-gateway';
import { fingerprint } from '@profullstack/throttle';

const WINDOW_MS = 60_000;
/** Bounded: a rotation over thousands of addresses must not become a leak. */
const MAX_ADDRESSES = 10_000;

let windowStart = Date.now();
let requests = 0;
let unidentified = 0;
/** Refusals since the last report, by which tier turned the caller away. */
const refusals = new Map<string, number>();
const seen = new Map<string, number>();
/** The same requests grouped by /24, to say whether a fleet would collapse. */
const subnets = new Map<string, number>();

/** The /24 an IPv4 address sits in. Null for anything that is not IPv4. */
function subnetOf(ip: string): string | null {
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

function report(now: number): void {
  const counts = [...seen.values()].sort((a, b) => b - a);
  const top = counts.slice(0, 3).join(',');
  const busy = counts.filter((c) => c > 30).length;
  const subnetCounts = [...subnets.values()].sort((a, b) => b - a);
  const refused = [...refusals.entries()].map(([k, v]) => `${k}=${v}`).join(' ') || 'none';
  console.log(
    `[explorer] ${requests} req/min from ${seen.size} addresses` +
      ` in ${subnets.size} /24s` +
      ` (top address ${top || '-'}; top /24 ${subnetCounts.slice(0, 3).join(',') || '-'};` +
      ` ${busy} over 30/min; ${unidentified} unidentified)` +
      ` refused: ${refused}`
  );
  windowStart = now;
  requests = 0;
  unidentified = 0;
  seen.clear();
  subnets.clear();
  refusals.clear();
}

/**
 * Record that a tier turned a request away, so the summary line says whether
 * the limits are biting at all -- and which one.
 */
export function countExplorerRefusal(tier: 'burst' | 'daily' | 'ip-ceiling'): void {
  try {
    refusals.set(tier, (refusals.get(tier) ?? 0) + 1);
  } catch {
    // Diagnostics never cost a caller its answer.
  }
}

/** Test seam: forget the current window. */
export function resetExplorerWatch(): void {
  windowStart = Date.now();
  requests = 0;
  unidentified = 0;
  seen.clear();
  subnets.clear();
  refusals.clear();
}

/**
 * Record one explorer request. Never throws: a counter must not be able to
 * take down the page it is counting.
 */
export function watchExplorer(request: Request): void {
  try {
    const now = Date.now();
    if (now - windowStart >= WINDOW_MS) report(now);

    requests += 1;
    const ip = clientIp(request);
    if (!ip) {
      unidentified += 1;
      return;
    }
    const key = fingerprint(ip);
    if (seen.size < MAX_ADDRESSES || seen.has(key)) {
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }

    const net = subnetOf(ip);
    if (net) {
      const netKey = fingerprint(net);
      if (subnets.size < MAX_ADDRESSES || subnets.has(netKey)) {
        subnets.set(netKey, (subnets.get(netKey) ?? 0) + 1);
      }
    }
  } catch {
    // Counting is diagnostics. It never costs a reader their page.
  }
}
