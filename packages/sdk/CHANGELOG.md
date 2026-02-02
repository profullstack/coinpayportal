# Changelog

All notable changes to `@profullstack/coinpay` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-01-15

### Added
- `waitForPayment()` method for polling payment status until completion
- `getPaymentQRUrl()` method (synchronous URL builder)
- `getPaymentQR()` method for fetching QR code as binary `ArrayBuffer`
- `getExchangeRate()` and `getExchangeRates()` for price lookups
- Business management methods: `createBusiness`, `getBusiness`, `listBusinesses`, `updateBusiness`
- Webhook management: `getWebhookLogs`, `testWebhook`
- TypeScript type declarations (`.d.ts` files) for all modules
- Comprehensive SDK documentation and API reference
- Usage examples for all major features
- `CHANGELOG.md`

### Changed
- Renamed `Cryptocurrency` constant to `Blockchain` (`Cryptocurrency` is still exported as a deprecated alias)
- Improved `package.json` for npm publish readiness (added `types`, `homepage`, `bugs`, keywords)

## [0.1.0] - 2024-12-01

### Added
- Initial SDK release
- `CoinPayClient` class with `createPayment`, `getPayment`, `listPayments`
- Standalone helper functions: `createPayment`, `getPayment`, `listPayments`
- Constants: `Blockchain`, `PaymentStatus`, `FiatCurrency`
- Webhook utilities: `verifyWebhookSignature`, `generateWebhookSignature`, `parseWebhookPayload`, `createWebhookHandler`
- `WebhookEvent` constants
- CLI tool (`coinpay`) for command-line payment management
- Support for BTC, BCH, ETH, POL, SOL, USDC_ETH, USDC_POL, USDC_SOL
