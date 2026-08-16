/**
 * SSRF guard for every server-side fetch of a caller-controlled URL.
 *
 * The previous check compared `url.hostname` against a handful of string
 * patterns. It missed, among others:
 *
 *   - IPv4-mapped IPv6 (`[::ffff:169.254.169.254]`)
 *   - non-dotted IPv4 (`2852039166`, `0251.0376.0251.0376`, `0xA9FEA9FE`)
 *   - `0.0.0.0`, the rest of `127.0.0.0/8`, CGNAT `100.64.0.0/10`
 *   - IPv6 unique-local `fc00::/7` and link-local `fe80::/10`
 *   - any hostname that simply *resolves* to one of the above, which is all a
 *     DNS rebind needs
 *   - the target of a redirect, since only the first URL was ever checked
 *
 * This module blocks all of those: it normalizes the host, resolves it, and
 * validates every resulting address, then re-validates on each redirect hop.
 *
 * Residual risk, stated plainly: Node's global fetch does not let us pin the
 * connection to the address we validated, so a DNS record that changes between
 * our lookup and the socket connect is not fully excluded. Callers must
 * therefore also never reflect the response body or headers back to the user —
 * that is what turns an SSRF into credential exfiltration, and it is enforced
 * at each call site.
 */

import { lookup } from 'dns/promises';
import { isIP } from 'net';

/** Cloud metadata hostnames that resolve publicly or via search domains. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

/** Convert an IPv4 dotted-quad to its 32-bit integer form. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = out * 256 + n;
  }
  return out >>> 0;
}

/** CIDR blocks that must never be reachable from a webhook or callback fetch. */
const BLOCKED_V4_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network" — 0.0.0.0 routes to localhost on Linux
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback, all of it
  ['169.254.0.0', 16], // link-local: AWS/Azure/GCP IMDS
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes 255.255.255.255
];

function isBlockedIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // unparseable → refuse

  for (const [base, bits] of BLOCKED_V4_CIDRS) {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) === (baseInt & mask)) return true;
  }
  return false;
}

/**
 * Expand an IPv6 address to its eight 16-bit groups.
 *
 * Necessary because `new URL()` rewrites an address into its canonical form:
 * `[::ffff:169.254.169.254]` comes back as `::ffff:a9fe:a9fe`, so matching the
 * dotted-quad spelling alone misses the very case it was written for.
 * Returns null when the address cannot be parsed.
 */
function expandIPv6(addr: string): number[] | null {
  let text = addr;

  // A trailing dotted-quad (IPv4-mapped/compatible) becomes two hextets.
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const octets = dotted[1].split('.').map(Number);
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = text.slice(0, dotted.index) + `${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const toGroups = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];
    for (const chunk of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(chunk)) return null;
      out.push(Number.parseInt(chunk, 16));
    }
    return out;
  };

  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (head === null || tail === null) return null;

  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    return [...head, ...new Array(fill).fill(0), ...tail];
  }

  return head.length === 8 ? head : null;
}

function isBlockedIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, '');

  const groups = expandIPv6(addr);
  if (groups === null) return true; // unparseable → refuse

  // Unspecified (::) and loopback (::1)
  if (groups.every((g) => g === 0)) return true;
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true;

  // IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::/96 carry an embedded v4
  // address, which must be judged by the v4 rules — ::ffff:169.254.169.254
  // reaches the metadata service just as 169.254.169.254 does.
  const firstFive = groups.slice(0, 5).every((g) => g === 0);
  if (firstFive && (groups[5] === 0xffff || groups[5] === 0)) {
    const v4 = [
      (groups[6] >> 8) & 255,
      groups[6] & 255,
      (groups[7] >> 8) & 255,
      groups[7] & 255,
    ].join('.');
    return isBlockedIPv4(v4);
  }

  // Unique-local fc00::/7
  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  // Link-local fe80::/10
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  // Multicast ff00::/8
  if ((groups[0] & 0xff00) === 0xff00) return true;

  return false;
}

/** Whether a literal IP address (v4 or v6) is in a blocked range. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip.replace(/^\[|\]$/g, ''));
  if (family === 4) return isBlockedIPv4(ip);
  if (family === 6) return isBlockedIPv6(ip);
  return true; // not an IP we can classify → refuse
}

/**
 * Normalize a hostname that may be a non-dotted IPv4 literal.
 *
 * `http://2852039166/` and `http://0xA9FEA9FE/` both reach 169.254.169.254;
 * `new URL()` leaves them as-is in `hostname`, so a dotted-quad regex misses
 * them entirely.
 */
function normalizeNumericHost(hostname: string): string | null {
  // Pure decimal, e.g. 2852039166
  if (/^\d+$/.test(hostname)) {
    const n = Number(hostname);
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }

  // Hex, e.g. 0xA9FEA9FE
  if (/^0x[0-9a-f]+$/i.test(hostname)) {
    const n = Number.parseInt(hostname, 16);
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }

  // Octal / mixed dotted forms, e.g. 0251.0376.0251.0376
  if (/^[0-9a-fx.]+$/i.test(hostname) && hostname.includes('.')) {
    const parts = hostname.split('.');
    if (parts.length === 4 && parts.every((p) => /^0[0-7]+$/.test(p))) {
      const octets = parts.map((p) => Number.parseInt(p, 8));
      if (octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255)) {
        return octets.join('.');
      }
    }
  }

  return null;
}

