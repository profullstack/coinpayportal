import { DocSection } from './DocSection';
import { ApiEndpoint } from './ApiEndpoint';
import { CodeBlock } from './CodeBlock';

export function OAuthDocs() {
  return (
    <DocSection title="OAuth 2.0 / OpenID Connect">
      <p className="text-gray-300 mb-6">
        CoinPayPortal is a full <strong>OAuth 2.0 / OIDC provider</strong>. Third-party apps can authenticate users,
        access profile data, wallet addresses, and DIDs — all with standard authorization code flow + PKCE.
      </p>

      <div className="mb-8 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
        <h4 className="font-semibold text-purple-300 mb-2">How It Works</h4>
        <ol className="text-purple-200 text-sm space-y-1 list-decimal list-inside">
          <li><strong>Register</strong> an OAuth client in your dashboard (<code className="text-purple-100">/dashboard/oauth</code>)</li>
          <li><strong>Redirect</strong> users to <code className="text-purple-100">/api/oauth/authorize</code> with your client_id and scopes</li>
          <li><strong>User consents</strong> on the CoinPayPortal consent screen</li>
          <li><strong>Exchange</strong> the authorization code for tokens at <code className="text-purple-100">/api/oauth/token</code></li>
          <li><strong>Fetch</strong> user info from <code className="text-purple-100">/api/oauth/userinfo</code></li>
        </ol>
      </div>

      <h3 className="text-xl font-semibold text-white mb-4">Scopes</h3>
      <div className="grid md:grid-cols-2 gap-4 mb-8">
        {[
          { scope: 'openid', desc: 'Verify user identity (always included)' },
          { scope: 'profile', desc: 'Access name and profile info' },
          { scope: 'email', desc: 'Access email address' },
          { scope: 'did', desc: 'Access decentralized identifier (DID)' },
          { scope: 'wallet:read', desc: 'View wallet addresses and chains' },
        ].map((item) => (
          <div key={item.scope} className="p-3 rounded-lg bg-slate-800/50 border border-white/10">
            <code className="text-purple-400 font-mono">{item.scope}</code>
            <p className="text-gray-300 text-sm mt-1">{item.desc}</p>
          </div>
        ))}
      </div>

      <h3 className="text-xl font-semibold text-white mb-4">Client Registration</h3>

      <ApiEndpoint method="POST" path="/api/oauth/clients" description="Register a new OAuth client. Requires authentication.">
        <CodeBlock title="Request Body">
{`{
  "name": "My App",
  "description": "My awesome application",
  "redirect_uris": ["https://myapp.com/callback"],
  "scopes": ["openid", "profile", "email", "wallet:read"]
}`}
        </CodeBlock>

        <CodeBlock title="Response (201 Created)">
{`{
  "success": true,
  "client": {
    "id": "uuid",
    "client_id": "cp_a1b2c3d4e5f6...",
    "client_secret": "cps_xxxxxxxxxxxx...",
    "name": "My App",
    "redirect_uris": ["https://myapp.com/callback"],
    "scopes": ["openid", "profile", "email", "wallet:read"]
  },
  "warning": "Store the client_secret securely. It will not be shown again."
}`}
        </CodeBlock>
      </ApiEndpoint>

      <ApiEndpoint method="GET" path="/api/oauth/clients" description="List your registered OAuth clients." />
      <ApiEndpoint method="PATCH" path="/api/oauth/clients/:id" description="Update a client (name, redirect_uris, scopes, active status)." />

      <h3 className="text-xl font-semibold text-white mt-8 mb-4">Authorization Flow</h3>

      <ApiEndpoint method="GET" path="/api/oauth/authorize" description="Start the authorization code flow. Redirect users here.">
        <CodeBlock title="Query Parameters">
{`response_type  = code                          (required)
client_id      = cp_a1b2c3d4e5f6...            (required)
redirect_uri   = https://myapp.com/callback    (required, must match registered URI)
scope          = openid profile email           (space-separated)
state          = random_csrf_token              (recommended)
code_challenge = base64url(sha256(verifier))   (recommended, PKCE)
code_challenge_method = S256                    (required if code_challenge present)`}
        </CodeBlock>

        <CodeBlock title="Example Redirect URL">
{`https://coinpayportal.com/api/oauth/authorize?
  response_type=code&
  client_id=cp_a1b2c3d4e5f6...&
  redirect_uri=https://myapp.com/callback&
  scope=openid profile email wallet:read&
  state=xyz123&
  code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&
  code_challenge_method=S256`}
        </CodeBlock>

        <CodeBlock title="Callback (on success)">
{`https://myapp.com/callback?code=AUTH_CODE_HERE&state=xyz123`}
        </CodeBlock>
      </ApiEndpoint>

      <h3 className="text-xl font-semibold text-white mt-8 mb-4">Token Exchange</h3>

      <ApiEndpoint method="POST" path="/api/oauth/token" description="Exchange authorization code for tokens, or refresh an expired access token.">
        <CodeBlock title="Authorization Code Exchange (application/x-www-form-urlencoded)">
{`grant_type=authorization_code
code=AUTH_CODE_HERE
redirect_uri=https://myapp.com/callback
client_id=cp_a1b2c3d4e5f6...
client_secret=cps_xxxxxxxxxxxx...
code_verifier=YOUR_PKCE_VERIFIER   (if PKCE was used)`}
        </CodeBlock>

        <CodeBlock title="cURL Example" language="curl">
{`curl -X POST https://coinpayportal.com/api/oauth/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=authorization_code" \\
  -d "code=AUTH_CODE_HERE" \\
  -d "redirect_uri=https://myapp.com/callback" \\
  -d "client_id=cp_a1b2c3d4e5f6..." \\
  -d "client_secret=cps_xxxxxxxxxxxx..."`}
        </CodeBlock>

        <CodeBlock title="Response">
{`{
  "access_token": "eyJhbGciOiJIUzI1NiI...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "eyJhbGciOiJIUzI1NiI...",
  "id_token": "eyJhbGciOiJIUzI1NiI...",
  "scope": "openid profile email wallet:read"
}`}
        </CodeBlock>

        <CodeBlock title="Refresh Token">
{`grant_type=refresh_token
refresh_token=eyJhbGciOiJIUzI1NiI...
client_id=cp_a1b2c3d4e5f6...
client_secret=cps_xxxxxxxxxxxx...`}
        </CodeBlock>
      </ApiEndpoint>

      <h3 className="text-xl font-semibold text-white mt-8 mb-4">UserInfo Endpoint</h3>

      <ApiEndpoint method="GET" path="/api/oauth/userinfo" description="Get user claims based on the access token's scopes.">
        <CodeBlock title="cURL Example" language="curl">
{`curl https://coinpayportal.com/api/oauth/userinfo \\
  -H "Authorization: Bearer ACCESS_TOKEN"`}
        </CodeBlock>

        <CodeBlock title="Response (with profile + email + wallet:read + did scopes)">
{`{
  "sub": "user-uuid-123",
  "name": "Alice Merchant",
  "email": "alice@example.com",
  "email_verified": true,
  "wallets": [
    { "address": "0x1234...", "chain": "ETH", "label": "Main" },
    { "address": "bc1q...", "chain": "BTC" }
  ],
  "did": "did:key:z6Mk..."
}`}
        </CodeBlock>
      </ApiEndpoint>

      <h3 className="text-xl font-semibold text-white mt-8 mb-4">JWKS Endpoint</h3>

      <ApiEndpoint method="GET" path="/api/oauth/jwks" description="JSON Web Key Set for token verification. Uses HS256 (symmetric).">
        <CodeBlock title="Response">
{`{
  "keys": [
    {
      "kty": "oct",
      "kid": "a1b2c3d4e5f6...",
      "use": "sig",
      "alg": "HS256"
    }
  ]
}`}
        </CodeBlock>
      </ApiEndpoint>

      <h3 className="text-xl font-semibold text-white mt-8 mb-4">Full Integration Example</h3>

      <CodeBlock title="Node.js (Express)" language="javascript">
{`import crypto from 'crypto';

// 1. Generate PKCE verifier + challenge
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto
  .createHash('sha256')
  .update(verifier)
  .digest('base64url');

// 2. Redirect user to authorize
const authUrl = new URL('https://coinpayportal.com/api/oauth/authorize');
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('client_id', 'cp_your_client_id');
authUrl.searchParams.set('redirect_uri', 'https://myapp.com/callback');
authUrl.searchParams.set('scope', 'openid profile email wallet:read');
authUrl.searchParams.set('state', crypto.randomBytes(16).toString('hex'));
authUrl.searchParams.set('code_challenge', challenge);
authUrl.searchParams.set('code_challenge_method', 'S256');
// res.redirect(authUrl.toString());

// 3. Handle callback — exchange code for tokens
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  // Verify state matches what you stored in session

  const tokenRes = await fetch('https://coinpayportal.com/api/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'https://myapp.com/callback',
      client_id: 'cp_your_client_id',
      client_secret: 'cps_your_client_secret',
      code_verifier: verifier,
    }),
  });

  const tokens = await tokenRes.json();

  // 4. Fetch user info
  const userRes = await fetch('https://coinpayportal.com/api/oauth/userinfo', {
    headers: { Authorization: \`Bearer \${tokens.access_token}\` },
  });
  const user = await userRes.json();

  console.log('Authenticated user:', user.email);
  console.log('Wallets:', user.wallets);
  console.log('DID:', user.did);
});`}
      </CodeBlock>

      <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <p className="text-blue-300 text-sm">
          <strong>💡 Tip:</strong> Manage your OAuth clients from the{' '}
          <a href="/dashboard/oauth" className="text-blue-400 hover:text-blue-300 underline">OAuth Dashboard</a>.
          PKCE is strongly recommended for all clients, especially SPAs and mobile apps.
        </p>
      </div>
    </DocSection>
  );
}
