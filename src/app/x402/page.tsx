'use client';

import { useState } from 'react';

/**
 * x402 Integration Dashboard Page
 * 
 * Shows setup instructions, active endpoints, payment history,
 * and code snippets for multi-chain, multi-asset x402 integration.
 */

const CODE_SNIPPETS = {
  express: `import { createX402Middleware } from '@profullstack/coinpay';

const x402 = createX402Middleware({
  apiKey: 'YOUR_API_KEY',
  payTo: {
    bitcoin: 'bc1qYourBtcAddress',
    ethereum: '0xYourEvmAddress',
    polygon: '0xYourEvmAddress',
    solana: 'YourSolanaAddress',
    lightning: 'lno1YourBolt12Offer',
    stripe: 'acct_YourStripeId',
    'bitcoin-cash': 'bitcoincash:qYourBchAddress',
    base: '0xYourEvmAddress',
  },
  rates: { BTC: 65000, ETH: 3500, SOL: 150, POL: 0.50, BCH: 350 },
});

// Charge $5 — buyer picks their chain/asset
app.get('/api/premium', x402({ amountUsd: 5.00 }), (req, res) => {
  res.json({ data: 'premium content', paidWith: req.x402Payment });
});`,
  nextjs: `import { buildPaymentRequired, verifyX402Payment } from '@profullstack/coinpay';

export async function GET(request: Request) {
  const paymentHeader = request.headers.get('x-payment');

  if (!paymentHeader) {
    const body = buildPaymentRequired({
      payTo: {
        bitcoin: 'bc1q...',
        ethereum: '0x...',
        solana: 'So1...',
        lightning: 'lno1...',
      },
      amountUsd: 5.00,
      rates: { BTC: 65000, ETH: 3500, SOL: 150 },
    });
    return Response.json(body, { status: 402 });
  }

  const result = await verifyX402Payment(paymentHeader, {
    apiKey: 'YOUR_API_KEY',
  });

  if (!result.valid) {
    return Response.json({ error: result.reason }, { status: 402 });
  }

  return Response.json({ data: 'premium content' });
}`,
  curl: `# Step 1: Get payment options (BTC, ETH, SOL, USDC, Lightning, Stripe...)
curl -i https://your-api.com/api/premium
# → HTTP 402 with accepts[] listing all payment methods

# Step 2: Pick a method, sign/send payment, retry with proof
curl -H "X-Payment: BASE64_PAYMENT_PROOF" \\
  https://your-api.com/api/premium`,
  limited: `// Only accept USDC stablecoins + Lightning
const x402 = createX402Middleware({
  apiKey: 'YOUR_API_KEY',
  payTo: {
    ethereum: '0x...',
    polygon: '0x...',
    base: '0x...',
    solana: 'So1...',
    lightning: 'lno1...',
  },
  methods: ['usdc_eth', 'usdc_polygon', 'usdc_base', 'usdc_solana', 'lightning'],
});`,
};

type TabKey = keyof typeof CODE_SNIPPETS;

const TAB_LABELS: Record<TabKey, string> = {
  express: 'Express',
  nextjs: 'Next.js',
  curl: 'cURL',
  limited: 'Limit Methods',
};