export type UrlCheck = { safe: true; url: URL } | { safe: false; reason: string };

/**
 * Validate a single URL: scheme, hostname shape, and every address it resolves
 * to. Does not follow redirects — see {@link safeFetch}.
 */
export async function checkUrlSafety(rawUrl: string): Promise<UrlCheck> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'Malformed URL' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { safe: false, reason: `Unsupported scheme: ${parsed.protocol}` };
  }

  // Plaintext HTTP leaks the payload and the signature header in transit.
  if (parsed.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    return { safe: false, reason: 'HTTPS is required' };
  }

  // Credentials in the URL are a redirect-laundering trick and have no
  // legitimate use for a webhook target.
  if (parsed.username || parsed.password) {
    return { safe: false, reason: 'Credentials in URL are not allowed' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');

  if (!hostname) {
    return { safe: false, reason: 'Missing hostname' };
  }

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.internal')) {
    return { safe: false, reason: 'Blocked hostname' };
  }

  // Literal IP (in any encoding) — judge it directly, no DNS involved.
  const numeric = normalizeNumericHost(hostname);
  const literal = numeric ?? (isIP(hostname.replace(/^\[|\]$/g, '')) ? hostname : null);
  if (literal) {
    return isBlockedAddress(literal)
      ? { safe: false, reason: 'Address is in a blocked range' }
      : { safe: true, url: parsed };
  }

  // A name: every address it resolves to must be public. Checking only the
  // first record lets a host with one public and one private A record through.
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { safe: false, reason: 'Hostname does not resolve' };
  }

  if (addresses.length === 0) {
    return { safe: false, reason: 'Hostname does not resolve' };
  }

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      return { safe: false, reason: 'Hostname resolves to a blocked address' };
    }
  }

  return { safe: true, url: parsed };
}

export interface SafeFetchOptions extends Omit<RequestInit, 'redirect' | 'signal'> {
  /** Abort after this many milliseconds. Defaults to 10s. */
  timeoutMs?: number;
  /** Redirect hops to follow, each re-validated. Defaults to 3. */
  maxRedirects?: number;
}

export type SafeFetchResult =
  | { ok: true; response: Response; finalUrl: string }
  /**
   * `kind` separates "we refused to make this request" from "we made it and
   * the network failed". Callers surface these differently: a blocked URL is a
   * configuration error the merchant must fix, whereas a transport error means
   * their endpoint is down.
   */
  | { ok: false; kind: 'blocked' | 'transport'; reason: string };

/**
 * Fetch a caller-supplied URL with SSRF validation on the initial request and
 * on every redirect hop.
 *
 * Redirects are followed manually because the built-in follower performs no
 * validation: a public URL that 302s to 169.254.169.254 defeated the original
 * check completely.
 *
 * The caller still owns what it does with the response. Never reflect the body
 * or headers of one of these responses back to an end user.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const { timeoutMs = 10_000, maxRedirects = 3, ...init } = options;

  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await checkUrlSafety(currentUrl);
    if (!check.safe) {
      return {
        ok: false,
        kind: 'blocked',
        reason: hop === 0 ? check.reason : `Redirect target rejected: ${check.reason}`,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(check.url.toString(), {
        ...init,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      return {
        ok: false,
        kind: 'transport',
        reason: error instanceof Error ? error.message : 'Request failed',
      };
    } finally {
      clearTimeout(timer);
    }

    const isRedirect = response.status >= 300 && response.status < 400;
    if (!isRedirect) {
      return { ok: true, response, finalUrl: check.url.toString() };
    }

    const location = response.headers.get('location');
    if (!location) {
      return { ok: true, response, finalUrl: check.url.toString() };
    }

    // Resolve relative redirects against the current URL before re-validating.
    currentUrl = new URL(location, check.url).toString();
  }

  return { ok: false, kind: 'blocked', reason: 'Too many redirects' };
}
