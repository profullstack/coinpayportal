import Link from 'next/link';
import { DocSection } from '@/components/docs/DocSection';
import { CodeBlock } from '@/components/docs/CodeBlock';

export default function SDKDocsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-4 mb-6">
            <Link href="/docs" className="inline-flex items-center text-purple-400 hover:text-purple-300">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to API Docs
            </Link>
          </div>
          <h1 className="text-5xl font-bold text-white mb-4">
            SDK Documentation
          </h1>
          <p className="text-xl text-gray-300">
            @profullstack/coinpay - Node.js SDK &amp; CLI for cryptocurrency payments
          </p>
          <div className="mt-4 flex gap-4">
            <a
              href="https://www.npmjs.com/package/@profullstack/coinpay"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
                <path d="M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.667h5.331v5.331zm4 0v1.336H8.001V8.667h5.334v5.332h-2.669v-.001zm12.001 0h-1.33v-4h-1.336v4h-1.335v-4h-1.33v4h-2.671V8.667h8.002v5.331z"/>
              </svg>
              npm
            </a>
            <a
              href="https://github.com/profullstack/coinpayportal"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              GitHub
            </a>
          </div>
        </div>

        {/* Table of Contents */}
        <nav className="mb-12 p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
          <h2 className="text-xl font-bold text-white mb-4">Quick Navigation</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { name: 'Installation', href: '#installation' },
              { name: 'Quick Start', href: '#quick-start' },
              { name: 'SDK Client', href: '#sdk-client' },
              { name: 'Payments API', href: '#payments' },
              { name: 'Credit Card Payments', href: '#card-payments' },
              { name: 'Businesses API', href: '#businesses' },
              { name: 'Escrow API', href: '#escrow' },
              { name: 'Recurring Escrow', href: '#recurring-escrow' },
              { name: 'Exchange Rates', href: '#rates' },
              { name: 'Webhook Verification', href: '#webhooks' },
              { name: 'CLI Commands', href: '#cli' },
              { name: 'Account & Auth', href: '#auth' },
              { name: 'Reputation & DID', href: '#reputation' },
              { name: 'Error Handling', href: '#errors' },
            ].map((item) => (
              <a
                key={item.name}
                href={item.href}
                className="text-purple-400 hover:text-purple-300 text-sm"
              >
                → {item.name}
              </a>
            ))}
          </div>
        </nav>

        {/* Installation */}
        <div id="installation">
          <DocSection title="Installation">
            <p className="text-gray-300 mb-6">
              Install the CoinPay SDK using your preferred package manager:
            </p>

            <CodeBlock title="Using pnpm (recommended)" language="bash">
{`pnpm add @profullstack/coinpay`}
            </CodeBlock>

            <CodeBlock title="Using npm" language="bash">
{`npm install @profullstack/coinpay`}
            </CodeBlock>

            <CodeBlock title="Global CLI Installation" language="bash">
{`# Install globally for CLI access
pnpm add -g @profullstack/coinpay

# Or with npm
npm install -g @profullstack/coinpay`}
            </CodeBlock>

            <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-blue-300 text-sm">
                <strong>Requirements:</strong> Node.js 20+ with ESM support
              </p>
            </div>
          </DocSection>
        </div>

        {/* Quick Start */}
        <div id="quick-start">
          <DocSection title="Quick Start">
            <div className="mb-8 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
              <h4 className="text-purple-300 font-semibold mb-2">How CoinPay Works</h4>
              <ol className="text-gray-300 text-sm space-y-1 list-decimal list-inside">
                <li>Your server calls the CoinPay API to create a payment request</li>
                <li>CoinPay generates a unique payment address and QR code</li>
                <li>Your customer sends cryptocurrency to that address</li>
                <li>CoinPay monitors the blockchain and notifies you via webhook</li>
                <li>Funds are automatically forwarded to your wallet (minus fees)</li>
              </ol>
            </div>

            <h3 className="text-xl font-semibold text-white mb-4">SDK Usage</h3>
            <CodeBlock title="Basic SDK Example" language="javascript">
{`import { CoinPayClient, Blockchain } from '@profullstack/coinpay';

// Initialize with your API key (get it from your dashboard)
const coinpay = new CoinPayClient({
  apiKey: 'cp_live_your_api_key_here',
});

// Create a payment when customer checks out
const result = await coinpay.createPayment({
  businessId: 'your-business-id',  // From your dashboard
  amount: 100,                      // Amount in fiat currency
  currency: 'USD',                  // Fiat currency (default: USD)
  blockchain: Blockchain.BTC,       // Cryptocurrency to accept
  description: 'Order #12345',      // Shown to customer
  metadata: {                       // Your custom data
    orderId: '12345',
    customerEmail: 'customer@example.com'
  }
});

// Display to customer
console.log('Send payment to:', result.payment.payment_address);
console.log('Amount:', result.payment.crypto_amount, result.payment.blockchain);
console.log('QR Code:', result.payment.qr_code);`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">cURL Example</h3>
            <CodeBlock title="Direct API Call" language="bash">
{`curl -X POST https://coinpayportal.com/api/payments/create \\
  -H "Authorization: Bearer cp_live_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "business_id": "your-business-id",
    "amount": 100,
    "blockchain": "BTC",
    "description": "Order #12345",
    "metadata": {"orderId": "12345"}
  }'`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">CLI Usage</h3>
            <CodeBlock title="CLI Quick Start" language="bash">
{`# Configure your API key (one-time setup)
coinpay config set-key cp_live_your_api_key

# Create a Bitcoin payment
coinpay payment create --business-id biz_123 --amount 100 --blockchain BTC

# Create an Ethereum payment with description
coinpay payment create --business-id biz_123 --amount 50 --blockchain ETH --description "Order #12345"

# Create a USDC payment on Polygon
coinpay payment create --business-id biz_123 --amount 25 --blockchain USDC_POL

# Send with fiat amount (wallet commands)
coinpay wallet send --chain SOL --to abc... --amount-fiat 10 --fiat USD
coinpay wallet send --chain ETH --to 0x123... --amount-fiat 25 --fiat EUR

# Get payment details
coinpay payment get pay_abc123

# List payments
coinpay payment list --business-id biz_123

# Get exchange rates with fiat support
coinpay rates get BTC --fiat USD
coinpay rates get SOL --fiat EUR`}
            </CodeBlock>
          </DocSection>
        </div>

        {/* SDK Client */}
        <div id="sdk-client">
          <DocSection title="SDK Client Configuration">
            <p className="text-gray-300 mb-6">
              Initialize the CoinPayClient with your API key from your business dashboard:
            </p>

            <CodeBlock title="Client Initialization" language="javascript">
{`import { CoinPayClient } from '@profullstack/coinpay';

const client = new CoinPayClient({
  // Required: Your API key (starts with cp_live_)
  apiKey: 'cp_live_your_api_key_here',
  
  // Optional: Custom API URL (defaults to https://coinpayportal.com/api)
  baseUrl: 'https://coinpayportal.com/api',
  
  // Optional: Request timeout in milliseconds (default: 30000)
  timeout: 30000,
});`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Environment Variables</h3>
            <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-white/10">
                    <th className="pb-2">Variable</th>
                    <th className="pb-2">Description</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  <tr className="border-b border-white/5">
                    <td className="py-2"><code className="text-purple-400">COINPAY_API_KEY</code></td>
                    <td className="py-2">API key (overrides config file)</td>
                  </tr>
                  <tr>
                    <td className="py-2"><code className="text-purple-400">COINPAY_BASE_URL</code></td>
                    <td className="py-2">Custom API URL</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </DocSection>
        </div>

        {/* Payments API */}
        <div id="payments">
          <DocSection title="Payments API">
            <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-blue-300 text-sm">
                <strong>Primary Use Case:</strong> Call this API from your backend when a customer wants to pay with cryptocurrency.
                Display the returned payment address and QR code to your customer.
              </p>
            </div>

            <h3 className="text-xl font-semibold text-white mb-4">Create Payment</h3>
            <CodeBlock title="Create a new payment" language="javascript">
{`const result = await client.createPayment({
  businessId: 'your-business-id',  // Required: From your dashboard
  amount: 100,                      // Required: Amount in fiat
  currency: 'USD',                  // Optional: Fiat currency (default: USD)
  blockchain: 'BTC',                // Required: BTC, ETH, SOL, POL, BCH, USDC_ETH, USDC_POL, USDC_SOL
  description: 'Order #12345',      // Optional: Shown to customer
  metadata: {                       // Optional: Your custom data
    orderId: '12345',
    customerEmail: 'customer@example.com'
  }
});

// Response structure
console.log(result);
// {
//   success: true,
//   payment: {
//     id: 'pay_abc123',
//     payment_address: 'bc1q...',
//     crypto_amount: '0.00234567',
//     blockchain: 'BTC',
//     status: 'pending',
//     expires_at: '2024-01-01T13:00:00Z',
//     qr_code: 'data:image/png;base64,...'
//   },
//   usage: { current: 45, limit: 100, remaining: 55 }
// }`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Check Payment Status</h3>
            <p className="text-gray-300 mb-4">
              There are two ways to know when a payment is complete:
            </p>
            
            <h4 className="text-lg font-semibold text-purple-300 mb-3">Option 1: Polling (Simple)</h4>
            <CodeBlock title="Poll for payment status" language="javascript">
{`// Check status once
const result = await client.getPayment('pay_abc123');
console.log(result.payment.status); // 'pending', 'confirmed', 'forwarded', etc.

// Or wait for payment to complete (polls automatically)
const payment = await client.waitForPayment('pay_abc123', {
  interval: 5000,      // Check every 5 seconds
  timeout: 600000,     // Give up after 10 minutes
  onStatusChange: (status, payment) => {
    console.log(\`Status changed to: \${status}\`);
  }
});

if (payment.payment.status === 'confirmed' || payment.payment.status === 'forwarded') {
  console.log('Payment successful!');
} else {
  console.log('Payment failed or expired');
}`}
            </CodeBlock>

            <h4 className="text-lg font-semibold text-purple-300 mb-3 mt-6">Option 2: Webhooks (Recommended)</h4>
            <p className="text-gray-300 mb-4">
              Configure a webhook URL in your business settings to receive real-time notifications.
              See the <a href="#webhooks" className="text-purple-400 hover:text-purple-300">Webhook Verification</a> section below.
            </p>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">List Payments</h3>
            <CodeBlock title="List payments with filters" language="javascript">
{`const payments = await client.listPayments({
  businessId: 'biz_123',
  status: 'completed', // optional filter
  limit: 20,           // optional, default 50
  offset: 0,           // optional, for pagination
});

console.log(\`Found \${payments.length} payments\`);`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Get Payment QR Code</h3>
            <p className="text-gray-300 mb-4">
              The QR code endpoint returns binary PNG image data that can be used directly in HTML.
            </p>
            <CodeBlock title="QR code usage" language="javascript">
{`// Get QR code URL for use in HTML <img> tags
const qrUrl = client.getPaymentQRUrl('pay_abc123');
// Returns: "https://coinpayportal.com/api/payments/pay_abc123/qr"

// Use directly in HTML:
// <img src={qrUrl} alt="Payment QR Code" />

// Or fetch as binary data (for server-side processing)
const imageData = await client.getPaymentQR('pay_abc123');

// Save to file (Node.js)
import fs from 'fs';
fs.writeFileSync('payment-qr.png', Buffer.from(imageData));`}
            </CodeBlock>

            <CodeBlock title="HTML usage" language="html">
{`<!-- Use QR endpoint directly as image source -->
<img src="https://coinpayportal.com/api/payments/pay_abc123/qr" alt="Payment QR Code" />`}
            </CodeBlock>
          </DocSection>
        </div>

        {/* Credit Card Payments */}
        <div id="card-payments">
          <DocSection title="Credit Card Payments">
            <p className="text-gray-300 mb-6">
              Accept credit and debit card payments via Stripe Connect. Merchants must complete Stripe onboarding before accepting card payments.
              Supports both direct payments (gateway mode) and escrow mode for holding funds until release.
            </p>

            <div className="bg-blue-900/50 border border-blue-400/30 rounded-lg p-4 mb-6">
              <h4 className="text-blue-300 font-medium mb-2">🔗 Merchant Onboarding Required</h4>
              <p className="text-blue-200 text-sm">
                Before accepting card payments, merchants must complete Stripe Connect onboarding. 
                Use <code>createStripeOnboardingLink()</code> to generate the onboarding URL.
              </p>
            </div>

            <h3 className="text-xl font-semibold text-white mb-4">Customer Payment Choice Example</h3>
            <CodeBlock title="Let customers choose: Crypto OR Card" language="javascript">
{`import { CoinPayClient } from '@profullstack/coinpay';

const client = new CoinPayClient({ apiKey: 'your-api-key' });

// Check what payment methods are available
const support = await client.getPaymentMethodSupport('business-id');

if (support.cards) {
  // Customer can choose crypto OR card
  console.log('✅ Crypto payments available');
  console.log('✅ Card payments available');
  
  // Create card payment
  const cardPayment = await client.createCardPayment({
    businessId: 'biz_123',
    amount: 5000, // $50.00 in cents
    currency: 'usd',
    description: 'Order #12345',
    successUrl: 'https://yourstore.com/success',
    cancelUrl: 'https://yourstore.com/cancel'
  });
  
  // Redirect customer to: cardPayment.checkout_url
  
} else {
  console.log('✅ Crypto payments available');
  console.log('❌ Card payments require Stripe onboarding');
  
  // Only crypto payments available
  const cryptoPayment = await client.createPayment({
    businessId: 'biz_123',
    amount: 50.00,
    currency: 'USD',
    blockchain: 'BTC',
    description: 'Order #12345'
  });
}`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4">Merchant Stripe Onboarding</h3>
            <CodeBlock title="Create Stripe Connect onboarding link" language="javascript">
{`// Generate onboarding link for merchant
const onboarding = await client.createStripeOnboardingLink('business-id', {
  email: 'merchant@example.com',
  country: 'US'
});

console.log('Onboarding URL:', onboarding.onboarding_url);
// Redirect merchant to complete Stripe onboarding

// Check onboarding status
const status = await client.getStripeAccountStatus('business-id');
console.log('Can accept cards:', status.onboarding_complete);`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4">Create Card Payment</h3>
            <CodeBlock title="Create credit card payment" language="javascript">
{`// Gateway Mode - Direct payment to merchant
const payment = await client.createCardPayment({
  businessId: 'biz_123',
  amount: 5000, // $50.00 in cents
  currency: 'usd',
  description: 'Order #12345',
  metadata: { orderId: '12345', customerId: 'cust_456' },
  successUrl: 'https://yourstore.com/success',
  cancelUrl: 'https://yourstore.com/cancel',
  escrowMode: false // Direct payment (default)
});

// Redirect customer to payment.checkout_url for card entry`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4">Card Escrow Mode</h3>
            <CodeBlock title="Create card payment with escrow" language="javascript">
{`// Escrow Mode - Hold funds until release
const escrowPayment = await client.createCardPayment({
  businessId: 'biz_123',
  amount: 10000, // $100.00 in cents
  currency: 'usd',
  description: 'Freelance Work - Logo Design',
  escrowMode: true, // Hold funds in escrow
  metadata: { projectId: 'proj_789' }
});

// Customer pays via payment.checkout_url
// Funds are held until release

// Later, release funds to merchant
const release = await client.releaseCardEscrow(escrowPayment.escrow_id, 'Work completed successfully');
console.log(\`Released \$\${release.amount_transferred / 100} to merchant\`);`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4">Card Payment Convenience Functions</h3>
            <CodeBlock title="Using card-payments convenience module" language="javascript">
{`import { 
  createQuickCardPayment, 
  formatCardAmount,
  calculateCardPaymentFees
} from '@profullstack/coinpay/card-payments';

// Quick payment with USD amount (auto-converts to cents)
const payment = await createQuickCardPayment(client, 'biz_123', 50.0, 'Order #123', {
  metadata: { orderId: '123' },
  escrowMode: true
});

// Format amounts for display
console.log(formatCardAmount(5000)); // "$50.00"
console.log(formatCardAmount(5050, 'EUR')); // "€50.50"

// Calculate platform fees
const fees = calculateCardPaymentFees(5000, 'free'); // free tier = 1%
console.log(\`Platform fee: \$\${fees.platformFee / 100}\`); // "$0.50"
console.log(\`Merchant receives: \$\${fees.merchantReceives / 100}\`); // "$49.50"`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4">Webhook Events for Card Payments</h3>
            <CodeBlock title="Handle card payment webhooks" language="javascript">
{`// Webhook events you'll receive for card payments:
// - card_payment_success: Customer paid successfully
// - card_dispute_created: Customer disputed the charge
// - card_refund: Payment was refunded
// - card_escrow_release: Escrow funds were released to merchant

app.post('/webhook', (req, res) => {
  const { event_type, data } = req.body;
  
  switch (event_type) {
    case 'card_payment_success':
      console.log('Card payment received:', data.amount / 100);
      // Update order status, send confirmation email, etc.
      break;
      
    case 'card_dispute_created':
      console.log('Dispute created for payment:', data.stripe_payment_intent_id);
      // Alert merchant, gather evidence
      break;
      
    case 'card_escrow_release':
      console.log('Escrow released:', data.amount / 100);
      // Mark project as completed, notify freelancer
      break;
  }
  
  res.status(200).send('OK');
});`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4">Platform Fees</h3>
            <div className="bg-gray-900/50 border border-gray-600/30 rounded-lg p-4 mb-6">
              <h4 className="text-gray-300 font-medium mb-2">Platform Fee Structure</h4>
              <div className="text-sm text-gray-400 space-y-1">
                <div>• <strong>Free Tier:</strong> 1.0% platform fee</div>
                <div>• <strong>Pro Tier:</strong> 0.5% platform fee</div>
                <div>• <em>Plus Stripe processing fees (2.9% + 30¢ for US cards)</em></div>
              </div>
            </div>

            <h3 className="text-xl font-semibold text-white mb-4">Refunds</h3>
            <CodeBlock title="Refund card payments" language="javascript">
{`// Full refund
const refund = await client.refundCardPayment('payment-intent-id');

// Partial refund ($25 out of $50 payment)
const partialRefund = await client.refundCardPayment('payment-intent-id', {
  amount: 2500, // $25.00 in cents
  reason: 'Customer complaint - partial refund'
});

console.log('Refund status:', refund.status);`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4">Card Escrow — Release &amp; Refund</h3>
            <CodeBlock title="Release and refund card escrow" language="javascript">
{`// Release card escrow funds to merchant
const release = await client.releaseCardEscrow('escrow-id', 'Work completed successfully');
console.log(\`Transfer ID: \${release.transfer_id}\`);
console.log(\`Amount released: $\${(release.amount_transferred / 100).toFixed(2)}\`);

// Refund card escrow — full refund
const refund = await client.refundCardPayment('escrow-id');
console.log(\`Refund ID: \${refund.refund_id}\`);

// Refund card escrow — partial refund
const partialRefund = await client.refundCardPayment('escrow-id', {
  amount: 2500, // $25.00 in cents
  reason: 'Partial refund — item returned'
});
console.log(\`Refunded: $\${(partialRefund.amount_refunded / 100).toFixed(2)}\`);
console.log(\`Escrow status: \${partialRefund.escrow_status}\`); // 'partially_refunded'`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4">CLI Card Commands</h3>
            <CodeBlock title="Card payment CLI" language="bash">
{`# Create a card payment ($50.00 = 5000 cents)
coinpay card create --business-id biz_123 --amount 5000 --description "Order #123"

# Create card payment with escrow mode
coinpay card create --business-id biz_123 --amount 10000 --escrow --description "Freelance work"

# Get card payment details
coinpay card get pay_abc123

# List card payments for a business
coinpay card list --business-id biz_123

# Stripe Connect — onboard a merchant
coinpay card connect onboard merch_123 --email merchant@example.com --country US

# Stripe Connect — check onboarding status
coinpay card connect status merch_123

# Release card escrow funds
coinpay card escrow release esc_123 --reason "Work completed"

# Refund card escrow (full)
coinpay card escrow refund esc_123

# Refund card escrow (partial, $25)
coinpay card escrow refund esc_123 --amount 2500 --reason "Partial refund"`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4">Stripe Webhook Events</h3>
            <p className="text-gray-300 mb-4">
              The platform processes these Stripe webhook events automatically:
            </p>
            <div className="space-y-3 mb-6">
              {[
                { event: 'payment_intent.succeeded', description: 'Card payment completed — updates transaction record, funds escrow if applicable, creates DID reputation event' },
                { event: 'charge.dispute.created', description: 'Customer disputed a charge — creates dispute record, negative DID reputation impact (-50 weight)' },
                { event: 'payout.created', description: 'Stripe payout initiated to merchant bank account' },
                { event: 'payout.paid', description: 'Payout arrived in merchant bank account' },
                { event: 'account.updated', description: 'Stripe Connect account capabilities changed (charges_enabled, payouts_enabled, etc.)' },
              ].map((item) => (
                <div key={item.event} className="p-3 rounded-lg bg-slate-800/50 flex items-start gap-4">
                  <code className="text-purple-400 font-mono text-sm whitespace-nowrap">{item.event}</code>
                  <span className="text-gray-300 text-sm">{item.description}</span>
                </div>
              ))}
            </div>
          </DocSection>
        </div>

        {/* Businesses API */}
        <div id="businesses">
          <DocSection title="Businesses API">
            <h3 className="text-xl font-semibold text-white mb-4">Create Business</h3>
            <CodeBlock title="Create a new business" language="javascript">
{`const business = await client.createBusiness({
  name: 'My Store',
  webhookUrl: 'https://your-site.com/webhook',
  walletAddresses: {
    BTC: 'bc1q...',
    ETH: '0x...',
    SOL: '...',
  },
});

console.log(\`Business ID: \${business.id}\`);
console.log(\`API Key: \${business.apiKey}\`);`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Get Business</h3>
            <CodeBlock title="Retrieve business details" language="javascript">
{`const business = await client.getBusiness('biz_123');

console.log(business.name);
console.log(business.walletAddresses);`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">List Businesses</h3>
            <CodeBlock title="List all businesses" language="javascript">
{`const businesses = await client.listBusinesses();

businesses.forEach(biz => {
  console.log(\`\${biz.name}: \${biz.id}\`);
});`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Update Business</h3>
            <CodeBlock title="Update business settings" language="javascript">
{`const updated = await client.updateBusiness('biz_123', {
  name: 'Updated Store Name',
  webhookUrl: 'https://new-webhook-url.com/webhook',
});`}
            </CodeBlock>
          </DocSection>
        </div>

        {/* Escrow API */}
        <div id="escrow">
          <DocSection title="Escrow API">
            <p className="text-gray-300 mb-6">
              Create and manage trustless crypto escrows. No accounts required — authentication uses unique tokens returned at creation.
            </p>

            <h3 className="text-xl font-semibold text-white mb-4">Create Escrow</h3>
            <CodeBlock title="Create a new escrow (crypto amount)" language="javascript">
{`const escrow = await client.createEscrow({
  chain: 'ETH',
  amount: 0.5,
  depositorAddress: '0xAlice...',
  beneficiaryAddress: '0xBob...',
  expiresInHours: 48,  // optional (default: 24, max: 720)
  metadata: { order_id: '12345' },  // optional
});

console.log('Deposit to:', escrow.escrowAddress);
console.log('Release token:', escrow.releaseToken);      // Save this! Given to depositor
console.log('Beneficiary token:', escrow.beneficiaryToken); // Save this! Given to beneficiary`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4">Fiat Conversion Support</h3>
            <CodeBlock title="Convert fiat to crypto amount" language="javascript">
{`// Convert fiat to crypto
const conversion = await client.convertFiatToCrypto(50, 'USD', 'SOL');
console.log(\`$50 USD = \${conversion.cryptoAmount} SOL\`);
console.log(\`Rate: 1 SOL = $\${conversion.rate}\`);`}
            </CodeBlock>

            <CodeBlock title="Create escrow with fiat amount" language="javascript">
{`// Create escrow with fiat amount (auto-converts internally)
const escrow = await client.createEscrow({
  chain: 'SOL',
  amountFiat: 50,
  fiatCurrency: 'USD',
  depositorAddress: '...',
  beneficiaryAddress: '...',
});

console.log(\`Escrow created for $50 USD (\${escrow.amount} SOL)\`);`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4">Get &amp; List Escrows</h3>
            <CodeBlock title="Get escrow by ID" language="javascript">
{`const escrow = await client.getEscrow('a1b2c3d4-...');
console.log(escrow.status);  // 'created' | 'funded' | 'released' | 'settled' | ...`}
            </CodeBlock>

            <CodeBlock title="List escrows with filters" language="javascript">
{`const { escrows, total } = await client.listEscrows({
  status: 'funded',
  depositor: '0xAlice...',   // optional
  beneficiary: '0xBob...',   // optional
  limit: 20,
  offset: 0,
});`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4">Release, Refund &amp; Dispute</h3>
            <CodeBlock title="Release funds to beneficiary (depositor only)" language="javascript">
{`await client.releaseEscrow('a1b2c3d4-...', 'esc_release_token...');
// Triggers on-chain settlement: funds → beneficiary minus fee`}
            </CodeBlock>

            <CodeBlock title="Refund to depositor (depositor only, no fee)" language="javascript">
{`await client.refundEscrow('a1b2c3d4-...', 'esc_release_token...');
// Full amount returned — no platform fee on refunds`}
            </CodeBlock>

            <CodeBlock title="Open a dispute (either party)" language="javascript">
{`await client.disputeEscrow('a1b2c3d4-...', 'esc_any_token...', 
  'Work was not delivered as agreed'
);`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4">Events &amp; Polling</h3>
            <CodeBlock title="Get audit log" language="javascript">
{`const { events } = await client.getEscrowEvents('a1b2c3d4-...');
events.forEach(e => console.log(e.event_type, e.actor, e.created_at));`}
            </CodeBlock>

            <CodeBlock title="Wait for a specific status" language="javascript">
{`// Poll until escrow reaches target status (or timeout)
const settled = await client.waitForEscrow('a1b2c3d4-...', 'settled', {
  intervalMs: 5000,   // check every 5s
  timeoutMs: 300000,  // timeout after 5min
});`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4">Escrow Management</h3>
            <p className="text-gray-300 mb-4">
              Authenticate with escrow tokens to manage escrows and determine available actions based on your role.
            </p>
            
            <CodeBlock title="Authenticate and manage escrow" language="javascript">
{`// Authenticate with escrow token
const { escrow, role } = await client.authenticateEscrow('escrow-id', 'token');
console.log(\`Your role: \${role}\`); // 'depositor' or 'beneficiary'

// Check available actions based on role and status
if (escrow.status === 'funded') {
  if (role === 'depositor') {
    console.log('Available actions: release, refund, dispute');
  } else if (role === 'beneficiary') {
    console.log('Available actions: dispute');
  }
}`}
            </CodeBlock>

            <CodeBlock title="Depositor workflow" language="javascript">
{`// Depositor can release or refund
const auth = await client.authenticateEscrow(escrowId, releaseToken);
if (auth.role === 'depositor') {
  // Release to beneficiary
  await client.releaseEscrow(escrowId, releaseToken);
  
  // Or refund to self (if needed)
  // await client.refundEscrow(escrowId, releaseToken);
}`}
            </CodeBlock>

            <CodeBlock title="Beneficiary workflow" language="javascript">
{`// Beneficiary can check status and dispute if needed
const auth = await client.authenticateEscrow(escrowId, beneficiaryToken);
if (auth.role === 'beneficiary') {
  console.log(\`Escrow status: \${auth.escrow.status}\`);
  
  // Open dispute if work not delivered
  if (auth.escrow.status === 'funded' && workNotDelivered) {
    await client.disputeEscrow(escrowId, beneficiaryToken, 
      'Work was not delivered as agreed upon'
    );
  }
}`}
            </CodeBlock>

            <div className="mt-4 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
              <p className="text-purple-300 text-sm">
                <strong>Web Management:</strong> Both parties can also manage escrows through the web interface at <code className="text-purple-200">/escrow/manage?id=xxx&token=yyy</code>. Share the escrow ID and appropriate token for easy access.
              </p>
            </div>
          </DocSection>
        </div>

        {/* Recurring Escrow */}
        <div id="recurring-escrow">
          <DocSection title="Recurring Escrow Series">
            <p className="text-gray-300 mb-6">
              Create and manage automated periodic escrow payments. Supports both crypto and card payment methods.
            </p>

            <h3 className="text-xl font-semibold text-white mb-4">Create Escrow Series</h3>
            <CodeBlock title="Create a recurring escrow series" language="javascript">
{`const series = await client.createEscrowSeries({
  business_id: 'biz_123',
  payment_method: 'crypto',             // 'crypto' or 'card'
  customer_email: 'client@example.com',
  description: 'Weekly retainer — frontend dev',
  amount: 500,
  currency: 'USD',
  coin: 'USDC_SOL',                     // Required for crypto
  interval: 'weekly',                   // 'weekly' | 'biweekly' | 'monthly'
  max_periods: 12,                      // Optional: stop after N periods
  beneficiary_address: 'Bob...',        // Required for crypto
  // stripe_account_id: 'acct_...',     // Required for card method
});

console.log('Series ID:', series.id);
console.log('Next charge:', series.next_charge_at);`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">List Escrow Series</h3>
            <CodeBlock title="List series for a business" language="javascript">
{`// List all active series
const { series, total } = await client.listEscrowSeries('biz_123', 'active');

// List all series (no status filter)
const all = await client.listEscrowSeries('biz_123');`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Get Series Details</h3>
            <CodeBlock title="Get series with child escrows" language="javascript">
{`const { series, escrows } = await client.getEscrowSeries('series_abc123');

console.log('Status:', series.status);
console.log('Periods completed:', series.periods_completed);
escrows.forEach(e => {
  console.log(\`  Period \${e.period}: \${e.status} — \${e.amount} \${series.currency}\`);
});`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Update Series</h3>
            <CodeBlock title="Pause, resume, or change amount" language="javascript">
{`// Pause a series
await client.updateEscrowSeries('series_abc123', { status: 'paused' });

// Resume a series
await client.updateEscrowSeries('series_abc123', { status: 'active' });

// Change amount for future periods
await client.updateEscrowSeries('series_abc123', { amount: 750 });`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Cancel Series</h3>
            <CodeBlock title="Permanently cancel a series" language="javascript">
{`await client.cancelEscrowSeries('series_abc123');
// In-flight escrows are not affected — release or refund them individually`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">CLI Commands</h3>
            <CodeBlock title="Recurring escrow CLI" language="bash">
{`# Create a recurring escrow series
coinpay escrow series create \\
  --business-id biz_123 \\
  --payment-method crypto \\
  --email client@example.com \\
  --amount 500 --currency USD --coin USDC_SOL \\
  --interval weekly --max-periods 12 \\
  --beneficiary Bob...

# List series for a business
coinpay escrow series list --business-id biz_123
coinpay escrow series list --business-id biz_123 --status active

# Get series details (includes child escrows)
coinpay escrow series get series_abc123

# Pause a series
coinpay escrow series pause series_abc123

# Resume a series
coinpay escrow series resume series_abc123

# Cancel a series permanently
coinpay escrow series cancel series_abc123`}
            </CodeBlock>
          </DocSection>
        </div>

        {/* Exchange Rates */}
        <div id="rates">
          <DocSection title="Exchange Rates">
            <p className="text-gray-300 mb-6">
              Get real-time cryptocurrency exchange rates in multiple fiat currencies. Supports fiat conversions for payments and escrows.
            </p>

            <h3 className="text-xl font-semibold text-white mb-4">Get Single Rate</h3>
            <CodeBlock title="Get exchange rate for one cryptocurrency" language="javascript">
{`// Get rate in USD (default)
const rate = await client.getExchangeRate('BTC');
console.log(\`1 BTC = $\${rate.price} USD\`);

// Get rate in specific fiat currency
const eurRate = await client.getExchangeRate('SOL', 'EUR');
console.log(\`1 SOL = €\${eurRate.price} EUR\`);`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Get Multiple Rates</h3>
            <CodeBlock title="Get rates for multiple cryptocurrencies" language="javascript">
{`// Get multiple rates in USD (default)
const rates = await client.getExchangeRates(['BTC', 'ETH', 'SOL']);

// Get multiple rates in specific fiat currency
const gbpRates = await client.getExchangeRates(['BTC', 'ETH', 'SOL'], 'GBP');
console.log(\`BTC: £\${gbpRates.rates.BTC}\`);`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Fiat Conversion</h3>
            <CodeBlock title="Convert fiat amounts to crypto" language="javascript">
{`// Convert $100 USD to BTC
const conversion = await client.convertFiatToCrypto(100, 'USD', 'BTC');
console.log(\`$100 USD = \${conversion.cryptoAmount.toFixed(8)} BTC\`);

// Convert €50 EUR to SOL
const eurConversion = await client.convertFiatToCrypto(50, 'EUR', 'SOL');
console.log(\`€50 EUR = \${eurConversion.cryptoAmount.toFixed(6)} SOL\`);`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Supported Fiat Currencies</h3>
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

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Supported Blockchains</h3>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { name: 'Bitcoin', symbol: 'BTC' },
                { name: 'Bitcoin Cash', symbol: 'BCH' },
                { name: 'Ethereum', symbol: 'ETH' },
                { name: 'Polygon', symbol: 'POL' },
                { name: 'Solana', symbol: 'SOL' },
                { name: 'USDC (Ethereum)', symbol: 'USDC_ETH' },
                { name: 'USDC (Polygon)', symbol: 'USDC_POL' },
                { name: 'USDC (Solana)', symbol: 'USDC_SOL' },
              ].map((crypto) => (
                <div key={crypto.symbol} className="p-3 rounded-lg bg-slate-800/50 border border-white/10 text-center">
                  <div className="font-semibold text-white">{crypto.name}</div>
                  <code className="text-purple-400 text-sm">{crypto.symbol}</code>
                </div>
              ))}
            </div>
          </DocSection>
        </div>

        {/* Webhook Verification */}
        <div id="webhooks">
          <DocSection title="Webhook Verification">
            <p className="text-gray-300 mb-6">
              Verify webhook signatures to ensure requests are from CoinPay:
            </p>

            <h3 className="text-xl font-semibold text-white mb-4">Manual Verification</h3>
            <CodeBlock title="Verify webhook signature" language="javascript">
{`import { verifyWebhookSignature } from '@profullstack/coinpay';

// In your webhook handler
const isValid = verifyWebhookSignature({
  payload: rawBody,  // Raw request body as string
  signature: req.headers['x-coinpay-signature'],
  secret: 'your-webhook-secret',
});

if (!isValid) {
  return res.status(401).json({ error: 'Invalid signature' });
}

// Process the webhook...`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Express Middleware</h3>
            <CodeBlock title="Use the webhook handler middleware" language="javascript">
{`import express from 'express';
import { createWebhookHandler } from '@profullstack/coinpay';

const app = express();

// Use raw body parser for webhook route
app.post('/webhook', 
  express.raw({ type: 'application/json' }),
  createWebhookHandler({
    secret: 'your-webhook-secret',
    onEvent: async (event) => {
      console.log('Received event:', event.type);
      
      switch (event.type) {
        case 'payment.completed':
          // Handle completed payment
          await fulfillOrder(event.payment_id);
          break;
        case 'payment.expired':
          // Handle expired payment
          await cancelOrder(event.payment_id);
          break;
        case 'payment.failed':
          // Handle failed payment
          await notifyCustomer(event.payment_id);
          break;
      }
    },
    onError: (error) => {
      console.error('Webhook error:', error);
    },
  })
);`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Webhook Events</h3>
            <div className="space-y-3">
              {[
                { event: 'payment.created', description: 'Payment was created' },
                { event: 'payment.pending', description: 'Payment is pending confirmation' },
                { event: 'payment.confirming', description: 'Payment is being confirmed on blockchain' },
                { event: 'payment.completed', description: 'Payment completed successfully' },
                { event: 'payment.expired', description: 'Payment expired without completion' },
                { event: 'payment.failed', description: 'Payment failed' },
                { event: 'payment.refunded', description: 'Payment was refunded' },
              ].map((item) => (
                <div key={item.event} className="p-3 rounded-lg bg-slate-800/50 flex items-center gap-4">
                  <code className="text-purple-400 font-mono text-sm">{item.event}</code>
                  <span className="text-gray-300 text-sm">{item.description}</span>
                </div>
              ))}
            </div>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Webhook Logs</h3>
            <CodeBlock title="Get webhook delivery logs" language="javascript">
{`// Get recent webhook logs for a business
const logs = await client.getWebhookLogs('biz_123', 50);

logs.forEach(log => {
  console.log(\`\${log.event}: \${log.status} (\${log.statusCode})\`);
});

// Test webhook endpoint
const result = await client.testWebhook('biz_123', 'payment.completed');
console.log(\`Test delivery: \${result.success ? 'OK' : 'Failed'}\`);`}
            </CodeBlock>
          </DocSection>
        </div>

        {/* CLI Commands */}
        <div id="cli">
          <DocSection title="CLI Commands">
            <p className="text-gray-300 mb-6">
              The CoinPay CLI provides command-line access to all API features:
            </p>

            <h3 className="text-xl font-semibold text-white mb-4">Configuration</h3>
            <CodeBlock title="Configure CLI" language="bash">
{`# Set your API key
coinpay config set-key sk_live_xxxxx

# Set custom API URL (optional)
coinpay config set-url https://custom-api.example.com

# Show current configuration
coinpay config show`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Payment Commands</h3>
            <CodeBlock title="Payment operations" language="bash">
{`# Create a Bitcoin payment
coinpay payment create \\
  --business-id biz_123 \\
  --amount 100 \\
  --blockchain BTC \\
  --description "Order #12345"

# Create a USDC payment on Polygon
coinpay payment create \\
  --business-id biz_123 \\
  --amount 50 \\
  --blockchain USDC_POL

# Get payment details
coinpay payment get pay_abc123

# List payments
coinpay payment list --business-id biz_123 --status completed --limit 20

# Generate QR code
coinpay payment qr pay_abc123 --format png > payment-qr.png`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Business Commands</h3>
            <CodeBlock title="Business operations" language="bash">
{`# Create a business
coinpay business create --name "My Store" --webhook-url https://example.com/webhook

# Get business details
coinpay business get biz_123

# List all businesses
coinpay business list

# Update business
coinpay business update biz_123 --name "New Name" --webhook-url https://new-url.com/webhook`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Exchange Rate Commands</h3>
            <CodeBlock title="Rate operations" language="bash">
{`# Get rate for single cryptocurrency in USD (default)
coinpay rates get BTC

# Get rate in specific fiat currency
coinpay rates get SOL --fiat EUR

# List all supported rates in USD
coinpay rates list

# List all supported rates in EUR
coinpay rates list --fiat EUR`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Escrow Commands</h3>
            <CodeBlock title="Escrow operations" language="bash">
{`# Create escrow with crypto amount
coinpay escrow create --chain ETH --amount 0.5 \\
  --depositor 0xAlice... --beneficiary 0xBob...

# Create escrow with fiat amount
coinpay escrow create --chain SOL --amount-fiat 50 --fiat USD \\
  --depositor abc... --beneficiary def...

# Create escrow with EUR amount
coinpay escrow create --chain SOL --amount-fiat 45 --fiat EUR \\
  --depositor abc... --beneficiary def...

# Authenticate and manage escrow with token
coinpay escrow auth <id> --token <token>

# Get escrow details
coinpay escrow get a1b2c3d4-...

# List escrows by status
coinpay escrow list --status funded

# Release funds (depositor)
coinpay escrow release a1b2c3d4-... --token esc_abc123...

# Refund (depositor, no fee)
coinpay escrow refund a1b2c3d4-... --token esc_abc123...

# Open dispute (either party)
coinpay escrow dispute a1b2c3d4-... --token esc_def456... \\
  --reason "Work not delivered as agreed"

# View audit log
coinpay escrow events a1b2c3d4-...`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Webhook Commands</h3>
            <CodeBlock title="Webhook operations" language="bash">
{`# View webhook logs
coinpay webhook logs biz_123 --limit 50

# Test webhook endpoint
coinpay webhook test biz_123 --event payment.completed`}
            </CodeBlock>
          </DocSection>
        </div>

        {/* Error Handling */}
        <div id="errors">
          <DocSection title="Error Handling">
            <p className="text-gray-300 mb-6">
              Handle errors gracefully in your integration:
            </p>

            <CodeBlock title="Error handling example" language="javascript">
{`import { CoinPayClient } from '@profullstack/coinpay';

const client = new CoinPayClient({ apiKey: 'cp_live_your_api_key' });

try {
  const result = await client.createPayment({
    businessId: 'your-business-id',
    amount: 100,
    blockchain: 'BTC',
  });
  
  console.log('Payment created:', result.payment.id);
  console.log('Address:', result.payment.payment_address);
} catch (error) {
  if (error.status === 401) {
    console.error('Invalid API key');
  } else if (error.status === 400) {
    console.error('Invalid request:', error.response?.error);
  } else if (error.status === 429) {
    // Transaction limit exceeded or rate limit
    console.error('Limit exceeded:', error.response?.error);
    console.error('Usage:', error.response?.usage);
  } else {
    console.error('Unexpected error:', error.message);
  }
}`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Error Codes</h3>
            <div className="space-y-3">
              {[
                { code: '400', name: 'Bad Request', description: 'Invalid parameters or missing required fields' },
                { code: '401', name: 'Unauthorized', description: 'Invalid or missing API key' },
                { code: '403', name: 'Forbidden', description: 'Access denied to resource' },
                { code: '404', name: 'Not Found', description: 'Resource not found' },
                { code: '429', name: 'Too Many Requests', description: 'Rate limit exceeded' },
                { code: '500', name: 'Server Error', description: 'Internal server error' },
              ].map((error) => (
                <div key={error.code} className="p-3 rounded-lg bg-slate-800/50 flex items-start gap-4">
                  <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded font-mono text-sm font-semibold">
                    {error.code}
                  </span>
                  <div>
                    <div className="font-semibold text-white text-sm">{error.name}</div>
                    <div className="text-gray-400 text-sm">{error.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </DocSection>
        </div>

        {/* Account & Auth */}
        <div id="auth">
          <DocSection title="Account & Auth">
            <p className="text-gray-300 mb-6">
              Create merchant accounts, authenticate, and manage sessions — all from the CLI or SDK.
            </p>

            <h3 className="text-xl font-semibold text-white mb-4">CLI Commands</h3>

            <CodeBlock title="Account management" language="bash">
{`# Register a new merchant account
coinpay auth register --email you@example.com --password yourpassword --name "Your Name"

# Login to get a JWT token (saved to config)
coinpay auth login --email you@example.com --password yourpassword

# Check who you're logged in as
coinpay auth me`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">SDK Methods</h3>

            <CodeBlock title="Authentication" language="javascript">
{`import { CoinPayClient, registerMerchant, loginMerchant, getMe } from '@profullstack/coinpay';

// Create a client (no API key needed for registration)
const client = new CoinPayClient({ apiKey: 'unused', baseUrl: 'https://coinpayportal.com' });

// Register a new merchant
const { token, merchant } = await registerMerchant(client, {
  email: 'agent@example.com',
  password: 'securepassword',
  name: 'My Agent'
});
console.log('JWT:', token);
console.log('Merchant ID:', merchant.id);

// Login
const login = await loginMerchant(client, {
  email: 'agent@example.com',
  password: 'securepassword'
});
console.log('JWT:', login.token);

// Get current merchant info (requires JWT auth)
const me = await getMe(client);
console.log('Logged in as:', me.email);`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">Full Onboarding Flow</h3>

            <CodeBlock title="Register → Create Business → Claim DID" language="bash">
{`# 1. Register your account
coinpay auth register --email agent@example.com --password mypass123

# 2. Create a business (generates API key)
coinpay business create --name "My Agency" --chain ETH,SOL,BTC

# 3. Set your API key
coinpay config set-key cp_live_your_key_here

# 4. Claim your DID
coinpay reputation did claim

# 5. Check your reputation
coinpay reputation did`}
            </CodeBlock>
          </DocSection>
        </div>

        {/* Reputation & DID */}
        <div id="reputation">
          <DocSection title="Reputation & DID">
            <p className="text-gray-300 mb-6">
              Track agent reputation, manage DIDs, and work with verifiable credentials.
            </p>

            <h3 className="text-xl font-semibold text-white mb-4">SDK Methods</h3>

            <CodeBlock title="DID Management" language="javascript">
{`import { CoinPayClient } from '@profullstack/coinpay';

const client = new CoinPayClient({ apiKey: 'cp_live_your_api_key' });

// Claim a DID
const did = await client.claimDid({ displayName: 'Agent Smith' });
console.log('DID:', did.did);

// Get your DID
const myDid = await client.getMyDid();
console.log('My DID:', myDid.did);

// Link an external DID
await client.linkDid({ externalDid: 'did:web:example.com' });`}
            </CodeBlock>

            <CodeBlock title="Reputation & Receipts" language="javascript">
{`// Submit a task receipt (after escrow settlement)
const receipt = await client.submitReceipt({
  escrowId: 'esc_abc123',
  taskDescription: 'Frontend bug fix',
  rating: 5,
  counterpartyDid: 'did:coinpay:xyz789...',
});
console.log('Receipt:', receipt.receiptId);

// Query reputation for a DID
const rep = await client.queryReputation('did:coinpay:abc123...');
console.log('Score:', rep.score, 'Tasks:', rep.totalTasks);`}
            </CodeBlock>

            <CodeBlock title="Verifiable Credentials" language="javascript">
{`// Get a credential
const cred = await client.getCredential('cred_ghi789');
console.log('Credential:', cred.credential);

// Verify a credential
const result = await client.verifyCredential('cred_ghi789');
console.log('Valid:', result.valid, 'Revoked:', result.revoked);

// Get revocation list
const revocations = await client.getRevocations();
console.log('Revoked credentials:', revocations.revocations.length);

// List all credentials for a DID
const creds = await client.getCredentials('did:key:z6Mk...');
console.log('Credentials:', creds.credentials.length);

// List all task receipts for a DID
const receipts = await client.getReceipts('did:key:z6Mk...');
console.log('Receipts:', receipts.receipts.length);

// Get embeddable reputation badge URL
import { getBadgeUrl } from '@profullstack/coinpay';
const badgeUrl = getBadgeUrl('https://coinpayportal.com', 'did:key:z6Mk...');
// Use in markdown: ![Reputation](badgeUrl)`}
            </CodeBlock>

            <h3 className="text-xl font-semibold text-white mb-4 mt-8">CLI Commands</h3>

            <CodeBlock title="DID commands" language="bash">
{`# Claim a DID
coinpay reputation did claim --name "Agent Smith"

# Get your DID
coinpay reputation did

# Link an external DID
coinpay reputation did link --did "did:web:example.com"`}
            </CodeBlock>

            <CodeBlock title="Reputation commands" language="bash">
{`# Submit a receipt
coinpay reputation submit --escrow esc_abc123 --rating 5 --description "Bug fix"

# Query reputation
coinpay reputation query did:key:z6Mk...

# Get a credential
coinpay reputation credential cred_ghi789

# List all your credentials
coinpay reputation credentials

# List credentials for another DID
coinpay reputation credentials did:key:z6Mk...

# List your task receipts
coinpay reputation receipts

# List receipts for another DID
coinpay reputation receipts did:key:z6Mk...

# Get your embeddable reputation badge URL
coinpay reputation badge

# Get badge for another DID
coinpay reputation badge did:key:z6Mk...

# Verify a credential
coinpay reputation verify cred_ghi789

# List revocations
coinpay reputation revocations`}
            </CodeBlock>
          </DocSection>
        </div>

        {/* TypeScript Support */}
        <DocSection title="TypeScript Support">
          <p className="text-gray-300 mb-6">
            The SDK is written in JavaScript (ESM) but includes JSDoc type annotations for IDE support:
          </p>

          <CodeBlock title="Type hints in VS Code" language="javascript">
{`import { CoinPayClient, Blockchain, PaymentStatus } from '@profullstack/coinpay';

// Use Blockchain constants for type safety
const result = await client.createPayment({
  businessId: 'biz_123',
  amount: 100,
  blockchain: Blockchain.BTC,  // BTC, BCH, ETH, POL, SOL, DOGE, XRP, ADA, BNB, USDT, USDC, USDC_ETH, USDC_POL, USDC_SOL
});

// result.payment.status: 'pending' | 'detected' | 'confirmed' | 'forwarding' | 'forwarded' | 'expired' | 'failed'
// result.payment.payment_address: string
// result.payment.crypto_amount: string`}
          </CodeBlock>
        </DocSection>

        {/* CPTL Phase 2 — Trust SDK */}
        <DocSection title="Trust Profile & Action Receipts (CPTL v2)">
          <p className="text-gray-300 mb-4">
            Phase 2 adds multi-dimensional trust scoring with categorized action receipts.
          </p>
          <CodeBlock title="Submit Action Receipt">
{`import { submitActionReceipt } from '@profullstack/coinpay/reputation';

const result = await submitActionReceipt(client, {
  receipt_id: '550e8400-...',
  task_id: '550e8400-...',
  agent_did: 'did:key:z6Mk...',
  buyer_did: 'did:key:z6Mk...',
  action_category: 'productivity.completion', // canonical category
  action_type: 'code_review',                 // custom action type
  amount: 250,
  currency: 'USD',
  outcome: 'accepted',
  signatures: { escrow_sig: '...' },
});`}
          </CodeBlock>
          <CodeBlock title="Get Trust Profile">
{`import { getTrustProfile } from '@profullstack/coinpay/reputation';

const profile = await getTrustProfile(client, 'did:key:z6Mk...');
// profile.trust_vector = { E: 42.5, P: 12.3, B: 9.1, D: 2.08, R: 0.87, A: 0, C: 0 }
// profile.reputation = { windows: { ... }, anti_gaming: { ... } }
// profile.computed_at = "2026-02-13T..."`}
          </CodeBlock>
          <p className="text-gray-400 text-sm mt-4">
            Valid action categories: <code>economic.transaction</code>, <code>economic.dispute</code>,
            <code>economic.refund</code>, <code>productivity.task</code>, <code>productivity.application</code>,
            <code>productivity.completion</code>, <code>identity.profile_update</code>,
            <code>identity.verification</code>, <code>social.post</code>, <code>social.comment</code>,
            <code>social.endorsement</code>, <code>compliance.incident</code>, <code>compliance.violation</code>
          </p>
        </DocSection>

        {/* Footer Navigation */}
        <div className="mt-12 pt-8 border-t border-white/10">
          <div className="flex justify-between items-center">
            <Link href="/docs" className="text-purple-400 hover:text-purple-300 flex items-center">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to API Documentation
            </Link>
            <a
              href="https://github.com/profullstack/coinpayportal/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-white flex items-center"
            >
              Report an Issue
              <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}