import { createGateway } from "@profullstack/x402-gateway";
import { x402Proxy } from "@profullstack/x402-gateway/next";

/**
 * Sells crawl access to AI training crawlers (GPTBot, ClaudeBot, CCBot,
 * meta-externalagent, Bytespider, Applebot-Extended, ...) by the day over
 * x402, settled by CoinPay in USDC. People, Googlebot and the retrieval
 * crawlers behind AI search pass through untouched.
 *
 * Runs inside the middleware, so nothing here may import Node-only modules.
 * The env is read through a non-literal key on purpose: Next inlines
 * `process.env.NAME` at build time, and these are runtime secrets. Without
 * COINPAY_X402_KEY and CRAWL_PAY_TO the gateway still answers training
 * crawlers with 402, just with an empty offer.
 */
const env = (name: string) => process.env[name];

/**
 * CoinPay's own app, on top of the gateway's APP_PATHS (sign-in, oauth,
 * dashboard, checkout, pay, webhooks). None of it is content: it is where a
 * merchant or an agent signs in and moves money, and since gateway 0.8 a stale
 * or headless browser string was answered 402 on all of it, so an agent whose
 * OAuth token lapsed could not get back in. `/api` is whole because every route
 * under it is credentialed or a health/discovery read, and the throttle still
 * meters it. The explorer is deliberately absent: it is the scraped surface,
 * and has its own daily tiers.
 */
export const COINPAY_APP_PATHS = [
  "/api",
  "/banking",
  "/businesses",
  "/cli-auth",
  "/clients",
  "/contractor",
  "/contractors",
  "/custody",
  "/documents",
  "/escrow",
  "/finances",
  "/invite",
  "/invoices",
  "/lnurlp",
  "/now",
  "/payments",
  "/payouts",
  "/portal",
  "/projects",
  "/proposals",
  "/remittance",
  "/sign",
  "/subscriptions",
  "/transactions",
  "/wallet",
  "/web-wallet",
];

/**
 * A caller already signed in to CoinPay, or presenting an API key or bearer
 * token, is a customer and never shown the crawl offer. Unverified here; the
 * routes verify it, and the throttle meters a credentialed caller by host.
 */
export function signedIn(request: Request): boolean {
  if (/(?:^|;\s*)token=[^;]+/.test(request.headers.get("cookie") ?? "")) return true;
  if (request.headers.get("x-api-key")?.trim()) return true;
  return /^(?:Bearer|Wallet)\s+\S+/i.test(request.headers.get("authorization")?.trim() ?? "");
}

export const gateway = createGateway({
  siteUrl: env("SITE_URL") || env("NEXT_PUBLIC_SITE_URL") || "https://coinpayportal.com",
  siteName: "CoinPay",
  coinpay: { apiKey: env("COINPAY_X402_KEY") },
  payTo: env("CRAWL_PAY_TO"),
  contact: "mailto:support@coinpayportal.com",
  appPaths: COINPAY_APP_PATHS,
  exempt: signedIn,
});

/** Resolves to a Response for a refused crawler, or undefined to carry on. */
export const gate = x402Proxy(gateway);
