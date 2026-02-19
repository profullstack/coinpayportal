'use client';

import { useState } from 'react';

/**
 * x402 Integration Dashboard Page
 * 
 * Shows setup instructions, active endpoints, payment history,
 * and code snippets for x402 integration.
 */

const CODE_SNIPPETS = {
  express: `import { createX402Middleware } from '@profullstack/coinpay';

const x402 = createX402Middleware({
  apiKey: 'YOUR_API_KEY',
  payTo: 'YOUR_WALLET_ADDRESS',
  network: 'base',
});

app.get('/api/premium', x402({ amount: '1000000' }), (req, res) => {
  res.json({ data: 'premium content' });
});`,
  nextjs: `import { verifyX402Payment } from '@profullstack/coinpay';

export async function GET(request: Request) {
  const paymentHeader = request.headers.get('x-payment');
  
  if (!paymentHeader) {
    return Response.json({
      x402Version: 1,
      accepts: [{
        scheme: 'exact',
        network: 'base',
        maxAmountRequired: '1000000',
        payTo: 'YOUR_WALLET_ADDRESS',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        maxTimeoutSeconds: 300,
        extra: { facilitator: 'https://coinpayportal.com/api/x402' }
      }]
    }, { status: 402 });
  }

  const result = await verifyX402Payment(paymentHeader, {
    apiKey: 'YOUR_API_KEY'
  });
  
  if (!result.valid) {
    return Response.json({ error: 'Invalid payment' }, { status: 402 });
  }

  return Response.json({ data: 'premium content' });
}`,
  curl: `# Step 1: Get payment instructions
curl -i https://your-api.com/api/premium
# → HTTP 402 with payment details

# Step 2: After signing payment, retry with proof
curl -H "X-Payment: BASE64_PAYMENT_PROOF" \\
  https://your-api.com/api/premium`,
};

type TabKey = keyof typeof CODE_SNIPPETS;

export default function X402Page() {
  const [activeTab, setActiveTab] = useState<TabKey>('express');
  const [copied, setCopied] = useState(false);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">x402 Payment Protocol</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Accept HTTP-native payments with USDC. Clients pay inline with API requests — no checkout pages, no redirects.
        </p>
      </div>

      {/* Setup Instructions */}
      <section className="mb-10 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold mb-4">Quick Setup</h2>
        <ol className="list-decimal list-inside space-y-3 text-gray-700 dark:text-gray-300">
          <li>
            Install the SDK:{' '}
            <code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-sm">
              npm install @profullstack/coinpay
            </code>
          </li>
          <li>
            Get your API key from the{' '}
            <a href="/businesses" className="text-blue-600 hover:underline">
              Business Settings
            </a>{' '}
            page
          </li>
          <li>Add the x402 middleware to your API routes (see code snippets below)</li>
          <li>
            Test with the CLI:{' '}
            <code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-sm">
              coinpay x402 test --url http://localhost:3000/api/premium
            </code>
          </li>
        </ol>
      </section>

      {/* Code Snippets */}
      <section className="mb-10 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold mb-4">Integration Code</h2>
        <div className="flex gap-2 mb-4">
          {(Object.keys(CODE_SNIPPETS) as TabKey[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {tab === 'nextjs' ? 'Next.js' : tab === 'express' ? 'Express' : 'cURL'}
            </button>
          ))}
        </div>
        <div className="relative">
          <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
            <code>{CODE_SNIPPETS[activeTab]}</code>
          </pre>
          <button
            onClick={() => copyToClipboard(CODE_SNIPPETS[activeTab])}
            className="absolute top-2 right-2 px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </section>

      {/* Active Endpoints */}
      <section className="mb-10 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold mb-4">Active x402 Endpoints</h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
          Endpoints are automatically tracked when payment verifications come through the facilitator API.
        </p>
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Endpoint</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Network</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Amount</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Payments</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  No x402 endpoints detected yet. Set up the middleware to get started.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Payment History */}
      <section className="mb-10 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold mb-4">x402 Payment History</h2>
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Date</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">From</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Amount (USDC)</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Network</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Tx</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No x402 payments yet. Payments will appear here once verified through the facilitator.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Supported Networks */}
      <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold mb-4">Supported Networks</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { name: 'Base', status: 'Live', color: 'green' },
            { name: 'Ethereum', status: 'Live', color: 'green' },
            { name: 'Polygon', status: 'Live', color: 'green' },
            { name: 'Solana', status: 'Coming Soon', color: 'yellow' },
          ].map((net) => (
            <div
              key={net.name}
              className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-center"
            >
              <h3 className="font-medium mb-1">{net.name}</h3>
              <span
                className={`text-xs px-2 py-1 rounded-full ${
                  net.color === 'green'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                    : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                }`}
              >
                {net.status}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
