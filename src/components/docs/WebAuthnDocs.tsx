import { DocSection } from './DocSection';
import { ApiEndpoint } from './ApiEndpoint';
import { CodeBlock } from './CodeBlock';

export function WebAuthnDocs() {
  return (
    <DocSection title="WebAuthn / Passkeys">
      <p className="text-gray-300 mb-6">
        CoinPayPortal supports <strong>passwordless authentication</strong> using WebAuthn / FIDO2 passkeys.
        Users can register hardware keys, biometric authenticators, or platform passkeys (Touch ID, Windows Hello, etc.)
        for secure, phishing-resistant login.
      </p>

      <div className="mb-8 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
        <h4 className="font-semibold text-green-300 mb-2">Why Passkeys?</h4>
        <ul className="text-green-200 text-sm space-y-1 list-disc list-inside">
          <li><strong>Phishing-resistant</strong> — bound to the origin, can&apos;t be stolen via fake login pages</li>
          <li><strong>No passwords</strong> — nothing to remember, nothing to leak in a breach</li>
          <li><strong>Cross-device</strong> — synced passkeys work across your Apple/Google/Microsoft ecosystem</li>
          <li><strong>Fast</strong> — one tap or biometric scan to login</li>
        </ul>
      </div>

      <div className="mb-8 grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-lg bg-slate-800/50 border border-white/10">
          <h4 className="font-semibold text-white mb-2">Registration Flow</h4>
          <ol className="text-gray-300 text-sm space-y-1 list-decimal list-inside">
            <li>User logs in with password (one-time)</li>
            <li>GET <code className="text-purple-400">/register-options</code> → challenge</li>
            <li>Browser creates credential (<code className="text-purple-400">navigator.credentials.create()</code>)</li>
            <li>POST <code className="text-purple-400">/register-verify</code> → passkey stored</li>
          </ol>
        </div>
        <div className="p-4 rounded-lg bg-slate-800/50 border border-white/10">
          <h4 className="font-semibold text-white mb-2">Login Flow</h4>
          <ol className="text-gray-300 text-sm space-y-1 list-decimal list-inside">
            <li>POST <code className="text-purple-400">/login-options</code> → challenge + allowed credentials</li>
            <li>Browser signs challenge (<code className="text-purple-400">navigator.credentials.get()</code>)</li>
            <li>POST <code className="text-purple-400">/login-verify</code> → JWT token returned</li>
            <li>User is authenticated (same token as password login)</li>
          </ol>
        </div>
      </div>

      <h3 className="text-xl font-semibold text-white mb-4">Registration</h3>

      <ApiEndpoint method="GET" path="/api/auth/webauthn/register-options" description="Get WebAuthn registration options. Requires authentication (user must already be logged in).">
        <CodeBlock title="cURL Example" language="curl">
{`curl https://coinpayportal.com/api/auth/webauthn/register-options \\
  -H "Authorization: Bearer YOUR_TOKEN"`}
        </CodeBlock>

        <CodeBlock title="Response">
{`{
  "success": true,
  "options": {
    "challenge": "base64url-encoded-challenge",
    "rp": {
      "name": "CoinPayPortal",
      "id": "coinpayportal.com"
    },
    "user": {
      "id": "base64url-encoded-user-id",
      "name": "merchant@example.com",
      "displayName": "merchant@example.com"
    },
    "pubKeyCredParams": [
      { "type": "public-key", "alg": -7 },
      { "type": "public-key", "alg": -257 }
    ],
    "authenticatorSelection": {
      "residentKey": "preferred",
      "userVerification": "preferred"
    },
    "attestation": "none",
    "excludeCredentials": []
  }
}`}
        </CodeBlock>
      </ApiEndpoint>

      <ApiEndpoint method="POST" path="/api/auth/webauthn/register-verify" description="Verify and store the new credential. Send the response from navigator.credentials.create().">
        <CodeBlock title="Request Body">
{`{
  "credential": {
    "id": "base64url-credential-id",
    "rawId": "base64url-raw-id",
    "response": {
      "attestationObject": "base64url-attestation",
      "clientDataJSON": "base64url-client-data",
      "transports": ["internal", "hybrid"]
    },
    "type": "public-key"
  },
  "name": "MacBook Pro Touch ID"
}`}
        </CodeBlock>

        <CodeBlock title="Response">
{`{
  "success": true,
  "credential": {
    "id": "uuid",
    "name": "MacBook Pro Touch ID",
    "device_type": "platform",
    "created_at": "2024-01-15T10:00:00Z"
  }
}`}
        </CodeBlock>
      </ApiEndpoint>

      <h3 className="text-xl font-semibold text-white mt-8 mb-4">Login</h3>

      <ApiEndpoint method="POST" path="/api/auth/webauthn/login-options" description="Get authentication options. Public endpoint — no auth required. Optionally pass email to filter credentials.">
        <CodeBlock title="Request Body">
{`{
  "email": "merchant@example.com"   // optional — enables credential filtering
}`}
        </CodeBlock>

        <CodeBlock title="Response">
{`{
  "success": true,
  "options": {
    "challenge": "base64url-encoded-challenge",
    "rpId": "coinpayportal.com",
    "allowCredentials": [
      {
        "id": "base64url-credential-id",
        "transports": ["internal", "hybrid"]
      }
    ],
    "userVerification": "preferred"
  },
  "_challengeKey": "user-uuid-or-anon-key"
}`}
        </CodeBlock>

        <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <p className="text-yellow-300 text-sm">
            <strong>Note:</strong> Save the <code className="text-yellow-200">_challengeKey</code> — you must send it back
            with the verification request. If no email is provided, the browser will show all available passkeys (discoverable credentials).
          </p>
        </div>
      </ApiEndpoint>

      <ApiEndpoint method="POST" path="/api/auth/webauthn/login-verify" description="Verify the authentication assertion. Returns a JWT token on success (same as password login).">
        <CodeBlock title="Request Body">
{`{
  "credential": {
    "id": "base64url-credential-id",
    "rawId": "base64url-raw-id",
    "response": {
      "authenticatorData": "base64url-auth-data",
      "clientDataJSON": "base64url-client-data",
      "signature": "base64url-signature"
    },
    "type": "public-key"
  },
  "challengeKey": "user-uuid-or-anon-key"
}`}
        </CodeBlock>

        <CodeBlock title="Response">
{`{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiI...",
  "merchant": {
    "id": "merchant-uuid",
    "email": "merchant@example.com",
    "is_admin": false
  }
}`}
        </CodeBlock>
      </ApiEndpoint>

      <h3 className="text-xl font-semibold text-white mt-8 mb-4">Credential Management</h3>

      <ApiEndpoint method="GET" path="/api/auth/webauthn/credentials" description="List all registered passkeys for the authenticated user.">
        <CodeBlock title="Response">
{`{
  "success": true,
  "credentials": [
    {
      "id": "uuid",
      "name": "MacBook Pro Touch ID",
      "device_type": "platform",
      "transports": ["internal"],
      "created_at": "2024-01-15T10:00:00Z",
      "last_used_at": "2024-01-20T14:30:00Z"
    },
    {
      "id": "uuid-2",
      "name": "YubiKey 5",
      "device_type": "cross-platform",
      "transports": ["usb"],
      "created_at": "2024-01-16T09:00:00Z",
      "last_used_at": null
    }
  ]
}`}
        </CodeBlock>
      </ApiEndpoint>

      <ApiEndpoint method="PATCH" path="/api/auth/webauthn/credentials" description="Rename a passkey.">
        <CodeBlock title="Request Body">
{`{
  "id": "credential-uuid",
  "name": "Work Laptop"
}`}
        </CodeBlock>
      </ApiEndpoint>

      <ApiEndpoint method="DELETE" path="/api/auth/webauthn/credentials?id=credential-uuid" description="Remove a passkey. User must have at least one other auth method." />

      <h3 className="text-xl font-semibold text-white mt-8 mb-4">Frontend Integration</h3>

      <CodeBlock title="Register a Passkey (Browser)" language="javascript">
{`import { startRegistration } from '@simplewebauthn/browser';

// 1. Get registration options from server
const optionsRes = await fetch('/api/auth/webauthn/register-options', {
  headers: { Authorization: \`Bearer \${token}\` },
});
const { options } = await optionsRes.json();

// 2. Create credential via browser API
const credential = await startRegistration(options);

// 3. Send to server for verification
const verifyRes = await fetch('/api/auth/webauthn/register-verify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: \`Bearer \${token}\`,
  },
  body: JSON.stringify({
    credential,
    name: 'My Passkey',
  }),
});

const result = await verifyRes.json();
console.log('Passkey registered:', result.credential.name);`}
      </CodeBlock>

      <CodeBlock title="Login with Passkey (Browser)" language="javascript">
{`import { startAuthentication } from '@simplewebauthn/browser';

// 1. Get authentication options
const optionsRes = await fetch('/api/auth/webauthn/login-options', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'merchant@example.com' }),
});
const { options, _challengeKey } = await optionsRes.json();

// 2. Authenticate via browser API (triggers biometric/PIN prompt)
const credential = await startAuthentication(options);

// 3. Verify on server — get JWT
const verifyRes = await fetch('/api/auth/webauthn/login-verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    credential,
    challengeKey: _challengeKey,
  }),
});

const { token, merchant } = await verifyRes.json();
console.log('Logged in as:', merchant.email);
// Store token for subsequent API calls`}
      </CodeBlock>

      <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <p className="text-blue-300 text-sm">
          <strong>💡 Browser Library:</strong> We recommend{' '}
          <a href="https://simplewebauthn.dev" className="text-blue-400 hover:text-blue-300 underline" target="_blank" rel="noopener noreferrer">
            @simplewebauthn/browser
          </a>{' '}
          for handling the WebAuthn browser API. It simplifies credential creation and authentication with proper
          base64url encoding and error handling.
        </p>
      </div>
    </DocSection>
  );
}
