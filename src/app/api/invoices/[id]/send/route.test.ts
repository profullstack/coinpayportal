import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock modules before imports
vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: vi.fn().mockReturnValue({ userId: 'user-1' }),
}));

vi.mock('@/lib/secrets', () => ({
  getJwtSecret: vi.fn().mockReturnValue('test-secret'),
}));

vi.mock('@/lib/rates/tatum', () => ({
  getCryptoPrice: vi.fn().mockResolvedValue(0.05),
}));

vi.mock('@/lib/wallets/system-wallet', () => ({
  generatePaymentAddress: vi.fn().mockResolvedValue({ success: true, address: 'SoLaDdReSs123' }),
}));

vi.mock('@/lib/payments/service', () => ({
  createPayment: vi.fn().mockResolvedValue({
    success: true,
    payment: {
      id: 'pay-invoice-1',
      payment_address: 'SoLaDdReSs123',
      crypto_amount: 0.05,
    },
  }),
}));

vi.mock('@/lib/entitlements/service', () => ({
  isBusinessPaidTier: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/paypal/accounts', () => ({
  businessHasPaypal: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/payment-methods/manual', () => ({
  getEnabledManualMethods: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/email/invoice-templates', () => ({
  invoiceSentTemplate: vi.fn().mockReturnValue({
    subject: 'Invoice from Acme',
    html: '<p>Pay here</p>',
  }),
}));

const mockStripeCreate = vi.fn().mockResolvedValue({
  id: 'cs_test_123',
  url: 'https://checkout.stripe.com/pay/cs_test_123',
});

vi.mock('@/lib/server/optional-deps', () => ({
  getStripe: vi.fn().mockResolvedValue({
    checkout: {
      sessions: {
        create: (...args: any[]) => mockStripeCreate(...args),
      },
    },
  }),
}));

const mockFrom = vi.fn();
const invoiceUpdatePayloads: Array<Record<string, unknown>> = [];
let pendingTrackingError: unknown = null;
let finalTrackingError: unknown = null;
let pendingTrackingMatched = true;
let finalTrackingMatched = true;

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

// Invoice access is authorized by business role via authorizeInvoice, which
// resolves the caller and gates on the invoice's business. Stub the underlying
// resolve/authorize so the route's real invoice fetch (via the supabase mock)
// still runs.
vi.mock('@/lib/auth/merchant', () => ({
  resolveMerchant: vi.fn().mockResolvedValue({ merchantId: 'merch-1', apiKeyBusinessId: null }),
}));
vi.mock('@/lib/auth/authz', () => ({
  authorizeBusiness: vi.fn().mockResolvedValue({ ok: true, role: 'owner' }),
}));

import { POST } from './route';
import { createPayment } from '@/lib/payments/service';
import { sendEmail } from '@/lib/email';

const baseInvoice = {
  id: 'inv-1',
  invoice_number: 'INV-001',
  status: 'draft',
  currency: 'USD',
  amount: '100.00',
  crypto_currency: 'SOL',
  fee_rate: '0.01',
  business_id: 'biz-1',
  merchant_wallet_address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
  clients: { id: 'c1', name: 'Alice', email: 'alice@example.com', company_name: null },
  businesses: { id: 'biz-1', name: 'Acme', merchant_id: 'merch-1' },
  notes: null,
  due_date: null,
};

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/invoices/inv-1/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token' },
  });
}

