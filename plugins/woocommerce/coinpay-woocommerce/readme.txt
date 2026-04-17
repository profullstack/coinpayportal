=== CoinPay for WooCommerce ===
Contributors: profullstack
Tags: woocommerce, payments, bitcoin, cryptocurrency, stripe, credit-card, usdc, ethereum, solana, crypto-payments
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.1.0
License: MIT
License URI: https://opensource.org/licenses/MIT

Accept cryptocurrency (BTC, ETH, SOL, POL, BCH, USDC) and credit card payments through CoinPay hosted checkout.

== Description ==

CoinPay for WooCommerce adds CoinPay as a payment gateway on your WooCommerce store. Customers check out via CoinPay's hosted checkout and can pay with crypto or credit card using a single configuration. Orders update automatically through HMAC-signed webhooks.

**Supported cryptocurrencies:** Bitcoin (BTC), Ethereum (ETH), Solana (SOL), Polygon (POL), Bitcoin Cash (BCH), USDC on Ethereum, Polygon, Solana, and Base.

**Features**

* Hosted checkout — no PCI burden on your site, no card data touches your server
* Crypto and credit card through a single gateway configuration
* Classic checkout **and** Block-based checkout support
* Signed webhook processing with replay protection (300s tolerance)
* Idempotent event handling — duplicate deliveries don't double-update orders
* HPOS (High-Performance Order Storage) compatible
* Debug logging through WooCommerce → Status → Logs (source: `coinpay`)
* One-click test-connection button in settings
* Secret redaction in debug logs

**What you need**

A CoinPay merchant account at [coinpayportal.com](https://coinpayportal.com). Registration is free.

== Installation ==

1. Upload the plugin zip via **Plugins → Add New → Upload Plugin**, or install from the WordPress.org directory.
2. Activate the plugin.
3. Go to **WooCommerce → Settings → Payments → CoinPay**.
4. Enter your API key, Business ID, and webhook secret from your CoinPay dashboard.
5. Copy the webhook URL shown on the settings page and paste it into **CoinPay → Webhooks**.
6. Click **Test connection** to verify the API key.
7. Enable the gateway and save.

== Frequently Asked Questions ==

= Do I need a separate Stripe account for card payments? =

No. CoinPay handles card processing through its own Stripe Connect integration. You configure one API key in the plugin and customers can pay with either crypto or card depending on your selected payment mode.

= Does the plugin store customer card data on my WordPress site? =

No. The plugin uses CoinPay's hosted checkout, so card details are entered on CoinPay's PCI-compliant checkout page, never on your server.

= What happens if a customer abandons the hosted checkout? =

The order stays in "On hold" state. If the CoinPay session expires, CoinPay sends a `payment.expired` webhook and the plugin cancels the order. Customers can always retry payment from the order-pay page.

= Can I issue refunds from WooCommerce admin? =

In v0.1.0, refunds must be initiated from the CoinPay dashboard. When you refund there, CoinPay emits a `payment.refunded` webhook and the WooCommerce order status automatically updates to "Refunded". Native refund-from-WooCommerce is on the Phase 2 roadmap.

= Is Block checkout supported? =

Yes. The plugin registers with both the classic checkout and the new block-based checkout (WooCommerce Blocks).

= What WooCommerce and PHP versions are supported? =

WooCommerce 7.0+ on PHP 7.4+. Tested against the latest stable WordPress 6.7 and WooCommerce 9.5.

= Is this plugin HPOS compatible? =

Yes. The plugin declares compatibility with WooCommerce's High-Performance Order Storage (custom order tables).

== Screenshots ==

1. CoinPay gateway settings page with credentials and webhook URL.
2. Test-connection button verifies the API key before going live.
3. CoinPay option at classic checkout.
4. CoinPay option inside the Block-based checkout.
5. Order admin view shows CoinPay payment ID and webhook-driven status updates.

== Changelog ==

= 0.1.0 =
* Initial release.
* Classic checkout hosted redirect flow.
* Block-based checkout integration.
* Crypto and credit card payment modes.
* HMAC-SHA256 webhook processing with 300s tolerance.
* Idempotent event handling via per-order event-id ring.
* HPOS compatibility declaration.
* Debug logging with secret redaction.
* Test-connection admin action.

== Upgrade Notice ==

= 0.1.0 =
Initial public release.
