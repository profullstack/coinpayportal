import type { Payment } from '../supabase/types';

export interface EmailTemplate {
  subject: string;
  html: string;
}

/**
 * Format currency amount for display
 */
function formatAmount(amount: string | number, currency: string = 'USD'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(num);
}

/**
 * Format crypto amount for display
 */
function formatCryptoAmount(amount: string | number, currency: string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return `${num.toFixed(8)} ${currency.toUpperCase()}`;
}

/**
 * Format date for display
 */
function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(date));
}

/**
 * Base HTML template wrapper
 */
function wrapTemplate(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CoinPay Notification</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: #ffffff;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #9333ea;
    }
    .logo {
      font-size: 28px;
      font-weight: bold;
      color: #9333ea;
    }
    .content {
      margin-bottom: 30px;
    }
    .status-badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 14px;
      margin: 10px 0;
    }
    .status-success {
      background-color: #d1fae5;
      color: #065f46;
    }
    .status-warning {
      background-color: #fef3c7;
      color: #92400e;
    }
    .status-error {
      background-color: #fee2e2;
      color: #991b1b;
    }
    .details {
      background-color: #f9fafb;
      border-radius: 6px;
      padding: 20px;
      margin: 20px 0;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 600;
      color: #6b7280;
    }
    .detail-value {
      color: #111827;
      text-align: right;
    }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background-color: #9333ea;
      color: #ffffff;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      margin: 20px 0;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      color: #6b7280;
      font-size: 14px;
    }
    .footer a {
      color: #9333ea;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">CoinPay</div>
    </div>
    ${content}
    <div class="footer">
      <p>This is an automated notification from CoinPay.</p>
      <p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard">View Dashboard</a> |
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/settings">Manage Notifications</a>
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Payment Detected Email Template
 * Sent when payment is first detected on the blockchain
 */
export function paymentDetectedTemplate(payment: Payment): EmailTemplate {
  const content = `
    <div class="content">
      <h2>Payment Detected 🔍</h2>
      <p>We've detected a payment on the blockchain for your business.</p>
      
      <span class="status-badge status-warning">Pending Confirmation</span>
      
      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Payment ID:</span>
          <span class="detail-value">${payment.id}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Amount:</span>
          <span class="detail-value">${formatAmount(payment.amount, payment.currency)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Crypto Amount:</span>
          <span class="detail-value">${payment.crypto_amount ? formatCryptoAmount(payment.crypto_amount, payment.crypto_currency || payment.blockchain) : 'Pending'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Blockchain:</span>
          <span class="detail-value">${payment.blockchain.toUpperCase()}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Confirmations:</span>
          <span class="detail-value">${payment.confirmations} / 3</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Detected At:</span>
          <span class="detail-value">${payment.detected_at ? formatDate(payment.detected_at) : 'Just now'}</span>
        </div>
      </div>
      
      <p>The payment is currently being confirmed on the blockchain. You'll receive another notification once it's fully confirmed.</p>
    </div>
  `;

  return {
    subject: `Payment Detected - ${formatAmount(payment.amount, payment.currency)}`,
    html: wrapTemplate(content),
  };
}

/**
 * Payment Confirmed Email Template
 * Sent when payment has enough confirmations
 */
export function paymentConfirmedTemplate(payment: Payment): EmailTemplate {
  const content = `
    <div class="content">
      <h2>Payment Confirmed ✅</h2>
      <p>Great news! Your payment has been confirmed on the blockchain.</p>
      
      <span class="status-badge status-success">Confirmed</span>
      
      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Payment ID:</span>
          <span class="detail-value">${payment.id}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Amount Received:</span>
          <span class="detail-value">${formatAmount(payment.amount, payment.currency)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Crypto Amount:</span>
          <span class="detail-value">${payment.customer_paid_amount ? formatCryptoAmount(payment.customer_paid_amount, payment.crypto_currency || payment.blockchain) : 'N/A'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Blockchain:</span>
          <span class="detail-value">${payment.blockchain.toUpperCase()}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Transaction Hash:</span>
          <span class="detail-value" style="word-break: break-all; font-size: 12px;">${payment.tx_hash || 'N/A'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Confirmed At:</span>
          <span class="detail-value">${payment.confirmed_at ? formatDate(payment.confirmed_at) : 'Just now'}</span>
        </div>
      </div>
      
      <p>The payment will be automatically forwarded to your wallet address shortly.</p>
      
      <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" class="button">View in Dashboard</a>
    </div>
  `;

  return {
    subject: `Payment Confirmed - ${formatAmount(payment.amount, payment.currency)}`,
    html: wrapTemplate(content),
  };
}

/**
 * Payment Forwarded Email Template
 * Sent when payment has been forwarded to merchant wallet
 */
export function paymentForwardedTemplate(payment: Payment): EmailTemplate {
  const merchantAmount = payment.merchant_received_amount 
    ? formatCryptoAmount(payment.merchant_received_amount, payment.crypto_currency || payment.blockchain)
    : 'N/A';
  
  const platformFee = payment.fee_amount
    ? formatCryptoAmount(payment.fee_amount, payment.crypto_currency || payment.blockchain)
    : 'N/A';

  const content = `
    <div class="content">
      <h2>Payment Forwarded 💸</h2>
      <p>Your payment has been successfully forwarded to your wallet!</p>
      
      <span class="status-badge status-success">Forwarded</span>
      
      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Payment ID:</span>
          <span class="detail-value">${payment.id}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Amount Forwarded:</span>
          <span class="detail-value">${merchantAmount}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Platform Fee (0.5%):</span>
          <span class="detail-value">${platformFee}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Your Wallet:</span>
          <span class="detail-value" style="word-break: break-all; font-size: 12px;">${payment.merchant_wallet_address}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Forward Transaction:</span>
          <span class="detail-value" style="word-break: break-all; font-size: 12px;">${payment.forward_tx_hash || 'N/A'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Forwarded At:</span>
          <span class="detail-value">${payment.forwarded_at ? formatDate(payment.forwarded_at) : 'Just now'}</span>
        </div>
      </div>
      
      <p>The funds should appear in your wallet shortly. You can track the transaction using the hash above.</p>
      
      <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" class="button">View in Dashboard</a>
    </div>
  `;

  return {
    subject: `Payment Forwarded - ${merchantAmount}`,
    html: wrapTemplate(content),
  };
}

/**
 * Payment Failed Email Template
 * Sent when payment fails or expires
 */
export function paymentFailedTemplate(payment: Payment): EmailTemplate {
  const reason = payment.status === 'expired' 
    ? 'The payment expired before receiving sufficient confirmations.'
    : 'The payment encountered an error during processing.';

  const content = `
    <div class="content">
      <h2>Payment ${payment.status === 'expired' ? 'Expired' : 'Failed'} ⚠️</h2>
      <p>Unfortunately, a payment was not completed successfully.</p>
      
      <span class="status-badge status-error">${payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}</span>
      
      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Payment ID:</span>
          <span class="detail-value">${payment.id}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Expected Amount:</span>
          <span class="detail-value">${formatAmount(payment.amount, payment.currency)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Blockchain:</span>
          <span class="detail-value">${payment.blockchain.toUpperCase()}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Status:</span>
          <span class="detail-value">${payment.status}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Created At:</span>
          <span class="detail-value">${formatDate(payment.created_at)}</span>
        </div>
      </div>
      
      <p><strong>Reason:</strong> ${reason}</p>
      
      <p>If this was a legitimate payment attempt, you may want to contact your customer to retry the payment.</p>
      
      <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" class="button">View in Dashboard</a>
    </div>
  `;

  return {
    subject: `Payment ${payment.status === 'expired' ? 'Expired' : 'Failed'} - ${formatAmount(payment.amount, payment.currency)}`,
    html: wrapTemplate(content),
  };
}

/**
 * Get email template based on event type
 */
export function getEmailTemplate(eventType: string, payment: Payment): EmailTemplate {
  switch (eventType) {
    case 'payment.detected':
      return paymentDetectedTemplate(payment);
    case 'payment.confirmed':
      return paymentConfirmedTemplate(payment);
    case 'payment.forwarded':
      return paymentForwardedTemplate(payment);
    case 'payment.failed':
      return paymentFailedTemplate(payment);
    default:
      throw new Error(`Unknown event type: ${eventType}`);
  }
}