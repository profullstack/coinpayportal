// Stub entrypoint for the CoinPayPortal Shopify app.
//
// Two integration modes are planned:
//
//   1. "Off-checkout" mode — adds a Pay-with-Crypto button on the cart /
//      order-status page, redirects the customer to a CoinPay hosted checkout,
//      and reconciles via webhooks. Does not require Shopify Payments
//      partner approval.
//
//   2. "Payments App Extension" mode — registers as a native Shopify
//      payment method. Requires Shopify partner approval + revenue-share.
//
// Replace this stub with a real Remix / Hono / Express app once we pick a
// host runtime.

export {};
