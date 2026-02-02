# Troubleshooting Guide

Common issues and their fixes when integrating with or operating CoinPay.

---

## Payment Issues

### Payment stays "pending" forever

**Symptoms:** Payment was created, customer says they sent funds, but status never changes.

**Causes & Fixes:**

1. **Customer sent to wrong address**  
   Have the customer verify the address they sent to matches `payment_address` in the payment record. Check the block explorer for the exact address.

2. **Customer sent wrong amount**  
   CoinPay has a 1% tolerance. If the customer sent significantly less, the payment won't confirm. Check `crypto_amount` (expected) vs actual blockchain balance.

3. **Blockchain congestion**  
   Bitcoin and Ethereum can have long confirmation times during high traffic. The cron monitor checks every minute — wait for at least 10-15 minutes before investigating.

4. **Payment expired before confirmation**  
   Default expiry is 60 minutes. If the customer took too long, the payment auto-expires. Create a new payment.

5. **Monitor not running**  
   Check if the cron job is active:
   ```bash
   # Vercel — check cron logs in the dashboard
   # Railway — check the logs for "monitor-payments"
   curl -H "Authorization: Bearer $INTERNAL_API_KEY" \
     https://coinpayportal.com/api/monitor/status
   ```

6. **RPC endpoint down**  
   If the blockchain RPC (Blockstream, Alchemy, etc.) is down, balance checks fail silently. Check the server logs for `Failed to fetch balance` errors.

**Debug steps:**
```bash
# Manually check the payment's blockchain balance
curl -X POST https://coinpayportal.com/api/payments/{payment_id}/check-balance

# Check payment details
curl https://coinpayportal.com/api/payments/{payment_id}
```

---

### Payment confirmed but not forwarded

**Symptoms:** Payment status is `confirmed` but funds weren't forwarded to merchant wallet.

**Causes & Fixes:**

1. **Forwarding key not configured**  
   Check that the payment address has an encrypted private key stored. This is set during HD wallet generation.

2. **Insufficient funds for gas/fees**  
   For EVM chains (ETH, POL, BNB), the payment address needs ETH/POL/BNB for gas to forward. For very small payments, the gas cost may exceed the payment.

3. **Forwarding transaction failed on-chain**  
   Check server logs for `Forwarding failed` errors. The transaction may have been rejected by the network.

4. **Manual forwarding:**
   ```bash
   curl -X POST \
     -H "Authorization: Bearer $ADMIN_JWT" \
     -H "Content-Type: application/json" \
     -d '{"retry": true}' \
     https://coinpayportal.com/api/payments/{payment_id}/forward
   ```

---

### "No wallet configured for this business" error

**Cause:** You're trying to create a payment for a blockchain but haven't added a receiving wallet address.

**Fix:**
1. Go to **Business Settings → Wallets**
2. Add a wallet address for the chain you want to accept
3. Or import global wallets: `POST /api/businesses/{id}/wallets/import`

---

### Payment amount seems wrong

**Cause:** Exchange rates fluctuate. The crypto amount is calculated at payment creation time based on the current rate.

**Details:**
- CoinPay uses Tatum API for exchange rates
- Rates are cached briefly (seconds) to avoid excessive API calls
- A 1% tolerance is applied when checking incoming funds

**If the rate seems very wrong**, check if the Tatum API is returning valid data:
```bash
curl https://coinpayportal.com/api/fees?blockchain=BTC
```

---

## Authentication Issues

### "Missing or invalid authorization header"

**Causes:**
1. Header format is wrong. Must be: `Authorization: Bearer YOUR_TOKEN`
2. Token is expired (JWTs expire after 24 hours)
3. API key is for a different business than the one you're accessing

**Fix:**
```javascript
// ✅ Correct
const response = await fetch('/api/payments/create', {
  headers: {
    'Authorization': `Bearer ${apiKey}`,  // with "Bearer " prefix
    'Content-Type': 'application/json',
  },
  // ...
});

// ❌ Wrong — missing "Bearer " prefix
headers: { 'Authorization': apiKey }

// ❌ Wrong — using "Token" instead of "Bearer"
headers: { 'Authorization': `Token ${apiKey}` }
```

### "Invalid or expired token"

**Cause:** JWT has expired or was signed with a different secret.

**Fix:**
1. Re-authenticate: `POST /api/auth/login`
2. Store and use the new token
3. Implement token refresh logic in your client

### API key not working after regeneration

**Cause:** The old key is immediately invalidated. Your code is still using the old key.

**Fix:** Update the environment variable on all servers and restart/redeploy.

---

## Webhook Issues

### Webhooks not arriving

**Causes & Fixes:**

1. **Webhook URL not configured**  
   Check Business Settings → Webhook URL is set and correct.

