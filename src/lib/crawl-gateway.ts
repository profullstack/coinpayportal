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
 * A caller signed in to CoinPay is a customer and never shown the crawl offer.
 *
 * Only the session cookie counts, and only once its signature checks out: an
 * exemption on the mere presence of `token=` or an Authorization header was a
 * free pass for any scraper willing to send one. API keys and bearer tokens
 * are not judged here at all -- they are presented to /api, which is an app
 * path and never charged, and verifying them would mean a database read in
 * the middleware. HS256 by WebCrypto, because this runs in the proxy.
 */
const SESSION = /(?:^|;\s*)token=([^;]+)/;

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

let hmacKey: { secret: string; key: Promise<CryptoKey> } | null = null;
const keyFor = (secret: string) => {
  if (hmacKey?.secret !== secret) {
    hmacKey = { secret, key: crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]) };
  }
  return hmacKey.key;
};

export async function signedIn(request: Request, now = Date.now()): Promise<boolean> {
  const secret = env("JWT_SECRET");
  const token = SESSION.exec(request.headers.get("cookie") ?? "")?.[1];
  if (!secret || !token) return false;
  const [header, payload, signature] = decodeURIComponent(token).split(".");
  if (!header || !payload || !signature) return false;
  try {
    if (JSON.parse(new TextDecoder().decode(b64url(header))).alg !== "HS256") return false;
    const ok = await crypto.subtle.verify("HMAC", await keyFor(secret), b64url(signature), new TextEncoder().encode(`${header}.${payload}`));
    if (!ok) return false;
    const claims = JSON.parse(new TextDecoder().decode(b64url(payload)));
    return typeof claims.exp !== "number" || claims.exp * 1000 > now;
  } catch {
    return false;
  }
}

export const gateway = createGateway({
  siteUrl: env("SITE_URL") || env("NEXT_PUBLIC_SITE_URL") || "https://coinpayportal.com",
  siteName: "CoinPay",
  coinpay: { apiKey: env("COINPAY_X402_KEY") },
  payTo: env("CRAWL_PAY_TO"),
  contact: "mailto:support@coinpayportal.com",
  appPaths: COINPAY_APP_PATHS,
});

const charge = x402Proxy(gateway);

/** Resolves to a Response for a refused crawler, or undefined to carry on. */
export const gate = async (request: Request) => ((await signedIn(request)) ? undefined : charge(request as never));
