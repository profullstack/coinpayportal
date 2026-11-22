import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Security | CoinPay',
  description:
    'How CoinPay protects funds, credentials and financial data: non-custodial wallets, per-merchant secret vaults, encryption at rest, signed webhooks and responsible disclosure.',
  alternates: { canonical: '/security' },
};

const h2 = 'text-2xl font-bold mb-4 text-white';
const p = 'text-gray-300 mb-4';
const ul = 'list-disc list-inside text-gray-300 space-y-2';

export default function SecurityPage() {
  return (
    <div className="container mx-auto px-4 py-16 max-w-4xl">
      <h1 className="text-4xl font-bold mb-8 text-white">Security</h1>
      <div className="prose max-w-none">
        <p className="text-gray-400 mb-6">Last updated: November 22, 2026</p>

        <section className="mb-8">
          <h2 className={h2}>Funds: non-custodial by design</h2>
          <ul className={ul}>
            <li>Payments settle to wallets the merchant controls. CoinPay does not hold a pooled customer balance.</li>
            <li>The web wallet generates and keeps private keys in the browser; they are never sent to our servers.</li>
            <li>Escrow uses 2-of-3 multisig. CoinPay holds one key of three, which is never enough to move funds alone.</li>
            <li>
              The server that handles payments is MIT-licensed and public, so anyone can audit it:{' '}
              <a className="text-purple-400 hover:underline" href="https://github.com/profullstack/coinpayportal">
                github.com/profullstack/coinpayportal
              </a>
              .
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className={h2}>Bank connections and financial data</h2>
          <ul className={ul}>
            <li>
              Bank-feed credentials are sealed to the merchant&apos;s own secrets vault. Opening them requires the
              merchant&apos;s unlock, and bank sync runs only while the merchant has unlocked it.
            </li>
            <li>Statements, reports and uploaded documents are encrypted at rest with AES-256-GCM.</li>
            <li>
              Finances are owner-only by default. Teammates see financial data only through a finance role the owner
              grants, and finance actions are audit-logged.
            </li>
            <li>
              <strong>Disconnect</strong> stops syncing and removes the stored credential while keeping your history.{' '}
              <strong>Delete</strong> removes the connection and its account data.
            </li>
            <li>We do not sell financial data or share it with third parties for their own use.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className={h2}>Accounts and access</h2>
          <ul className={ul}>
            <li>Sign in with a passkey, a passphrase, or a password. Passwords are stored only as bcrypt hashes.</li>
            <li>
              CoinPay is an OAuth 2.1 provider: PKCE, device flow, token revocation and RS256-signed tokens. Third-party
              apps receive only the scopes a user approves.{' '}
              <a className="text-purple-400 hover:underline" href="/docs/oauth">
                OAuth docs
              </a>
              .
            </li>
            <li>Scoped API keys are stored as SHA-256 hashes and can be revoked at any time. OAuth client secrets are bcrypt-hashed.</li>
            <li>Team members join only after the business owner approves the request.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className={h2}>Integrations and transport</h2>
          <ul className={ul}>
            <li>All traffic is served over HTTPS. Pages send a strict Content-Security-Policy and refuse to be framed.</li>
            <li>
              Webhooks are signed with HMAC-SHA256 over a timestamp and the body, so receivers can verify origin and
              reject replays.
            </li>
            <li>The domain publishes an MTA-STS policy so mail to CoinPay is delivered over TLS.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className={h2}>Reporting a vulnerability</h2>
          <p className={p}>
            Please report security issues to{' '}
            <a className="text-purple-400 hover:underline" href="mailto:security@coinpayportal.com">
              security@coinpayportal.com
            </a>
            . Include steps to reproduce and the affected URL or endpoint. Please do not access other users&apos; data,
            run denial-of-service tests, or disclose the issue publicly before we have had a chance to fix it. Our
            machine-readable contact is at{' '}
            <a className="text-purple-400 hover:underline" href="/.well-known/security.txt">
              /.well-known/security.txt
            </a>
            .
          </p>
        </section>

        <section className="mb-8">
          <h2 className={h2}>Questions</h2>
          <p className={p}>
            For anything else, contact{' '}
            <a className="text-purple-400 hover:underline" href="mailto:support@coinpayportal.com">
              support@coinpayportal.com
            </a>{' '}
            or see our <a className="text-purple-400 hover:underline" href="/privacy">Privacy Policy</a>.
          </p>
        </section>
      </div>
    </div>
  );
}
