/**
 * Proposal emails.
 *
 * Mirrors the invoice templates' shell so both flows look like one product. The
 * call to action differs: an invoice asks for payment, a proposal asks for a
 * decision — accept, reject, or counter.
 */

export interface ProposalSentData {
  businessName: string;
  proposalNumber: string;
  title: string;
  amount: number;
  currency: string;
  cryptoCurrency?: string | null;
  terms?: string | null;
  message?: string | null;
  dueDate?: string | null;
  expiresAt?: string | null;
  respondLink: string;
}

export interface ProposalCounteredData {
  businessName: string;
  proposalNumber: string;
  title: string;
  amount: number;
  currency: string;
  message?: string | null;
  respondLink: string;
}

export interface ProposalDecidedData {
  proposalNumber: string;
  title: string;
  counterpartyName: string;
  amount: number;
  currency: string;
  decision: 'accepted' | 'rejected';
  message?: string | null;
  link: string;
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapTemplate(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #374151; margin: 0; padding: 0; background-color: #f9fafb; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff; }
    .header { text-align: center; padding: 20px 0; border-bottom: 2px solid #9333ea; }
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

/** Initial proposal delivered to the client. */
export function proposalSentTemplate(data: ProposalSentData) {
  const content = `
    <div>
      <h2 style="color: #111827;">Proposal from ${escapeHtml(data.businessName)}</h2>
      <p>${escapeHtml(data.businessName)} has sent you a proposal. Review the terms below, then accept, decline, or send back a counter-offer.</p>

      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Proposal:</span>
          <span class="detail-value">${escapeHtml(data.proposalNumber)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Title:</span>
          <span class="detail-value">${escapeHtml(data.title)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Amount:</span>
          <span class="detail-value">${formatAmount(data.amount, data.currency)}</span>
        </div>
        ${data.cryptoCurrency ? `
        <div class="detail-row">
          <span class="detail-label">Paid in:</span>
          <span class="detail-value">${escapeHtml(data.cryptoCurrency)}</span>
        </div>
        ` : ''}
        ${data.dueDate ? `
        <div class="detail-row">
          <span class="detail-label">Delivery by:</span>
          <span class="detail-value">${formatDate(data.dueDate)}</span>
        </div>
        ` : ''}
        ${data.expiresAt ? `
        <div class="detail-row">
          <span class="detail-label">Offer expires:</span>
          <span class="detail-value">${formatDate(data.expiresAt)}</span>
        </div>
        ` : ''}
      </div>

      ${data.terms ? `<p><strong>Terms:</strong><br>${escapeHtml(data.terms).replace(/\n/g, '<br>')}</p>` : ''}
      ${data.message ? `<p style="color: #6b7280; font-style: italic;">${escapeHtml(data.message)}</p>` : ''}

      <div style="text-align: center;">
        <a href="${data.respondLink}" class="button">Review Proposal</a>
      </div>

      <p style="color: #6b7280; font-size: 14px;">Nothing is charged at this stage. An invoice is only created once both sides agree.</p>
    </div>
  `;

  return {
    subject: `Proposal ${data.proposalNumber} from ${data.businessName} - ${formatAmount(data.amount, data.currency)}`,
    html: wrapTemplate(content),
  };
}

/** A counter-offer landed — sent to whichever side now has to respond. */
export function proposalCounteredTemplate(data: ProposalCounteredData) {
  const content = `
    <div>
      <h2 style="color: #111827;">Counter-offer on ${escapeHtml(data.proposalNumber)}</h2>
      <p>New terms have been proposed for <strong>${escapeHtml(data.title)}</strong>.</p>

      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Proposed amount:</span>
          <span class="detail-value">${formatAmount(data.amount, data.currency)}</span>
        </div>
      </div>

      ${data.message ? `<p style="color: #6b7280; font-style: italic;">${escapeHtml(data.message)}</p>` : ''}

      <div style="text-align: center;">
        <a href="${data.respondLink}" class="button">View Counter-offer</a>
      </div>
    </div>
  `;

  return {
    subject: `Counter-offer on proposal ${data.proposalNumber} - ${formatAmount(data.amount, data.currency)}`,
    html: wrapTemplate(content),
  };
}

/** Final outcome notification. */
export function proposalDecidedTemplate(data: ProposalDecidedData) {
  const accepted = data.decision === 'accepted';
  const content = `
    <div>
      <h2 style="color: ${accepted ? '#059669' : '#dc2626'};">
        Proposal ${escapeHtml(data.proposalNumber)} was ${accepted ? 'accepted' : 'declined'}
      </h2>
      <p>${escapeHtml(data.counterpartyName)} ${accepted ? 'accepted' : 'declined'} <strong>${escapeHtml(data.title)}</strong>.</p>

      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Agreed amount:</span>
          <span class="detail-value">${formatAmount(data.amount, data.currency)}</span>
        </div>
      </div>

      ${data.message ? `<p style="color: #6b7280; font-style: italic;">${escapeHtml(data.message)}</p>` : ''}

      <div style="text-align: center;">
        <a href="${data.link}" class="button">${accepted ? 'Create Invoice' : 'View Proposal'}</a>
      </div>
    </div>
  `;

  return {
    subject: `Proposal ${data.proposalNumber} ${accepted ? 'accepted' : 'declined'}`,
    html: wrapTemplate(content),
  };
}
