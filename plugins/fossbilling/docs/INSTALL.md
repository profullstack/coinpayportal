# Installation

## Requirements

- FOSSBilling v0.6+
- PHP 8.1+
- cURL PHP extension
- HTTPS in production

## Manual Installation

1. Download the latest release zip from the [releases page](https://github.com/profullstack/coinpayportal/releases) or clone this directory.

2. Copy the plugin files into your FOSSBilling installation:

```bash
# From your FOSSBilling root directory
mkdir -p library/Payment/Adapter/CoinPayPortal

cp /path/to/fossbilling-coinpayportal/library/Payment/Adapter/CoinPayPortal.php \
   library/Payment/Adapter/

cp -r /path/to/fossbilling-coinpayportal/library/Payment/Adapter/CoinPayPortal/* \
   library/Payment/Adapter/CoinPayPortal/

cp -r /path/to/fossbilling-coinpayportal/src \
   library/Payment/Adapter/CoinPayPortal/../../../coinpayportal-src
```

The final layout inside your FOSSBilling root should be:

```
library/
  Payment/
    Adapter/
      CoinPayPortal.php
      CoinPayPortal/
        manifest.json
        templates/
          pay.phtml
          error.phtml
```

And the `src/` directory should sit **three levels above** `CoinPayPortal.php`:

```
library/Payment/Adapter/CoinPayPortal.php  ← adapter
src/
  CoinPayPortalClient.php
  WebhookVerifier.php
  StatusMapper.php
```

If you install the plugin directly from this repository into `plugins/fossbilling/` inside the coinpayportal monorepo, the relative paths are already correct.

3. Log into your FOSSBilling admin panel.

4. Go to **System → Payment Gateways**.

5. Find **CoinPayPortal Crypto Payments** in the list and click **Install**.

6. Click **Manage** and fill in your credentials (see [CONFIGURATION.md](CONFIGURATION.md)).

7. Copy the **Webhook URL** shown in the configuration screen into your [CoinPayPortal merchant dashboard](https://coinpayportal.com) under **Settings → Webhooks**.

8. Test with a sandbox payment before going live.

## Updating

Replace `CoinPayPortal.php`, the `CoinPayPortal/` directory, and the `src/` files with the new version. No database migrations are required.