const PAYMENT_METHODS = [
  { key: 'btc', name: 'Bitcoin', asset: 'BTC', network: 'bitcoin', type: 'Native' },
  { key: 'bch', name: 'Bitcoin Cash', asset: 'BCH', network: 'bitcoin-cash', type: 'Native' },
  { key: 'eth', name: 'Ethereum', asset: 'ETH', network: 'ethereum', type: 'Native' },
  { key: 'pol', name: 'Polygon', asset: 'POL', network: 'polygon', type: 'Native' },
  { key: 'sol', name: 'Solana', asset: 'SOL', network: 'solana', type: 'Native' },
  { key: 'usdc_eth', name: 'USDC on Ethereum', asset: 'USDC', network: 'ethereum', type: 'Stablecoin' },
  { key: 'usdc_polygon', name: 'USDC on Polygon', asset: 'USDC', network: 'polygon', type: 'Stablecoin' },
  { key: 'usdc_solana', name: 'USDC on Solana', asset: 'USDC', network: 'solana', type: 'Stablecoin' },
  { key: 'usdc_base', name: 'USDC on Base', asset: 'USDC', network: 'base', type: 'Stablecoin' },
  { key: 'lightning', name: 'Lightning', asset: 'BTC', network: 'lightning', type: 'Lightning' },
  { key: 'stripe', name: 'Card (Stripe)', asset: 'USD', network: 'stripe', type: 'Fiat' },
];

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
          The first multi-chain, multi-asset x402 facilitator. Accept BTC, ETH, SOL, POL, BCH, USDC, Lightning, and card payments — all inline with HTTP requests.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {['BTC', 'ETH', 'SOL', 'POL', 'BCH', 'USDC', '⚡ Lightning', '💳 Stripe'].map((badge) => (
            <span key={badge} className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded text-xs font-medium">
              {badge}
            </span>
          ))}
        </div>
      </div>

      {/* How It Works */}
      <section className="mb-10 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold mb-4">How It Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { step: '1', title: 'Client Requests', desc: 'Client hits your API endpoint' },
            { step: '2', title: '402 + Options', desc: 'Server returns all accepted payment methods' },
            { step: '3', title: 'Client Pays', desc: 'Client picks BTC, ETH, Lightning, card...' },
            { step: '4', title: 'Access Granted', desc: 'Payment verified, resource served' },
          ].map((s) => (
            <div key={s.step} className="text-center p-4">
              <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center mx-auto mb-2 font-bold">
                {s.step}
              </div>
              <h3 className="font-medium mb-1">{s.title}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Fees */}
      <section className="mb-10 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold mb-4">Fees</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          CoinPayPortal charges a small commission on each x402 payment, deducted before forwarding to the merchant. The same fee structure applies to all CoinPayPortal payment methods.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Plan</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Commission</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Merchant Receives</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Price</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-gray-200 dark:border-gray-700">
                <td className="px-4 py-3 font-medium">Starter (Free)</td>
                <td className="px-4 py-3">1.0%</td>
                <td className="px-4 py-3">99.0%</td>
                <td className="px-4 py-3">$0/mo</td>
              </tr>
              <tr className="border-t border-gray-200 dark:border-gray-700">
                <td className="px-4 py-3 font-medium">Professional</td>
                <td className="px-4 py-3">0.5%</td>
                <td className="px-4 py-3">99.5%</td>
                <td className="px-4 py-3">$49/mo</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-gray-500 dark:text-gray-400 text-xs mt-3">
          Network fees (gas, miner fees) are separate and vary by chain. Lightning payments have near-zero network fees. No hidden fees — what you see is what you pay.
        </p>
      </section>

      {/* How Clients Actually Pay */}
      <section className="mb-10 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold mb-4">How Clients Pay</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          When a client (browser, AI agent, or bot) hits an x402-protected endpoint, they get back a <strong>402 response</strong> with all accepted payment methods. Here&apos;s what happens:
        </p>

        <div className="space-y-6">
          {/* Step 1: 402 Response */}
          <div className="border-l-4 border-blue-500 pl-4">
            <h3 className="font-semibold mb-2">1. Client receives payment options</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              The 402 response body contains an <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs">accepts</code> array — one entry per payment method the merchant supports:
            </p>
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs">{`HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "bitcoin",
      "asset": "BTC",
      "maxAmountRequired": "769",       // satoshis
      "payTo": "bc1qMerchant...",
      "extra": { "label": "Bitcoin" }
    },
    {
      "scheme": "exact",
      "network": "base",
      "asset": "0xA0b8...eB48",         // USDC contract
      "maxAmountRequired": "5000000",    // 6 decimals = $5.00
      "payTo": "0xMerchant...",
      "extra": { "label": "USDC on Base", "chainId": 8453 }
    },
    {
      "scheme": "exact",
      "network": "lightning",
      "asset": "BTC",
      "maxAmountRequired": "769",
      "payTo": "lno1Merchant...",        // BOLT12 offer
      "extra": { "label": "Lightning" }
    }
    // ... more methods
  ],
  "error": "Payment required"
}`}</pre>
          </div>

          {/* Step 2: Client picks and pays */}
          <div className="border-l-4 border-green-500 pl-4">
            <h3 className="font-semibold mb-2">2. Client picks a method and creates payment proof</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              The client chooses a payment method from the <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs">accepts</code> array, then:
            </p>
            <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-2 ml-4 list-disc">
              <li><strong>USDC (EVM chains):</strong> Sign an EIP-712 typed message authorizing a <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs">transferFrom</code> — no on-chain tx yet, just a signature</li>
              <li><strong>Bitcoin/BCH:</strong> Broadcast a transaction to the merchant&apos;s address, include the txid as proof</li>
              <li><strong>Lightning:</strong> Pay the BOLT12 offer, include the preimage as proof</li>
              <li><strong>Solana:</strong> Sign and broadcast a transfer, include the signature</li>
              <li><strong>Stripe:</strong> Complete card checkout, include the payment intent ID</li>
            </ul>
          </div>

          {/* Step 3: Retry with header */}
          <div className="border-l-4 border-purple-500 pl-4">
            <h3 className="font-semibold mb-2">3. Client retries the request with payment proof</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              The payment proof goes in the <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs">X-PAYMENT</code> header as a base64-encoded JSON payload:
            </p>
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs">{`GET /api/premium HTTP/1.1
X-PAYMENT: eyJzY2hlbWUiOiJleGFjdCIsIm5ldHdvcmsiOiJiYXNlIiwiYXNzZXQiOiIweEEwYjg2OTkx...

