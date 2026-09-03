import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { activateInvoicePayment } from './activation';
import { createPayment } from '@/lib/payments/service';
import { createInvoiceStripeCheckout } from '@/lib/payments/invoice-stripe';
import { businessHasPaypal } from '@/lib/paypal/accounts';
import { getEnabledManualMethods } from '@/lib/payment-methods/manual';

vi.mock('@/lib/payments/service', () => ({ createPayment: vi.fn() }));
vi.mock('@/lib/entitlements/service', () => ({
  isBusinessPaidTier: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/lib/payments/invoice-stripe', () => ({
  createInvoiceStripeCheckout: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/paypal/accounts', () => ({
  businessHasPaypal: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/lib/payment-methods/manual', () => ({
  getEnabledManualMethods: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/payments/payee', () => ({
  assertPayee: vi.fn((address: string) => ({ ok: true, address })),
  resolvePayee: vi.fn(),
}));
vi.mock('@/lib/email/invoice-delivery', () => ({
  getInvoicePaymentLink: vi.fn((id: string) => `https://coinpayportal.com/now/${id}`),
}));

const invoice = {
  id: 'inv-1',
  invoice_number: 'INV-001',
  status: 'draft',
  amount: '40.00',
  currency: 'USD',
  crypto_currency: 'SOL',
  merchant_wallet_address: 'So11111111111111111111111111111111111111112',
  fee_rate: '0.01',
  due_date: null,
  business_id: 'biz-1',
  user_id: 'merchant-1',
  metadata: {},
  businesses: { merchant_id: 'merchant-1' },
};

function invoiceClient(
  options: {
    updateData?: any;
    updateError?: any;
    reloaded?: any;
  } = {}
) {
  const updateQuery: any = {};
  updateQuery.eq = vi.fn(() => updateQuery);
  updateQuery.select = vi.fn(() => updateQuery);
  updateQuery.maybeSingle = vi.fn().mockResolvedValue({
    data:
      options.updateData === undefined
        ? { ...invoice, status: 'sent', payment_address: 'pay-address' }
        : options.updateData,
    error: options.updateError || null,
  });

  const reloadQuery: any = {};
  reloadQuery.select = vi.fn(() => reloadQuery);
  reloadQuery.eq = vi.fn(() => reloadQuery);
  reloadQuery.single = vi.fn().mockResolvedValue({
    data: options.reloaded || null,
    error: options.reloaded ? null : { code: 'PGRST116' },
  });

  const table = {
    update: vi.fn(() => updateQuery),
    select: vi.fn(() => reloadQuery),
  };
  return {
    supabase: { from: vi.fn(() => table) } as unknown as SupabaseClient,
    table,
    updateQuery,
  };
}

