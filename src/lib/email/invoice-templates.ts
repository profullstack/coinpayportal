/**
 * Invoice Email Templates
 */

interface InvoiceSentData {
  invoiceNumber: string;
  amount: number;
  currency: string;
  cryptoAmount: string;
  cryptoCurrency: string;
  dueDate?: string;
  businessName: string;
  paymentLink: string;
  notes?: string;
}

interface InvoicePaidData {
  invoiceNumber: string;
  amount: number;
  currency: string;
  cryptoAmount: string;
  cryptoCurrency: string;
  txHash: string;
  feeAmount: number;
  feeRate: number;
  merchantAmount: number;
  clientName?: string;
  clientEmail?: string;
  businessName: string;
}

interface InvoiceOverdueData {
  invoiceNumber: string;
  amount: number;
  currency: string;
  dueDate: string;
  businessName: string;
  paymentLink: string;
}

function formatAmount(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date(date));
}

function wrapTemplate(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5; }
    .container { background-color: #ffffff; border-radius: 8px; padding: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #9333ea; }
    .logo { font-size: 28px; font-weight: bold; color: #9333ea; }
    .details { background-color: #f9fafb; border-radius: 6px; padding: 20px; margin: 20px 0; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { font-weight: 600; color: #6b7280; }
    .detail-value { color: #111827; text-align: right; }
    .button { display: inline-block; padding: 14px 32px; background-color: #9333ea; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; margin: 20px 0; }
    .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><div class="logo">CoinPay</div></div>
    ${content}
    <div class="footer"><p>Powered by CoinPay - Crypto Payment Gateway</p></div>
  </div>
</body>
</html>`.trim();
}

/**
 * Invoice sent to client email template
 */
export function invoiceSentTemplate(data: InvoiceSentData) {
  const content = `
    <div>
      <h2 style="color: #111827;">Invoice from ${data.businessName}</h2>
      <p>You have received an invoice. Please review the details below and make your payment.</p>

      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Invoice:</span>
          <span class="detail-value">${data.invoiceNumber}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Amount:</span>
          <span class="detail-value">${formatAmount(data.amount, data.currency)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Crypto Amount:</span>
          <span class="detail-value">${data.cryptoAmount} ${data.cryptoCurrency}</span>
        </div>
        ${data.dueDate ? `
        <div class="detail-row">
          <span class="detail-label">Due Date:</span>
          <span class="detail-value">${formatDate(data.dueDate)}</span>
        </div>
        ` : ''}
      </div>

      ${data.notes ? `<p style="color: #6b7280; font-style: italic;">Note: ${data.notes}</p>` : ''}

      <div style="text-align: center;">
        <a href="${data.paymentLink}" class="button">Pay Now</a>
      </div>

      <p style="color: #6b7280; font-size: 14px;">Click the button above to view payment details and make your crypto payment.</p>
    </div>
  `;

  return {
    subject: `Invoice ${data.invoiceNumber} from ${data.businessName} - ${formatAmount(data.amount, data.currency)}`,
    html: wrapTemplate(content),
  };
}

/**
 * Payment confirmed email to merchant
 */
export function invoicePaidMerchantTemplate(data: InvoicePaidData) {
  const content = `
    <div>
      <h2 style="color: #059669;">Payment Received ✅</h2>
      <p>Invoice ${data.invoiceNumber} has been paid!</p>

      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Invoice:</span>
          <span class="detail-value">${data.invoiceNumber}</span>
        </div>
        ${data.clientName ? `
        <div class="detail-row">
          <span class="detail-label">Client:</span>
          <span class="detail-value">${data.clientName} (${data.clientEmail})</span>
        </div>
        ` : ''}
        <div class="detail-row">
          <span class="detail-label">Amount:</span>
          <span class="detail-value">${formatAmount(data.amount, data.currency)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Crypto Received:</span>
          <span class="detail-value">${data.cryptoAmount} ${data.cryptoCurrency}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Platform Fee (${(data.feeRate * 100).toFixed(1)}%):</span>
          <span class="detail-value">${formatAmount(data.feeAmount, data.currency)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">You Receive:</span>
          <span class="detail-value" style="font-weight: bold; color: #059669;">${formatAmount(data.merchantAmount, data.currency)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">TX Hash:</span>
          <span class="detail-value" style="word-break: break-all; font-size: 12px;">${data.txHash}</span>
        </div>
      </div>

      <a href="${process.env.NEXT_PUBLIC_APP_URL || ''}/invoices" class="button" style="display: inline-block;">View Invoices</a>
    </div>
  `;

  return {
    subject: `Payment Received - Invoice ${data.invoiceNumber} (${formatAmount(data.amount, data.currency)})`,
    html: wrapTemplate(content),
  };
}

/**
 * Overdue reminder to client
 */
export function invoiceOverdueTemplate(data: InvoiceOverdueData) {
  const content = `
    <div>
      <h2 style="color: #dc2626;">Invoice Overdue ⚠️</h2>
      <p>This is a reminder that the following invoice from <strong>${data.businessName}</strong> is overdue.</p>

      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Invoice:</span>
          <span class="detail-value">${data.invoiceNumber}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Amount:</span>
          <span class="detail-value">${formatAmount(data.amount, data.currency)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Due Date:</span>
          <span class="detail-value" style="color: #dc2626;">${formatDate(data.dueDate)}</span>
        </div>
      </div>

      <div style="text-align: center;">
        <a href="${data.paymentLink}" class="button" style="background-color: #dc2626;">Pay Now</a>
      </div>

      <p style="color: #6b7280; font-size: 14px;">Please make your payment at your earliest convenience.</p>
    </div>
  `;

  return {
    subject: `OVERDUE: Invoice ${data.invoiceNumber} from ${data.businessName} - ${formatAmount(data.amount, data.currency)}`,
    html: wrapTemplate(content),
  };
}
