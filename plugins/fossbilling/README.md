# CoinPayPortal Payment Gateway for FOSSBilling

Accept cryptocurrency payments in FOSSBilling through CoinPayPortal. Customers are redirected to a secure CoinPayPortal checkout and invoices are automatically marked paid after verified on-chain confirmation.

## Features

- One-click crypto checkout for FOSSBilling invoices
- Automatic invoice reconciliation via signed webhooks
- Sandbox/test mode for safe development
- Configurable underpayment tolerance
- Constant-time webhook signature verification
- Idempotent webhook handling (duplicate events ignored)
- Debug logging for troubleshooting

## Requirements

- FOSSBilling v0.6+
- PHP 8.1+
- PHP `curl` extension
- HTTPS in production

## Quick Install

1. Copy `library/Payment/Adapter/CoinPayPortal.php` and `library/Payment/Adapter/CoinPayPortal/` into your FOSSBilling installation.
2. Copy `src/` to the correct relative path (three levels above `CoinPayPortal.php`).
3. In the FOSSBilling admin, go to **System → Payment Gateways**, install **CoinPayPortal**, and enter your credentials.
4. Copy the Webhook URL into your [CoinPayPortal dashboard](https://coinpayportal.com) under **Settings → Webhooks**.

See [docs/INSTALL.md](docs/INSTALL.md) for full instructions.

## Configuration

| Setting | Description |
|---|---|
| API Key | From your CoinPayPortal merchant dashboard |
| Merchant ID | Your CoinPayPortal account ID |
| Webhook Secret | Used to verify incoming webhook signatures |
| Sandbox Mode | Test without real funds |

Full field reference: [docs/CONFIGURATION.md](docs/CONFIGURATION.md)

## Webhook Setup

Your webhook endpoint:

```
https://YOUR-DOMAIN.COM/ipn/CoinPayPortal
```

See [docs/WEBHOOKS.md](docs/WEBHOOKS.md) for signature verification details and supported event types.

## Running Tests

```bash
composer install
composer test
```

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Support

- Issues: [github.com/profullstack/coinpayportal](https://github.com/profullstack/coinpayportal/issues)
- Email: [support@coinpayportal.com](mailto:support@coinpayportal.com)
- Website: [coinpayportal.com](https://coinpayportal.com)

## License

MIT — see [LICENSE](LICENSE).
