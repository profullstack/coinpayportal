import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockSupabase = { from: vi.fn() };
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/auth/invoice-access', () => ({
  authorizeInvoice: vi.fn(),
}));

vi.mock('@/lib/invoices/activation', () => ({
  activateInvoicePayment: vi.fn(),
}));

vi.mock('@/lib/email/invoice-delivery', () => ({
  getInvoicePaymentLink: vi.fn((id: string) => `https://coinpayportal.com/now/${id}`),
}));

import { POST } from './route';
import { authorizeInvoice } from '@/lib/auth/invoice-access';
import { activateInvoicePayment } from '@/lib/invoices/activation';

const draftInvoice = {
  id: 'inv-1',
  business_id: 'biz-1',
  status: 'draft',
  amount: '40.00',
  crypto_currency: 'SOL',
};

function request() {
  return new NextRequest('http://localhost/api/invoices/inv-1/publish', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
  });
}

describe('POST /api/invoices/[id]/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    vi.mocked(authorizeInvoice).mockResolvedValue({
      ok: true,
      merchantId: 'merchant-1',
      apiKeyBusinessId: null,
      role: 'owner',
      invoice: draftInvoice,
    } as any);
    vi.mocked(activateInvoicePayment).mockResolvedValue({
      ok: true,
      invoice: { ...draftInvoice, status: 'sent', payment_address: 'pay-address' },
      paymentLink: 'https://coinpayportal.com/now/inv-1',
      idempotentReplay: false,
    });
  });

  it('publishes a draft without claiming an email attempt', async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      invoice: { id: 'inv-1', status: 'sent', payment_address: 'pay-address' },
      paymentLink: 'https://coinpayportal.com/now/inv-1',
      emailAttempted: false,
      idempotentReplay: false,
    });
    expect(authorizeInvoice).toHaveBeenCalledWith(
      mockSupabase,
      expect.any(NextRequest),
      'inv-1',
      'invoice.write',
      expect.any(String)
    );
    expect(activateInvoicePayment).toHaveBeenCalledWith(mockSupabase, draftInvoice);
  });

  it('returns the same live link when a published invoice is retried', async () => {
    vi.mocked(authorizeInvoice).mockResolvedValue({
      ok: true,
      merchantId: 'merchant-1',
      apiKeyBusinessId: null,
      role: 'owner',
      invoice: { ...draftInvoice, status: 'sent', payment_address: 'pay-address' },
    } as any);

    const response = await POST(request(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await response.json();

    expect(body).toMatchObject({
      success: true,
      emailAttempted: false,
      idempotentReplay: true,
      paymentLink: 'https://coinpayportal.com/now/inv-1',
    });
    expect(activateInvoicePayment).not.toHaveBeenCalled();
  });

  it.each(['overdue', 'paid', 'cancelled', 'rejected'])(
    'does not publish an invoice in %s state',
    async (status) => {
      vi.mocked(authorizeInvoice).mockResolvedValue({
        ok: true,
        merchantId: 'merchant-1',
        apiKeyBusinessId: null,
        role: 'owner',
        invoice: { ...draftInvoice, status },
      } as any);

      const response = await POST(request(), { params: Promise.resolve({ id: 'inv-1' }) });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.code).toBe('INVOICE_NOT_PUBLISHABLE');
      expect(activateInvoicePayment).not.toHaveBeenCalled();
    }
  );

  it('reports an incomplete sent state instead of pretending the link is live', async () => {
    vi.mocked(authorizeInvoice).mockResolvedValue({
      ok: true,
      merchantId: 'merchant-1',
      apiKeyBusinessId: null,
      role: 'owner',
      invoice: { ...draftInvoice, status: 'sent', payment_address: null },
    } as any);

    const response = await POST(request(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('PAYMENT_ADDRESS_MISSING');
  });

  it('preserves activation error status and code', async () => {
    vi.mocked(activateInvoicePayment).mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Invoice payment is still being created; retry shortly',
      code: 'PAYMENT_CREATION_IN_PROGRESS',
    });

    const response = await POST(request(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('PAYMENT_CREATION_IN_PROGRESS');
  });
});
