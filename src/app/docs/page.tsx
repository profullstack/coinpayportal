import Link from 'next/link';

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

        {/* Authentication */}
        <section className="mb-12 p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-3xl font-bold text-white mb-6">Authentication</h2>
          
          <p className="text-gray-300 mb-6">
            All API requests require authentication using a JWT token in the Authorization header.
          </p>

          {/* Register */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-lg font-mono text-sm">POST</span>
              <code className="text-purple-400 font-mono">/api/auth/register</code>
            </div>
            <p className="text-gray-300 mb-4">Create a new merchant account.</p>
            
            <h4 className="text-lg font-semibold text-white mb-2">Request Body</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto mb-4">
              <pre className="text-sm text-gray-300">
{`{
  "email": "merchant@example.com",
  "password": "SecurePassword123!",
  "name": "My Business"  // optional
}`}
              </pre>
            </div>

            <h4 className="text-lg font-semibold text-white mb-2">cURL Example</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto mb-4">
              <pre className="text-sm text-green-400">
{`curl -X POST https://coinpayportal.com/api/auth/register \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "merchant@example.com",
    "password": "SecurePassword123!",
    "name": "My Business"
  }'`}
              </pre>
            </div>

            <h4 className="text-lg font-semibold text-white mb-2">Node.js Example</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
              <pre className="text-sm text-blue-400">
{`const response = await fetch('https://coinpayportal.com/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'merchant@example.com',
    password: 'SecurePassword123!',
    name: 'My Business'
  })
});
const data = await response.json();
console.log(data.token); // Save this token`}
              </pre>
            </div>
          </div>

          {/* Login */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-lg font-mono text-sm">POST</span>
              <code className="text-purple-400 font-mono">/api/auth/login</code>
            </div>
            <p className="text-gray-300 mb-4">Login to get an authentication token.</p>
            
            <h4 className="text-lg font-semibold text-white mb-2">Request Body</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto mb-4">
              <pre className="text-sm text-gray-300">
{`{
  "email": "merchant@example.com",
  "password": "SecurePassword123!"
}`}
              </pre>
            </div>

            <h4 className="text-lg font-semibold text-white mb-2">Response</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
              <pre className="text-sm text-gray-300">
{`{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "merchant": {
    "id": "merchant-123",
    "email": "merchant@example.com",
    "name": "My Business"
  }
}`}
              </pre>
            </div>
          </div>

          {/* Get Current User */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-lg font-mono text-sm">GET</span>
              <code className="text-purple-400 font-mono">/api/auth/me</code>
            </div>
            <p className="text-gray-300 mb-4">Get current authenticated merchant information.</p>
            
            <h4 className="text-lg font-semibold text-white mb-2">cURL Example</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto mb-4">
              <pre className="text-sm text-green-400">
{`curl https://coinpayportal.com/api/auth/me \\
  -H "Authorization: Bearer YOUR_TOKEN"`}
              </pre>
            </div>

            <h4 className="text-lg font-semibold text-white mb-2">Response</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
              <pre className="text-sm text-gray-300">
{`{
  "success": true,
  "merchant": {
    "id": "merchant-123",
    "email": "merchant@example.com",
    "name": "My Business",
    "created_at": "2024-01-01T12:00:00Z"
  }
}`}
              </pre>
            </div>
          </div>
        </section>

        {/* Businesses */}
        <section className="mb-12 p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-3xl font-bold text-white mb-6">Businesses</h2>

          {/* List Businesses */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-lg font-mono text-sm">GET</span>
              <code className="text-purple-400 font-mono">/api/businesses</code>
            </div>
            <p className="text-gray-300 mb-4">List all businesses for the authenticated merchant.</p>
            
            <h4 className="text-lg font-semibold text-white mb-2">cURL Example</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
              <pre className="text-sm text-green-400">
{`curl https://coinpayportal.com/api/businesses \\
  -H "Authorization: Bearer YOUR_TOKEN"`}
              </pre>
            </div>
          </div>

          {/* Create Business */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-lg font-mono text-sm">POST</span>
              <code className="text-purple-400 font-mono">/api/businesses</code>
            </div>
            <p className="text-gray-300 mb-4">Create a new business.</p>
            
            <h4 className="text-lg font-semibold text-white mb-2">Request Body</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto mb-4">
              <pre className="text-sm text-gray-300">
{`{
  "name": "My Store",
  "description": "Online retail store",  // optional
  "wallet_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "webhook_url": "https://mystore.com/webhook"  // optional
}`}
              </pre>
            </div>

            <h4 className="text-lg font-semibold text-white mb-2">Node.js Example</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
              <pre className="text-sm text-blue-400">
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
              </pre>
            </div>
          </div>

          {/* Update Business */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 bg-yellow-500/20 text-yellow-400 rounded-lg font-mono text-sm">PATCH</span>
              <code className="text-purple-400 font-mono">/api/businesses/:id</code>
            </div>
            <p className="text-gray-300 mb-4">Update an existing business.</p>
          </div>

          {/* Delete Business */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 bg-red-500/20 text-red-400 rounded-lg font-mono text-sm">DELETE</span>
              <code className="text-purple-400 font-mono">/api/businesses/:id</code>
            </div>
            <p className="text-gray-300 mb-4">Delete a business.</p>
          </div>
        </section>

        {/* Payments */}
        <section className="mb-12 p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-3xl font-bold text-white mb-6">Payments</h2>

          {/* Create Payment */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-lg font-mono text-sm">POST</span>
              <code className="text-purple-400 font-mono">/api/payments/create</code>
            </div>
            <p className="text-gray-300 mb-4">Create a new payment request.</p>
            
            <h4 className="text-lg font-semibold text-white mb-2">Request Body</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto mb-4">
              <pre className="text-sm text-gray-300">
{`{
  "business_id": "business-123",
  "amount_usd": 100.00,
  "currency": "btc",  // btc, eth, matic, sol
  "description": "Order #12345"  // optional
}`}
              </pre>
            </div>

            <h4 className="text-lg font-semibold text-white mb-2">cURL Example</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto mb-4">
              <pre className="text-sm text-green-400">
{`curl -X POST https://coinpayportal.com/api/payments/create \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "business_id": "business-123",
    "amount_usd": 100.00,
    "currency": "btc"
  }'`}
              </pre>
            </div>

            <h4 className="text-lg font-semibold text-white mb-2">Response</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
              <pre className="text-sm text-gray-300">
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
              </pre>
            </div>
          </div>

          {/* Get Payment */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-lg font-mono text-sm">GET</span>
              <code className="text-purple-400 font-mono">/api/payments/:id</code>
            </div>
            <p className="text-gray-300 mb-4">Retrieve payment details by ID.</p>
            
            <h4 className="text-lg font-semibold text-white mb-2">Node.js Example</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
              <pre className="text-sm text-blue-400">
{`const response = await fetch('https://coinpayportal.com/api/payments/payment-456', {
  headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
});
const data = await response.json();
console.log(data.payment.status);`}
              </pre>
            </div>
          </div>

          {/* Get QR Code */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-lg font-mono text-sm">GET</span>
              <code className="text-purple-400 font-mono">/api/payments/:id/qr</code>
            </div>
            <p className="text-gray-300 mb-4">Get QR code image for payment address.</p>
            
            <h4 className="text-lg font-semibold text-white mb-2">Usage</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
              <pre className="text-sm text-gray-300">
{`<img src="https://coinpayportal.com/api/payments/payment-456/qr" 
     alt="Payment QR Code" />`}
              </pre>
            </div>
          </div>
        </section>

        {/* Business Collection */}
        <section className="mb-12 p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-3xl font-bold text-white mb-6">Business Collection</h2>
          
          <p className="text-gray-300 mb-6">
            Business Collection payments allow the platform to collect payments from business users (subscription fees, service charges, etc.) with <strong className="text-purple-400">100% forwarding</strong> to platform wallets.
          </p>

          <div className="mb-6 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
            <p className="text-purple-300 text-sm">
              <strong>Key Difference:</strong> Unlike regular payments (99.5% merchant / 0.5% platform), Business Collection forwards 100% of funds to the platform&apos;s collection wallet.
            </p>
          </div>

          {/* Create Business Collection Payment */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-lg font-mono text-sm">POST</span>
              <code className="text-purple-400 font-mono">/api/business-collection</code>
            </div>
            <p className="text-gray-300 mb-4">Create a new business collection payment.</p>
            
            <h4 className="text-lg font-semibold text-white mb-2">Request Body</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto mb-4">
              <pre className="text-sm text-gray-300">
{`{
  "business_id": "business-123",
  "amount": 99.99,
  "currency": "USD",
  "blockchain": "ETH",  // BTC, BCH, ETH, MATIC, SOL
  "description": "Monthly subscription fee",
  "metadata": {
    "plan": "premium",
    "billing_period": "2024-01"
  }
}`}
              </pre>
            </div>

            <h4 className="text-lg font-semibold text-white mb-2">cURL Example</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto mb-4">
              <pre className="text-sm text-green-400">
{`curl -X POST https://coinpayportal.com/api/business-collection \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "business_id": "business-123",
    "amount": 99.99,
    "currency": "USD",
    "blockchain": "ETH",
    "description": "Monthly subscription fee"
  }'`}
              </pre>
            </div>

            <h4 className="text-lg font-semibold text-white mb-2">Response</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
              <pre className="text-sm text-gray-300">
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
              </pre>
            </div>
          </div>

          {/* List Business Collection Payments */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-lg font-mono text-sm">GET</span>
              <code className="text-purple-400 font-mono">/api/business-collection</code>
            </div>
            <p className="text-gray-300 mb-4">List business collection payments with optional filters.</p>
            
            <h4 className="text-lg font-semibold text-white mb-2">Query Parameters</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto mb-4">
              <div className="space-y-2 text-sm text-gray-300">
                <p><code className="text-purple-400">business_id</code> - Filter by business (optional)</p>
                <p><code className="text-purple-400">status</code> - Filter by status: pending, confirmed, forwarded (optional)</p>
                <p><code className="text-purple-400">limit</code> - Results per page, default 50 (optional)</p>
                <p><code className="text-purple-400">offset</code> - Pagination offset (optional)</p>
              </div>
            </div>

            <h4 className="text-lg font-semibold text-white mb-2">Node.js Example</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
              <pre className="text-sm text-blue-400">
{`const response = await fetch(
  'https://coinpayportal.com/api/business-collection?status=pending&limit=10',
  { headers: { 'Authorization': 'Bearer YOUR_TOKEN' } }
);
const data = await response.json();
console.log(data.payments);`}
              </pre>
            </div>
          </div>

          {/* Get Business Collection Payment */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-lg font-mono text-sm">GET</span>
              <code className="text-purple-400 font-mono">/api/business-collection/:id</code>
            </div>
            <p className="text-gray-300 mb-4">Get details of a specific business collection payment.</p>
          </div>

          {/* Payment Statuses */}
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
        </section>

        {/* Dashboard */}
        <section className="mb-12 p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-3xl font-bold text-white mb-6">Dashboard</h2>

          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-lg font-mono text-sm">GET</span>
              <code className="text-purple-400 font-mono">/api/dashboard/stats</code>
            </div>
            <p className="text-gray-300 mb-4">Get payment statistics and recent activity.</p>
            
            <h4 className="text-lg font-semibold text-white mb-2">Response</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
              <pre className="text-sm text-gray-300">
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
              </pre>
            </div>
          </div>
        </section>

        {/* Settings */}
        <section className="mb-12 p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-3xl font-bold text-white mb-6">Settings</h2>

          {/* Get Settings */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-lg font-mono text-sm">GET</span>
              <code className="text-purple-400 font-mono">/api/settings</code>
            </div>
            <p className="text-gray-300 mb-4">Get merchant notification settings.</p>
          </div>

          {/* Update Settings */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 bg-yellow-500/20 text-yellow-400 rounded-lg font-mono text-sm">PUT</span>
              <code className="text-purple-400 font-mono">/api/settings</code>
            </div>
            <p className="text-gray-300 mb-4">Update notification preferences.</p>
            
            <h4 className="text-lg font-semibold text-white mb-2">Request Body</h4>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
              <pre className="text-sm text-gray-300">
{`{
  "notifications_enabled": true,
  "email_notifications": true,
  "web_notifications": false
}`}
              </pre>
            </div>
          </div>
        </section>

        {/* Supported Cryptocurrencies */}
        <section className="mb-12 p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-3xl font-bold text-white mb-6">Supported Cryptocurrencies</h2>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { name: 'Bitcoin', symbol: 'BTC', code: 'btc', confirmations: 3 },
              { name: 'Ethereum', symbol: 'ETH', code: 'eth', confirmations: 12 },
              { name: 'Polygon', symbol: 'MATIC', code: 'matic', confirmations: 128 },
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
        </section>

        {/* Webhooks */}
        <section className="mb-12 p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-3xl font-bold text-white mb-6">Webhooks</h2>
          
          <p className="text-gray-300 mb-6">
            Configure webhook URLs in your business settings to receive real-time payment notifications.
          </p>

          <h3 className="text-xl font-semibold text-white mb-4">Webhook Events</h3>
          <div className="space-y-4 mb-8">
            {[
              { event: 'payment.detected', description: 'Payment detected on blockchain (0 confirmations)' },
              { event: 'payment.confirmed', description: 'Payment confirmed (sufficient confirmations)' },
              { event: 'payment.forwarded', description: 'Payment forwarded to merchant wallet' },
              { event: 'payment.failed', description: 'Payment failed or expired' },
            ].map((webhook) => (
              <div key={webhook.event} className="p-4 rounded-lg bg-slate-800/50">
                <code className="text-purple-400 font-mono">{webhook.event}</code>
                <p className="text-gray-300 mt-2">{webhook.description}</p>
              </div>
            ))}
          </div>

          <h3 className="text-xl font-semibold text-white mb-4">Webhook Payload Example</h3>
          <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
            <pre className="text-sm text-gray-300">
{`{
  "event": "payment.confirmed",
  "payment_id": "payment-456",
  "business_id": "business-123",
  "amount_crypto": "0.00234567",
  "amount_usd": "100.00",
  "currency": "btc",
  "status": "confirmed",
  "confirmations": 3,
  "tx_hash": "abc123...",
  "timestamp": "2024-01-01T12:05:00Z"
}`}
            </pre>
          </div>

          <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <p className="text-yellow-300 text-sm">
              <strong>Note:</strong> Webhook payloads are signed with HMAC-SHA256. Verify the signature using your webhook secret.
            </p>
          </div>
        </section>

        {/* Rate Limits & Fees */}
        <section className="mb-12 p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-3xl font-bold text-white mb-6">Rate Limits & Fees</h2>
          
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
        </section>

        {/* Error Codes */}
        <section className="p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-3xl font-bold text-white mb-6">Error Codes</h2>
          
          <div className="space-y-4">
            {[
              { code: '400', name: 'Bad Request', description: 'Invalid request parameters or missing required fields' },
              { code: '401', name: 'Unauthorized', description: 'Invalid or missing authentication token' },
              { code: '404', name: 'Not Found', description: 'Resource not found' },
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
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
              <pre className="text-sm text-gray-300">
{`{
  "success": false,
  "error": "Detailed error message here"
}`}
              </pre>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}