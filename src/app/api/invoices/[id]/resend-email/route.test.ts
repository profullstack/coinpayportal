import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthorizeInvoice = vi.fn();
const mockDeliverInvoiceEmail = vi.fn();
const mockCheckRateLimitAsync = vi.fn();
const invoiceUpdatePayloads: Array<Record<string, unknown>> = [];

let paymentResult: { data: Record<string, unknown> | null; error: unknown };
let claimResult: { data: Record<string, unknown> | null; error: unknown };
let finalizeResult: { data: Record<string, unknown> | null; error: unknown };

const paymentQuery: any = {};
paymentQuery.select = vi.fn(() => paymentQuery);
paymentQuery.eq = vi.fn(() => paymentQuery);
paymentQuery.order = vi.fn(() => paymentQuery);
paymentQuery.limit = vi.fn(() => paymentQuery);
paymentQuery.maybeSingle = vi.fn(() => Promise.resolve(paymentResult));

const mockInvoiceUpdate = vi.fn((payload: Record<string, unknown>) => {
  invoiceUpdatePayloads.push(payload);
  const updateNumber = invoiceUpdatePayloads.length;
  const query: any = {};
  query.eq = vi.fn(() => query);
  query.is = vi.fn(() => query);
  query.select = vi.fn(() => query);
  query.maybeSingle = vi.fn(() => Promise.resolve(
    updateNumber === 1 ? claimResult : finalizeResult
  ));
  return query;
});

vi.mock('@/lib/auth/invoice-access', () => ({
  authorizeInvoice: (...args: unknown[]) => mockAuthorizeInvoice(...args),
}));

vi.mock('@/lib/email/invoice-delivery', () => ({
  deliverInvoiceEmail: (...args: unknown[]) => mockDeliverInvoiceEmail(...args),
  getInvoicePaymentLink: (id: string) => `https://coinpayportal.com/now/${id}`,
}));

vi.mock('@/lib/web-wallet/rate-limit', () => ({
  checkRateLimitAsync: (...args: unknown[]) => mockCheckRateLimitAsync(...args),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => table === 'payments'
      ? paymentQuery
      : { update: mockInvoiceUpdate }),
  })),
}));

import { POST } from './route';

const sentInvoice = {
  id: 'inv-1',
  invoice_number: 'INV-001',
  status: 'sent',
  amount: '40.00',
  currency: 'USD',
  crypto_amount: '0.52909283',
  crypto_currency: 'SOL',
  payment_address: 'existing-solana-payment-address',
  business_id: 'biz-1',
  metadata: null,
  email_status: null,
  email_last_attempted_at: null,
  due_date: null,
  notes: 'Weekly development milestones',
  clients: { email: 'anthony@profullstack.com' },
  businesses: { name: 'Profullstack' },
};

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/invoices/inv-1/resend-email', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token' },
  });
}

