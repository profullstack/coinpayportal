/**
 * What a request gives away before anyone looks up the address.
 *
 * These checks cost nothing, need no upstream and cannot be rate limited, so
 * they run first and settle most traffic on their own. The address lookup in
 * ./ip.js is only consulted for what survives.
 *
 * The load-bearing one is fetch metadata. Every Chromium since 76 sends
 * `Sec-Fetch-Mode` on every request, headless included, and it is a forbidden
 * header: no page script and no extension can remove it. A request announcing
 * "Chrome/148" without it is an HTTP client wearing a copied string.
 *
 * Only Chromium is judged that way. Firefox and Safari adopted Sec-Fetch later
 * and old builds are still in the wild, so silence from those proves nothing —
 * judging them here would fail closed on real readers.
 *
 * A client that NAMES itself is never judged by any of this. Googlebot claims
 * "Chrome/W.X.Y.Z" and sends no Sec-Fetch-Mode, and it is the last thing on
 * earth worth blocking. Self-declared agents belong to the caller's allow and
 * charge lists, not to spoof detection.
 */

const CLAIMS_CHROMIUM = /\bChrome\/\d+/i;

/** A client that says what it is: judged by lists, never by the spoof check. */
const DECLARES_ITSELF = /compatible;|\bbot\b|bot\/|crawler|spider|slurp|\bcurl\b|wget|python-requests|httpx|axios|go-http-client|java\/|okhttp|scrapy|libwww|phantomjs|headlesschrome/i;

/** Tools that are not pretending to be anything else. */
const OBVIOUS_TOOLS = /\bcurl\b|wget|python-requests|python-urllib|httpx|aiohttp|go-http-client|java\/|okhttp|scrapy|libwww|mechanize|node-fetch|got\/|axios/i;

/**
 * Headers a real browser navigation carries. Their absence is weak on its own
 * (a legitimate API client sends none of them either) but corroborating when
 * the user agent is busy claiming to be a browser.
 */
function browserHeaderCount(get) {
  let n = 0;
  if (get('accept-language')) n++;
  if (get('accept-encoding')) n++;
  if (get('sec-fetch-site')) n++;
  if (get('sec-fetch-dest')) n++;
  if (get('sec-ch-ua')) n++;
  const accept = get('accept') || '';
  if (accept.includes('text/html')) n++;
  return n;
}

/**
 * Inspect a Request (or anything exposing `headers.get`).
 *
 * Returns signals, not a verdict. Scoring lives in ./score.js so the same
 * signals can feed a different policy per site.
 */
export function inspectHeaders(request) {
  const get = (name) => {
    const v = request?.headers?.get?.(name);
    return v == null ? '' : String(v);
  };

  const ua = get('user-agent');
  const claimsChromium = CLAIMS_CHROMIUM.test(ua);
  const declaresItself = DECLARES_ITSELF.test(ua);
  const hasFetchMetadata = Boolean(get('sec-fetch-mode'));

  return {
    userAgent: ua,
    /** No user agent at all. Every browser sends one. */
    missingUserAgent: ua.trim() === '',
    claimsChromium,
    declaresItself,
    hasFetchMetadata,
    /** An HTTP client wearing a Chrome string. The strongest cheap signal. */
    spoofedBrowser: claimsChromium && !declaresItself && !hasFetchMetadata,
    /** Announces itself as a tool; honest, and usually still automation. */
    obviousTool: OBVIOUS_TOOLS.test(ua),
    browserHeaderCount: browserHeaderCount(get),
  };
}

export const _internals = { CLAIMS_CHROMIUM, DECLARES_ITSELF, OBVIOUS_TOOLS };