describe('activateInvoicePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createPayment).mockResolvedValue({
      success: true,
      payment: {
        id: 'payment-1',
        business_id: 'biz-1',
        amount: 40,
        currency: 'USD',
        blockchain: 'SOL',
        status: 'pending',
        crypto_amount: 0.5,
        payment_address: 'pay-address',
        created_at: '2026-09-03T00:00:00.000Z',
      },
    });
    vi.mocked(createInvoiceStripeCheckout).mockResolvedValue(null);
    vi.mocked(businessHasPaypal).mockResolvedValue(false);
    vi.mocked(getEnabledManualMethods).mockResolvedValue([]);
  });

  it('uses one deterministic payment and Stripe key for the initial publish', async () => {
    const { supabase, table, updateQuery } = invoiceClient();

    const result = await activateInvoicePayment(supabase, invoice);

    expect(result).toMatchObject({
      ok: true,
      paymentLink: 'https://coinpayportal.com/now/inv-1',
      idempotentReplay: false,
    });
    expect(createPayment).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        amount: 40,
        merchant_wallet_address: invoice.merchant_wallet_address,
        idempotency_key: 'invoice:inv-1:initial',
        metadata: expect.objectContaining({
          invoice_id: 'inv-1',
        }),
      })
    );
    expect(createInvoiceStripeCheckout).toHaveBeenCalledWith(
      supabase,
      invoice,
      false,
      'invoice:inv-1:initial:stripe'
    );
    expect(table.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'sent',
        payment_address: 'pay-address',
        metadata: expect.objectContaining({
          coinpay_payment_id: 'payment-1',
          payment_activation_key: 'invoice:inv-1:initial',
        }),
      })
    );
    expect(updateQuery.eq).toHaveBeenCalledWith('status', 'draft');
  });

  it('does not mutate the invoice while a winning request is still allocating its address', async () => {
    vi.mocked(createPayment).mockResolvedValue({
      success: true,
      replayed: true,
      payment: {
        id: 'payment-1',
        business_id: 'biz-1',
        amount: 40,
        currency: 'USD',
        blockchain: 'SOL',
        status: 'pending',
        created_at: '2026-09-03T00:00:00.000Z',
      },
    });
    const { supabase, table } = invoiceClient();

    const result = await activateInvoicePayment(supabase, invoice);

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'PAYMENT_CREATION_IN_PROGRESS',
    });
    expect(table.update).not.toHaveBeenCalled();
    expect(createInvoiceStripeCheckout).not.toHaveBeenCalled();
  });

  it('preserves existing Stripe details when renewal cannot resolve Stripe', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(createInvoiceStripeCheckout).mockRejectedValue(new Error('Stripe unavailable'));
    const overdueInvoice = {
      ...invoice,
      status: 'overdue',
      stripe_checkout_url: 'https://checkout.stripe.com/old',
      stripe_session_id: 'cs_old',
    };
    const { supabase, table } = invoiceClient();

    const result = await activateInvoicePayment(supabase, overdueInvoice);

    expect(result).toMatchObject({ ok: true });
    const update = table.update.mock.calls[0][0];
    expect(update).not.toHaveProperty('stripe_checkout_url');
    expect(update).not.toHaveProperty('stripe_session_id');
  });

  it('clears existing Stripe details after a successful no-account lookup', async () => {
    vi.mocked(createInvoiceStripeCheckout).mockResolvedValue(null);
    const overdueInvoice = {
      ...invoice,
      status: 'overdue',
      stripe_checkout_url: 'https://checkout.stripe.com/old',
      stripe_session_id: 'cs_old',
    };
    const { supabase, table } = invoiceClient();

    const result = await activateInvoicePayment(supabase, overdueInvoice);

    expect(result).toMatchObject({ ok: true });
    expect(table.update).toHaveBeenCalledWith(
      expect.objectContaining({
        stripe_checkout_url: null,
        stripe_session_id: null,
      })
    );
  });

  it('preserves existing optional payment methods when their lookups fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(businessHasPaypal).mockRejectedValue(new Error('PayPal unavailable'));
    vi.mocked(getEnabledManualMethods).mockRejectedValue(new Error('Methods unavailable'));
    const overdueInvoice = {
      ...invoice,
      status: 'overdue',
      paypal_enabled: true,
      manual_methods: [{ method_id: 'zelle' }],
    };
    const { supabase, table } = invoiceClient();

    const result = await activateInvoicePayment(supabase, overdueInvoice);

    expect(result).toMatchObject({ ok: true });
    const update = table.update.mock.calls[0][0];
    expect(update).not.toHaveProperty('paypal_enabled');
    expect(update).not.toHaveProperty('manual_methods');
  });

  it('returns the invoice activated by a concurrent winner after the CAS misses', async () => {
    const winner = { ...invoice, status: 'sent', payment_address: 'winner-address' };
    const { supabase } = invoiceClient({ updateData: null, reloaded: winner });

    const result = await activateInvoicePayment(supabase, invoice);

    expect(result).toMatchObject({
      ok: true,
      invoice: { status: 'sent', payment_address: 'winner-address' },
      idempotentReplay: true,
    });
  });
});
