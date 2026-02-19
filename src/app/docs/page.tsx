import Link from 'next/link';
import { AuthenticationDocs } from '@/components/docs/AuthenticationDocs';
import { SubscriptionsDocs } from '@/components/docs/SubscriptionsDocs';
import { WebWalletDocs } from '@/components/docs/WebWalletDocs';
import { ReputationDocs } from '@/components/docs/ReputationDocs';
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

        {/* Web Wallet Banner */}
        <div className="mb-8 p-6 rounded-2xl bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white mb-2">🔐 Non-Custodial Web Wallet</h2>
              <p className="text-gray-300 text-sm">
                Multi-chain wallet for humans and AI agents — no signup, no KYC, API-first
              </p>
            </div>
            <a
              href="#web-wallet"
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              View Docs
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        </div>

        {/* Escrow Banner */}
        <div className="mb-8 p-6 rounded-2xl bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white mb-2">🔐 Escrow Service</h2>
              <p className="text-gray-300 text-sm">
                Trustless crypto escrow — hold funds until both sides are satisfied. Token-based auth, no accounts needed.
              </p>
            </div>
            <a
              href="#escrow"
              className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              View Docs
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        </div>

        {/* Card Payments Banner */}
        <div className="mb-8 p-6 rounded-2xl bg-gradient-to-r from-blue-500/20 to-indigo-500/20 border border-blue-500/30">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white mb-2">💳 Credit Card Payments</h2>
              <p className="text-gray-300 text-sm">
                Accept credit &amp; debit cards via Stripe Connect — gateway mode, escrow mode, and automatic merchant onboarding
              </p>
            </div>
            <Link
              href="/docs/sdk#card-payments"
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              View Docs
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* x402 Banner */}
        <div className="mb-8 p-6 rounded-2xl bg-gradient-to-r from-yellow-500/20 to-red-500/20 border border-yellow-500/30">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white mb-2">⚡ x402 Payment Protocol</h2>
              <p className="text-gray-300 text-sm">
                HTTP-native machine payments — the only multi-chain x402 facilitator. BTC, ETH, SOL, USDC, Lightning &amp; more.
              </p>
            </div>
            <Link
              href="/x402"
              className="px-6 py-3 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              x402 Dashboard
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Reputation Banner */}
        <div className="mb-8 p-6 rounded-2xl bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 border border-violet-500/30">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white mb-2">🛡️ Reputation &amp; DID</h2>
              <p className="text-gray-300 text-sm">
                Decentralized reputation system — track agent performance, issue verifiable credentials, query trust scores
              </p>
            </div>
            <a
              href="#reputation"
              className="px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              View Docs
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        </div>

        {/* Table of Contents */}
        <nav className="mb-12 p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-xl font-bold text-white mb-4">Quick Navigation</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { name: 'x402 Protocol', href: '#x402' },
              { name: 'SDK Documentation', href: '/docs/sdk', external: true },
              { name: 'Web Wallet API', href: '#web-wallet' },
              { name: 'Escrow API', href: '#escrow' },
              { name: 'Recurring Escrow', href: '#recurring-escrow' },
              { name: 'Reputation & DID', href: '#reputation' },
              { name: 'Exchange Rates', href: '#rates' },
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

        {/* x402 Protocol */}
        <div id="x402">
          <DocSection title="x402 Payment Protocol">
            <p className="text-gray-300 mb-6">
              HTTP-native machine payments using the <strong>HTTP 402 Payment Required</strong> status code. 
              Paywall any API route — clients (browsers, AI agents, bots) automatically negotiate payment inline with HTTP requests. 
              CoinPayPortal is the <strong>only multi-chain x402 facilitator</strong>: BTC, ETH, SOL, POL, BCH, USDC (4 chains), Lightning, and Stripe.
            </p>

            <div className="mb-8 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <h4 className="font-semibold text-yellow-300 mb-2">How x402 Works</h4>
              <ol className="text-yellow-200 text-sm space-y-1 list-decimal list-inside">
                <li><strong>Client requests</strong> a paid API endpoint (e.g. <code className="text-yellow-100">GET /api/premium</code>)</li>
                <li><strong>Server returns 402</strong> with an <code className="text-yellow-100">accepts[]</code> array listing all payment methods + prices</li>
                <li><strong>Client picks a method</strong> (BTC, USDC, Lightning, card...) and creates a payment proof</li>
                <li><strong>Client retries</strong> the request with an <code className="text-yellow-100">X-Payment</code> header containing the proof</li>
                <li><strong>Server verifies</strong> the proof via CoinPayPortal&apos;s facilitator and serves the content</li>
              </ol>
            </div>

            {/* Merchant: Paywall a Route */}
            <h3 className="text-lg font-bold text-white mt-8 mb-4">Merchant: Paywall a Route</h3>
            <p className="text-gray-300 text-sm mb-4">
              Install the SDK and add x402 middleware to any Express or Next.js route. Set a USD price — the middleware handles multi-chain pricing and 402 responses automatically.
            </p>

            <CodeBlock language="bash">{`npm install @profullstack/coinpay`}</CodeBlock>

            <h4 className="text-md font-semibold text-white mt-6 mb-3">Express</h4>
            <CodeBlock language="javascript">{`import { createX402Middleware } from '@profullstack/coinpay';

const x402 = createX402Middleware({
  apiKey: 'cp_live_xxxxx',                // from /businesses
  payTo: {
    bitcoin: 'bc1qYourBtcAddress',
    ethereum: '0xYourEvmAddress',         // also receives USDC on ETH
    polygon: '0xYourEvmAddress',
    base: '0xYourEvmAddress',             // also receives USDC on Base
    solana: 'YourSolanaAddress',
    lightning: 'lno1YourBolt12Offer',
    stripe: 'acct_YourStripeId',
    'bitcoin-cash': 'bitcoincash:qYourBchAddress',
  },
  rates: { BTC: 65000, ETH: 3500, SOL: 150, POL: 0.50, BCH: 350 },
});

// Paywall — charge $5, buyer picks their chain/asset
app.get('/api/premium', x402({ amountUsd: 5.00 }), (req, res) => {
  res.json({ data: 'premium content', paidWith: req.x402Payment });
});`}</CodeBlock>

            <h4 className="text-md font-semibold text-white mt-6 mb-3">Next.js (App Router)</h4>
            <CodeBlock language="typescript">{`import { buildPaymentRequired, verifyX402Payment } from '@profullstack/coinpay';

export async function GET(request: Request) {
  const paymentHeader = request.headers.get('x-payment');

  if (!paymentHeader) {
    // No payment — return 402 with all accepted methods
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

  // Verify payment proof via CoinPayPortal facilitator
  const result = await verifyX402Payment(paymentHeader, {
    apiKey: 'cp_live_xxxxx',
  });

  if (!result.valid) {
    return Response.json({ error: result.reason }, { status: 402 });
  }

  return Response.json({ data: 'premium content' });
}`}</CodeBlock>

            {/* Customer: How to Pay */}
            <h3 className="text-lg font-bold text-white mt-10 mb-4">Customer: How to Pay</h3>
            <p className="text-gray-300 text-sm mb-4">
              When you hit an x402-protected endpoint, you receive a <strong>402 response</strong> with the payment options. Here&apos;s what the response looks like and how to pay with each method.
            </p>

            <h4 className="text-md font-semibold text-white mt-6 mb-3">The 402 Response</h4>
            <CodeBlock language="json">{`{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "bitcoin",
      "asset": "BTC",
      "maxAmountRequired": "769",
      "payTo": "bc1qMerchant...",
      "extra": { "label": "Bitcoin" }
    },
    {
      "scheme": "exact",
      "network": "base",
      "asset": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "maxAmountRequired": "5000000",
      "payTo": "0xMerchant...",
      "extra": { "label": "USDC on Base", "chainId": 8453 }
    },
    {
      "scheme": "exact",
      "network": "lightning",
      "asset": "BTC",
      "maxAmountRequired": "769",
      "payTo": "lno1Merchant...",
      "extra": { "label": "Lightning" }
    },
    {
      "scheme": "exact",
      "network": "stripe",
      "asset": "USD",
      "maxAmountRequired": "500",
      "payTo": "acct_MerchantStripe",
      "extra": { "label": "Card (Stripe)" }
    }
  ],
  "error": "Payment required"
}`}</CodeBlock>

            <h4 className="text-md font-semibold text-white mt-6 mb-3">Payment Methods</h4>
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">Method</th>
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">How to Pay</th>
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">Proof</th>
                  </tr>
                </thead>
                <tbody className="text-gray-400">
                  <tr className="border-b border-white/5">
                    <td className="px-4 py-3 font-medium text-white">USDC (EVM)</td>
                    <td className="px-4 py-3">Sign an EIP-712 typed message authorizing <code className="text-purple-300">transferFrom</code> — gasless, no on-chain tx until settlement</td>
                    <td className="px-4 py-3"><code className="text-purple-300">signature</code> + <code className="text-purple-300">authorization</code> object</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="px-4 py-3 font-medium text-white">Bitcoin / BCH</td>
                    <td className="px-4 py-3">Broadcast a transaction to the merchant&apos;s <code className="text-purple-300">payTo</code> address</td>
                    <td className="px-4 py-3">Transaction ID (<code className="text-purple-300">txid</code>)</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="px-4 py-3 font-medium text-white">Lightning</td>
                    <td className="px-4 py-3">Pay the BOLT12 offer via any Lightning wallet</td>
                    <td className="px-4 py-3">Payment preimage</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="px-4 py-3 font-medium text-white">Solana</td>
                    <td className="px-4 py-3">Sign and broadcast a SOL/USDC transfer</td>
                    <td className="px-4 py-3">Transaction signature</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="px-4 py-3 font-medium text-white">Stripe (Card)</td>
                    <td className="px-4 py-3">Complete card checkout (redirect or embedded form)</td>
                    <td className="px-4 py-3">Payment Intent ID</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h4 className="text-md font-semibold text-white mt-6 mb-3">Sending the Payment Proof</h4>
            <p className="text-gray-300 text-sm mb-3">
              After paying, retry the original request with the proof in the <code className="text-purple-300">X-Payment</code> header (base64-encoded JSON):
            </p>
            <CodeBlock language="http">{`GET /api/premium HTTP/1.1
Host: api.example.com
X-Payment: eyJzY2hlbWUiOiJleGFjdCIsIm5ldHdvcmsiOiJiYXNlIi4uLn0=`}</CodeBlock>

            <p className="text-gray-400 text-sm mt-3 mb-3">Decoded payload (USDC on Base example):</p>
            <CodeBlock language="json">{`{
  "scheme": "exact",
  "network": "base",
  "asset": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "payload": {
    "signature": "0xabc123...",
    "authorization": {
      "from": "0xBuyerAddress...",
      "to": "0xMerchantAddress...",
      "value": "5000000",
      "validAfter": 0,
      "validBefore": 1739980800,
      "nonce": "0xUniqueNonce..."
    }
  }
}`}</CodeBlock>

            {/* Paying with CoinPay Wallet */}
            <h4 className="text-md font-semibold text-white mt-6 mb-3">Paying with CoinPay Web Wallet</h4>
            <p className="text-gray-300 text-sm mb-3">
              If the customer has a <a href="/web-wallet" className="text-purple-400 hover:text-purple-300 underline">CoinPay Web Wallet</a>, the flow is seamless — the wallet can read the 402 response, display the payment options, and sign the proof automatically:
            </p>
            <CodeBlock language="javascript">{`// Using CoinPay Wallet SDK (browser)
import { CoinPayWallet } from '@profullstack/coinpay/wallet';

const wallet = new CoinPayWallet();

// Fetch with automatic x402 handling
const response = await wallet.x402fetch('https://api.example.com/premium');
// Wallet prompts user to pick a chain → signs → retries → done

const data = await response.json();`}</CodeBlock>

            {/* Paying with any wallet */}
            <h4 className="text-md font-semibold text-white mt-6 mb-3">Paying with Any Wallet (Programmatic)</h4>
            <p className="text-gray-300 text-sm mb-3">
              AI agents, bots, or any programmatic client can use <code className="text-purple-300">x402fetch()</code> — it wraps <code className="text-purple-300">fetch()</code> and handles the entire 402 → pay → retry loop:
            </p>
            <CodeBlock language="javascript">{`import { x402fetch } from '@profullstack/coinpay';

const response = await x402fetch('https://api.example.com/premium', {
  paymentMethods: {
    // Provide wallet/signer for each chain you can pay with
    base: { signer: evmWallet },           // ethers.js or viem signer
    lightning: { macaroon, host },          // LND or CLN credentials
    bitcoin: { wif: 'L4rK1yD...' },        // BTC private key (WIF)
    solana: { secretKey: keypair },         // Solana Keypair
  },
  preferredMethod: 'usdc_base',            // try this first
  maxAmount: '10.00',                      // USD safety cap
});

const data = await response.json();
// data = { data: 'premium content' }`}</CodeBlock>

            {/* Manual cURL flow */}
            <h4 className="text-md font-semibold text-white mt-6 mb-3">Manual Flow (cURL)</h4>
            <CodeBlock language="bash">{`# Step 1: Hit the endpoint — get 402 with payment options
curl -s https://api.example.com/api/premium | jq .
# → { "x402Version": 1, "accepts": [...], "error": "Payment required" }

# Step 2: Pay using your preferred method (e.g. send BTC to payTo address)
# ... broadcast transaction, get txid ...

# Step 3: Retry with the payment proof
curl -H "X-Payment: $(echo -n '{"scheme":"exact","network":"bitcoin","asset":"BTC","payload":{"txid":"abc123..."}}' | base64)" \\
  https://api.example.com/api/premium
# → { "data": "premium content" }`}</CodeBlock>

            {/* Fees */}
            <h3 className="text-lg font-bold text-white mt-10 mb-4">Fees</h3>
            <p className="text-gray-300 text-sm mb-4">
              CoinPayPortal takes a small commission on each x402 payment, deducted before forwarding to the merchant:
            </p>
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">Plan</th>
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">Commission</th>
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">Merchant Receives</th>
                  </tr>
                </thead>
                <tbody className="text-gray-400">
                  <tr className="border-b border-white/5">
                    <td className="px-4 py-3 font-medium text-white">Starter (Free)</td>
                    <td className="px-4 py-3">1.0%</td>
                    <td className="px-4 py-3">99.0%</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="px-4 py-3 font-medium text-white">Professional ($49/mo)</td>
                    <td className="px-4 py-3">0.5%</td>
                    <td className="px-4 py-3">99.5%</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-gray-500 text-xs mb-6">
              Network fees (gas, miner fees) are separate and vary by chain. Lightning has near-zero network fees. No hidden fees.
            </p>

            {/* Facilitator API */}
            <h3 className="text-lg font-bold text-white mt-10 mb-4">Facilitator API</h3>
            <p className="text-gray-300 text-sm mb-4">
              The facilitator endpoints are used by the merchant&apos;s middleware to verify and settle payments. You typically don&apos;t call these directly — the SDK handles it.
            </p>

            <ApiEndpoint
              method="POST"
              path="/api/x402/verify"
              description="Verify an x402 payment proof. Validates signatures, checks expiry, prevents replay attacks."
            />
            <CodeBlock language="json">{`// Request
{
  "proof": "<base64-encoded X-Payment header>",
  "expectedAmount": "5000000",
  "expectedAsset": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "expectedNetwork": "base",
  "expectedPayTo": "0xMerchantAddress..."
}

// Response (200 OK)
{
  "valid": true,
  "network": "base",
  "asset": "USDC",
  "amount": "5000000",
  "from": "0xBuyerAddress...",
  "to": "0xMerchantAddress..."
}

// Response (invalid)
{
  "valid": false,
  "reason": "Signature expired"
}`}</CodeBlock>

            <ApiEndpoint
              method="POST"
              path="/api/x402/settle"
              description="Settle (claim) a verified payment on-chain. For USDC, executes the transferFrom. Called after successful verification."
            />
            <CodeBlock language="json">{`// Request
{
  "proof": "<base64-encoded X-Payment header>",
  "network": "base"
}

// Response (200 OK)
{
  "settled": true,
  "txHash": "0xdef456...",
  "network": "base",
  "amount": "5000000",
  "asset": "USDC"
}`}</CodeBlock>

            <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-blue-300 text-sm">
                <strong>💡 Tip:</strong> For a full interactive setup guide and payment history dashboard, visit the{' '}
                <a href="/x402" className="text-blue-400 hover:text-blue-300 underline">x402 Dashboard</a>.
              </p>
            </div>
          </DocSection>
        </div>

        {/* Web Wallet API */}
        <div id="web-wallet">
          <WebWalletDocs />
        </div>

        {/* Escrow API */}
        <div id="escrow">
          <DocSection title="Escrow Service">
            <p className="text-gray-300 mb-6">
              Anonymous, trustless escrow for crypto transactions. Hold funds until both parties are satisfied. 
              No accounts required — authentication is handled via unique tokens returned at creation time.
            </p>

            <div className="mb-8 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <h4 className="font-semibold text-amber-300 mb-2">How Escrow Works</h4>
              <ol className="text-amber-200 text-sm space-y-1 list-decimal list-inside">
                <li><strong>Create</strong> — Specify chain, amount, depositor &amp; beneficiary addresses. Get a deposit address + two auth tokens. Share the Escrow ID!</li>
                <li><strong>Fund</strong> — Depositor sends crypto to the escrow address. Auto-detected by the balance monitor.</li>
                <li><strong>Manage</strong> — Both parties can manage the escrow via <code className="text-amber-100">/escrow/manage?id=xxx&token=yyy</code> with shareable links generated at creation.</li>
                <li><strong>Release or Dispute</strong> — Depositor releases funds (using <code className="text-amber-100">release_token</code>) or either party opens a dispute.</li>
                <li><strong>Settlement</strong> — Funds forwarded on-chain to beneficiary (minus fee). Refunds return the full amount.</li>
              </ol>
            </div>

            <div className="mb-8 grid md:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-slate-800/50 border border-white/10">
                <h4 className="font-semibold text-white mb-2">Auth Tokens</h4>
                <div className="text-gray-300 text-sm space-y-1">
                  <p><code className="text-purple-400">release_token</code> — Given to depositor. Used to release or refund funds.</p>
                  <p><code className="text-purple-400">beneficiary_token</code> — Given to beneficiary. Used to open disputes.</p>
                </div>
              </div>
              <div className="p-4 rounded-lg bg-slate-800/50 border border-white/10">
                <h4 className="font-semibold text-white mb-2">Fees</h4>
                <div className="text-gray-300 text-sm space-y-1">
                  <p><strong>Free tier:</strong> 1% on release</p>
                  <p><strong>Professional:</strong> 0.5% on release</p>
                  <p><strong>Refunds:</strong> No fee (full amount returned)</p>
                </div>
              </div>
            </div>

            <h3 className="text-xl font-semibold text-white mb-4">Escrow Statuses</h3>
            <div className="grid md:grid-cols-3 gap-4 mb-8">
              {[
                { status: 'pending', desc: 'Awaiting deposit', color: 'yellow' },
                { status: 'funded', desc: 'Deposit received on-chain', color: 'blue' },
                { status: 'released', desc: 'Depositor released funds', color: 'green' },
                { status: 'settled', desc: 'Funds forwarded to beneficiary', color: 'green' },
                { status: 'disputed', desc: 'Dispute opened by either party', color: 'orange' },
                { status: 'refunded', desc: 'Funds returned to depositor', color: 'purple' },
                { status: 'expired', desc: 'Deposit window expired', color: 'red' },
              ].map((item) => (
                <div key={item.status} className="p-3 rounded-lg bg-slate-800/50">
                  <code className={`text-${item.color}-400 font-mono`}>{item.status}</code>
                  <p className="text-gray-300 text-sm mt-1">{item.desc}</p>
                </div>
              ))}
            </div>

            <ApiEndpoint method="POST" path="/api/escrow" description="Create a new escrow. No authentication required (anonymous). Optionally authenticate to associate with a business and get paid-tier fees.">
              <div className="mb-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-blue-300 text-sm">
                  <strong>Fiat Support:</strong> While this API accepts crypto amounts directly, you can now specify amounts in fiat when using the SDK/CLI, which will auto-convert via the rates API before creating the escrow.
                </p>
              </div>
              <CodeBlock title="Request Body">
{`{
  "chain": "ETH",              // BTC, BCH, ETH, POL, SOL, USDC, USDC_ETH, USDC_POL, USDC_SOL
  "amount": 0.5,               // Amount in crypto
  "depositor_address": "0xAlice...",     // Depositor's wallet
  "beneficiary_address": "0xBob...",     // Beneficiary's wallet
  "arbiter_address": "0xArbiter...",     // Optional: dispute arbiter
  "expires_in_hours": 48,               // Optional: 1-720 hours (default: 24)
  "metadata": { "order_id": "123" },    // Optional: custom metadata
  "business_id": "uuid"                 // Optional: for merchant association
}`}
              </CodeBlock>

              <CodeBlock title="cURL Example" language="curl">
{`curl -X POST https://coinpayportal.com/api/escrow \\
  -H "Content-Type: application/json" \\
  -d '{
    "chain": "ETH",
    "amount": 0.5,
    "depositor_address": "0xAlice...",
    "beneficiary_address": "0xBob...",
    "expires_in_hours": 48
  }'`}
              </CodeBlock>

              <CodeBlock title="Response (201 Created)">
{`{
  "id": "a1b2c3d4-...",
  "escrow_address": "0xEscrowAddr...",
  "chain": "ETH",
  "amount": 0.5,
  "amount_usd": 1250.00,
  "fee_amount": 0.005,
  "status": "created",
  "depositor_address": "0xAlice...",
  "beneficiary_address": "0xBob...",
  "expires_at": "2024-01-03T12:00:00Z",
  "created_at": "2024-01-01T12:00:00Z",
  "release_token": "esc_abc123...",
  "beneficiary_token": "esc_def456...",
  "metadata": {}
}`}
              </CodeBlock>

              <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <p className="text-yellow-300 text-sm">
                  <strong>Important:</strong> Save the <code className="text-yellow-200">release_token</code> and <code className="text-yellow-200">beneficiary_token</code> — they are only returned once at creation time. The depositor needs <code className="text-yellow-200">release_token</code> to release or refund. The beneficiary needs <code className="text-yellow-200">beneficiary_token</code> to dispute. Both parties can use these tokens to manage the escrow via the <a href="/escrow/manage" className="text-yellow-200 underline">/escrow/manage</a> page.
                </p>
              </div>

              <div className="mt-4 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                <p className="text-green-300 text-sm">
                  <strong>Escrow ID:</strong> Always save the escrow ID returned in the response. Share the escrow ID and appropriate token with the other party so they can manage the escrow at <code className="text-green-200">/escrow/manage?id=xxx&token=yyy</code>
                </p>
              </div>
            </ApiEndpoint>

            <ApiEndpoint method="GET" path="/api/escrow?status=funded&depositor=0x..." description="List escrows. Requires at least one filter: status, depositor, beneficiary, or business_id.">
              <CodeBlock title="Query Parameters">
{`status       — Filter by status (created, funded, released, settled, etc.)
depositor    — Filter by depositor address
beneficiary  — Filter by beneficiary address
business_id  — Filter by business (requires auth)
limit        — Results per page (default: 20)
offset       — Pagination offset`}
              </CodeBlock>

              <CodeBlock title="Response">
{`{
  "escrows": [
    {
      "id": "a1b2c3d4-...",
      "escrow_address": "0xEscrowAddr...",
      "chain": "ETH",
      "amount": 0.5,
      "status": "funded",
      "deposited_amount": 0.5,
      "funded_at": "2024-01-01T13:00:00Z",
      ...
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}`}
              </CodeBlock>
            </ApiEndpoint>

            <ApiEndpoint method="GET" path="/api/escrow/:id" description="Get escrow details by ID. Public endpoint — no auth required.">
              <CodeBlock title="cURL Example" language="curl">
{`curl https://coinpayportal.com/api/escrow/a1b2c3d4-...`}
              </CodeBlock>
            </ApiEndpoint>

            <ApiEndpoint method="POST" path="/api/escrow/:id/auth" description="Authenticate with escrow using token. Returns escrow details and your role (depositor/beneficiary). Used by the manage page to determine what actions are available.">
              <CodeBlock title="Request Body">
{`{
  "token": "esc_abc123..."    // release_token or beneficiary_token
}`}
              </CodeBlock>

              <CodeBlock title="cURL Example" language="curl">
{`curl -X POST https://coinpayportal.com/api/escrow/a1b2c3d4-.../auth \\
  -H "Content-Type: application/json" \\
  -d '{"token": "esc_abc123..."}'`}
              </CodeBlock>

              <CodeBlock title="Response">
{`{
  "escrow": {
    "id": "a1b2c3d4-...",
    "escrow_address": "0xEscrowAddr...",
    "chain": "ETH",
    "amount": 0.5,
    "status": "funded",
    "depositor_address": "0xAlice...",
    "beneficiary_address": "0xBob...",
    "funded_at": "2024-01-01T13:00:00Z",
    ...
  },
  "role": "depositor"    // "depositor" or "beneficiary"
}`}
              </CodeBlock>

              <div className="mt-4 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                <p className="text-purple-300 text-sm">
                  <strong>Use Case:</strong> Both depositors and recipients can manage escrows via <code className="text-purple-200">/escrow/manage?id=xxx&token=yyy</code>. This endpoint authenticates the token and returns available actions based on your role and escrow status.
                </p>
              </div>
            </ApiEndpoint>

            <ApiEndpoint method="POST" path="/api/escrow/:id/release" description="Release funds to the beneficiary. Only the depositor (via release_token) can do this. Escrow must be in 'funded' or 'disputed' status.">
              <CodeBlock title="Request Body">
{`{
  "release_token": "esc_abc123..."
}`}
              </CodeBlock>

              <CodeBlock title="Response">
{`{
  "success": true,
  "escrow": {
    "id": "a1b2c3d4-...",
    "status": "released",
    "released_at": "2024-01-02T12:00:00Z",
    ...
  }
}`}
              </CodeBlock>
              <p className="text-gray-400 text-sm mt-2">
                After release, the cron monitor triggers on-chain settlement — funds are forwarded to the beneficiary minus the platform fee.
              </p>
            </ApiEndpoint>

            <ApiEndpoint method="POST" path="/api/escrow/:id/refund" description="Request a refund. Only the depositor (via release_token) can do this. Escrow must be in 'funded' status. Full amount is returned (no fee).">
              <CodeBlock title="Request Body">
{`{
  "release_token": "esc_abc123..."
}`}
              </CodeBlock>
            </ApiEndpoint>

            <ApiEndpoint method="POST" path="/api/escrow/:id/dispute" description="Open a dispute. Either party can do this (depositor via release_token, beneficiary via beneficiary_token). Escrow must be in 'funded' status.">
              <CodeBlock title="Request Body">
{`{
  "token": "esc_abc123...",
  "reason": "Work was not delivered as agreed upon in the contract"
}`}
              </CodeBlock>
              <p className="text-gray-400 text-sm mt-2">
                Dispute reason must be at least 10 characters. Disputed escrows can still be released by the depositor or resolved by an arbiter.
              </p>
            </ApiEndpoint>

            <ApiEndpoint method="GET" path="/api/escrow/:id/events" description="Get the audit log for an escrow — all status changes, deposits, releases, disputes, and settlements.">
              <CodeBlock title="Response">
{`{
  "success": true,
  "events": [
    {
      "id": "evt-1",
      "escrow_id": "a1b2c3d4-...",
      "event_type": "created",
      "actor": "0xAlice...",
      "details": { "chain": "ETH", "amount": 0.5 },
      "created_at": "2024-01-01T12:00:00Z"
    },
    {
      "id": "evt-2",
      "event_type": "funded",
      "actor": "system",
      "details": { "deposited_amount": 0.5, "tx_hash": "0x..." },
      "created_at": "2024-01-01T13:00:00Z"
    }
  ]
}`}
              </CodeBlock>
            </ApiEndpoint>

            <h3 className="text-xl font-semibold text-white mt-8 mb-4">SDK &amp; CLI</h3>
            <CodeBlock title="Node.js SDK" language="javascript">
{`import { CoinPayClient } from '@profullstack/coinpay';

const client = new CoinPayClient({ apiKey: 'YOUR_API_KEY' });

// Create escrow
const escrow = await client.createEscrow({
  chain: 'SOL',
  amount: 10,
  depositor_address: 'Alice...',
  beneficiary_address: 'Bob...',
});
console.log('Deposit to:', escrow.escrow_address);
console.log('Release token:', escrow.release_token);

// Check status
const status = await client.getEscrow(escrow.id);

// Release funds
await client.releaseEscrow(escrow.id, escrow.release_token);

// Wait for settlement
const settled = await client.waitForEscrow(escrow.id, 'settled');`}
            </CodeBlock>

            <CodeBlock title="CLI" language="bash">
{`# Create escrow
coinpay escrow create --chain SOL --amount 10 \\
  --depositor Alice... --beneficiary Bob...

# Check status
coinpay escrow get <escrow_id>

# List escrows
coinpay escrow list --status funded

# Release funds
coinpay escrow release <escrow_id> --token esc_abc123...

# Refund
coinpay escrow refund <escrow_id> --token esc_abc123...

# Open dispute
coinpay escrow dispute <escrow_id> --token esc_def456... \\
  --reason "Work not delivered as agreed"

# View audit log
coinpay escrow events <escrow_id>`}
            </CodeBlock>
          </DocSection>
        </div>

        {/* Recurring Escrow */}
        <div id="recurring-escrow">
          <DocSection title="Recurring Escrow Series">
            <p className="text-gray-300 mb-6">
              Recurring escrow series automate periodic escrow payments for ongoing work — freelance retainers, 
              milestone-based projects, or any situation where you need regular, trustless payments. 
              Supports both <strong className="text-purple-400">crypto</strong> and <strong className="text-purple-400">credit card</strong> payments.
            </p>

            <div className="mb-8 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <h4 className="font-semibold text-amber-300 mb-2">How Recurring Escrow Works</h4>
              <ol className="text-amber-200 text-sm space-y-1 list-decimal list-inside">
                <li><strong>Create Series</strong> — Define the amount, interval (weekly/biweekly/monthly), payment method, and beneficiary.</li>
                <li><strong>Auto-Charge</strong> — The payment monitor daemon automatically creates and funds a new escrow each period. No cron needed.</li>
                <li><strong>Individual Release</strong> — The merchant reviews and releases each escrow individually when work is delivered.</li>
                <li><strong>Manage Anytime</strong> — Pause, resume, or cancel the series at any time.</li>
              </ol>
            </div>

            <div className="mb-8 grid md:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-slate-800/50 border border-white/10">
                <h4 className="font-semibold text-white mb-2">Supported Intervals</h4>
                <div className="text-gray-300 text-sm space-y-1">
                  <p><code className="text-purple-400">weekly</code> — Every 7 days</p>
                  <p><code className="text-purple-400">biweekly</code> — Every 14 days</p>
                  <p><code className="text-purple-400">monthly</code> — Every calendar month</p>
                </div>
              </div>
              <div className="p-4 rounded-lg bg-slate-800/50 border border-white/10">
                <h4 className="font-semibold text-white mb-2">Payment Methods</h4>
                <div className="text-gray-300 text-sm space-y-1">
                  <p><code className="text-purple-400">crypto</code> — On-chain escrow (BTC, ETH, SOL, POL, USDC, etc.)</p>
                  <p><code className="text-purple-400">card</code> — Stripe Connect card payments held in escrow</p>
                </div>
              </div>
            </div>

            <div className="mb-8 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
              <h4 className="font-semibold text-green-300 mb-2">Integrated Daemon — No Cron Needed</h4>
              <p className="text-green-200 text-sm">
                Recurring escrow is powered by the built-in payment monitor daemon. When a series is active, 
                the monitor automatically creates and charges new escrows at each interval. 
                Each child escrow follows the standard escrow lifecycle (created → funded → released → settled).
              </p>
            </div>

            <h3 className="text-xl font-semibold text-white mb-4">Series Statuses</h3>
            <div className="grid md:grid-cols-3 gap-4 mb-8">
              {[
                { status: 'active', desc: 'Series is running, auto-charges each period', color: 'green' },
                { status: 'paused', desc: 'Temporarily stopped, can resume', color: 'yellow' },
                { status: 'completed', desc: 'All periods fulfilled (max_periods reached)', color: 'blue' },
                { status: 'cancelled', desc: 'Permanently stopped by user', color: 'red' },
              ].map((item) => (
                <div key={item.status} className="p-3 rounded-lg bg-slate-800/50">
                  <code className={`text-${item.color}-400 font-mono`}>{item.status}</code>
                  <p className="text-gray-300 text-sm mt-1">{item.desc}</p>
                </div>
              ))}
            </div>

            <ApiEndpoint method="POST" path="/api/escrow/series" description="Create a new recurring escrow series. Requires authentication.">
              <CodeBlock title="Request Body">
{`{
  "business_id": "uuid",
  "payment_method": "crypto",          // "crypto" or "card"
  "customer_email": "client@example.com",
  "description": "Weekly retainer — frontend development",
  "amount": 500,
  "currency": "USD",
  "coin": "USDC_SOL",                  // Required for crypto method
  "interval": "weekly",                // "weekly", "biweekly", "monthly"
  "max_periods": 12,                   // Optional: auto-complete after N periods
  "beneficiary_address": "0xBob...",   // Required for crypto method
  "stripe_account_id": "acct_..."      // Required for card method
}`}
              </CodeBlock>

              <CodeBlock title="Response (201 Created)">
{`{
  "id": "series_abc123",
  "business_id": "uuid",
  "payment_method": "crypto",
  "status": "active",
  "interval": "weekly",
  "amount": 500,
  "currency": "USD",
  "coin": "USDC_SOL",
  "periods_completed": 0,
  "max_periods": 12,
  "next_charge_at": "2024-01-08T00:00:00Z",
  "created_at": "2024-01-01T00:00:00Z"
}`}
              </CodeBlock>
            </ApiEndpoint>

            <ApiEndpoint method="GET" path="/api/escrow/series?business_id=uuid&status=active" description="List escrow series for a business. Optionally filter by status.">
              <CodeBlock title="Response">
{`{
  "series": [
    {
      "id": "series_abc123",
      "status": "active",
      "interval": "weekly",
      "amount": 500,
      "currency": "USD",
      "periods_completed": 3,
      "max_periods": 12,
      "next_charge_at": "2024-01-22T00:00:00Z"
    }
  ],
  "total": 1
}`}
              </CodeBlock>
            </ApiEndpoint>

            <ApiEndpoint method="GET" path="/api/escrow/series/:id" description="Get series details including all child escrows.">
              <CodeBlock title="Response">
{`{
  "series": { "id": "series_abc123", "status": "active", ... },
  "escrows": [
    { "id": "esc_1", "status": "settled", "amount": 500, "period": 1 },
    { "id": "esc_2", "status": "released", "amount": 500, "period": 2 },
    { "id": "esc_3", "status": "funded", "amount": 500, "period": 3 }
  ]
}`}
              </CodeBlock>
            </ApiEndpoint>

            <ApiEndpoint method="PATCH" path="/api/escrow/series/:id" description="Update a series — pause, resume, or change amount.">
              <CodeBlock title="Request Body">
{`{
  "status": "paused",    // "paused" or "active" (to resume)
  "amount": 600          // Optional: change amount for future periods
}`}
              </CodeBlock>
            </ApiEndpoint>

            <ApiEndpoint method="DELETE" path="/api/escrow/series/:id" description="Cancel a series permanently. In-flight escrows are not affected.">
              <CodeBlock title="Response">
{`{
  "success": true,
  "series": { "id": "series_abc123", "status": "cancelled" }
}`}
              </CodeBlock>
            </ApiEndpoint>
          </DocSection>
        </div>

        {/* Exchange Rates */}
        <div id="rates">
          <DocSection title="Exchange Rates">
            <p className="text-gray-300 mb-6">
              Get real-time cryptocurrency exchange rates in multiple fiat currencies. Used for price conversion and fiat amount support.
            </p>

            <ApiEndpoint method="GET" path="/api/rates" description="Get exchange rates for cryptocurrencies with multi-fiat support.">
              <h4 className="text-lg font-semibold text-white mb-2">Query Parameters</h4>
              <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto mb-4">
                <div className="space-y-2 text-sm text-gray-300">
                  <p><code className="text-purple-400">coin</code> - Single cryptocurrency code (e.g., BTC, ETH, SOL)</p>
                  <p><code className="text-purple-400">coins</code> - Comma-separated list of cryptocurrency codes</p>
                  <p><code className="text-purple-400">fiat</code> - Target fiat currency (default: USD)</p>
                </div>
              </div>

              <h4 className="text-lg font-semibold text-white mb-2">Supported Fiat Currencies</h4>
              <div className="grid md:grid-cols-5 gap-3 mb-6">
                {[
                  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 
                  'JPY', 'CHF', 'CNY', 'INR', 'BRL'
                ].map((currency) => (
                  <div key={currency} className="p-2 rounded bg-slate-800/50 border border-white/10 text-center">
                    <code className="text-purple-400 font-mono">{currency}</code>
                  </div>
                ))}
              </div>

              <CodeBlock title="Single Rate Example" language="curl">
{`# Get SOL price in EUR
curl "https://coinpayportal.com/api/rates?coin=SOL&fiat=EUR"`}
              </CodeBlock>

              <CodeBlock title="Multiple Rates Example" language="curl">
{`# Get multiple cryptocurrency rates in USD (default)
curl "https://coinpayportal.com/api/rates?coins=BTC,ETH,SOL"

# Get multiple rates in EUR
curl "https://coinpayportal.com/api/rates?coins=BTC,ETH,SOL&fiat=EUR"`}
              </CodeBlock>

              <CodeBlock title="Single Rate Response">
{`{
  "success": true,
  "coin": "SOL",
  "rate": 185.42,
  "fiat": "EUR",
  "cached": true,
  "timestamp": "2024-01-15T10:30:00Z"
}`}
              </CodeBlock>

              <CodeBlock title="Multiple Rates Response">
{`{
  "success": true,
  "rates": {
    "BTC": 42350.80,
    "ETH": 2580.45,
    "SOL": 185.42
  },
  "fiat": "EUR",
  "timestamp": "2024-01-15T10:30:00Z"
}`}
              </CodeBlock>

              <CodeBlock title="Node.js Example" language="javascript">
{`// Get single rate
const response = await fetch('https://coinpayportal.com/api/rates?coin=SOL&fiat=EUR');
const data = await response.json();
console.log(\`1 SOL = €\${data.rate}\`);

// Get multiple rates  
const multiResponse = await fetch('https://coinpayportal.com/api/rates?coins=BTC,ETH,SOL&fiat=GBP');
const multiData = await multiResponse.json();
console.log(\`BTC: £\${multiData.rates.BTC}\`);`}
              </CodeBlock>

              <div className="mt-4 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                <p className="text-green-300 text-sm">
                  <strong>Integration:</strong> This API powers fiat amount support in the SDK and CLI. When you specify <code className="text-green-200">--amount-fiat 50 --fiat EUR</code>, it automatically converts to the required crypto amount using these rates.
                </p>
              </div>
            </ApiEndpoint>
          </DocSection>
        </div>

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
  "currency": "usdc_pol",  // See currency options below
  "description": "Order #12345",  // optional
  "redirect_url": "https://yoursite.com/success"  // optional - redirect after payment
}`}
              </CodeBlock>

              <h4 className="text-lg font-semibold text-white mb-2 mt-4">Currency Options</h4>
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div className="p-3 rounded-lg bg-slate-800/50">
                  <h5 className="font-semibold text-green-400 mb-2">Low Fee Options (Recommended)</h5>
                  <div className="space-y-1 text-sm text-gray-300">
                    <p><code className="text-purple-400">usdc_pol</code> - USDC on Polygon (~$0.01 fee)</p>
                    <p><code className="text-purple-400">usdc_sol</code> - USDC on Solana (~$0.001 fee)</p>
                    <p><code className="text-purple-400">pol</code> - Polygon native (~$0.01 fee)</p>
                    <p><code className="text-purple-400">sol</code> - Solana native (~$0.001 fee)</p>
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/50">
                  <h5 className="font-semibold text-yellow-400 mb-2">Higher Fee Options</h5>
                  <div className="space-y-1 text-sm text-gray-300">
                    <p><code className="text-purple-400">btc</code> - Bitcoin (~$2-3 fee)</p>
                    <p><code className="text-purple-400">eth</code> - Ethereum (~$3-5 fee)</p>
                    <p><code className="text-purple-400">usdc_eth</code> - USDC on Ethereum (~$3-5 fee)</p>
                    <p><code className="text-purple-400">usdt</code> - USDT on Ethereum (~$3-5 fee)</p>
                  </div>
                </div>
              </div>

              <div className="mb-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-blue-300 text-sm">
                  <strong>Tip:</strong> Network fees are added to ensure merchants receive the full amount. Use <code className="text-blue-200">usdc_pol</code> or <code className="text-blue-200">usdc_sol</code> for the lowest customer fees while still accepting stablecoins.
                </p>
              </div>

              <CodeBlock title="cURL Example with redirect_url" language="curl">
{`curl -X POST https://coinpayportal.com/api/payments/create \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "business_id": "business-123",
    "amount_usd": 100.00,
    "currency": "usdc_pol",
    "redirect_url": "https://yoursite.com/order/success?id=12345"
  }'`}
              </CodeBlock>

              <CodeBlock title="Response">
{`{
  "success": true,
  "payment": {
    "id": "payment-456",
    "business_id": "business-123",
    "amount_usd": "100.00",
    "amount_crypto": "100.50",
    "currency": "usdc_pol",
    "payment_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "status": "pending",
    "metadata": {
      "network_fee_usd": 0.50,
      "total_amount_usd": 100.50,
      "redirect_url": "https://yoursite.com/order/success?id=12345"
    },
    "created_at": "2024-01-01T12:00:00Z",
    "expires_at": "2024-01-01T12:15:00Z"
  }
}`}
              </CodeBlock>

              <div className="mt-4 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                <h4 className="font-semibold text-green-400 mb-2">Auto-Redirect After Payment</h4>
                <p className="text-green-300 text-sm">
                  When <code className="text-green-200">redirect_url</code> is provided, customers are automatically redirected back to your site 5 seconds after payment completion. A &quot;Return to Merchant&quot; button is also shown for immediate redirect.
                </p>
              </div>
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
          <h3 className="text-xl font-semibold text-white mb-4">Native Cryptocurrencies</h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { name: 'Bitcoin', symbol: 'BTC', code: 'btc', confirmations: 3, fee: '~$2-3' },
              { name: 'Ethereum', symbol: 'ETH', code: 'eth', confirmations: 12, fee: '~$3-5' },
              { name: 'Polygon', symbol: 'POL', code: 'pol', confirmations: 128, fee: '~$0.01' },
              { name: 'Solana', symbol: 'SOL', code: 'sol', confirmations: 32, fee: '~$0.001' },
            ].map((crypto) => (
              <div key={crypto.symbol} className="p-4 rounded-lg bg-slate-800/50 border border-white/10">
                <div className="font-semibold text-white mb-1">{crypto.name}</div>
                <div className="text-purple-400 font-mono text-sm mb-2">{crypto.symbol}</div>
                <div className="text-gray-400 text-xs">Code: <code className="text-purple-300">{crypto.code}</code></div>
                <div className="text-gray-400 text-xs">Confirmations: {crypto.confirmations}</div>
                <div className="text-gray-400 text-xs">Network Fee: <span className="text-green-400">{crypto.fee}</span></div>
              </div>
            ))}
          </div>

          <h3 className="text-xl font-semibold text-white mb-4">USDC Stablecoin (Multi-Chain)</h3>
          <div className="grid md:grid-cols-3 gap-4 mb-4">
            {[
              { name: 'USDC on Polygon', code: 'usdc_pol', fee: '~$0.01', recommended: true },
              { name: 'USDC on Solana', code: 'usdc_sol', fee: '~$0.001', recommended: true },
              { name: 'USDC on Ethereum', code: 'usdc_eth', fee: '~$3-5', recommended: false },
            ].map((crypto) => (
              <div key={crypto.code} className={`p-4 rounded-lg border ${crypto.recommended ? 'bg-green-500/10 border-green-500/30' : 'bg-slate-800/50 border-white/10'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <div className="font-semibold text-white">{crypto.name}</div>
                  {crypto.recommended && <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">Low Fee</span>}
                </div>
                <div className="text-purple-400 font-mono text-sm mb-2">{crypto.code}</div>
                <div className="text-gray-400 text-xs">Network Fee: <span className={crypto.recommended ? 'text-green-400' : 'text-yellow-400'}>{crypto.fee}</span></div>
              </div>
            ))}
          </div>
          <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <p className="text-blue-300 text-sm">
              <strong>Recommendation:</strong> Use <code className="text-blue-200">usdc_pol</code> or <code className="text-blue-200">usdc_sol</code> for the lowest fees while accepting stable USD-pegged payments.
            </p>
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
                { event: 'payment.confirmed', description: 'Payment confirmed on blockchain — safe to fulfill order' },
                { event: 'payment.forwarded', description: 'Funds forwarded to your merchant wallet' },
                { event: 'payment.expired', description: 'Payment request expired (15 minute window)' },
                { event: 'escrow.created', description: 'New escrow created' },
                { event: 'escrow.funded', description: 'Escrow deposit detected on-chain' },
                { event: 'escrow.released', description: 'Depositor released funds to beneficiary' },
                { event: 'escrow.settled', description: 'Funds forwarded on-chain to beneficiary' },
                { event: 'escrow.refunded', description: 'Funds returned to depositor' },
                { event: 'escrow.disputed', description: 'Dispute opened on escrow' },
                { event: 'test.webhook', description: 'Test webhook (sent from dashboard)' },
              ].map((webhook) => (
                <div key={webhook.event} className="p-4 rounded-lg bg-slate-800/50">
                  <code className="text-purple-400 font-mono">{webhook.event}</code>
                  <p className="text-gray-300 mt-2">{webhook.description}</p>
                </div>
              ))}
            </div>

            <h3 className="text-xl font-semibold text-white mb-4">Payload Structure</h3>
            <p className="text-gray-300 mb-4">All webhook events use this SDK-compliant nested structure:</p>
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-2 text-gray-300">Field</th>
                    <th className="text-left py-2 text-gray-300">Type</th>
                    <th className="text-left py-2 text-gray-300">Description</th>
                  </tr>
                </thead>
                <tbody className="text-gray-400">
                  <tr className="border-b border-slate-800"><td className="py-2"><code className="text-purple-400">id</code></td><td>string</td><td>Unique event ID (evt_paymentId_timestamp)</td></tr>
                  <tr className="border-b border-slate-800"><td className="py-2"><code className="text-purple-400">type</code></td><td>string</td><td>Event type (payment.confirmed, etc.)</td></tr>
                  <tr className="border-b border-slate-800"><td className="py-2"><code className="text-purple-400">data</code></td><td>object</td><td>Event data (see below)</td></tr>
                  <tr className="border-b border-slate-800"><td className="py-2"><code className="text-purple-400">created_at</code></td><td>string</td><td>ISO 8601 timestamp</td></tr>
                  <tr><td className="py-2"><code className="text-purple-400">business_id</code></td><td>string</td><td>Your business ID</td></tr>
                </tbody>
              </table>
            </div>

            <h4 className="text-lg font-semibold text-white mb-2">Data Object Fields</h4>
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-2 text-gray-300">Field</th>
                    <th className="text-left py-2 text-gray-300">Type</th>
                    <th className="text-left py-2 text-gray-300">Description</th>
                  </tr>
                </thead>
                <tbody className="text-gray-400">
                  <tr className="border-b border-slate-800"><td className="py-2"><code className="text-purple-400">payment_id</code></td><td>string</td><td>Payment identifier</td></tr>
                  <tr className="border-b border-slate-800"><td className="py-2"><code className="text-purple-400">status</code></td><td>string</td><td>Payment status</td></tr>
                  <tr className="border-b border-slate-800"><td className="py-2"><code className="text-purple-400">amount_crypto</code></td><td>string</td><td>Amount in crypto</td></tr>
                  <tr className="border-b border-slate-800"><td className="py-2"><code className="text-purple-400">amount_usd</code></td><td>string</td><td>Amount in USD</td></tr>
                  <tr className="border-b border-slate-800"><td className="py-2"><code className="text-purple-400">currency</code></td><td>string</td><td>Blockchain (ETH, BTC, etc.)</td></tr>
                  <tr className="border-b border-slate-800"><td className="py-2"><code className="text-purple-400">payment_address</code></td><td>string</td><td>Payment address</td></tr>
                  <tr className="border-b border-slate-800"><td className="py-2"><code className="text-purple-400">tx_hash</code></td><td>string</td><td>Transaction hash (when available)</td></tr>
                  <tr><td className="py-2"><code className="text-purple-400">metadata</code></td><td>object</td><td>Custom data passed during payment creation (order_id, customer info, etc.)</td></tr>
                </tbody>
              </table>
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

            <h3 className="text-xl font-semibold text-white mb-4">payment.confirmed Payload</h3>
            <p className="text-gray-400 text-sm mb-2">Sent when payment is confirmed. Safe to fulfill the order.</p>
            <CodeBlock>
{`{
  "id": "evt_pay_abc123_1705315800",
  "type": "payment.confirmed",
  "data": {
    "payment_id": "pay_abc123",
    "status": "confirmed",
    "amount_crypto": "0.05",
    "amount_usd": "150.00",
    "currency": "ETH",
    "payment_address": "0x1234...5678",
    "tx_hash": "0xabc...def",
    "received_amount": "0.05",
    "confirmed_at": "2024-01-15T10:30:00Z",
    "metadata": {
      "order_id": "order_12345",
      "customer_email": "customer@example.com"
    }
  },
  "created_at": "2024-01-15T10:30:00Z",
  "business_id": "biz_xyz789"
}`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mt-6 mb-4">payment.forwarded Payload</h3>
            <p className="text-gray-400 text-sm mb-2">Sent when funds are forwarded to your wallet. Includes transaction hashes.</p>
            <CodeBlock>
{`{
  "id": "evt_pay_abc123_1705316100",
  "type": "payment.forwarded",
  "data": {
    "payment_id": "pay_abc123",
    "status": "forwarded",
    "amount_crypto": "0.05",
    "amount_usd": "150.00",
    "currency": "ETH",
    "merchant_amount": 0.049,
    "platform_fee": 0.001,
    "tx_hash": "0xmerchant123...",
    "merchant_tx_hash": "0xmerchant123...",
    "platform_tx_hash": "0xplatform456...",
    "metadata": {
      "order_id": "order_12345",
      "customer_email": "customer@example.com"
    }
  },
  "created_at": "2024-01-15T10:35:00Z",
  "business_id": "biz_xyz789"
}`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mt-6 mb-4">payment.expired Payload</h3>
            <p className="text-gray-400 text-sm mb-2">Sent when payment expires without receiving funds.</p>
            <CodeBlock>
{`{
  "id": "evt_pay_abc123_1705316700",
  "type": "payment.expired",
  "data": {
    "payment_id": "pay_abc123",
    "status": "expired",
    "amount_crypto": "0.05",
    "amount_usd": "150.00",
    "currency": "ETH",
    "reason": "Payment window expired (15 minutes)",
    "expired_at": "2024-01-15T10:45:00Z"
  },
  "created_at": "2024-01-15T10:45:00Z",
  "business_id": "biz_xyz789"
}`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mt-8 mb-4">Verifying Webhook Signatures</h3>
            <p className="text-gray-300 mb-4">
              The signature is computed as <code className="text-purple-400">HMAC-SHA256(timestamp.rawBody, secret)</code> where rawBody is the exact JSON string received.
            </p>
            <CodeBlock title="JavaScript/Node.js Example" language="javascript">
{`import crypto from 'crypto';

function verifyWebhookSignature(rawBody, signatureHeader, secret) {
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

  // Compute expected signature using raw body string
  const signedPayload = \`\${timestamp}.\${rawBody}\`;
  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  // Timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(computedSignature, 'hex')
  );
}

// Express.js example
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString();
  const signature = req.headers['x-coinpay-signature'];

  if (!verifyWebhookSignature(rawBody, signature, process.env.WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = JSON.parse(rawBody);

  // Handle the event
  switch (event.type) {
    case 'payment.confirmed':
      // Fulfill the order
      console.log('Payment confirmed:', event.data.payment_id);
      break;
    case 'payment.forwarded':
      // Funds forwarded to your wallet
      console.log('Funds forwarded:', event.data.merchant_tx_hash);
      break;
  }

  res.json({ received: true });
});`}
            </CodeBlock>

            <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <p className="text-yellow-300 text-sm">
                <strong>Important:</strong> Always use the <strong>raw request body string</strong> for signature verification. Do not parse and re-stringify the JSON, as whitespace differences will cause signature mismatches. Use <code className="text-yellow-200">express.raw()</code> or equivalent middleware.
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
                <p>• <strong>Starter (free):</strong> 1% per transaction &amp; escrow release</p>
                <p>• <strong>Professional ($49/mo):</strong> 0.5% per transaction &amp; escrow release</p>
                <p>• <strong>Escrow Refunds:</strong> No fee (full amount returned)</p>
                <p>• <strong>Network Fees:</strong> Paid by customer</p>
                <p>• <strong>Minimum Payment:</strong> $1.00 USD</p>
              </div>
            </div>
          </div>
        </DocSection>

        {/* Reputation & DID */}
        <div id="reputation">
          <ReputationDocs />
        </div>

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