/**
 * @profullstack/footprint — is this request a person?
 *
 * Built for the case where a page is expensive to render and someone is taking
 * it for free. CoinPay's block explorer fans out ten upstream RPC calls for a
 * single landing-page view, so a scraper costs real money per hit.
 *
 * WHAT THIS IS NOT. It is not a bot blocker and it does not try to be: a
 * determined scraper with a headless Chromium on residential addresses will
 * pass, and no header check will ever stop it. What it does is make the cheap
 * attack cheap to refuse, and hand the caller an honest verdict with reasons
 * so the policy — serve, charge, or refuse — stays the caller's to set.
 *
 * It pairs with @profullstack/x402-gateway rather than duplicating it. The
 * gateway already knows which crawlers name themselves and already catches a
 * request claiming Chromium without fetch metadata. This adds the layer it has
 * no opinion on: what the ADDRESS says. Feed `isNonHuman()` to the gateway's
 * `isPaidAgent` and the two halves cover both the client and the network it
 * came from.
 *
 *   import { analyze, isNonHuman } from '@profullstack/footprint';
 *
 *   const result = await analyze(request);          // header-only by default
 *   const result = await analyze(request, { ip });  // plus address reputation
 *   if (isNonHuman(result)) return gateway.handle(request);
 *
 * Every path here fails OPEN. An address lookup that times out yields
 * `unknown`, which scores nothing, so an upstream outage degrades the check
 * rather than locking readers out.
 */

import { inspectHeaders } from './headers.js';
import { lookupIp, createIpCache } from './ip.js';
import { score, isNonHuman, AUTOMATED_AT, HUMAN_BELOW } from './score.js';
import { createCidrMatcher, parseCidr, ipv4ToInt } from './cidr.js';
import {
  fetchCloudRanges,
  createCloudMatcher,
  CLOUD_SOURCES,
  SINGAPORE_REGIONS,
} from './cloud.js';

export { inspectHeaders, lookupIp, createIpCache, score, isNonHuman, AUTOMATED_AT, HUMAN_BELOW };
export { createCidrMatcher, parseCidr, ipv4ToInt };
export { fetchCloudRanges, createCloudMatcher, CLOUD_SOURCES, SINGAPORE_REGIONS };

/**
 * Analyze a request.
 *
 * The address lookup is OFF unless `ip` is given, because it reaches an
 * upstream with a per-minute quota and this can run on a request path. Header
 * signals alone settle most traffic; spend the lookup on what they cannot.
 *
 * @param {Request} request        anything exposing `headers.get`
 * @param {object}  [options]
 * @param {string}  [options.ip]   client address; enables reputation lookup
 * @param {boolean} [options.chargeUnclear=true]  count `unclear` as non-human
 */
export async function analyze(request, options = {}) {
  const signals = inspectHeaders(request);

  let ip = null;
  if (options.ip) {
    ip = await lookupIp(options.ip, options);
  }

  const result = score(signals, ip);
  return {
    ...result,
    signals,
    ip,
    nonHuman: isNonHuman(result, options),
  };
}

/**
 * Header-only verdict, with no network call and no await.
 *
 * This is the one to use inside edge middleware, where a per-request upstream
 * call is not an option and a synchronous answer is worth more than a slightly
 * better one.
 */
export function analyzeSync(request, options = {}) {
  const signals = inspectHeaders(request);
  const result = score(signals, null);
  return { ...result, signals, ip: null, nonHuman: isNonHuman(result, options) };
}
