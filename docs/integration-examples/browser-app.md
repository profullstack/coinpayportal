# Integration Example: Browser Payment Page

A minimal browser-based payment page that lets customers pay with crypto. No build tools needed — just HTML + JavaScript.

---

## Complete Working Example

### `payment-page.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pay with Crypto</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 480px; margin: 0 auto; }
    .card { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 16px; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #666; margin-bottom: 24px; }
    label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 14px; }
    select, input { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; margin-bottom: 16px; }
    button { width: 100%; padding: 12px; background: #2563eb; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    button:disabled { background: #94a3b8; cursor: not-allowed; }
    .payment-info { text-align: center; }
    .payment-info img { max-width: 200px; margin: 16px auto; }
    .address { font-family: monospace; font-size: 13px; word-break: break-all; background: #f1f5f9; padding: 12px; border-radius: 8px; margin: 12px 0; cursor: pointer; }
    .address:hover { background: #e2e8f0; }
    .status { padding: 8px 16px; border-radius: 20px; display: inline-block; font-weight: 600; font-size: 14px; }
    .status.pending { background: #fef3c7; color: #92400e; }
    .status.confirmed { background: #d1fae5; color: #065f46; }
    .status.expired { background: #fee2e2; color: #991b1b; }
    .status.failed { background: #fee2e2; color: #991b1b; }
    .countdown { font-size: 14px; color: #666; margin-top: 8px; }
    .hidden { display: none; }
    .error { color: #dc2626; font-size: 14px; margin-top: 8px; }
    .copy-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #1e293b; color: white; padding: 8px 20px; border-radius: 8px; font-size: 14px; opacity: 0; transition: opacity 0.3s; }
    .copy-toast.show { opacity: 1; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Step 1: Create Payment -->
    <div id="create-form" class="card">
      <h1>💰 Pay with Crypto</h1>
      <p class="subtitle">Select your cryptocurrency and amount</p>

      <label for="amount">Amount (USD)</label>
      <input type="number" id="amount" placeholder="25.00" min="1" step="0.01" value="25.00">

      <label for="chain">Pay with</label>
      <select id="chain">
        <option value="BTC">Bitcoin (BTC)</option>
        <option value="ETH">Ethereum (ETH)</option>
        <option value="SOL">Solana (SOL)</option>
        <option value="POL">Polygon (POL)</option>
        <option value="BCH">Bitcoin Cash (BCH)</option>
        <option value="USDC_ETH">USDC (Ethereum)</option>
        <option value="USDC_POL">USDC (Polygon)</option>
        <option value="USDC_SOL">USDC (Solana)</option>
      </select>

      <button id="create-btn" onclick="createPayment()">Create Payment</button>
      <p id="create-error" class="error hidden"></p>
    </div>

    <!-- Step 2: Payment Details -->
    <div id="payment-details" class="card hidden">
      <div class="payment-info">
        <h1>📱 Scan to Pay</h1>
        <img id="qr-code" alt="Payment QR Code">
        <p>Send <strong id="crypto-amount"></strong> <strong id="crypto-chain"></strong></p>

        <div class="address" id="address" onclick="copyAddress()" title="Click to copy">
          <!-- address appears here -->
        </div>

        <span id="payment-status" class="status pending">⏳ Waiting for payment</span>
        <p id="countdown" class="countdown"></p>
      </div>
    </div>

    <!-- Step 3: Success -->
    <div id="success-card" class="card hidden">
      <div class="payment-info">
        <h1>✅ Payment Confirmed!</h1>
        <p class="subtitle">Thank you for your payment.</p>
        <p>Transaction: <code id="tx-hash"></code></p>
        <button onclick="resetForm()" style="margin-top: 16px;">Make Another Payment</button>
      </div>
    </div>
  </div>

  <div id="copy-toast" class="copy-toast">📋 Address copied!</div>

  <script>
    // ─── Configuration ──────────────────────────────────────────────────
    // In production, payment creation should go through YOUR backend
    // to avoid exposing the API key in the browser.
    const API_BASE = 'https://coinpayportal.com/api';
    const BUSINESS_ID = 'YOUR_BUSINESS_ID'; // Replace with your business UUID

    let currentPaymentId = null;
    let pollInterval = null;

    // ─── Create Payment ─────────────────────────────────────────────────
    async function createPayment() {
      const btn = document.getElementById('create-btn');
      const errorEl = document.getElementById('create-error');
      const amount = parseFloat(document.getElementById('amount').value);
      const chain = document.getElementById('chain').value;

      errorEl.classList.add('hidden');
      btn.disabled = true;
      btn.textContent = 'Creating...';

      try {
        // ⚠️  In production, call YOUR backend instead of the CoinPay API directly.
        //     Your backend creates the payment and returns the details.
        //     This avoids exposing your API key in browser code.
        const response = await fetch('/api/create-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount,
            chain,
            orderId: `web-${Date.now()}`,
          }),
        });

        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to create payment');
        }

        const payment = data.payment;
        currentPaymentId = payment.id;

        // Show payment details
        document.getElementById('qr-code').src = `${API_BASE}/payments/${payment.id}/qr`;
        document.getElementById('crypto-amount').textContent = payment.crypto_amount || payment.amount_crypto;
        document.getElementById('crypto-chain').textContent = chain;
        document.getElementById('address').textContent = payment.payment_address;

        document.getElementById('create-form').classList.add('hidden');
        document.getElementById('payment-details').classList.remove('hidden');

        // Start countdown
        if (payment.expires_at) {
          startCountdown(new Date(payment.expires_at));
        }

        // Start polling for payment
        startPolling(payment.id);

      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Create Payment';
      }
    }

    // ─── Poll for Payment Status ────────────────────────────────────────
    function startPolling(paymentId) {
      if (pollInterval) clearInterval(pollInterval);

      pollInterval = setInterval(async () => {
        try {
          const response = await fetch(`${API_BASE}/payments/${paymentId}/check-balance`, {
            method: 'POST',
          });
          const data = await response.json();

          updateStatus(data.status, data);

          if (['confirmed', 'forwarded', 'expired', 'failed'].includes(data.status)) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        } catch (error) {
          console.error('Poll error:', error);
        }
      }, 5000); // Check every 5 seconds
    }

    // ─── Update UI Status ───────────────────────────────────────────────
    function updateStatus(status, data) {
      const statusEl = document.getElementById('payment-status');
      statusEl.className = `status ${status}`;

      switch (status) {
        case 'pending':
          if (data.balance > 0) {
            statusEl.textContent = `⏳ Partial: ${data.balance} / ${data.expected}`;
          } else {
            statusEl.textContent = '⏳ Waiting for payment';
          }
          break;
        case 'confirmed':
        case 'forwarded':
          statusEl.textContent = '✅ Payment Confirmed!';
          showSuccess(data);
          break;
        case 'expired':
          statusEl.textContent = '⏰ Payment Expired';
          break;
        case 'failed':
          statusEl.textContent = '❌ Payment Failed';
          break;
      }
    }

    // ─── Show Success ───────────────────────────────────────────────────
    function showSuccess(data) {
      document.getElementById('payment-details').classList.add('hidden');
      document.getElementById('success-card').classList.remove('hidden');
      document.getElementById('tx-hash').textContent = data.tx_hash || currentPaymentId;
    }

    // ─── Countdown Timer ────────────────────────────────────────────────
    function startCountdown(expiresAt) {
      const countdownEl = document.getElementById('countdown');

      const tick = () => {
        const remaining = expiresAt - new Date();
        if (remaining <= 0) {
          countdownEl.textContent = 'Expired';
          return;
        }
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        countdownEl.textContent = `Expires in ${minutes}:${seconds.toString().padStart(2, '0')}`;
      };

      tick();
      const timer = setInterval(() => {
        tick();
        if (expiresAt - new Date() <= 0) clearInterval(timer);
      }, 1000);
    }

    // ─── Copy Address ───────────────────────────────────────────────────
    function copyAddress() {
      const address = document.getElementById('address').textContent;
      navigator.clipboard.writeText(address);
      const toast = document.getElementById('copy-toast');
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    }

    // ─── Reset ──────────────────────────────────────────────────────────
    function resetForm() {
      if (pollInterval) clearInterval(pollInterval);
      currentPaymentId = null;
      document.getElementById('create-form').classList.remove('hidden');
      document.getElementById('payment-details').classList.add('hidden');
      document.getElementById('success-card').classList.add('hidden');
    }
  </script>
</body>
</html>
```

---

## Backend Proxy (Required for Production)

**Never expose your API key in browser code.** Create a backend endpoint that proxies payment creation:

### Express.js Backend

```javascript
// server.mjs
import express from 'express';
import { CoinPayClient } from '@profullstack/coinpay';

const app = express();
app.use(express.json());
app.use(express.static('public')); // Serve the HTML above from public/

const client = new CoinPayClient({
  apiKey: process.env.COINPAY_API_KEY,
});

const BUSINESS_ID = process.env.COINPAY_BUSINESS_ID;

// Payment creation proxy
app.post('/api/create-payment', async (req, res) => {
  try {
    const { amount, chain, orderId } = req.body;

    // Validate input
    if (!amount || amount <= 0 || amount > 10000) {
      return res.status(400).json({ success: false, error: 'Invalid amount' });
    }

    const result = await client.createPayment({
      businessId: BUSINESS_ID,
      amount,
      currency: 'USD',
      blockchain: chain,
      description: `Web Payment ${orderId}`,
      metadata: { orderId, source: 'web-checkout' },
    });

    res.json(result);
  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message,
    });
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));
```

---

## React Component Version

```jsx
// PaymentWidget.jsx
import { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api';   // Your backend proxy
const COINPAY_API = 'https://coinpayportal.com/api';

const CHAINS = [
  { value: 'BTC', label: 'Bitcoin' },
  { value: 'ETH', label: 'Ethereum' },
  { value: 'SOL', label: 'Solana' },
  { value: 'POL', label: 'Polygon' },
  { value: 'USDC_ETH', label: 'USDC (Ethereum)' },
  { value: 'USDC_SOL', label: 'USDC (Solana)' },
];

export function PaymentWidget({ amount, orderId, onSuccess, onExpired }) {
  const [chain, setChain] = useState('BTC');
  const [payment, setPayment] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | creating | pending | confirmed | expired
  const [error, setError] = useState(null);

  // Create payment
  const create = useCallback(async () => {
    setStatus('creating');
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, chain, orderId }),
      });
      const data = await res.json();

      if (!data.success) throw new Error(data.error);

      setPayment(data.payment);
      setStatus('pending');
    } catch (err) {
      setError(err.message);
      setStatus('idle');
    }
  }, [amount, chain, orderId]);

  // Poll for status
  useEffect(() => {
    if (status !== 'pending' || !payment) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${COINPAY_API}/payments/${payment.id}/check-balance`, {
          method: 'POST',
        });
        const data = await res.json();

        if (data.status === 'confirmed' || data.status === 'forwarded') {
          setStatus('confirmed');
          clearInterval(interval);
          onSuccess?.(data);
        } else if (data.status === 'expired') {
          setStatus('expired');
          clearInterval(interval);
          onExpired?.();
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [status, payment, onSuccess, onExpired]);

  if (status === 'confirmed') {
    return <div className="text-center p-8">✅ Payment confirmed! Thank you.</div>;
  }

  if (status === 'expired') {
    return (
      <div className="text-center p-8">
        ⏰ Payment expired.
        <button onClick={() => { setPayment(null); setStatus('idle'); }}>Try Again</button>
      </div>
    );
  }

  if (payment && status === 'pending') {
    return (
      <div className="text-center p-6">
        <h2>Scan to Pay</h2>
        <img
          src={`${COINPAY_API}/payments/${payment.id}/qr`}
          alt="QR Code"
          className="mx-auto my-4 w-48"
        />
        <p><strong>{payment.crypto_amount || payment.amount_crypto} {chain}</strong></p>
        <code className="block my-2 text-sm break-all bg-gray-100 p-3 rounded">
          {payment.payment_address}
        </code>
        <p className="text-gray-500 text-sm">Waiting for payment...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h2>Pay ${amount} with Crypto</h2>
      <select value={chain} onChange={e => setChain(e.target.value)} className="w-full p-2 border rounded my-4">
        {CHAINS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      <button
        onClick={create}
        disabled={status === 'creating'}
        className="w-full p-3 bg-blue-600 text-white rounded font-bold"
      >
        {status === 'creating' ? 'Creating...' : `Pay $${amount}`}
      </button>
      {error && <p className="text-red-600 mt-2">{error}</p>}
    </div>
  );
}
```

**Usage:**
```jsx
<PaymentWidget
  amount={49.99}
  orderId="ORD-12345"
  onSuccess={(data) => router.push('/order/success')}
  onExpired={() => alert('Payment expired, please try again')}
/>
```

---

## Key Architecture Points

1. **API key stays on your server** — the browser only calls your backend proxy
2. **QR code and check-balance are public endpoints** — safe to call from the browser
3. **Poll `check-balance` every 5 seconds** — or use webhooks for instant notifications
4. **Always validate amounts server-side** — never trust the browser