describe('POST /api/invoices/[id]/resend-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoiceUpdatePayloads.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockAuthorizeInvoice.mockResolvedValue({
      ok: true,
      merchantId: 'merchant-1',
      apiKeyBusinessId: null,
      role: 'owner',
      invoice: sentInvoice,
    });
    paymentResult = {
      data: {
        id: 'payment-1',
        business_id: 'biz-1',
        payment_address: 'existing-solana-payment-address',
        status: 'pending',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      error: null,
    };
    claimResult = { data: { id: 'inv-1' }, error: null };
    finalizeResult = { data: { id: 'inv-1' }, error: null };
    mockCheckRateLimitAsync.mockResolvedValue({ allowed: true, limit: 10, remaining: 9, resetAt: 0 });
    mockDeliverInvoiceEmail.mockResolvedValue({
      success: true,
      messageId: 'email-message-2',
      paymentLink: 'https://coinpayportal.com/now/inv-1',
    });
  });

  it('resends a legacy sent invoice through its active existing payment', async () => {
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.emailAccepted).toBe(true);
    expect(body.invoice).toMatchObject({
      id: 'inv-1',
      payment_address: 'existing-solana-payment-address',
      email_status: 'accepted',
      email_message_id: 'email-message-2',
    });
    expect(paymentQuery.eq).toHaveBeenCalledWith('business_id', 'biz-1');
    expect(paymentQuery.eq).toHaveBeenCalledWith('payment_address', 'existing-solana-payment-address');
    expect(mockCheckRateLimitAsync).toHaveBeenCalledWith('biz-1', 'invoice_email_resend');
    expect(mockDeliverInvoiceEmail).toHaveBeenCalledOnce();
    expect(mockDeliverInvoiceEmail).toHaveBeenCalledWith(sentInvoice);
    expect(invoiceUpdatePayloads[0]).toMatchObject({ email_status: 'pending' });
    expect(invoiceUpdatePayloads[1]).toMatchObject({
      email_status: 'accepted',
      email_message_id: 'email-message-2',
      email_last_error: null,
    });
  });

  it('uses the linked payment id when newer invoice metadata provides one', async () => {
    mockAuthorizeInvoice.mockResolvedValueOnce({
      ok: true,
      invoice: { ...sentInvoice, metadata: { coinpay_payment_id: 'payment-1' } },
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });

    expect(res.status).toBe(200);
    expect(paymentQuery.eq).toHaveBeenCalledWith('id', 'payment-1');
    expect(paymentQuery.order).not.toHaveBeenCalled();
  });

  it('records a provider rejection without changing payment details or inviting HTTP retries', async () => {
    mockDeliverInvoiceEmail.mockResolvedValueOnce({
      success: false,
      error: 'Recipient suppressed',
      paymentLink: 'https://coinpayportal.com/now/inv-1',
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.emailAccepted).toBe(false);
    expect(body.emailError).toBe('Recipient suppressed');
    expect(body.warning).toContain('payment link is still active');
    expect(body.invoice).toMatchObject({
      payment_address: 'existing-solana-payment-address',
      email_status: 'failed',
      email_last_error: 'Recipient suppressed',
    });
    expect(invoiceUpdatePayloads[1]).toMatchObject({ email_status: 'failed' });
  });

  it('does not advertise an expired payment link and prepares the invoice for re-issue', async () => {
    paymentResult.data = {
      ...paymentResult.data,
      status: 'expired',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    };

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('PAYMENT_LINK_INACTIVE');
    expect(body.canReissue).toBe(true);
    expect(body.error).toContain('no longer active');
    expect(body.invoice).toMatchObject({ id: 'inv-1', status: 'overdue' });
    expect(mockDeliverInvoiceEmail).not.toHaveBeenCalled();
    expect(invoiceUpdatePayloads).toEqual([
      expect.objectContaining({ status: 'overdue' }),
    ]);
  });

  it('does not overwrite an invoice that changes while an inactive payment is checked', async () => {
    paymentResult.data = {
      ...paymentResult.data,
      status: 'expired',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    };
    claimResult = { data: null, error: null };

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('changed');
    expect(mockDeliverInvoiceEmail).not.toHaveBeenCalled();
  });

  it.each(['confirmed', 'forwarding', 'forwarded', 'forwarding_failed'])(
    'does not reissue or email a payment in %s state',
    async (status) => {
      paymentResult.data = {
        ...paymentResult.data,
        status,
      };

      const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.code).toBe('PAYMENT_ALREADY_DETECTED');
      expect(body.canReissue).toBe(false);
      expect(mockDeliverInvoiceEmail).not.toHaveBeenCalled();
      expect(mockInvoiceUpdate).not.toHaveBeenCalled();
    }
  );

  it('does not reissue a payment whose address does not match the invoice', async () => {
    paymentResult.data = {
      ...paymentResult.data,
      payment_address: 'different-payment-address',
      status: 'confirmed',
    };

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('PAYMENT_LINK_MISMATCH');
    expect(body.canReissue).toBe(false);
    expect(mockDeliverInvoiceEmail).not.toHaveBeenCalled();
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
  });

  it('fails closed for an unknown payment state', async () => {
    paymentResult.data = {
      ...paymentResult.data,
      status: 'unexpected_state',
    };

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('PAYMENT_STATUS_UNRESOLVED');
    expect(body.canReissue).toBe(false);
    expect(mockDeliverInvoiceEmail).not.toHaveBeenCalled();
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
  });

  it('rate limits provider-backed retries per business', async () => {
    mockCheckRateLimitAsync.mockResolvedValueOnce({ allowed: false, limit: 10, remaining: 0, resetAt: 0 });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });

    expect(res.status).toBe(429);
    expect(mockDeliverInvoiceEmail).not.toHaveBeenCalled();
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
  });

  it('does not send when the pending attempt cannot be claimed', async () => {
    claimResult = { data: null, error: { message: 'Database unavailable' } };

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Failed to start invoice email retry');
    expect(mockDeliverInvoiceEmail).not.toHaveBeenCalled();
  });

  it('reports pending when provider acceptance cannot be persisted', async () => {
    finalizeResult = { data: null, error: { message: 'Tracking unavailable' } };

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.emailAccepted).toBe(true);
    expect(body.emailTrackingSaved).toBe(false);
    expect(body.invoice.email_status).toBe('pending');
    expect(body.warning).toContain('tracking status could not be saved');
  });

  it('does not let an older retry overwrite a newer email attempt', async () => {
    finalizeResult = { data: null, error: null };

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.emailAccepted).toBe(true);
    expect(body.emailTrackingSaved).toBe(false);
    expect(body.invoice.email_status).toBe('pending');
    expect(body.warning).toContain('tracking status could not be saved');
  });

  it('does not resend overdue or closed invoices', async () => {
    for (const status of ['overdue', 'draft', 'paid', 'cancelled', 'rejected']) {
      mockAuthorizeInvoice.mockResolvedValueOnce({
        ok: true,
        invoice: { ...sentInvoice, status },
      });

      const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(400);
    }

    expect(mockDeliverInvoiceEmail).not.toHaveBeenCalled();
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
  });
});
