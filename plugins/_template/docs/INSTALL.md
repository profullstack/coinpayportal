# Installation — &lt;Platform&gt;

> **TODO:** replace `<Platform>` with the target platform and fill in the platform-specific install steps.

## Requirements

- &lt;Platform&gt; version: TODO
- Runtime: TODO (PHP / Node / Ruby / etc.)
- HTTPS in production
- A CoinPayPortal merchant account with an API key (`cp_live_*` or `cp_test_*`)

## Install

1. TODO — describe the upload / package install path for this platform (admin upload, app store install, composer/npm package, manual file copy).
2. Activate the plugin from the platform's admin UI.
3. Open the gateway settings and paste your CoinPayPortal credentials (see `CONFIGURATION.md`).
4. Copy the **Webhook URL** shown in settings into your CoinPayPortal dashboard under **Settings → Webhooks**.
5. Run a small sandbox-mode purchase end-to-end before going live.

## Updating

Replace the plugin files with the new release. No database migrations are required unless the changelog explicitly calls one out.

## Uninstalling

Disable the gateway, remove the webhook from your CoinPayPortal dashboard, then delete the plugin files.