describe('POST /api/invoices/[id]/send', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoiceUpdatePayloads.length = 0;
    pendingTrackingError = null;
    finalTrackingError = null;
    pendingTrackingMatched = true;
    finalTrackingMatched = true;
    vi.mocked(createPayment).mockResolvedValue({
      success: true,
      payment: {
        id: 'pay-invoice-1',
        payment_address: 'SoLaDdReSs123',
        crypto_amount: 0.05,
      } as any,
    });
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 'email-message-1' });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://coinpayportal.com';
  });

  function setupMocks(overrides: { invoice?: any; stripeAccount?: any } = {}) {
    const invoice = overrides.invoice || baseInvoice;
    const stripeAccount = overrides.stripeAccount !== undefined ? overrides.stripeAccount : null;

    mockFrom.mockImplementation((table: string) => {
      if (table === 'invoices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: invoice, error: null }),
            }),
          }),
          update: vi.fn((payload: Record<string, unknown>) => {
            invoiceUpdatePayloads.push(payload);
            const updateNumber = invoiceUpdatePayloads.length;
            const query: any = {};
            query.eq = vi.fn(() => query);
            query.select = vi.fn(() => {
              if (updateNumber === 1) {
                return {
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { ...invoice, ...payload, status: 'sent' },
                    error: null,
                  }),
                };
              }

              const error = updateNumber === 2 ? pendingTrackingError : finalTrackingError;
              const matched = updateNumber === 2 ? pendingTrackingMatched : finalTrackingMatched;
              return {
                maybeSingle: vi.fn().mockResolvedValue({
                  data: error || !matched ? null : { id: invoice.id },
                  error,
                }),
              };
            });
            return query;
          }),
        };
      }
      if (table === 'stripe_accounts') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: stripeAccount, error: null }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi
            .fn()
            .mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }),
        }),
      };
    });
  }

  it('creates Stripe checkout session when business has stripe_account_id', async () => {
    setupMocks({
      stripeAccount: { stripe_account_id: 'acct_test123', charges_enabled: true },
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.emailAccepted).toBe(true);
    expect(body.invoice.email_status).toBe('accepted');
    expect(body.invoice.email_message_id).toBe('email-message-1');
    expect(body.paymentLink).toBe('https://coinpayportal.com/now/inv-1');
    expect(invoiceUpdatePayloads[0]).not.toHaveProperty('email_status');
    expect(invoiceUpdatePayloads[1]).toMatchObject({
      email_status: 'pending',
      email_message_id: null,
      email_last_error: null,
    });
    expect(invoiceUpdatePayloads[2]).toMatchObject({
      email_status: 'accepted',
      email_message_id: 'email-message-1',
      email_last_error: null,
    });
    expect(sendEmail).toHaveBeenCalledWith({
      to: 'alice@example.com',
      subject: 'Invoice from Acme',
      html: '<p>Pay here</p>',
    });
    expect(createPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        business_id: 'biz-1',
        amount: 100,
        blockchain: 'SOL',
        merchant_wallet_address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
        idempotency_key: 'invoice:inv-1:initial',
        metadata: expect.objectContaining({
          source: 'invoice',
          invoice_id: 'inv-1',
          invoice_number: 'INV-001',
        }),
      })
    );
    expect(mockStripeCreate).toHaveBeenCalledTimes(1);

    // Verify the Stripe session was created with correct params
    const createCall = mockStripeCreate.mock.calls[0][0];
    expect(createCall.line_items[0].price_data.unit_amount).toBe(10000); // $100 in cents
    expect(createCall.payment_intent_data.transfer_data.destination).toBe('acct_test123');
    expect(createCall.payment_intent_data.application_fee_amount).toBe(100); // 1% of 10000
    expect(createCall.metadata.coinpay_invoice_id).toBe('inv-1');
    expect(createCall.metadata.business_id).toBe('biz-1');
    expect(mockStripeCreate.mock.calls[0][1]).toEqual({
      idempotencyKey: 'invoice:inv-1:initial:stripe',
    });
  });

  it('skips Stripe when no stripe_account_id (crypto-only)', async () => {
    setupMocks({ stripeAccount: null });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });

  it('skips Stripe when charges not enabled', async () => {
    setupMocks({
      stripeAccount: { stripe_account_id: 'acct_test123', charges_enabled: false },
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });

  it('uses 0.5% fee for paid tier businesses', async () => {
    // Override isBusinessPaidTier to return true
    const { isBusinessPaidTier } = await import('@/lib/entitlements/service');
    vi.mocked(isBusinessPaidTier).mockResolvedValueOnce(true);

    setupMocks({
      stripeAccount: { stripe_account_id: 'acct_test123', charges_enabled: true },
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(mockStripeCreate).toHaveBeenCalledTimes(1);

    const createCall = mockStripeCreate.mock.calls[0][0];
    expect(createCall.payment_intent_data.application_fee_amount).toBe(50); // 0.5% of 10000
  });

  it('keeps the payment live and reports when the email provider rejects the message', async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce({
      success: false,
      error: 'Provider rejected the message',
    });
    setupMocks({ stripeAccount: null });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.emailAccepted).toBe(false);
    expect(body.emailTrackingSaved).toBe(true);
    expect(body.emailError).toBe('Provider rejected the message');
    expect(body.warning).toContain('payment link is active');
    expect(body.invoice).toMatchObject({
      id: 'inv-1',
      status: 'sent',
      email_status: 'failed',
      email_message_id: null,
      email_last_error: 'Provider rejected the message',
    });
    expect(body.paymentLink).toBe('https://coinpayportal.com/now/inv-1');
    expect(createPayment).toHaveBeenCalledTimes(1);
  });

  it('turns an unexpected email exception into an explicit partial-success response', async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('Email transport crashed'));
    setupMocks({ stripeAccount: null });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.emailAccepted).toBe(false);
    expect(body.emailError).toBe('Email transport crashed');
    expect(body.invoice.email_status).toBe('failed');
    expect(createPayment).toHaveBeenCalledTimes(1);
  });

  it('reports pending when the final email tracking write fails', async () => {
    finalTrackingError = { message: 'Tracking unavailable' };
    setupMocks({ stripeAccount: null });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.emailAccepted).toBe(true);
    expect(body.emailTrackingSaved).toBe(false);
    expect(body.invoice.email_status).toBe('pending');
    expect(body.warning).toContain('tracking status could not be saved');
    expect(invoiceUpdatePayloads[1]).toMatchObject({ email_status: 'pending' });
    expect(invoiceUpdatePayloads[2]).toMatchObject({ email_status: 'accepted' });
  });

  it('does not let an older send overwrite a newer email attempt', async () => {
    finalTrackingMatched = false;
    setupMocks({ stripeAccount: null });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.emailAccepted).toBe(true);
    expect(body.emailTrackingSaved).toBe(false);
    expect(body.invoice.email_status).toBe('pending');
    expect(body.warning).toContain('tracking status could not be saved');
  });
});