// Decoded X-PAYMENT payload:
{
  "scheme": "exact",
  "network": "base",
  "asset": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "payload": {
    "signature": "0xabc123...",       // EIP-712 sig (USDC)
    "authorization": {
      "from": "0xBuyerAddress...",
      "to": "0xMerchantAddress...",
      "value": "5000000",
      "validAfter": 0,
      "validBefore": 1739980800,      // expiry timestamp
      "nonce": "0xUniqueNonce..."
    }
  }
}`}</pre>
          </div>

          {/* Step 4: Verification */}
          <div className="border-l-4 border-yellow-500 pl-4">
            <h3 className="font-semibold mb-2">4. Server verifies and serves content</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              The middleware sends the proof to CoinPayPortal&apos;s facilitator (<code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs">/api/x402/verify</code>) which validates the signature, checks expiry, prevents replay attacks, and optionally settles on-chain. If valid → content is served. If invalid → another 402.
            </p>
          </div>
        </div>

        {/* Client Libraries */}
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <h3 className="font-semibold text-blue-700 dark:text-blue-300 mb-2">Client Libraries</h3>
          <p className="text-sm text-blue-600 dark:text-blue-400 mb-3">
            For automated clients (AI agents, bots), use a library that handles the 402 → pay → retry loop:
          </p>
          <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs">{`import { x402fetch } from '@profullstack/coinpay';

// Wraps fetch() — automatically handles 402 responses
const response = await x402fetch('https://api.example.com/premium', {
  paymentMethods: {
    // Provide wallet/signer for chains you want to pay with
    base: { signer: wallet },           // EVM wallet (ethers/viem)
    lightning: { macaroon, host },       // LND credentials
    bitcoin: { wif: 'privateKey...' },   // BTC wallet
  },
  preferredMethod: 'usdc_base',          // optional: try this first
});

const data = await response.json();`}</pre>
        </div>
      </section>

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
            Get your API key from{' '}
            <a href="/businesses" className="text-blue-600 hover:underline">Business Settings</a>
          </li>
          <li>
            Configure wallet addresses for each chain you want to accept
          </li>
          <li>Add the x402 middleware — set a USD price and let the buyer choose their chain</li>
          <li>
            Test:{' '}
            <code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-sm">
              coinpay x402 test --url http://localhost:3000/api/premium
            </code>
          </li>
        </ol>
      </section>

      {/* Code Snippets */}
      <section className="mb-10 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold mb-4">Integration Code</h2>
        <div className="flex flex-wrap gap-2 mb-4">
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
              {TAB_LABELS[tab]}
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
          Endpoints are tracked automatically when payment verifications come through the facilitator.
        </p>
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Endpoint</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Methods</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Price</th>
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
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Amount</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Method</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Tx</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No x402 payments yet.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Supported Payment Methods */}
      <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold mb-4">Supported Payment Methods</h2>
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Method</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Asset</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Network</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Key</th>
              </tr>
            </thead>
            <tbody>
              {PAYMENT_METHODS.map((m) => (
                <tr key={m.key} className="border-t border-gray-200 dark:border-gray-700">
                  <td className="px-4 py-2 font-medium">{m.name}</td>
                  <td className="px-4 py-2">{m.asset}</td>
                  <td className="px-4 py-2 text-gray-500">{m.network}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      m.type === 'Native' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' :
                      m.type === 'Stablecoin' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                      m.type === 'Lightning' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
                      'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                    }`}>
                      {m.type}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{m.key}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
