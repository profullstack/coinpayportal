/**
 * Matching an address against a lot of CIDRs, quickly.
 *
 * AWS alone publishes over ten thousand IPv4 prefixes, and this is consulted
 * on a request path, so a linear walk is not an option. The ranges are
 * compiled once into sorted [start, end] integer pairs with overlaps merged,
 * and a lookup is a binary search: O(log n) against a few thousand entries is
 * a handful of comparisons.
 *
 * IPv4 only, deliberately. IPv6 needs BigInt arithmetic, the published cloud
 * range files list v4 and v6 separately, and every address we have actually
 * seen doing this arrives as v4. An IPv6 caller is reported as "not matched"
 * rather than guessed at — see `matches()`.
 */

/** "1.2.3.4" to a 32-bit integer, or null if it is not an IPv4 address. */
export function ipv4ToInt(ip) {
  if (typeof ip !== 'string') return null;
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

/** Parse "a.b.c.d/len" (a bare address means /32) into [start, end]. */
export function parseCidr(cidr) {
  const [ip, lenRaw] = String(cidr).trim().split('/');
  const base = ipv4ToInt(ip);
  if (base === null) return null;
  const len = lenRaw === undefined ? 32 : Number(lenRaw);
  if (!Number.isInteger(len) || len < 0 || len > 32) return null;
  const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
  const start = (base & mask) >>> 0;
  const end = (start + (len === 0 ? 0xffffffff : ~mask >>> 0)) >>> 0;
  return [start, end];
}

/**
 * Compile CIDRs into a matcher.
 *
 * Unparseable entries are skipped rather than thrown on: these lists come from
 * other people's published files, and one malformed line in ten thousand must
 * not take the caller down. `size` reports what actually compiled, so a caller
 * that fetched a list can tell "empty" from "all rejected".
 */
export function createCidrMatcher(cidrs) {
  const ranges = [];
  for (const cidr of cidrs ?? []) {
    const parsed = parseCidr(cidr);
    if (parsed) ranges.push(parsed);
  }
  ranges.sort((a, b) => a[0] - b[0]);

  // Merge overlapping and adjacent ranges so the search space is minimal and
  // a hit is unambiguous. Cloud lists overlap freely (a region prefix inside a
  // larger service prefix), which would otherwise triple the entries.
  const merged = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) {
      if (end > last[1]) last[1] = end;
    } else {
      merged.push([start, end]);
    }
  }

  function matches(ip) {
    const n = ipv4ToInt(ip);
    if (n === null) return false;
    let lo = 0;
    let hi = merged.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [start, end] = merged[mid];
      if (n < start) hi = mid - 1;
      else if (n > end) lo = mid + 1;
      else return true;
    }
    return false;
  }

  matches.size = merged.length;
  return matches;
}
