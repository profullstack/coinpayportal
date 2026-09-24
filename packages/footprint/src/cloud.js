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
  /**
   * Azure publishes weekly at a URL carrying that week's date, so there is no
   * fixed address to fetch. The download PAGE is stable, though, and names the
   * current file, so the page is read first and the link taken from it. If
   * Microsoft changes that page the fetch fails and is reported — which is the
   * right outcome, since a silently stale Azure list is worse than a missing
   * one.
   *
   * The file is ~4MB and 44,000 IPv4 prefixes across 3,300 service tags, many
   * overlapping; the matcher merges them down to a fraction of that.
   */
  azure: {
    url: 'https://www.microsoft.com/en-us/download/details.aspx?id=56519',
    indirect: true,
    /** Only this host may be fetched, whatever the page turns out to say. */
    allowHost: 'download.microsoft.com',
    /**
     * Pull the current file's link out of the page.
     *
     * Split on delimiters and test each token rather than running one regex
     * across the whole document. A pattern like `…/download/[^"']*Service…`
     * backtracks polynomially, and the document is remote input — so a page
     * built to be hostile could hang the refresh. Splitting is linear, and
     * the only regex left runs anchored against one short token.
     */
    findUrl(html) {
      for (const token of String(html).split(/["'\s<>]+/)) {
        if (
          token.startsWith('https://download.microsoft.com/download/') &&
          /\/ServiceTags_Public_\d{1,12}\.json$/.test(token)
        ) {
          return token;
        }
      }
      return null;
    },
    parse(json, region) {
      const out = [];
      for (const value of json?.values ?? []) {
        const props = value?.properties ?? {};
        if (region && !String(props.region ?? '').toLowerCase().includes(region.toLowerCase())) continue;
        for (const prefix of props.addressPrefixes ?? []) {
          if (!String(prefix).includes(':')) out.push(prefix);
        }
      }
      return out;
    },
  },
  /**
   * Alibaba publishes nothing, so its address space is taken from what its
   * ASNs actually announce, via RIPEstat. That is a different KIND of claim
   * from the files above: those are the provider saying "these are ours", this
   * is the routing table saying "these are announced by them". Good enough to
   * price traffic on, and the only thing available.
   *
   * `region` cannot filter BGP data — an announcement carries no region — so a
   * region argument is ignored here rather than silently returning nothing.
   */
  alibaba: {
    asns: [45102, 37963, 45103, 59028, 134963],
    bgp: true,
  },
  oracle: {
    url: 'https://docs.oracle.com/iaas/tools/public_ip_ranges.json',
    parse(json, region) {
      return (json?.regions ?? [])
        .filter((r) => !region || String(r.region ?? '').includes(region))
        .flatMap((r) => (r.cidrs ?? []).map((c) => c.cidr))
        .filter(Boolean);
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
  oracle: 'ap-singapore',
  azure: 'southeastasia',
  digitalocean: 'SG',
  // alibaba is BGP-derived and carries no region; see CLOUD_SOURCES.alibaba.
};

/** Every provider this module knows how to fetch. */
export const ALL_PROVIDERS = ['aws', 'gcp', 'azure', 'alibaba', 'oracle', 'digitalocean'];

/**
 * STILL NOT COVERED, and worth knowing before trusting a miss.
 *
 * Huawei and Tencent publish nothing and are not BGP-derived here yet. Neither
 * is any of the long tail of regional hosts — and a residential proxy network,
 * by construction, is not a datacenter at all and never will be matched.
 *
 * So a caller that finds nothing here has NOT established that an address
 * belongs to a person.
 */
export const UNCOVERED_PROVIDERS = ['huawei', 'tencent'];

/**
 * Fetch published ranges.
 *
 * Each provider is fetched independently and allowed to fail on its own: a
 * partial list still matches what it covers, whereas throwing would leave the
 * caller with nothing. Failures are returned rather than logged, so the
 * caller decides whether a missing provider is worth reporting.
 */
/**
 * What a set of ASNs currently announces, from RIPEstat.
 *
 * For providers that publish no list of their own. Each ASN is asked for
 * separately and allowed to fail on its own: a partial answer still covers
 * what it covers, which is the same rule the file sources follow.
 */
async function fetchAnnouncedPrefixes(asns, { fetchImpl, timeoutMs, name, failed }) {
  const out = [];
  await Promise.all(
    (asns ?? []).map(async (asn) => {
      try {
        const resp = await fetchImpl(
          `https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS${asn}`,
          { signal: AbortSignal.timeout(timeoutMs) },
        );
        if (!resp.ok) {
          failed.push(`${name}/AS${asn}: HTTP ${resp.status}`);
          return;
        }
        const body = await resp.json();
        for (const entry of body?.data?.prefixes ?? []) {
          const prefix = entry?.prefix;
          if (prefix && !String(prefix).includes(':')) out.push(prefix);
        }
      } catch (err) {
        failed.push(`${name}/AS${asn}: ${err?.name === 'TimeoutError' ? 'timeout' : String(err?.message || err)}`);
      }
    }),
  );
  return out;
}

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
        if (source.bgp) {
          cidrs.push(...(await fetchAnnouncedPrefixes(source.asns, { fetchImpl, timeoutMs, name, failed })));
          return;
        }

        // Azure names this week's file on a stable page rather than serving it
        // at a stable URL, so the page is read first.
        let url = source.url;
        if (source.indirect) {
          const page = await fetchImpl(source.url, { signal: AbortSignal.timeout(timeoutMs) });
          if (!page.ok) {
            failed.push(`${name}: index HTTP ${page.status}`);
            return;
          }
          url = source.findUrl(await page.text());
          if (!url) {
            failed.push(`${name}: no file link on the download page`);
            return;
          }
          /*
           * The URL came out of a document someone else serves, so it is
           * input, not configuration. Check the host before fetching it —
           * otherwise a changed, redirected or hostile page chooses what this
           * server requests, which is server-side request forgery with extra
           * steps. Parsed rather than substring-matched: "download.microsoft
           * .com" appears in plenty of URLs that are not on that host.
           */
          let host = '';
          try {
            const parsed = new URL(url);
            host = parsed.protocol === 'https:' ? parsed.hostname : '';
          } catch {
            host = '';
          }
          if (host !== source.allowHost) {
            failed.push(`${name}: refused ${host || 'unparseable URL'}, expected ${source.allowHost}`);
            return;
          }
        }

        const resp = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
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
