# Troubleshooting — &lt;Platform&gt;

## Enable debug logging

Turn on **Debug Logging** in the gateway settings. Disable once the issue is resolved — logs may contain request bodies.

---

## "Could not start crypto checkout"

The plugin failed to create a checkout session.

Check:
- API key is valid and matches the chosen environment (sandbox vs live).
- Business ID is correct.
- API Base URL is reachable from the merchant's server.
- Debug log shows the underlying API error.

---

## Webhook not received / order not marked paid

Check:
1. Webhook URL is registered in the CoinPayPortal dashboard.
2. The URL is publicly reachable (`curl -X POST` from outside the merchant network).
3. Webhook Secret matches exactly between the dashboard and the plugin.
4. The platform isn't blocking the request (CDN, WAF, basic auth).

---

## "Webhook signature verification failed"

- Webhook secret was copied wrong (extra whitespace).
- A proxy or CDN reformatted the JSON body before the plugin saw it — HMAC is over the raw bytes.
- Clock skew &gt; 5 minutes between the merchant server and CoinPayPortal.

---

## Already paid — webhook ignored

Expected. Duplicate `payment.confirmed` events are silently ignored.

---

## Underpayment not accepted

Check the **Underpayment Tolerance** field. `0` requires exact payment.

---

## Getting help

- Issues: [github.com/profullstack/coinpayportal](https://github.com/profullstack/coinpayportal/issues)
- Email: [support@coinpayportal.com](mailto:support@coinpayportal.com)
