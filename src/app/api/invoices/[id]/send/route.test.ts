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

vi.mock('@/lib/entitlements/service', () => ({
  isBusinessPaidTier: vi.fn().mockResolvedValue(false),
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

const mockSingle = vi.fn();
const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle });
const mockEq = vi.fn().mockReturnValue({ eq: mockEq2, single: mockSingle });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'inv-1' }, error: null }) }) }) });
const mockFrom = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

import { POST } from './route';

const baseInvoice = {
  id: 'inv-1',
  invoice_number: 'INV-001',
  status: 'draft',
  currency: 'USD',
  amount: '100.00',
  crypto_currency: 'SOL',
  fee_rate: '0.01',
  business_id: 'biz-1',
  merchant_wallet_address: 'wallet123',
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
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: invoice, error: null }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { ...invoice, status: 'sent' }, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'stripe_accounts') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: stripeAccount, error: stripeAccount ? null : { code: 'PGRST116' } }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
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
    expect(mockStripeCreate).toHaveBeenCalledTimes(1);

    // Verify the Stripe session was created with correct params
    const createCall = mockStripeCreate.mock.calls[0][0];
    expect(createCall.line_items[0].price_data.unit_amount).toBe(10000); // $100 in cents
    expect(createCall.payment_intent_data.transfer_data.destination).toBe('acct_test123');
    expect(createCall.payment_intent_data.application_fee_amount).toBe(100); // 1% of 10000
    expect(createCall.metadata.coinpay_invoice_id).toBe('inv-1');
    expect(createCall.metadata.business_id).toBe('biz-1');
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
});
