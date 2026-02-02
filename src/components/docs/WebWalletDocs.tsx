import Link from 'next/link';
import { DocSection } from './DocSection';
import { ApiEndpoint } from './ApiEndpoint';
import { CodeBlock } from './CodeBlock';

export function WebWalletDocs() {
  return (
    <DocSection title="Web Wallet API">
      <p className="text-gray-300 mb-6">
        Non-custodial multi-chain wallet for humans and AI agents. Private keys <strong className="text-white">never leave the client</strong>. 
        The server stores only public keys and coordinates transactions. No email, no KYC — your seed phrase is your identity.
      </p>

      <div className="mb-8 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-emerald-400 font-semibold">🔐 Non-Custodial</span>
        </div>
        <p className="text-emerald-300 text-sm">
          Keys are generated and stored client-side only. The server never sees your seed phrase or private keys. 
          Authentication uses cryptographic signature challenges — prove you own the key without revealing it.
        </p>
      </div>

      {/* Supported Chains */}
      <h3 className="text-xl font-semibold text-white mb-4">Supported Chains</h3>
      <div className="grid md:grid-cols-4 gap-3 mb-8">
        {[
          { chain: 'BTC', name: 'Bitcoin' },
          { chain: 'BCH', name: 'Bitcoin Cash' },
          { chain: 'ETH', name: 'Ethereum' },
          { chain: 'POL', name: 'Polygon' },
          { chain: 'SOL', name: 'Solana' },
          { chain: 'USDC_ETH', name: 'USDC (Ethereum)' },
          { chain: 'USDC_POL', name: 'USDC (Polygon)' },
          { chain: 'USDC_SOL', name: 'USDC (Solana)' },
        ].map((c) => (
          <div key={c.chain} className="p-3 rounded-lg bg-slate-800/50 border border-white/10">
            <code className="text-purple-400 font-mono text-sm">{c.chain}</code>
            <p className="text-gray-400 text-xs mt-1">{c.name}</p>
          </div>
        ))}
      </div>

      {/* Auth Flow */}
      <h3 className="text-xl font-semibold text-white mb-4">Authentication Flow</h3>
      <div className="mb-8 p-4 rounded-lg bg-slate-800/50">
        <ol className="space-y-2 text-gray-300 text-sm list-decimal list-inside">
          <li>Client requests a challenge: <code className="text-purple-400">GET /api/web-wallet/auth/challenge?wallet_id=UUID</code></li>
          <li>Server returns a random challenge string with expiration</li>
          <li>Client signs the challenge with their private key</li>
          <li>Client submits signature: <code className="text-purple-400">POST /api/web-wallet/auth/verify</code></li>
          <li>Server verifies and returns a JWT (valid 24h)</li>
        </ol>
      </div>

      {/* Wallet Creation */}
      <ApiEndpoint method="POST" path="/api/web-wallet/create" description="Register a new wallet. Client generates seed phrase and HD keys locally, then sends only public keys.">
        <CodeBlock title="Request Body">
{`{
  "identity_public_key": "04a1b2c3d4...",
  "label": "My Wallet",
  "addresses": [
    {
      "chain": "BTC",
      "address": "bc1qxy2kgdygjrs...",
      "public_key": "02abc123...",
      "derivation_path": "m/84'/0'/0'/0/0"
    },
    {
      "chain": "ETH",
      "address": "0x1234567890abcdef...",
      "public_key": "04def456...",
      "derivation_path": "m/44'/60'/0'/0/0"
    }
  ]
}`}
        </CodeBlock>
        <CodeBlock title="Response (201)">
{`{
  "ok": true,
  "data": {
    "wallet_id": "550e8400-e29b-41d4-a716-446655440000",
    "label": "My Wallet",
    "status": "active",
    "created_at": "2025-01-15T10:30:00.000Z",
    "addresses": [
      { "id": "addr_123", "chain": "BTC", "address": "bc1q...", "is_active": true }
    ]
  }
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* Import */}
      <ApiEndpoint method="POST" path="/api/web-wallet/import" description="Import an existing wallet with proof of ownership (signature over a timestamped message).">
        <CodeBlock title="Request Body">
{`{
  "identity_public_key": "04a1b2c3d4...",
  "proof_signature": "3045022100...",
  "proof_message": "CoinPay wallet import: 2025-01-15T10:30:00Z",
  "label": "Imported Wallet",
  "addresses": [
    { "chain": "ETH", "address": "0x...", "public_key": "04...", "derivation_path": "m/44'/60'/0'/0/0" }
  ]
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* Auth Challenge */}
      <ApiEndpoint method="GET" path="/api/web-wallet/auth/challenge" description="Request an authentication challenge. Pass wallet_id as query parameter.">
        <CodeBlock title="Response">
{`{
  "ok": true,
  "data": {
    "challenge_id": "ch_123",
    "challenge": "coinpay:auth:550e8400...:1705312500:a1b2c3d4e5f6",
    "expires_at": "2025-01-15T10:35:00.000Z"
  }
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* Auth Verify */}
      <ApiEndpoint method="POST" path="/api/web-wallet/auth/verify" description="Verify a signed challenge and receive a JWT token (valid 24h).">
        <CodeBlock title="Request Body">
{`{
  "wallet_id": "550e8400-e29b-41d4-a716-446655440000",
  "challenge_id": "ch_123",
  "signature": "3045022100..."
}`}
        </CodeBlock>
        <CodeBlock title="Response">
{`{
  "ok": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_at": "2025-01-16T10:30:00.000Z",
    "wallet_id": "550e8400..."
  }
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* Get Wallet */}
      <ApiEndpoint method="GET" path="/api/web-wallet/:id" description="Get wallet info. Requires wallet JWT." />

      {/* Derive Address */}
      <ApiEndpoint method="POST" path="/api/web-wallet/:id/derive" description="Derive and register a new address for the wallet.">
        <CodeBlock title="Request Body">
{`{
  "chain": "ETH",
  "address": "0xnewaddress...",
  "public_key": "04...",
  "derivation_path": "m/44'/60'/0'/0/1"
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* List Addresses */}
      <ApiEndpoint method="GET" path="/api/web-wallet/:id/addresses" description="List all addresses. Optional filters: chain, active_only." />

      {/* Deactivate Address */}
      <ApiEndpoint method="DELETE" path="/api/web-wallet/:id/addresses/:address_id" description="Deactivate an address (soft delete)." />

      {/* Balances */}
      <ApiEndpoint method="GET" path="/api/web-wallet/:id/balances" description="Get balances for all active addresses. Optional: chain filter, refresh=true to force blockchain query.">
        <CodeBlock title="Response">
{`{
  "ok": true,
  "data": {
    "balances": [
      { "chain": "BTC", "address": "bc1q...", "balance": "0.05423", "last_updated": "2025-01-15T10:30:00Z" },
      { "chain": "ETH", "address": "0x...", "balance": "1.234", "last_updated": "2025-01-15T10:30:00Z" }
    ]
  }
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* Total USD */}
      <ApiEndpoint method="GET" path="/api/web-wallet/:id/balances/total-usd" description="Get total wallet balance converted to USD with per-chain breakdown." />

      {/* Prepare TX */}
      <ApiEndpoint method="POST" path="/api/web-wallet/:id/prepare-tx" description="Prepare an unsigned transaction for client-side signing. Expires in 5 minutes.">
        <CodeBlock title="Request Body">
{`{
  "from_address": "0xSenderAddress...",
  "to_address": "0xRecipientAddress...",
  "chain": "ETH",
  "amount": "0.5",
  "priority": "medium"
}`}
        </CodeBlock>
        <CodeBlock title="Response">
{`{
  "ok": true,
  "data": {
    "tx_id": "tx_789",
    "unsigned_tx": "0x02f8...",
    "chain": "ETH",
    "estimated_fee": "0.002",
    "expires_at": "2025-01-15T10:45:00.000Z"
  }
}`}
        </CodeBlock>
        <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <p className="text-yellow-300 text-sm">
            <strong>Security:</strong> If spend limits or address whitelists are enabled, the server enforces them at this step. 
            Errors: <code className="text-yellow-200">SPEND_LIMIT_EXCEEDED</code>, <code className="text-yellow-200">ADDRESS_NOT_WHITELISTED</code>, <code className="text-yellow-200">INSUFFICIENT_BALANCE</code>
          </p>
        </div>
      </ApiEndpoint>

      {/* Broadcast */}
      <ApiEndpoint method="POST" path="/api/web-wallet/:id/broadcast" description="Broadcast a signed transaction to the network.">
        <CodeBlock title="Request Body">
{`{
  "tx_id": "tx_789",
  "signed_tx": "0x02f8...",
  "chain": "ETH"
}`}
        </CodeBlock>
        <CodeBlock title="Response">
{`{
  "ok": true,
  "data": {
    "tx_hash": "0xabc123...",
    "chain": "ETH",
    "status": "pending",
    "explorer_url": "https://etherscan.io/tx/0xabc123..."
  }
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* Estimate Fee */}
      <ApiEndpoint method="POST" path="/api/web-wallet/:id/estimate-fee" description="Get fee estimates (low/medium/high) for a chain.">
        <CodeBlock title="Response">
{`{
  "ok": true,
  "data": {
    "chain": "ETH",
    "estimates": {
      "low":    { "fee": "0.0005", "time_minutes": 15 },
      "medium": { "fee": "0.001",  "time_minutes": 5 },
      "high":   { "fee": "0.003",  "time_minutes": 1 }
    }
  }
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* Transactions */}
      <ApiEndpoint method="GET" path="/api/web-wallet/:id/transactions" description="Get transaction history with filtering and pagination.">
        <h4 className="text-lg font-semibold text-white mb-2">Query Parameters</h4>
        <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto mb-4">
          <div className="space-y-2 text-sm text-gray-300">
            <p><code className="text-purple-400">chain</code> - Filter by chain</p>
            <p><code className="text-purple-400">direction</code> - <code>incoming</code> or <code>outgoing</code></p>
            <p><code className="text-purple-400">status</code> - <code>pending</code>, <code>confirming</code>, <code>confirmed</code>, <code>failed</code></p>
            <p><code className="text-purple-400">from_date</code> / <code className="text-purple-400">to_date</code> - ISO date range</p>
            <p><code className="text-purple-400">limit</code> - Default 50, max 100</p>
            <p><code className="text-purple-400">offset</code> - Pagination offset</p>
          </div>
        </div>
      </ApiEndpoint>

      {/* Transaction Detail */}
      <ApiEndpoint method="GET" path="/api/web-wallet/:id/transactions/:tx_id" description="Get details of a specific transaction." />

      {/* Settings */}
      <ApiEndpoint method="GET" path="/api/web-wallet/:id/settings" description="Get wallet security settings (spend limits, whitelist, confirmation delay)." />
      <ApiEndpoint method="PATCH" path="/api/web-wallet/:id/settings" description="Update wallet security settings.">
        <CodeBlock title="Request Body (all fields optional)">
{`{
  "daily_spend_limit": 500.00,
  "whitelist_enabled": true,
  "whitelist_addresses": ["0xTrustedAddr1...", "0xTrustedAddr2..."],
  "require_confirmation": true,
  "confirmation_delay_seconds": 60
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* Webhooks */}
      <ApiEndpoint method="POST" path="/api/web-wallet/:id/webhooks" description="Register a webhook for wallet events.">
        <CodeBlock title="Request Body">
{`{
  "url": "https://myapp.com/webhooks/wallet",
  "events": ["transaction.incoming", "transaction.confirmed"]
}`}
        </CodeBlock>
        <h4 className="text-lg font-semibold text-white mb-2 mt-4">Available Events</h4>
        <div className="grid md:grid-cols-2 gap-3 mb-4">
          {[
            { event: 'transaction.incoming', desc: 'New incoming transaction detected' },
            { event: 'transaction.confirmed', desc: 'Transaction reached confirmation threshold' },
            { event: 'transaction.outgoing', desc: 'Outgoing transaction broadcast' },
            { event: 'balance.changed', desc: 'Balance updated' },
          ].map((e) => (
            <div key={e.event} className="p-3 rounded-lg bg-slate-800/50">
              <code className="text-purple-400 font-mono text-sm">{e.event}</code>
              <p className="text-gray-400 text-xs mt-1">{e.desc}</p>
            </div>
          ))}
        </div>
      </ApiEndpoint>

      <ApiEndpoint method="GET" path="/api/web-wallet/:id/webhooks" description="List registered webhooks." />
      <ApiEndpoint method="DELETE" path="/api/web-wallet/:id/webhooks/:webhook_id" description="Remove a webhook registration." />

      {/* Rate Limits */}
      <h3 className="text-xl font-semibold text-white mb-4">Rate Limits</h3>
      <div className="grid md:grid-cols-2 gap-3 mb-8">
        {[
          { endpoint: 'Wallet creation', limit: '5/hour per IP' },
          { endpoint: 'Auth challenge/verify', limit: '10/min per IP' },
          { endpoint: 'Balance queries', limit: '60/min per IP' },
          { endpoint: 'Transaction prep', limit: '20/min per IP' },
          { endpoint: 'Broadcast', limit: '10/min per IP' },
          { endpoint: 'Fee estimation', limit: '60/min per IP' },
        ].map((r) => (
          <div key={r.endpoint} className="flex justify-between items-center p-3 rounded-lg bg-slate-800/50">
            <span className="text-gray-300 text-sm">{r.endpoint}</span>
            <code className="text-purple-400 text-sm">{r.limit}</code>
          </div>
        ))}
      </div>

      {/* Try It */}
      <div className="p-6 bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border border-emerald-500/20 rounded-xl">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">Try the Web Wallet</h3>
            <p className="text-gray-300 text-sm">Create a wallet in seconds — no signup required.</p>
          </div>
          <Link
            href="/web-wallet"
            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            Open Wallet
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </DocSection>
  );
}
