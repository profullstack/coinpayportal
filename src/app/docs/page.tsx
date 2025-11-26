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
            Documentation
          </h1>
          <p className="text-xl text-gray-300">
            Complete guide to integrating CoinPayPortal into your application
          </p>
        </div>

        {/* Quick Start */}
        <section className="mb-12 p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-3xl font-bold text-white mb-6">Quick Start</h2>
          
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold text-purple-400 mb-3">1. Create an Account</h3>
              <p className="text-gray-300 mb-4">
                Sign up for a free account to get your API credentials.
              </p>
              <div className="bg-slate-800/50 p-4 rounded-lg">
                <code className="text-green-400">
                  POST /api/auth/signup
                </code>
              </div>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-purple-400 mb-3">2. Get Your API Key</h3>
              <p className="text-gray-300 mb-4">
                After signing up, navigate to your dashboard to retrieve your API key.
              </p>
              <div className="bg-slate-800/50 p-4 rounded-lg">
                <code className="text-green-400">
                  API_KEY=your_api_key_here
                </code>
              </div>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-purple-400 mb-3">3. Make Your First Payment Request</h3>
              <p className="text-gray-300 mb-4">
                Create a payment request using our REST API.
              </p>
              <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
                <pre className="text-green-400 text-sm">
{`curl -X POST https://api.coinpayportal.com/v1/payments \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "100.00",
    "currency": "USD",
    "crypto": "BTC",
    "callback_url": "https://yoursite.com/webhook"
  }'`}
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* API Reference */}
        <section className="mb-12 p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-3xl font-bold text-white mb-6">API Reference</h2>
          
          <div className="space-y-8">
            {/* Create Payment */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-lg font-mono text-sm">POST</span>
                <code className="text-purple-400 font-mono">/api/v1/payments</code>
              </div>
              <p className="text-gray-300 mb-4">Create a new payment request.</p>
              
              <h4 className="text-lg font-semibold text-white mb-2">Request Body</h4>
              <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto mb-4">
                <pre className="text-sm text-gray-300">
{`{
  "amount": "100.00",        // Amount in fiat currency
  "currency": "USD",         // Fiat currency code
  "crypto": "BTC",           // Cryptocurrency to receive
  "callback_url": "string",  // Webhook URL for notifications
  "metadata": {}             // Optional custom data
}`}
                </pre>
              </div>

              <h4 className="text-lg font-semibold text-white mb-2">Response</h4>
              <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
                <pre className="text-sm text-gray-300">
{`{
  "id": "pay_abc123",
  "status": "pending",
  "amount": "100.00",
  "crypto_amount": "0.00234",
  "address": "bc1q...",
  "expires_at": "2024-01-01T12:00:00Z"
}`}
                </pre>
              </div>
            </div>

            {/* Get Payment */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-lg font-mono text-sm">GET</span>
                <code className="text-purple-400 font-mono">/api/v1/payments/:id</code>
              </div>
              <p className="text-gray-300 mb-4">Retrieve payment details by ID.</p>
              
              <h4 className="text-lg font-semibold text-white mb-2">Response</h4>
              <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
                <pre className="text-sm text-gray-300">
{`{
  "id": "pay_abc123",
  "status": "completed",
  "amount": "100.00",
  "crypto_amount": "0.00234",
  "confirmations": 6,
  "created_at": "2024-01-01T12:00:00Z"
}`}
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* Supported Cryptocurrencies */}
        <section className="mb-12 p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-3xl font-bold text-white mb-6">Supported Cryptocurrencies</h2>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { name: 'Bitcoin', symbol: 'BTC', network: 'Bitcoin' },
              { name: 'Ethereum', symbol: 'ETH', network: 'Ethereum' },
              { name: 'Solana', symbol: 'SOL', network: 'Solana' },
              { name: 'USD Coin', symbol: 'USDC', network: 'Multiple' },
              { name: 'Tether', symbol: 'USDT', network: 'Multiple' },
              { name: 'Litecoin', symbol: 'LTC', network: 'Litecoin' },
            ].map((crypto) => (
              <div key={crypto.symbol} className="p-4 rounded-lg bg-slate-800/50 border border-white/10">
                <div className="font-semibold text-white mb-1">{crypto.name}</div>
                <div className="text-purple-400 font-mono text-sm mb-1">{crypto.symbol}</div>
                <div className="text-gray-400 text-sm">{crypto.network}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Webhooks */}
        <section className="mb-12 p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-3xl font-bold text-white mb-6">Webhooks</h2>
          
          <p className="text-gray-300 mb-6">
            Receive real-time notifications about payment status changes.
          </p>

          <h3 className="text-xl font-semibold text-white mb-4">Webhook Events</h3>
          <div className="space-y-4">
            {[
              { event: 'payment.created', description: 'Payment request created' },
              { event: 'payment.pending', description: 'Payment detected on blockchain' },
              { event: 'payment.confirmed', description: 'Payment confirmed' },
              { event: 'payment.completed', description: 'Payment fully processed' },
              { event: 'payment.failed', description: 'Payment failed or expired' },
            ].map((webhook) => (
              <div key={webhook.event} className="p-4 rounded-lg bg-slate-800/50">
                <code className="text-purple-400 font-mono">{webhook.event}</code>
                <p className="text-gray-300 mt-2">{webhook.description}</p>
              </div>
            ))}
          </div>

          <h3 className="text-xl font-semibold text-white mb-4 mt-8">Webhook Payload Example</h3>
          <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
            <pre className="text-sm text-gray-300">
{`{
  "event": "payment.completed",
  "payment": {
    "id": "pay_abc123",
    "status": "completed",
    "amount": "100.00",
    "crypto_amount": "0.00234",
    "confirmations": 6
  },
  "timestamp": "2024-01-01T12:00:00Z"
}`}
            </pre>
          </div>
        </section>

        {/* Error Codes */}
        <section className="p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-3xl font-bold text-white mb-6">Error Codes</h2>
          
          <div className="space-y-4">
            {[
              { code: '400', name: 'Bad Request', description: 'Invalid request parameters' },
              { code: '401', name: 'Unauthorized', description: 'Invalid or missing API key' },
              { code: '404', name: 'Not Found', description: 'Resource not found' },
              { code: '429', name: 'Rate Limit', description: 'Too many requests' },
              { code: '500', name: 'Server Error', description: 'Internal server error' },
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
        </section>
      </div>
    </div>
  );
}