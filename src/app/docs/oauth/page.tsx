import type { Metadata } from 'next';
import Link from 'next/link';
import { DocSection } from '@/components/docs/DocSection';
import { CodeBlock } from '@/components/docs/CodeBlock';

export const metadata: Metadata = {
  title: 'Sign in with CoinPay (OAuth 2.1) | CoinPay Docs',
  description:
    'Add "Sign in with CoinPay" to a web app, a PWA or a CLI: OAuth 2.1 authorization code + PKCE, public clients, the device flow, refresh rotation and revocation.',
};

const ENDPOINTS: Array<[string, string, string]> = [
  ['GET', '/.well-known/openid-configuration', 'OIDC discovery'],
  ['GET', '/.well-known/oauth-authorization-server', 'RFC 8414 metadata (same content)'],
  ['GET', '/api/oauth/authorize', 'Authorization endpoint (response_type=code only)'],
  ['POST', '/api/oauth/token', 'authorization_code, refresh_token, device_code grants'],
  ['POST', '/api/oauth/device_authorization', 'Start the device flow (RFC 8628)'],
  ['POST', '/api/oauth/revoke', 'Revoke a refresh or access token (RFC 7009)'],
  ['GET', '/api/oauth/userinfo', 'Claims for the access token'],
  ['GET', '/api/oauth/jwks', 'Public keys for RS256 ID tokens'],
  ['POST', '/api/oauth/clients', 'Register a client (signed-in CoinPay account)'],
];

