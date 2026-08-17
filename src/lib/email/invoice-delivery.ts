import { sendEmail, type SendEmailResult } from '.';
import { invoiceSentTemplate } from './invoice-templates';

export interface InvoiceEmailData {
  id: string;
  invoice_number: string;
  amount: string | number;
  currency?: string | null;
  crypto_amount: string | number;
  crypto_currency: string;
  due_date?: string | null;
  notes?: string | null;
  clients?: { email?: string | null } | null;
  businesses?: { name?: string | null } | null;
}

export interface InvoiceEmailResult extends SendEmailResult {
  paymentLink: string;
}

export function getInvoicePaymentLink(invoiceId: string): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com').replace(/\/$/, '');
  return `${appUrl}/now/${invoiceId}`;
}

export async function deliverInvoiceEmail(invoice: InvoiceEmailData): Promise<InvoiceEmailResult> {
  const clientEmail = invoice.clients?.email;
  if (!clientEmail) {
    return {
      success: false,
      error: 'Client email is required to send invoice',
      paymentLink: getInvoicePaymentLink(invoice.id),
    };
  }

  const paymentLink = getInvoicePaymentLink(invoice.id);
  const template = invoiceSentTemplate({
    invoiceNumber: invoice.invoice_number,
    amount: Number(invoice.amount),
    currency: invoice.currency || 'USD',
    cryptoAmount: String(invoice.crypto_amount),
    cryptoCurrency: invoice.crypto_currency,
    dueDate: invoice.due_date || undefined,
    businessName: invoice.businesses?.name || 'CoinPay Merchant',
    paymentLink,
    notes: invoice.notes || undefined,
  });

  const result = await sendEmail({
    to: clientEmail,
    subject: template.subject,
    html: template.html,
  });

  return { ...result, paymentLink };
}
