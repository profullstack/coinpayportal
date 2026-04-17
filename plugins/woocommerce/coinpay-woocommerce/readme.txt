=== CoinPay for WooCommerce ===
Contributors: profullstack
Tags: woocommerce, payments, bitcoin, cryptocurrency, stripe, credit card
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.1.0
License: MIT

Accept cryptocurrency (BTC, ETH, SOL, POL, BCH, USDC) and credit card payments through CoinPay hosted checkout.

== Description ==

CoinPay for WooCommerce adds CoinPay as a payment gateway on your WooCommerce store. Customers check out via CoinPay's hosted checkout and can pay with crypto or credit card. Orders update automatically through signed webhooks.

Features:

* Hosted checkout — no PCI burden on your site
* Crypto + card support via a single configuration
* Order status updates via HMAC-signed webhooks
* HPOS (High-Performance Order Storage) compatible
* Debug logging through WooCommerce → Status → Logs
* Test-connection button in settings

== Installation ==

1. Upload the plugin zip via Plugins → Add New → Upload Plugin.
2. Activate the plugin.
3. Go to WooCommerce → Settings → Payments → CoinPay.
4. Enter your API key, Business ID, and webhook secret from your CoinPay dashboard.
5. Copy the webhook URL shown on the settings page and paste it into CoinPay → Webhooks.
6. Click "Test connection".
7. Enable the gateway and save.

== Changelog ==

= 0.1.0 =
* Initial MVP: hosted checkout, crypto + card modes, webhook processing, order status mapping, debug logs, test-connection button.
