# Sign in with CoinPay (OAuth 2.0 / OIDC)

You are adding "Sign in with CoinPay" to an app using OAuth 2.0 + OpenID Connect.

## Goal

Let users authenticate via CoinPay and receive an ID token + access token. Use the ID token to create a local session.

## Environment variables

```
COINPAY_OAUTH_CLIENT_ID=cpc_...
COINPAY_OAUTH_CLIENT_SECRET=cps_...
COINPAY_OAUTH_REDIRECT_URI=https://example-business.com/api/auth/callback/coinpay
COINPAY_OAUTH_ISSUER=https://coinpayportal.com
```

Where to find them:
- `COINPAY_OAUTH_CLIENT_ID` / `COINPAY_OAUTH_CLIENT_SECRET` — `https://coinpayportal.com/dashboard/oauth` → **New Client**. The client secret is shown once on creation; copy it immediately.
- `COINPAY_OAUTH_REDIRECT_URI` — must match exactly what you registered on the client. Add it both in the portal and in `.env`.
- `COINPAY_OAUTH_ISSUER` — `https://coinpayportal.com` in production. JWKS is at `${COINPAY_OAUTH_ISSUER}/.well-known/jwks.json`.

## Steps

1. **Register an OAuth client** in the CoinPay portal at `https://example-business.com/oauth/clients` (use your actual portal URL). Set:
   - Redirect URI: `https://example-business.com/api/auth/callback/coinpay`
   - Scopes: `openid email profile` (add `payments` if you'll call the API on the user's behalf)

2. **Start the flow.** Redirect the user to:

   ```
   https://coinpayportal.com/oauth/authorize
     ?response_type=code
     &client_id=$CLIENT_ID
     &redirect_uri=https://example-business.com/api/auth/callback/coinpay
     &scope=openid%20email%20profile
     &state=$RANDOM_CSRF_TOKEN
     &code_challenge=$PKCE_CHALLENGE
     &code_challenge_method=S256
   ```

3. **Handle the callback.** Verify `state`, then exchange the code:

   ```bash
   curl -X POST https://coinpayportal.com/oauth/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=authorization_code" \
     -d "code=$CODE" \
     -d "redirect_uri=https://example-business.com/api/auth/callback/coinpay" \
     -d "client_id=$CLIENT_ID" \
     -d "client_secret=$CLIENT_SECRET" \
     -d "code_verifier=$PKCE_VERIFIER"
   ```

   Returns `id_token`, `access_token`, `refresh_token`.

4. **Verify the ID token.** Fetch JWKS from `https://coinpayportal.com/.well-known/jwks.json`, verify the JWT signature, `iss`, `aud`, `exp`. Use a JWT library — do not roll your own.

5. **Create a session** keyed off the verified `sub` claim.

6. **Refresh** when the access token expires using the refresh token.

## Rules

- Always use PKCE, even for confidential clients.
- Always verify `state` to prevent CSRF.
- Never trust the ID token without verifying the signature against JWKS.
- Use `example-business.com` for any placeholder app URL.

## Deliverable

- `/api/auth/login/coinpay` route that initiates the flow with PKCE + state.
- `/api/auth/callback/coinpay` route that verifies state, exchanges the code, verifies the ID token, and creates a session.
- A logout route that revokes the refresh token.
