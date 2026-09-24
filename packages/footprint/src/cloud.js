/**
 * Which addresses belong to a cloud, from the clouds' own published files.
 *
 * This exists because of a scrape nothing else could see. A headless browser
 * in one Singapore region was 95.8% of a site's reported HUMAN traffic: it
 * runs real Chromium, so it sends Sec-Fetch-Mode, renders the page and fires
 * the analytics beacon. Every user-agent and header check passes it, because
 * it is not lying about being a browser — it is a browser. It is just not a
 * reader.
 *
 * The one thing it cannot dress up is where it lives. AWS, GCP and
 * DigitalOcean each publish their address space as a machine-readable file,
 * so the ranges can be known exactly, with no IP reputation service, no
 * per-request lookup, no quota, and — importantly — without our ever storing
 * anybody's address to work it out.
 *
 * THIS IS NOT A BLOCKLIST. A datacenter address is not misconduct: agents,
 * integrations, monitoring and corporate egress all live there, and plenty of
 * them are welcome. It identifies traffic that should be asked to PAY rather
 * than served free, which is a question a caller can answer with money instead
 * of being refused. Callers who should never be charged (signed-in customers,
 * search crawlers, our own infrastructure) are the consuming site's business,
 * not this module's.
 */

import { createCidrMatcher } from './cidr.js';

/**
 * Where each provider publishes, and how to read it.
 *
 * `region` is matched as a substring against whatever the file calls a region,
 * so a caller can ask for one datacenter ('ap-southeast-1') or leave it out
 * and take the provider's whole space.
 */
export const CLOUD_SOURCES = {
  aws: {
    url: 'https://ip-ranges.amazonaws.com/ip-ranges.json',
    parse(json, region) {
      return (json?.prefixes ?? [])
        .filter((p) => !region || String(p.region ?? '').includes(region))
        .map((p) => p.ip_prefix)
        .filter(Boolean);
    },
  },
  gcp: {
    url: 'https://www.gstatic.com/ipranges/cloud.json',
    parse(json, region) {
      return (json?.prefixes ?? [])
        .filter((p) => p.ipv4Prefix && (!region || String(p.scope ?? '').includes(region)))
        .map((p) => p.ipv4Prefix);
    },
  },
  digitalocean: {
    url: 'https://www.digitalocean.com/geo/google.csv',
    csv: true,
    parse(text, region) {
      // range,country,region,city,postcode — no header row.
      return String(text)
        .split('\n')
        .map((line) => line.split(','))
        .filter((cols) => cols.length >= 2 && (!region || cols.slice(1, 4).some((c) => c?.includes(region))))
        .map((cols) => cols[0]?.trim())
        .filter((cidr) => cidr && cidr.includes('/') && !cidr.includes(':'));
    },
  },
};

/** Regions the major providers call Singapore, for the case that prompted this. */
export const SINGAPORE_REGIONS = {
  aws: 'ap-southeast-1',
  gcp: 'asia-southeast1',
  digitalocean: 'SG',
};

/**
 * Fetch published ranges.
 *
 * Each provider is fetched independently and allowed to fail on its own: a
 * partial list still matches what it covers, whereas throwing would leave the
 * caller with nothing. Failures are returned rather than logged, so the
 * caller decides whether a missing provider is worth reporting.
 */
export async function fetchCloudRanges(options = {}) {
  const {
    providers = ['aws', 'gcp'],
    regions = null,
    fetch: fetchImpl = globalThis.fetch,
    timeoutMs = 15_000,
  } = options;

  const cidrs = [];
  const failed = [];

  await Promise.all(
    providers.map(async (name) => {
      const source = CLOUD_SOURCES[name];
      if (!source) {
        failed.push(`${name}: unknown provider`);
        return;
      }
      const region = regions === null ? null : regions[name] ?? null;
      try {
        const resp = await fetchImpl(source.url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!resp.ok) {
          failed.push(`${name}: HTTP ${resp.status}`);
          return;
        }
        const body = source.csv ? await resp.text() : await resp.json();
        cidrs.push(...source.parse(body, region));
      } catch (err) {
        failed.push(`${name}: ${err?.name === 'TimeoutError' ? 'timeout' : String(err?.message || err)}`);
      }
    }),
  );

  return { cidrs, failed };
}

/**
 * A matcher that refreshes itself, and never blocks a request to do it.
 *
 * The published files are megabytes and change rarely, so they are fetched on
 * an interval rather than on demand. Until the first fetch lands the matcher
 * answers `false` for everything: an empty list means "charge nobody", never
 * "charge everybody", so a slow or failed download degrades to the behaviour
 * the site had before this existed.
 *
 * `refresh()` is returned rather than started on a timer, because a timer in
 * module scope runs in every process that imports the module — including test
 * runners and build steps — and this one downloads megabytes.
 */
export function createCloudMatcher(options = {}) {
  let matcher = createCidrMatcher([]);
  let lastRefresh = 0;
  let lastError = null;

  async function refresh() {
    const { cidrs, failed } = await fetchCloudRanges(options);
    lastError = failed.length ? failed.join('; ') : null;
    // Only replace a working matcher with one that actually loaded something.
    // A provider outage must not silently empty a list that was fine a minute
    // ago, nor replace a good list with a truncated one.
    if (cidrs.length) {
      matcher = createCidrMatcher(cidrs);
      lastRefresh = Date.now();
    }
    return { size: matcher.size, failed };
  }

  return {
    /** True when the address is inside a published cloud range. */
    matches: (ip) => matcher(ip),
    refresh,
    get size() {
      return matcher.size;
    },
    get lastRefresh() {
      return lastRefresh;
    },
    get lastError() {
      return lastError;
    },
  };
}
