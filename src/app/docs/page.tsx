import Link from 'next/link';
import { AuthenticationDocs } from '@/components/docs/AuthenticationDocs';
import { SubscriptionsDocs } from '@/components/docs/SubscriptionsDocs';
import { DocSection } from '@/components/docs/DocSection';
import { ApiEndpoint } from '@/components/docs/ApiEndpoint';
import { CodeBlock } from '@/components/docs/CodeBlock';

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="mb-12">
          <Link href="/" className="inline-flex items-center text-purple-400 hover:text-purple-300 mb-6">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Home
          </Link>
          <h1 className="text-5xl font-bold text-white mb-4">
            API Documentation
          </h1>
          <p className="text-xl text-gray-300">
            Complete reference for the CoinPay REST API
          </p>
        </div>

        {/* SDK Documentation Link */}
        <div className="mb-8 p-6 rounded-2xl bg-gradient-to-r from-purple-500/20 to-blue-500/20 border border-purple-500/30">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white mb-2">📦 Node.js SDK &amp; CLI</h2>
              <p className="text-gray-300 text-sm">
                Use our official SDK for seamless integration with your Node.js applications
              </p>
            </div>
            <Link
              href="/docs/sdk"
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              View SDK Docs
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Table of Contents */}
        <nav className="mb-12 p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-xl font-bold text-white mb-4">Quick Navigation</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { name: 'SDK Documentation', href: '/docs/sdk', external: true },
              { name: 'Authentication', href: '#authentication' },
              { name: 'Subscriptions & Entitlements', href: '#subscriptions' },
              { name: 'Businesses', href: '#businesses' },
              { name: 'Supported Coins', href: '#supported-coins' },
              { name: 'Payments', href: '#payments' },
              { name: 'Business Collection', href: '#business-collection' },
              { name: 'Dashboard', href: '#dashboard' },
              { name: 'Settings', href: '#settings' },
              { name: 'Webhooks', href: '#webhooks' },
              { name: 'Error Codes', href: '#errors' },
            ].map((item) => (
              item.external ? (
                <Link
                  key={item.name}
                  href={item.href}
                  className="text-purple-400 hover:text-purple-300 text-sm font-semibold"
                >
                  → {item.name} ↗
                </Link>
              ) : (
                <a
                  key={item.name}
                  href={item.href}
                  className="text-purple-400 hover:text-purple-300 text-sm"
                >
                  → {item.name}
                </a>
              )
            ))}
          </div>
        </nav>

        {/* Authentication */}
        <div id="authentication">
          <AuthenticationDocs />
        </div>

        {/* Subscriptions & Entitlements */}
        <div id="subscriptions">
          <SubscriptionsDocs />
        </div>

        {/* Businesses */}
        <div id="businesses">
          <DocSection title="Businesses">
            <ApiEndpoint method="GET" path="/api/businesses" description="List all businesses for the authenticated merchant.">
              <CodeBlock title="cURL Example" language="curl">
{`curl https://coinpayportal.com/api/businesses \\
  -H "Authorization: Bearer YOUR_TOKEN"`}
              </CodeBlock>
            </ApiEndpoint>

            <ApiEndpoint method="POST" path="/api/businesses" description="Create a new business.">
              <CodeBlock title="Request Body">
{`{
  "name": "My Store",
  "description": "Online retail store",  // optional
  "wallet_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "webhook_url": "https://mystore.com/webhook"  // optional
}`}
              </CodeBlock>

              <CodeBlock title="Node.js Example" language="javascript">
{`const response = await fetch('https://coinpayportal.com/api/businesses', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'My Store',
    wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'
  })
});
const data = await response.json();`}
              </CodeBlock>
            </ApiEndpoint>

            <ApiEndpoint method="PATCH" path="/api/businesses/:id" description="Update an existing business." />
            <ApiEndpoint method="DELETE" path="/api/businesses/:id" description="Delete a business." />
          </DocSection>
        </div>

        {/* Supported Coins */}
        <div id="supported-coins">
          <DocSection title="Supported Coins">
            <p className="text-gray-300 mb-6">
              Get the list of supported cryptocurrencies (wallets) configured for a business. This endpoint is useful for displaying available payment options to customers.
            </p>

            <ApiEndpoint method="GET" path="/api/supported-coins" description="Get supported cryptocurrencies for a business.">
              <h4 className="text-lg font-semibold text-white mb-2">Query Parameters</h4>
              <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto mb-4">
                <div className="space-y-2 text-sm text-gray-300">
                  <p><code className="text-purple-400">business_id</code> - Business UUID (required for JWT auth, not needed with API key)</p>
                  <p><code className="text-purple-400">active_only</code> - If &quot;true&quot;, only return active wallets (optional)</p>
                </div>
              </div>

              <CodeBlock title="cURL Example (API Key)" language="curl">
{`curl https://coinpayportal.com/api/supported-coins \\
  -H "Authorization: Bearer cp_live_your_api_key"`}
              </CodeBlock>

              <CodeBlock title="cURL Example (JWT with business_id)" language="curl">
{`curl "https://coinpayportal.com/api/supported-coins?business_id=your-business-uuid" \\
  -H "Authorization: Bearer YOUR_JWT_TOKEN"`}
              </CodeBlock>

              <CodeBlock title="Response">
{`{
  "success": true,
  "coins": [
    {
      "symbol": "BTC",
      "name": "Bitcoin",
      "is_active": true,
      "has_wallet": true
    },
    {
      "symbol": "ETH",
      "name": "Ethereum",
      "is_active": true,
      "has_wallet": true
    },
    {
      "symbol": "SOL",
      "name": "Solana",
      "is_active": false,
      "has_wallet": true
    }
  ],
  "business_id": "your-business-uuid",
  "total": 3
}`}
              </CodeBlock>

              <CodeBlock title="Node.js Example" language="javascript">
{`const response = await fetch('https://coinpayportal.com/api/supported-coins', {
  headers: {
    'Authorization': 'Bearer cp_live_your_api_key'
  }
});
const data = await response.json();

// Display available payment options to customers
data.coins.filter(c => c.is_active).forEach(coin => {
  console.log(\`Accept \${coin.name} (\${coin.symbol})\`);
});`}
              </CodeBlock>
            </ApiEndpoint>

            <h3 className="text-xl font-semibold text-white mb-4">Available Cryptocurrency Symbols</h3>
            <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
              {[
                { symbol: 'BTC', name: 'Bitcoin' },
                { symbol: 'BCH', name: 'Bitcoin Cash' },
                { symbol: 'ETH', name: 'Ethereum' },
                { symbol: 'POL', name: 'Polygon' },
                { symbol: 'SOL', name: 'Solana' },
                { symbol: 'USDT', name: 'Tether' },
                { symbol: 'USDC', name: 'USD Coin' },
                { symbol: 'BNB', name: 'BNB' },
                { symbol: 'XRP', name: 'XRP' },
                { symbol: 'ADA', name: 'Cardano' },
                { symbol: 'DOGE', name: 'Dogecoin' },
              ].map((crypto) => (
                <div key={crypto.symbol} className="p-3 rounded-lg bg-slate-800/50 border border-white/10">
                  <code className="text-purple-400 font-mono">{crypto.symbol}</code>
                  <p className="text-gray-300 text-sm mt-1">{crypto.name}</p>
                </div>
              ))}
            </div>

            <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-blue-300 text-sm">
                <strong>Tip:</strong> Use this endpoint to dynamically show customers which cryptocurrencies your business accepts. Only coins with <code className="text-blue-200">is_active: true</code> should be offered as payment options.
              </p>
            </div>
          </DocSection>
        </div>

        {/* Payments */}
        <div id="payments">
          <DocSection title="Payments">
            <ApiEndpoint method="POST" path="/api/payments/create" description="Create a new payment request.">
              <CodeBlock title="Request Body">
{`{
  "business_id": "business-123",
  "amount_usd": 100.00,
  "currency": "btc",  // btc, eth, pol, sol
  "description": "Order #12345"  // optional
}`}
              </CodeBlock>

              <CodeBlock title="cURL Example" language="curl">
{`curl -X POST https://coinpayportal.com/api/payments/create \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "business_id": "business-123",
    "amount_usd": 100.00,
    "currency": "btc"
  }'`}
              </CodeBlock>

              <CodeBlock title="Response">
{`{
  "success": true,
  "payment": {
    "id": "payment-456",
    "business_id": "business-123",
    "amount_usd": "100.00",
    "amount_crypto": "0.00234567",
    "currency": "btc",
    "payment_address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    "status": "pending",
    "created_at": "2024-01-01T12:00:00Z",
    "expires_at": "2024-01-01T13:00:00Z"
  }
}`}
              </CodeBlock>
            </ApiEndpoint>

            <ApiEndpoint method="GET" path="/api/payments/:id" description="Retrieve payment details by ID.">
              <CodeBlock title="Node.js Example" language="javascript">
{`const response = await fetch('https://coinpayportal.com/api/payments/payment-456', {
  headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
});
const data = await response.json();
console.log(data.payment.status);`}
              </CodeBlock>
            </ApiEndpoint>

            <ApiEndpoint method="GET" path="/api/payments/:id/qr" description="Get QR code image for payment address.">
              <CodeBlock title="Usage" language="html">
{`<img src="https://coinpayportal.com/api/payments/payment-456/qr" 
     alt="Payment QR Code" />`}
              </CodeBlock>
            </ApiEndpoint>
          </DocSection>
        </div>

        {/* Business Collection */}
        <div id="business-collection">
          <DocSection title="Business Collection">
            <p className="text-gray-300 mb-6">
              Business Collection payments allow the platform to collect payments from business users (subscription fees, service charges, etc.) with <strong className="text-purple-400">100% forwarding</strong> to platform wallets.
            </p>

            <div className="mb-6 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
              <p className="text-purple-300 text-sm">
                <strong>Key Difference:</strong> Unlike regular payments (99.5% merchant / 0.5% platform), Business Collection forwards 100% of funds to the platform&apos;s collection wallet.
              </p>
            </div>

            <ApiEndpoint method="POST" path="/api/business-collection" description="Create a new business collection payment.">
              <CodeBlock title="Request Body">
{`{
  "business_id": "business-123",
  "amount": 99.99,
  "currency": "USD",
  "blockchain": "ETH",  // BTC, BCH, ETH, POL, SOL
  "description": "Monthly subscription fee",
  "metadata": {
    "plan": "premium",
    "billing_period": "2024-01"
  }
}`}
              </CodeBlock>

              <CodeBlock title="Response">
{`{
  "success": true,
  "payment": {
    "id": "collection-456",
    "payment_address": "0x1234...5678",
    "amount": 99.99,
    "currency": "USD",
    "blockchain": "ETH",
    "destination_wallet": "0xplatform...wallet",
    "status": "pending",
    "description": "Monthly subscription fee",
    "expires_at": "2024-01-02T12:00:00Z",
    "created_at": "2024-01-01T12:00:00Z"
  }
}`}
              </CodeBlock>
            </ApiEndpoint>

            <ApiEndpoint method="GET" path="/api/business-collection" description="List business collection payments with optional filters.">
              <h4 className="text-lg font-semibold text-white mb-2">Query Parameters</h4>
              <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto mb-4">
                <div className="space-y-2 text-sm text-gray-300">
                  <p><code className="text-purple-400">business_id</code> - Filter by business (optional)</p>
                  <p><code className="text-purple-400">status</code> - Filter by status: pending, confirmed, forwarded (optional)</p>
                  <p><code className="text-purple-400">limit</code> - Results per page, default 50 (optional)</p>
                  <p><code className="text-purple-400">offset</code> - Pagination offset (optional)</p>
                </div>
              </div>
            </ApiEndpoint>

            <ApiEndpoint method="GET" path="/api/business-collection/:id" description="Get details of a specific business collection payment." />

            <h3 className="text-xl font-semibold text-white mb-4">Collection Payment Statuses</h3>
            <div className="grid md:grid-cols-2 gap-4">
              {[
                { status: 'pending', description: 'Waiting for payment', color: 'yellow' },
                { status: 'detected', description: 'Payment detected on blockchain', color: 'blue' },
                { status: 'confirmed', description: 'Payment confirmed', color: 'green' },
                { status: 'forwarding', description: 'Forwarding to platform wallet', color: 'purple' },
                { status: 'forwarded', description: '100% forwarded to platform', color: 'green' },
                { status: 'expired', description: 'Payment request expired', color: 'red' },
              ].map((item) => (
                <div key={item.status} className="p-3 rounded-lg bg-slate-800/50">
                  <code className={`text-${item.color}-400 font-mono`}>{item.status}</code>
                  <p className="text-gray-300 text-sm mt-1">{item.description}</p>
                </div>
              ))}
            </div>
          </DocSection>
        </div>

        {/* Dashboard */}
        <div id="dashboard">
          <DocSection title="Dashboard">
            <ApiEndpoint method="GET" path="/api/dashboard/stats" description="Get payment statistics and recent activity.">
              <CodeBlock title="Response">
{`{
  "success": true,
  "stats": {
    "total_payments": 150,
    "successful_payments": 142,
    "pending_payments": 5,
    "failed_payments": 3,
    "total_volume": "0.12345678",
    "total_volume_usd": 5234.56
  },
  "recent_payments": [...]
}`}
              </CodeBlock>
            </ApiEndpoint>
          </DocSection>
        </div>

        {/* Settings */}
        <div id="settings">
          <DocSection title="Settings">
            <ApiEndpoint method="GET" path="/api/settings" description="Get merchant notification settings." />

            <ApiEndpoint method="PUT" path="/api/settings" description="Update notification preferences.">
              <CodeBlock title="Request Body">
{`{
  "notifications_enabled": true,
  "email_notifications": true,
  "web_notifications": false
}`}
              </CodeBlock>
            </ApiEndpoint>
          </DocSection>
        </div>

        {/* Supported Cryptocurrencies */}
        <DocSection title="Supported Cryptocurrencies">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { name: 'Bitcoin', symbol: 'BTC', code: 'btc', confirmations: 3 },
              { name: 'Ethereum', symbol: 'ETH', code: 'eth', confirmations: 12 },
              { name: 'Polygon', symbol: 'POL', code: 'pol', confirmations: 128 },
              { name: 'Solana', symbol: 'SOL', code: 'sol', confirmations: 32 },
            ].map((crypto) => (
              <div key={crypto.symbol} className="p-4 rounded-lg bg-slate-800/50 border border-white/10">
                <div className="font-semibold text-white mb-1">{crypto.name}</div>
                <div className="text-purple-400 font-mono text-sm mb-2">{crypto.symbol}</div>
                <div className="text-gray-400 text-xs">Code: <code className="text-purple-300">{crypto.code}</code></div>
                <div className="text-gray-400 text-xs">Confirmations: {crypto.confirmations}</div>
              </div>
            ))}
          </div>
        </DocSection>

        {/* Webhooks */}
        <div id="webhooks">
          <DocSection title="Webhooks">
            <p className="text-gray-300 mb-6">
              Configure webhook URLs in your business settings to receive real-time payment notifications.
            </p>

            <h3 className="text-xl font-semibold text-white mb-4">Webhook Events</h3>
            <div className="space-y-4 mb-8">
              {[
                { event: 'payment.detected', description: 'Payment detected on blockchain (0 confirmations)' },
                { event: 'payment.confirmed', description: 'Payment confirmed (sufficient confirmations)' },
                { event: 'payment.forwarded', description: 'Payment forwarded to merchant wallet' },
                { event: 'payment.failed', description: 'Payment failed' },
                { event: 'payment.expired', description: 'Payment request expired' },
                { event: 'test.webhook', description: 'Test webhook (sent from dashboard)' },
              ].map((webhook) => (
                <div key={webhook.event} className="p-4 rounded-lg bg-slate-800/50">
                  <code className="text-purple-400 font-mono">{webhook.event}</code>
                  <p className="text-gray-300 mt-2">{webhook.description}</p>
                </div>
              ))}
            </div>

            <h3 className="text-xl font-semibold text-white mb-4">Webhook Headers</h3>
            <CodeBlock>
{`Content-Type: application/json
X-CoinPay-Signature: t=1702234567,v1=5d41402abc4b2a76b9719d911017c592
User-Agent: CoinPay-Webhook/1.0`}
            </CodeBlock>
            <p className="text-gray-400 text-sm mt-2 mb-6">
              The <code className="text-purple-400">X-CoinPay-Signature</code> header contains: <code className="text-purple-400">t</code> (Unix timestamp) and <code className="text-purple-400">v1</code> (HMAC-SHA256 signature)
            </p>

            <h3 className="text-xl font-semibold text-white mb-4">Webhook Payload Example</h3>
            <CodeBlock>
{`{
  "id": "evt_abc123def456",
  "type": "payment.confirmed",
  "data": {
    "payment_id": "pay_xyz789",
    "amount_crypto": "0.00234567",
    "amount_usd": "100.00",
    "currency": "BTC",
    "status": "confirmed",
    "confirmations": 3,
    "tx_hash": "abc123...",
    "metadata": {
      "order_id": "ORDER-123"
    }
  },
  "created_at": "2024-01-01T12:05:00Z",
  "business_id": "business-123"
}`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mt-8 mb-4">Verifying Webhook Signatures</h3>
            <p className="text-gray-300 mb-4">
              The signature is computed as <code className="text-purple-400">HMAC-SHA256(timestamp.payload, secret)</code>
            </p>
            <CodeBlock title="JavaScript Example" language="javascript">
{`import crypto from 'crypto';

function verifyWebhookSignature(payload, signatureHeader, secret) {
  // Parse signature header (format: t=timestamp,v1=signature)
  const parts = signatureHeader.split(',');
  const signatureParts = {};
  for (const part of parts) {
    const [key, value] = part.split('=');
    signatureParts[key] = value;
  }

  const timestamp = signatureParts.t;
  const expectedSignature = signatureParts.v1;

  // Check timestamp tolerance (300 seconds)
  const timestampAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (Math.abs(timestampAge) > 300) {
    return false; // Reject old webhooks
  }

  // Compute expected signature
  const signedPayload = \`\${timestamp}.\${payload}\`;
  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  // Timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(computedSignature, 'hex')
  );
}`}
            </CodeBlock>

            <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <p className="text-yellow-300 text-sm">
                <strong>Important:</strong> Always verify webhook signatures before processing. Use <code className="text-yellow-200">express.raw()</code> or equivalent to get the raw body for signature verification.
              </p>
            </div>

            <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-blue-300 text-sm">
                <strong>SDK Support:</strong> Use <code className="text-blue-200">verifyWebhookSignature()</code> and <code className="text-blue-200">parseWebhookPayload()</code> from the <a href="/docs/sdk" className="underline">CoinPay SDK</a> for easier integration.
              </p>
            </div>
          </DocSection>
        </div>

        {/* Rate Limits & Fees */}
        <DocSection title="Rate Limits & Fees">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-xl font-semibold text-white mb-4">Rate Limits</h3>
              <div className="space-y-2 text-gray-300">
                <p>• <strong>API Requests:</strong> 100 requests/minute</p>
                <p>• <strong>Payment Creation:</strong> 10 payments/minute</p>
                <p>• <strong>Webhook Retries:</strong> 3 attempts with exponential backoff</p>
              </div>
            </div>
            <div>
              <h3 className="text-xl font-semibold text-white mb-4">Platform Fees</h3>
              <div className="space-y-2 text-gray-300">
                <p>• <strong>Platform Fee:</strong> 0.5% per transaction</p>
                <p>• <strong>Network Fees:</strong> Paid by customer</p>
                <p>• <strong>Minimum Payment:</strong> $1.00 USD</p>
              </div>
            </div>
          </div>
        </DocSection>

        {/* Error Codes */}
        <div id="errors">
          <DocSection title="Error Codes">
            <div className="space-y-4">
              {[
                { code: '400', name: 'Bad Request', description: 'Invalid request parameters or missing required fields' },
                { code: '401', name: 'Unauthorized', description: 'Invalid or missing authentication token' },
                { code: '402', name: 'Payment Required', description: 'Subscription inactive or payment needed' },
                { code: '403', name: 'Forbidden', description: 'Feature not available on current plan' },
                { code: '404', name: 'Not Found', description: 'Resource not found' },
                { code: '429', name: 'Too Many Requests', description: 'Rate limit or transaction limit exceeded' },
                { code: '500', name: 'Server Error', description: 'Internal server error - please try again' },
              ].map((error) => (
                <div key={error.code} className="p-4 rounded-lg bg-slate-800/50 flex items-start gap-4">
                  <span className="px-3 py-1 bg-red-500/20 text-red-400 rounded-lg font-mono text-sm font-semibold">
                    {error.code}
                  </span>
                  <div>
                    <div className="font-semibold text-white mb-1">{error.name}</div>
                    <div className="text-gray-300 text-sm">{error.description}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <h4 className="text-lg font-semibold text-white mb-2">Error Response Format</h4>
              <CodeBlock>
{`{
  "success": false,
  "error": "Detailed error message here"
}`}
              </CodeBlock>
            </div>
          </DocSection>
        </div>
      </div>
    </div>
  );
}