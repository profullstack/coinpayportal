# Add Passkey Login (WebAuthn) via CoinPay

You are adding passkey-based authentication to an app using CoinPay's WebAuthn endpoints.

## Goal

Users register a passkey (Touch ID, Face ID, Windows Hello, hardware key) and use it to sign in — no passwords.

## Environment variables

```
COINPAY_API_KEY=sk_live_...
COINPAY_API_URL=https://coinpayportal.com
WEBAUTHN_RP_ID=example-business.com
WEBAUTHN_RP_ORIGIN=https://example-business.com
```

Where to find them:
- `COINPAY_API_KEY` — `https://coinpayportal.com/businesses/<your-business-id>` → **API Keys** tab → **Create API Key**. Shown once.
- `WEBAUTHN_RP_ID` — your bare domain (no scheme, no port). Passkeys are bound to it forever, so pick the production domain.
- `WEBAUTHN_RP_ORIGIN` — full origin including scheme. Must be HTTPS in production.

## Registration

1. **Begin** — server fetches a challenge:

   ```bash
   curl -X POST https://coinpayportal.com/api/webauthn/register/begin \
     -H "Authorization: Bearer $COINPAY_API_KEY" \
     -d '{"user_id": "user_123", "username": "alice@example-business.com"}'
   ```

   Returns a `PublicKeyCredentialCreationOptions` object.

2. **Browser** — call `navigator.credentials.create({ publicKey: options })`.

3. **Finish** — POST the resulting attestation back to:

   ```
   POST https://coinpayportal.com/api/webauthn/register/finish
   ```

   The server verifies and stores the credential.

## Authentication

1. **Begin:**

   ```bash
   curl -X POST https://coinpayportal.com/api/webauthn/login/begin \
     -d '{"username": "alice@example-business.com"}'
   ```

   Returns `PublicKeyCredentialRequestOptions`.

2. **Browser** — call `navigator.credentials.get({ publicKey: options })`.

3. **Finish** — POST the assertion to `/api/webauthn/login/finish`. On success, create a session.

## Rules

- `rpId` must match your domain (`example-business.com`) — passkeys are bound to it.
- Use HTTPS in production. WebAuthn requires it.
- Store the credential ID and public key per user; one user can have multiple passkeys.
- Provide a fallback (email magic link or recovery code) for lost devices.

## Deliverable

- Register / authenticate routes wired to the CoinPay endpoints.
- Browser-side helpers using `@simplewebauthn/browser` (or equivalent).
- A "manage passkeys" UI listing the user's credentials with delete buttons.
