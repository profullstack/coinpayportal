import { createGateway } from '@profullstack/x402-gateway';

/**
 * Sells explorer access to whoever is actually consuming it.
 *
 * The crawl gateway next door charges AI training crawlers, and it works — a
 * request announcing itself as GPTBot, ClaudeBot or CCBot gets a 402. What it
 * cannot do is charge a client that does not announce anything, and that is
 * the traffic that was costing us: an ordinary user agent walking transaction
 * hashes. Rate limiting caps how fast that client goes; it does not make it
 * pay, and at the cap a single IP can still spend 21,600 upstream JSON-RPC
 * calls an hour, because every explorer page is three of them.
 *
 * So this gateway charges on **usage**, not on user agent:
 * `isPaidAgent` returns true for everyone, and the middleware only invokes it
 * once a caller has spent its free daily allowance. The decision of *who*
 * pays lives with the counter in `proxy.ts`; everything x402 — the offer, the
 * pass, verification, settlement, the sales page — is handled here by the same
 * package the crawl gateway uses.
 *
 * Runs inside the middleware, so nothing here may import Node-only modules.
 * The env is read through a non-literal key on purpose: Next inlines
 * `process.env.NAME` at build time and these are runtime secrets.
 */
const env = (name: string) => process.env[name];

/**
 * Where the sales page lives.
 *
 * Deliberately NOT under `/explorer`, because the middleware gates that whole
 * prefix by counting requests — a sales page inside the metered area is a page
 * you can be refused for reading, which is a loop rather than an offer.
 */
export const EXPLORER_PASS_PATH = '/explorer-pass';

export const explorerGateway = createGateway({
  siteUrl: env('SITE_URL') || env('NEXT_PUBLIC_SITE_URL') || 'https://coinpayportal.com',
  siteName: 'CoinPay Explorer',
  coinpay: { apiKey: env('COINPAY_X402_KEY') },
  payTo: env('CRAWL_PAY_TO'),
  // A day of unmetered explorer reads. Matches the crawl pass, because it is
  // the same shape of thing being sold and two prices would need explaining.
  priceCents: Number(env('EXPLORER_PASS_CENTS') ?? '100'),
  passMinutes: 1440,
  header: 'x-explorer-pass',
  path: EXPLORER_PASS_PATH,
  /**
   * Usage decides, not the user agent.
   *
   * This is the whole point of the file. The middleware calls `handle` only
   * after a caller is over its allowance, so by the time we are here the
   * answer is always yes — encoding it as a user-agent test would just be a
   * second, weaker copy of the rule the counter already applied.
   */
  isPaidAgent: () => true,
  contact: 'mailto:support@coinpayportal.com',
});

/**
 * Answer a caller that is over its allowance, or null to let it through.
 *
 * Null means the caller presented a valid pass or just settled a payment, so
 * the request continues to the explorer as normal.
 */
export const explorerGate = explorerGateway.handle;

/**
 * The sales page itself.
 *
 * Served from the middleware rather than as a route, the same way the crawl
 * gateway serves `/crawl` — the page is the package's, so giving it a route
 * file would mean keeping a second copy of it in step with the offer.
 */
export const explorerSell = explorerGateway.sell;
