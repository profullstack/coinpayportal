# Troubleshooting

## Enable Debug Logging

Go to **System → Payment Gateways → CoinPayPortal → Manage** and set **Debug Logging** to **Yes**. Then check your PHP error log (usually `/var/log/php/error.log` or your web server's error log).

Disable debug logging in production once your issue is resolved.

---

## Common Issues

### "We could not start the crypto checkout"

The customer sees this message when the plugin cannot create a checkout session.

**Check:**
- API key is correct and not expired.
- Merchant ID is correct.
- API Base URL is reachable from your server (`curl https://api.coinpayportal.com/v1/checkouts` should not time out).
- Sandbox mode matches your API key (sandbox key ≠ live key).
- Debug logging is enabled and the PHP error log shows the specific API error.

---

### Webhook not received / invoice not marked paid

**Check:**
1. The webhook URL (`https://YOUR-DOMAIN.COM/ipn/CoinPayPortal`) is registered in your CoinPayPortal merchant dashboard.
2. The webhook URL is publicly reachable — test with `curl -X POST https://YOUR-DOMAIN.COM/ipn/CoinPayPortal`.
3. The **Webhook Secret** in FOSSBilling matches exactly what's in your CoinPayPortal dashboard.
4. Debug logging shows `[CoinPayPortal] Webhook received event=...` in the error log.

---

### "Webhook signature verification failed"

The `X-CoinPayPortal-Signature` header did not match.

**Check:**
- Webhook Secret is copied correctly (no extra spaces or newlines).
- Your server is not modifying the raw POST body before the plugin reads it (proxies, CDNs, or WAFs that reformat JSON can break HMAC verification).
- The signature format is `sha256=<hex>`.

---

### Invoice already paid — webhook ignored

This is expected behavior. If the same `payment.completed` event arrives twice, the second is silently ignored. Check the debug log for `already paid, ignoring`.

---

### Underpayment not accepted

If a customer paid less than the invoice total and the invoice was not marked paid, check the **Underpayment Tolerance** setting. A value of `0` requires exact payment. Set to e.g. `2` to accept payments within 2% of the total.

---

### PHP cURL errors

Ensure the PHP `curl` extension is enabled:

```bash
php -m | grep curl
```

If missing, install it:

```bash
# Debian/Ubuntu
sudo apt install php-curl

# CentOS/RHEL
sudo yum install php-curl
```

---

### Template not found

If you see "Template not found: pay" the `templates/` directory was not copied correctly. Verify:

```
library/Payment/Adapter/CoinPayPortal/templates/pay.phtml
library/Payment/Adapter/CoinPayPortal/templates/error.phtml
```

---

## Getting Help

Open an issue at [github.com/profullstack/coinpayportal](https://github.com/profullstack/coinpayportal/issues) or contact [support@coinpayportal.com](mailto:support@coinpayportal.com).
