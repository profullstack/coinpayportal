# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-04-30

### Added

- FOSSBilling payment adapter (`Payment_Adapter_CoinPayPortal`)
- CoinPayPortal API client with cURL, Bearer auth, 30s timeout
- Webhook signature verifier using HMAC-SHA256 and constant-time comparison
- Payment status mapper covering all CoinPayPortal event types
- Admin configuration: API key, merchant ID, webhook secret, sandbox mode, expiration, underpayment tolerance, debug logging
- Customer payment button template (`pay.phtml`)
- Error template (`error.phtml`)
- Idempotent webhook handler — duplicate `payment.completed` events ignored
- Underpayment tolerance check before marking invoice paid
- Sandbox mode with separate API URL
- PHPUnit tests for `WebhookVerifier` and `StatusMapper`
- Install, configuration, webhook, and troubleshooting documentation
- Example webhook payload JSON files