2. **URL not reachable from the internet**  
   CoinPay must be able to POST to your URL. Test:
   ```bash
   # From your server
   curl -X POST https://your-webhook-url/webhooks/coinpay \
     -d '{"test": true}'
   ```
   For local development, use [ngrok](https://ngrok.com) or a similar tunnel.

3. **URL returns non-2xx status**  
   Your webhook handler must return 200. If it returns 500 or times out, CoinPay will retry.

4. **Firewall blocking**  
   Ensure your server accepts POST requests from external IPs on the webhook path.

5. **Send a test webhook:**
   ```bash
   curl -X POST \
     -H "Authorization: Bearer $JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"event_type": "payment.confirmed"}' \
     https://coinpayportal.com/api/businesses/{id}/webhook-test
   ```

### Webhook signature verification failing

**Causes:**

1. **Parsing body as JSON before verification**  
   You MUST verify the raw string body, not the parsed JSON:
   ```javascript
   // ❌ BAD — body has been parsed, signature won't match
   app.post('/webhook', express.json(), (req, res) => {
     verifyWebhookSignature({ payload: JSON.stringify(req.body), ... });
   });

   // ✅ GOOD — raw body
   app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
     verifyWebhookSignature({ payload: req.body.toString(), ... });
   });
   ```

2. **Wrong webhook secret**  
   Did you regenerate the secret but forget to update your code?

3. **Timestamp tolerance**  
   Default tolerance is 300 seconds (5 minutes). If your server clock is very wrong, increase the tolerance or sync NTP.

---

## Web Wallet Issues

### "INVALID_SIGNATURE" when authenticating

**Cause:** The challenge signature verification failed.

**Fix:**
1. Make sure you're signing the exact challenge string returned by `/auth/challenge`
2. Use the wallet's identity private key, not an address-level key
3. The challenge expires in 5 minutes — sign promptly
4. Ensure the signature format matches what the server expects (hex or base64 depending on chain)

### "RATE_LIMITED" error

**Cause:** You've exceeded the rate limit for this endpoint.

**Fix:** Wait for the `retry_after` seconds indicated in the response:
```json
{ "ok": false, "code": "RATE_LIMITED", "retry_after": 30 }
```

Reduce your request frequency or implement backoff.

### "SPEND_LIMIT_EXCEEDED" when sending

**Cause:** The transaction exceeds your configured daily spend limit.

**Fix:**
1. Check your limits: `GET /api/web-wallet/{id}/settings`
2. Increase the limit: `PATCH /api/web-wallet/{id}/settings`
3. Or wait until the next UTC day when the limit resets

### "ADDRESS_NOT_WHITELISTED"

**Cause:** Address whitelisting is enabled and the destination address isn't on your whitelist.

**Fix:**
1. Add the address to your whitelist:
   ```json
   PATCH /api/web-wallet/{id}/settings
   {
     "whitelist_addresses": ["0xExisting...", "0xNewAddress..."]
   }
   ```
2. Or disable whitelisting (less secure):
   ```json
   { "whitelist_enabled": false }
   ```

---

## Deployment Issues

### Build fails on Railway/Vercel

**Common causes:**

1. **Missing environment variables**  
   Required at build time:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - All `NEXT_PUBLIC_*` variables (they're embedded at build time)

2. **Node version mismatch**  
   CoinPay requires Node ≥ 24. Check your deployment config:
   ```json
   // package.json
   { "engines": { "node": ">=24.0.0" } }
   ```

3. **pnpm version**  
   Requires pnpm ≥ 10. Railway/Vercel should auto-detect from `pnpm-lock.yaml`.

### Database migration errors

**Fix:**
```bash
# Check current migration status
npx supabase migration list

# Apply pending migrations
npx supabase db push

# If a migration fails, check the SQL for syntax errors
# or conflicting constraints, then fix and re-run
```

### "Server configuration error" (500)

**Cause:** Missing environment variables on the server.

**Required variables:**
```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJxxx
JWT_SECRET=your-secret
```

Check your deployment platform's environment variables panel.

---

## Performance Issues

### API responses are slow

**Causes:**
1. **Cold starts** — Vercel serverless functions may cold-start. First request after idle is slower.
2. **Blockchain RPC latency** — Balance checks and fee estimates call external RPCs.
3. **Database queries** — Check Supabase dashboard for slow queries.

**Fixes:**
- Use `keep-alive` connections
- Reduce polling frequency (5s → 10s)
- Cache exchange rates client-side
- Consider Railway for always-on deployment (no cold starts)

### Payment check-balance is slow

**Cause:** Each balance check hits an external blockchain RPC.

**Fix:** The cron-based monitor handles most detection. Only use `check-balance` for the active payment page, not for batch checking.

---

## Getting Help

1. **Check logs first** — Most issues leave traces in server logs
2. **Webhook logs** — `GET /api/webhooks` shows delivery history with response codes
3. **Block explorers** — Verify transactions independently:
   - BTC: [blockstream.info](https://blockstream.info)
   - ETH: [etherscan.io](https://etherscan.io)
   - SOL: [solscan.io](https://solscan.io)
   - POL: [polygonscan.com](https://polygonscan.com)
4. **Test endpoints** — Use `POST /api/businesses/{id}/webhook-test` to test webhook delivery
5. **CoinPay support** — Contact via the Help page at [coinpayportal.com/help](https://coinpayportal.com/help)
