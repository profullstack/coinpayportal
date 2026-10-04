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
  updated_at: '2026-09-07T00:00:00.000Z',
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
  updateQuery.is = vi.fn(() => updateQuery);
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
    expect(updateQuery.eq).toHaveBeenCalledWith('updated_at', invoice.updated_at);
    expect(updateQuery.eq).toHaveBeenCalledWith('metadata', '{}');
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
    const winner = { ...invoice, status: 'sent', payment_address: 'winner-address',
      metadata: { payment_activation_key: 'invoice:inv-1:initial' } };
    const { supabase } = invoiceClient({ updateData: null, reloaded: winner });

    const result = await activateInvoicePayment(supabase, invoice);

    expect(result).toMatchObject({
      ok: true,
      invoice: { status: 'sent', payment_address: 'winner-address' },
      idempotentReplay: true,
    });
  });

  it.each(['draft', 'overdue'])('uses a stable new key for an edited %s invoice', async (status) => {
    const revision = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const edited = { ...invoice, status, metadata: { invoice_edit_revision: revision, coinpay_payment_id: 'previous-payment' } };
    const { supabase } = invoiceClient();
    await activateInvoicePayment(supabase, edited);
    await activateInvoicePayment(supabase, edited);
    const base = status === 'draft' ? 'initial' : 'renew:previous-payment';
    const key = `invoice:inv-1:${base}:edit:${revision}`;
    expect(vi.mocked(createPayment).mock.calls.map((call) => call[1].idempotency_key)).toEqual([key, key]);
    expect(createInvoiceStripeCheckout).toHaveBeenCalledWith(supabase, edited, false, `${key}:stripe`);
  });

  it('retains the unedited overdue renewal key', async () => {
    const { supabase } = invoiceClient();
    await activateInvoicePayment(supabase, { ...invoice, status: 'overdue', metadata: { coinpay_payment_id: 'previous-payment' } });
    expect(createPayment).toHaveBeenCalledWith(supabase, expect.objectContaining({ idempotency_key: 'invoice:inv-1:renew:previous-payment' }));
  });

  it('does not call a different revision concurrent winner a successful replay', async () => {
    const { supabase } = invoiceClient({ updateData: null, reloaded: { ...invoice,
      status: 'sent', payment_address: 'different-payment', metadata: { payment_activation_key: 'different-key' } } });
    expect(await activateInvoicePayment(supabase, invoice)).toMatchObject({ ok: false, status: 409, code: 'INVOICE_STATE_CHANGED' });
  });

  it('fails closed when an edit wins the guarded update', async () => {
    const { supabase, updateQuery } = invoiceClient({ updateData: null, reloaded: { ...invoice, amount: 41 } });
    expect(await activateInvoicePayment(supabase, invoice)).toMatchObject({ ok: false, status: 409, code: 'INVOICE_STATE_CHANGED' });
    expect(updateQuery.eq).toHaveBeenCalledWith('metadata', '{}');
  });

  it('uses SQL NULL comparisons for legacy nullable revision fields', async () => {
    const { supabase, updateQuery } = invoiceClient();
    await activateInvoicePayment(supabase, { ...invoice, metadata: null, updated_at: null });
    expect(updateQuery.is).toHaveBeenCalledWith('updated_at', null);
    expect(updateQuery.is).toHaveBeenCalledWith('metadata', null);
  });
});
