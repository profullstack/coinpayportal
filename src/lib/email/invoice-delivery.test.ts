import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSendEmail = vi.fn();
const mockInvoiceSentTemplate = vi.fn(() => ({
  subject: 'Invoice INV-001',
  html: '<p>Invoice</p>',
}));

vi.mock('@/lib/email', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

vi.mock('@/lib/email/invoice-templates', () => ({
  invoiceSentTemplate: (...args: unknown[]) => mockInvoiceSentTemplate(...args),
}));

import { deliverInvoiceEmail, getInvoicePaymentLink } from './invoice-delivery';

const invoice = {
  id: 'inv-1',
  invoice_number: 'INV-001',
  amount: '40.00',
  currency: 'USD',
  crypto_amount: '0.52909283',
  crypto_currency: 'SOL',
  due_date: null,
  notes: 'Weekly milestone',
  clients: { email: 'client@example.com' },
  businesses: { name: 'Profullstack' },
};

describe('invoice email delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://coinpayportal.com/';
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'message-1' });
  });

  it('builds the canonical payment link without a duplicate slash', () => {
    expect(getInvoicePaymentLink('inv-1')).toBe('https://coinpayportal.com/now/inv-1');
  });

  it('sends the invoice template and returns provider acceptance details', async () => {
    const result = await deliverInvoiceEmail(invoice);

    expect(mockInvoiceSentTemplate).toHaveBeenCalledWith(expect.objectContaining({
      invoiceNumber: 'INV-001',
      paymentLink: 'https://coinpayportal.com/now/inv-1',
      businessName: 'Profullstack',
    }));
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'client@example.com',
      subject: 'Invoice INV-001',
      html: '<p>Invoice</p>',
    });
    expect(result).toEqual({
      success: true,
      messageId: 'message-1',
      paymentLink: 'https://coinpayportal.com/now/inv-1',
    });
  });

  it('does not call the provider when the client email is missing', async () => {
    const result = await deliverInvoiceEmail({ ...invoice, clients: null });

    expect(result).toMatchObject({
      success: false,
      error: 'Client email is required to send invoice',
      paymentLink: 'https://coinpayportal.com/now/inv-1',
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
