import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock modules before imports
vi.mock('@/lib/payments/monitor-balance', () => ({
  checkBalance: vi.fn(),
}));

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/email/invoice-templates', () => ({
  invoicePaidMerchantTemplate: vi.fn().mockReturnValue({
    subject: 'Invoice Paid',
    html: '<p>Paid</p>',
  }),
}));

const mockSingle = vi.fn();
const mockEq = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

import { POST } from './route';
import { checkBalance } from '@/lib/payments/monitor-balance';
import { sendEmail } from '@/lib/email';
import { invoicePaidMerchantTemplate } from '@/lib/email/invoice-templates';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/invoices/inv-1/check-balance', { method: 'POST' });
}

const baseInvoice = {
  id: 'inv-1',
  invoice_number: 'INV-001',
  status: 'sent',
  currency: 'USD',
  amount: '10.00',
  crypto_currency: 'SOL',
  crypto_amount: '0.05',
  payment_address: 'SoLaDdReSs123',
  fee_rate: '0.01',
  user_id: 'user-1',
  clients: { id: 'c1', name: 'Alice', email: 'alice@example.com', company_name: null },
  businesses: { id: 'b1', name: 'Acme', merchant_id: 'm1' },
};

describe('POST /api/invoices/[id]/check-balance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  function setupInvoiceQuery(invoice: any, error: any = null) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'invoices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: invoice, error }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === 'merchants') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { email: 'merchant@example.com' }, error: null }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      };
    });
  }

  it('returns 404 when invoice not found', async () => {
    setupInvoiceQuery(null, { message: 'not found' });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it('returns current status for already-paid invoice', async () => {
    setupInvoiceQuery({ ...baseInvoice, status: 'paid' });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.status).toBe('paid');
    expect(vi.mocked(checkBalance)).not.toHaveBeenCalled();
  });

  it('returns error when invoice has no payment address', async () => {
    setupInvoiceQuery({ ...baseInvoice, payment_address: null });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/no payment address/i);
  });

  it('returns pending when balance is zero', async () => {
    setupInvoiceQuery(baseInvoice);
    vi.mocked(checkBalance).mockResolvedValue({ balance: 0 });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.status).toBe('pending');
    expect(data.balance).toBe(0);
  });

  it('returns pending for partial payment', async () => {
    setupInvoiceQuery(baseInvoice);
    vi.mocked(checkBalance).mockResolvedValue({ balance: 0.02 });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const data = await res.json();
    expect(data.status).toBe('pending');
    expect(data.message).toMatch(/Partial payment/i);
  });

  it('marks invoice as paid when full balance detected', async () => {
    setupInvoiceQuery(baseInvoice);
    vi.mocked(checkBalance).mockResolvedValue({ balance: 0.05, txHash: 'tx-abc' });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.status).toBe('paid');
    expect(data.txHash).toBe('tx-abc');

    // Should have called update on invoices
    expect(mockFrom).toHaveBeenCalledWith('invoices');
  });

  it('marks invoice as paid with 1% tolerance', async () => {
    setupInvoiceQuery(baseInvoice);
    // 0.0496 is within 1% of 0.05
    vi.mocked(checkBalance).mockResolvedValue({ balance: 0.0496 });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const data = await res.json();
    expect(data.status).toBe('paid');
  });

  it('sends merchant email on confirmation', async () => {
    setupInvoiceQuery(baseInvoice);
    vi.mocked(checkBalance).mockResolvedValue({ balance: 0.05, txHash: 'tx-abc' });

    await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });

    expect(invoicePaidMerchantTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceNumber: 'INV-001',
        amount: 10,
        cryptoAmount: '0.05',
        cryptoCurrency: 'SOL',
        txHash: 'tx-abc',
      })
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'merchant@example.com',
      })
    );
  });

  it('still marks paid even if email fails', async () => {
    setupInvoiceQuery(baseInvoice);
    vi.mocked(checkBalance).mockResolvedValue({ balance: 0.05 });
    vi.mocked(sendEmail).mockRejectedValue(new Error('SMTP error'));

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const data = await res.json();
    expect(data.status).toBe('paid');
  });

  it('works for overdue invoices too', async () => {
    setupInvoiceQuery({ ...baseInvoice, status: 'overdue' });
    vi.mocked(checkBalance).mockResolvedValue({ balance: 0.05 });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const data = await res.json();
    expect(data.status).toBe('paid');
  });
});