export default function SignInWithCoinPayDocs() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link href="/docs#oauth" className="inline-flex items-center text-purple-400 hover:text-purple-300 mb-6">
          ← Back to API docs
        </Link>
        <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">Sign in with CoinPay</h1>
        <p className="text-xl text-gray-300 mb-10">
          One CoinPay account signs people in to every app that trusts it. CoinPay is an OAuth 2.1 authorization
          server and OpenID Connect provider: web apps, installable PWAs and command-line tools all use the same
          account, with the flow that fits each.
        </p>

        <DocSection title="Pick your flow">
          <div className="grid md:grid-cols-3 gap-4 mb-6">
            {[
              ['Web app with a server', 'Confidential client', 'Authorization code + PKCE, client secret on your server.'],
              ['PWA / SPA / mobile', 'Public client', 'Authorization code + PKCE, no secret. Register with token_endpoint_auth_method "none".'],
              ['CLI / TV / headless', 'Public client', 'Device flow (RFC 8628), or loopback PKCE when a browser is on the same machine.'],
            ].map(([title, kind, body]) => (
              <div key={title} className="p-4 rounded-lg bg-slate-800/60 border border-white/10">
                <div className="font-semibold text-white">{title}</div>
                <div className="text-purple-300 text-sm mb-2">{kind}</div>
                <p className="text-gray-300 text-sm">{body}</p>
              </div>
            ))}
          </div>
          <p className="text-gray-300">
            Every flow requires PKCE with <code>S256</code>. There is no implicit grant and no password grant.
            Authorization codes are single-use and live 10 minutes. Redirect URIs must match exactly, except that a
            public client registered with <code>http://127.0.0.1/…</code> or <code>http://[::1]/…</code> may use any
            port at runtime (RFC 8252).
          </p>
        </DocSection>

        <DocSection title="1. Register your app">
          <p className="text-gray-300 mb-4">
            Sign in to CoinPay and register at <Link href="/dashboard/oauth" className="text-purple-300 underline">/dashboard/oauth</Link>,
            with <code>coinpay oauth create</code>, or by API. Ask only for the scopes you need; a grant is limited to the
            scopes the client was registered with.
          </p>
          <CodeBlock title="Confidential web client" language="bash">
{`curl -X POST https://coinpayportal.com/api/oauth/clients \\
  -H "Authorization: Bearer <your CoinPay session or API key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "My App",
    "redirect_uris": ["https://myapp.com/api/v1/coinpay/oauth/callback"],
    "scopes": ["openid", "profile", "email"]
  }'
# → client_id + client_secret (shown once). ID tokens are RS256 by default.`}
          </CodeBlock>
          <CodeBlock title="Public client (PWA, CLI, native app)" language="bash">
{`curl -X POST https://coinpayportal.com/api/oauth/clients \\
  -H "Authorization: Bearer <your CoinPay session or API key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "My CLI",
    "token_endpoint_auth_method": "none",
    "redirect_uris": ["http://127.0.0.1/callback", "https://myapp.com/oauth/callback"],
    "scopes": ["openid", "profile"]
  }'
# → client_id only. grant_types defaults to authorization_code, refresh_token
#   and urn:ietf:params:oauth:grant-type:device_code.`}
          </CodeBlock>
          <p className="text-gray-400 text-sm">
            Optional fields: <code>grant_types</code>, <code>id_token_signed_response_alg</code> (<code>RS256</code> default,
            or <code>HS256</code>). Loopback and private-use-scheme (<code>com.example.app:/cb</code>) redirect URIs are
            accepted for public clients only; everything else must be https.
          </p>
        </DocSection>

        <DocSection title="2a. Web app (confidential, code + PKCE)">
          <CodeBlock title="Send the user to CoinPay" language="http">
{`GET https://coinpayportal.com/api/oauth/authorize
  ?response_type=code
  &client_id=cp_xxx
  &redirect_uri=https://myapp.com/api/v1/coinpay/oauth/callback
  &scope=openid%20profile%20email
  &state=<random, stored in a cookie>
  &nonce=<random>
  &code_challenge=<base64url(sha256(verifier))>
  &code_challenge_method=S256`}
          </CodeBlock>
          <CodeBlock title="Exchange the code on your server" language="bash">
{`curl -X POST https://coinpayportal.com/api/oauth/token \\
  -u "cp_xxx:cps_secret" \\
  -d grant_type=authorization_code \\
  -d code=<code> \\
  -d redirect_uri=https://myapp.com/api/v1/coinpay/oauth/callback \\
  -d code_verifier=<verifier>`}
          </CodeBlock>
          <p className="text-gray-300">
            Check <code>state</code> before the exchange and <code>nonce</code> in the ID token after it. Confidential
            clients authenticate with HTTP Basic or <code>client_secret</code> in the body.
          </p>
        </DocSection>

        <DocSection title="2b. PWA or single-page app (public, code + PKCE)">
          <p className="text-gray-300 mb-4">
            Same authorize request as above. The token exchange sends <code>client_id</code> and the verifier and no
            secret; sending one for a public client is an error.
          </p>
          <CodeBlock title="Browser code" language="javascript">
{`const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
sessionStorage.setItem('pkce', verifier);
// ...redirect to /api/oauth/authorize with code_challenge=challenge, then on the callback:
const res = await fetch('https://coinpayportal.com/api/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code', client_id: 'cp_xxx', code,
    redirect_uri: location.origin + '/oauth/callback',
    code_verifier: sessionStorage.getItem('pkce'),
  }),
});`}
          </CodeBlock>
        </DocSection>

        <DocSection title="2c. CLI (device flow, RFC 8628)">
          <CodeBlock title="Start" language="bash">
{`curl -X POST https://coinpayportal.com/api/oauth/device_authorization \\
  -d client_id=cp_xxx -d "scope=openid profile"
# {"device_code":"…","user_code":"WDJB-MJHT",
#  "verification_uri":"https://coinpayportal.com/oauth/device",
#  "expires_in":600,"interval":5}`}
          </CodeBlock>
          <p className="text-gray-300 mb-4">
            Show the user the code and the URL. They open it on any device where they are signed in to CoinPay, type
            the code, and approve your app by name and scope. There is deliberately no pre-filled
            <code> verification_uri_complete</code>: typing the code is what ties the approval to the person at your
            terminal.
          </p>
          <CodeBlock title="Poll" language="bash">
{`curl -X POST https://coinpayportal.com/api/oauth/token \\
  -d grant_type=urn:ietf:params:oauth:grant-type:device_code \\
  -d device_code=<device_code> -d client_id=cp_xxx
# 400 authorization_pending  keep polling every \`interval\` seconds
# 400 slow_down              add 5 seconds to the interval
# 400 access_denied          the user said no
# 400 expired_token          start again
# 200 { access_token, refresh_token, id_token, ... }`}
          </CodeBlock>
          <p className="text-gray-300">
            When a browser is on the same machine, a CLI can instead listen on <code>http://127.0.0.1:&lt;any port&gt;/callback</code>{' '}
            and run the PKCE flow. The CoinPay CLI does both: <code>coinpay login</code> picks loopback or device flow,{' '}
            <code>coinpay login --device</code> forces the device flow, and <code>coinpay logout</code> revokes.
          </p>
        </DocSection>

        <DocSection title="Tokens">
          <ul className="list-disc list-inside text-gray-300 space-y-2 mb-4">
            <li>Access tokens last 1 hour and carry <code>aud</code> = your client_id, <code>scope</code>, <code>jti</code> and <code>sid</code> (the grant). Treat them as opaque and check them at userinfo.</li>
            <li>Refresh tokens last 30 days and rotate on every use. Store the new one each time. Presenting a refresh token that was already used revokes the whole grant (reuse detection), so serialise refreshes per user.</li>
            <li>ID tokens are RS256 (verify against <code>/api/oauth/jwks</code>, <code>aud</code> = client_id, <code>iss</code> = https://coinpayportal.com) for clients registered from 2026-10-29. Older clients keep HS256 unless they change <code>id_token_signed_response_alg</code>.</li>
            <li>If your API accepts CoinPay access tokens from another app, check <code>aud</code> (or <code>client_id</code>) against an allow-list and confirm the token at userinfo; revoked tokens fail there at once.</li>
          </ul>
          <CodeBlock title="Revoke on sign-out" language="bash">
{`curl -X POST https://coinpayportal.com/api/oauth/revoke \\
  -d token=<refresh_token> -d token_type_hint=refresh_token -d client_id=cp_xxx
# always 200. Revoking a refresh token ends the grant and its access tokens.`}
          </CodeBlock>
        </DocSection>

        <DocSection title="Account linking: bind to sub, never to email">
          <p className="text-gray-300">
            CoinPay does not verify email addresses, so <code>email_verified</code> is always <code>false</code>. Link a
            CoinPay login to a local account by its <code>sub</code> only. Never sign someone in to an existing account
            because the CoinPay email matches, never treat that email as verified or unique, and never grant admin
            rights from it. Connect CoinPay to an existing account only while the user is signed in to it.
          </p>
        </DocSection>

        <DocSection title="Endpoints">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-gray-300">
              <tbody>
                {ENDPOINTS.map(([method, path, what]) => (
                  <tr key={path} className="border-b border-white/10">
                    <td className="py-2 pr-4 font-mono text-purple-300">{method}</td>
                    <td className="py-2 pr-4 font-mono break-all">{path}</td>
                    <td className="py-2">{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DocSection>
      </div>
    </div>
  );
}
