import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: vi.fn().mockReturnValue({ userId: 'user-1' }),
}));

vi.mock('@/lib/secrets', () => ({
  getJwtSecret: vi.fn().mockReturnValue('test-secret'),
}));

vi.mock('@/lib/entitlements/service', () => ({
  isBusinessPaidTier: vi.fn().mockResolvedValue(false),
}));

const mockStripeCreate = vi.fn().mockResolvedValue({
  id: 'cs_test_123',
  url: 'https://checkout.stripe.com/pay/cs_test_123',
});

vi.mock('@/lib/server/optional-deps', () => ({
  getStripe: vi.fn().mockResolvedValue({
    checkout: { sessions: { create: (...args: any[]) => mockStripeCreate(...args) } },
  }),
}));

const mockFrom = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

import { POST } from './route';

const baseInvoice = {
  id: 'inv-1',
  invoice_number: 'INV-001',
  status: 'sent',
  currency: 'USD',
  amount: '100.00',
  crypto_currency: 'SOL',
  fee_rate: '0.01',
  business_id: 'biz-1',
  stripe_checkout_url: null,
  businesses: { id: 'biz-1', name: 'Acme', merchant_id: 'merch-1' },
};

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/invoices/inv-1/enable-card', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token' },
  });
}

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
              single: vi.fn().mockResolvedValue({
                data: { ...invoice, stripe_checkout_url: 'https://checkout.stripe.com/pay/cs_test_123' },
                error: null,
              }),
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

describe('POST /api/invoices/[id]/enable-card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://coinpayportal.com';
  });

  it('generates a Stripe checkout URL when the business has cards enabled', async () => {
    setupMocks({ stripeAccount: { stripe_account_id: 'acct_test123', charges_enabled: true } });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockStripeCreate).toHaveBeenCalledTimes(1);
    expect(body.invoice.stripe_checkout_url).toBe('https://checkout.stripe.com/pay/cs_test_123');
  });

  it('returns 409 needsStripeOnboarding when business has no enabled Stripe account', async () => {
    setupMocks({ stripeAccount: null });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.needsStripeOnboarding).toBe(true);
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });

  it('is idempotent when a checkout URL already exists', async () => {
    setupMocks({
      invoice: { ...baseInvoice, stripe_checkout_url: 'https://checkout.stripe.com/pay/existing' },
      stripeAccount: { stripe_account_id: 'acct_test123', charges_enabled: true },
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.alreadyEnabled).toBe(true);
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });

  it('rejects invoices that are not sent/overdue', async () => {
    setupMocks({
      invoice: { ...baseInvoice, status: 'draft' },
      stripeAccount: { stripe_account_id: 'acct_test123', charges_enabled: true },
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'inv-1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });
});
