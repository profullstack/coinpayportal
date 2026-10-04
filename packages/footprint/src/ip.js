/**
 * What an address gives away.
 *
 * Extracted from launchpadder's ip-protection-service, which had been doing
 * this against ip-api.com for a while. Three things were changed on the way
 * out, and each was a real defect rather than a matter of taste:
 *
 *  1. `fetch(url, { timeout: 5000 })` does nothing. `timeout` is not a fetch
 *     option in any runtime; the call had NO deadline at all. That is survivable
 *     in a background job and unacceptable here, where this can be reached from
 *     a request path. It is an AbortSignal now.
 *
 *  2. The reputation table treated `google`, `amazon`, `microsoft` and
 *     `cloudflare` as TRUSTED ISPs. For fraud scoring that is arguable. For
 *     catching scrapers it is exactly inverted: those are the hosting providers
 *     that most scraping runs from, and the rule handed them the best score on
 *     the board. Hosting is now a POSITIVE signal of automation.
 *
 *  3. A lookup failure returned `proxy: false, vpn: false` — indistinguishable
 *     from a clean result. A dead upstream therefore read as "everyone is
 *     innocent", silently. Failures are now marked `unknown: true` so a caller
 *     can tell "we looked and it was clean" from "we never found out", and
 *     scoring treats the two differently.
 *
 * ip-api's free tier is HTTP-only and rate limited to ~45 requests a minute,
 * which rules out calling it per request. Everything here is cached and every
 * caller is expected to fail open: this is evidence, never a gate on its own.
 */

/** ISP/org substrings that mean "a machine lives here", not a reader. */
const HOSTING_KEYWORDS = [
  'amazon', 'aws', 'google', 'microsoft', 'azure', 'cloudflare', 'digitalocean',
  'linode', 'akamai', 'hetzner', 'ovh', 'scaleway', 'vultr', 'contabo',
  'oracle', 'alibaba', 'tencent', 'leaseweb', 'choopa', 'quadranet',
  'colocation', 'colocrossing', 'datacenter', 'data center', 'hosting',
  'server', 'cloud', 'vps', 'dedicated',
];

/** Substrings that suggest a consumer VPN egress. */
const VPN_KEYWORDS = [
  'vpn', 'virtual private', 'tunnel', 'anonymous', 'nordvpn', 'expressvpn',
  'surfshark', 'cyberghost', 'purevpn', 'private internet access',
  'mullvad', 'protonvpn', 'ipvanish', 'hide.me', 'windscribe',
];

/** Substrings that suggest a Tor exit. */
const TOR_KEYWORDS = ['tor exit', 'tor-exit', 'torservers', 'onion', 'exit node', 'tor relay'];

const has = (haystack, needles) => {
  if (!haystack) return false;
  const s = String(haystack).toLowerCase();
  return needles.some((k) => s.includes(k));
};

/**
 * A result for an address nobody could look up.
 *
 * `unknown` is the whole point: absent evidence must not read as clean
 * evidence. See the header comment.
 */
function unknownResult(ip, reason) {
  return {
    ip,
    unknown: true,
    reason,
    isProxy: false,
    isVpn: false,
    isTor: false,
    isHosting: false,
    isp: null,
    countryCode: null,
  };
}

/**
 * A tiny TTL cache. Deliberately in-process and bounded: this runs in a web
 * process that may be replicated, and a cache that grows with the number of
 * distinct scraper addresses is itself the denial of service.
 */
export function createIpCache({ ttlMs = 15 * 60 * 1000, max = 10_000 } = {}) {
  const entries = new Map();
  return {
    get(ip) {
      const hit = entries.get(ip);
      if (!hit) return undefined;
      if (Date.now() - hit.at > ttlMs) {
        entries.delete(ip);
        return undefined;
      }
      return hit.value;
    },
    set(ip, value) {
      // Oldest-first eviction; Map preserves insertion order.
      if (entries.size >= max) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(ip, { at: Date.now(), value });
    },
    get size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
  };
}

const defaultCache = createIpCache();

/**
 * Look up what is known about `ip`.
 *
 * Never throws and never rejects: a caller on a request path gets an answer
 * marked `unknown` rather than an exception to handle.
 */
export async function lookupIp(ip, options = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    cache = defaultCache,
    timeoutMs = 2000,
    endpoint = 'http://ip-api.com/json',
  } = options;

  if (!ip) return unknownResult(ip, 'no address');

  const cached = cache.get(ip);
  if (cached) return { ...cached, fromCache: true };

  let data;
  try {
    const url = `${endpoint}/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,region,city,isp,org,as,proxy,hosting,query`;
    const resp = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return unknownResult(ip, `HTTP ${resp.status}`);
    data = await resp.json();
  } catch (err) {
    return unknownResult(ip, err?.name === 'TimeoutError' ? 'timeout' : String(err?.message || err));
  }

  if (!data || data.status === 'fail') {
    return unknownResult(ip, data?.message || 'lookup failed');
  }

  // `proxy` and `hosting` are ip-api's own flags. The keyword checks are a
  // second opinion for the cases its flags miss, which is most small VPN
  // operators and anything self-hosted.
  const org = [data.isp, data.org, data.as].filter(Boolean).join(' ');
  const result = {
    ip,
    unknown: false,
    isProxy: Boolean(data.proxy) || has(org, ['proxy']),
    isVpn: has(org, VPN_KEYWORDS),
    isTor: has(org, TOR_KEYWORDS),
    isHosting: Boolean(data.hosting) || has(org, HOSTING_KEYWORDS),
    isp: data.isp || null,
    countryCode: data.countryCode || null,
  };

  cache.set(ip, result);
  return result;
}

export const _internals = { HOSTING_KEYWORDS, VPN_KEYWORDS, TOR_KEYWORDS, has };
