import { createThrottle } from "@profullstack/throttle";
import { gateway } from "@/lib/crawl-gateway";

/**
 * The site-wide allowance: a hundred requests a minute, per caller, on every
 * route. Going over is answered 402 with the crawl gateway's offer, not 429.
 *
 * WHY EVERY ROUTE. The limiter this replaces only watched `/api/`. On
 * 2026-09-08 a headless browser found `/explorer` fifteen hours after it
 * shipped and walked 19,000 of its URLs a day for two days -- one fresh
 * visitor id per hit, a plain `Chrome/145` user agent, every page rendered
 * server-side against Etherscan and a JSON-RPC endpoint on our key. It was on
 * no crawler list because it declared nothing, and it never touched `/api/`,
 * so nothing here saw it. The gateway sells access to crawlers that say who
 * they are; this charges the ones that do not.
 *
 * Runs inside the middleware, so nothing here may import Node-only modules.
 */

/** The session cookie `POST /api/auth/login` and the passkey verifier both set. */
const sessionFrom = (request: Request): string | null =>
  /(?:^|;\s*)token=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1] ?? null;

export const throttle = createThrottle({
  gateway,
  /*
   * A signed-in merchant watching a dashboard is a customer, not a scraper,
   * and gets the integration budget rather than the anonymous one. Deliberately
   * not `exempt`: an unmetered site for anyone willing to sign up first is a
   * worse trade than metering a customer generously.
   */
  credentialFrom: (request) =>
    sessionFrom(request) ??
    request.headers.get("x-api-key")?.trim() ??
    /^(\S+)\s+(\S+)/.exec(request.headers.get("authorization")?.trim() ?? "")?.[2] ??
    null,
  credential: { limit: 600, ceiling: 1200 },
  rules: [
    /*
     * Sign-in stays address-bucketed however it is credentialed, or a
     * brute-force attempt bolts an Authorization header onto every guess and
     * buys itself the 600 above.
     */
    { path: "/api/auth/", limit: 10, credential: false },
    /*
     * Webhooks are delivered by processors whose burst we do not control, so
     * they get a large allowance -- but not an open route. Every one of them
     * is signature-verified downstream, and an unmetered path is an unmetered
     * path whoever we meant it for.
     */
    { path: "/api/webhooks/", limit: 600, credential: false },
  ],
  /*
   * What is being refused, and whether it was sold anything. Without this the
   * only evidence a limit is working is traffic going down, which is exactly
   * the signal that failed us: the 100/min limit WAS refusing requests and the
   * scrape carried on regardless, and nothing recorded either fact.
   */
  onThrottle: (event) => {
    console.log(
      `[throttle] ${event.sold ? "402" : "429"} ${event.count}/${event.limit}` +
        ` per ${event.windowSeconds}s ${new URL(event.url).pathname}` +
        ` ua=${(event.userAgent ?? "-").slice(0, 80)}`
    );
  },
});

/** Resolves to a Response for a caller over the allowance, or undefined. */
export const meter = (request: Request) => throttle.handle(request);
