import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockSupabase,
  mockAuthorize,
  mockScreen,
  mockIsPaidTier,
  mockCreateOrder,
  mockResolveContext,
} = vi.hoisted(() => ({
  mockSupabase: { from: vi.fn() },
  mockAuthorize: vi.fn(),
  mockScreen: vi.fn(),
  mockIsPaidTier: vi.fn(),
  mockCreateOrder: vi.fn(),
  mockResolveContext: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn().mockReturnValue(mockSupabase) }));
// Each of these is unit-tested where it lives; here we only care how the route
// reacts to what they say.
vi.mock('@/lib/auth/payment-auth', () => ({ authorizePaymentCreation: mockAuthorize }));
vi.mock('@/lib/fraud/screen', () => ({ screenCheckout: mockScreen }));
vi.mock('@/lib/entitlements/service', () => ({ isBusinessPaidTier: mockIsPaidTier }));
vi.mock('@/lib/paypal/client', () => ({ createPaypalOrder: mockCreateOrder }));
vi.mock('@/lib/paypal/accounts', () => ({ resolvePaypalContext: mockResolveContext }));
vi.mock('@/lib/web-wallet/client-ip', () => ({ getClientIp: () => '1.2.3.4' }));

import { POST } from './route';

const PARTNER_CONTEXT = {
  mode: 'partner',
  creds: { clientId: 'pcid', clientSecret: 'psecret', environment: 'sandbox' },
  callContext: { authAssertionMerchantId: 'MERCHANT1', bnCode: 'BN1' },
  payeeMerchantId: 'MERCHANT1',
  platformFeePayeeMerchantId: 'PARTNER1',
  supportsPlatformFee: true,
  paymentsReceivable: true,
  merchantIdInPaypal: 'MERCHANT1',
  environment: 'sandbox',
};

const SELF_SERVE_CONTEXT = {
  ...PARTNER_CONTEXT,
  mode: 'self_serve',
  callContext: {},
  payeeMerchantId: null,
  platformFeePayeeMerchantId: null,
  supportsPlatformFee: false,
};

/** Captures what was inserted so assertions can read it back. */
let insertedRow: any = null;

function wireSupabase() {
  insertedRow = null;
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'businesses') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { merchant_id: 'merch-1', name: 'Acme' }, error: null }),
          }),
        }),
      };
    }
    if (table === 'paypal_transactions') {
      return {
        insert: (values: any) => {
          insertedRow = values;
          return {
            select: () => ({ single: async () => ({ data: { id: 'txn-1' }, error: null }) }),
          };
        },
        update: () => ({ eq: () => ({ error: null, eq: () => ({ error: null }) }) }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

function request(body: any) {
  return new NextRequest('https://app.test/api/paypal/payments/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: 'Bearer cp_live_x' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/paypal/payments/create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wireSupabase();
    mockAuthorize.mockResolvedValue({ ok: true, via: 'api_key', merchantId: 'merch-1' });
    mockScreen.mockResolvedValue({ decision: 'allow', score: 0, findings: [], buyerMessage: '' });
    mockIsPaidTier.mockResolvedValue(false);
    mockResolveContext.mockResolvedValue(PARTNER_CONTEXT);
    mockCreateOrder.mockResolvedValue({
      orderId: 'ORDER-1',
      approveUrl: 'https://paypal/approve',
      status: 'CREATED',
    });
  });

  it('creates an order and charges the free-tier rate', async () => {
    const res = await POST(request({ businessId: 'biz-1', amount: 100, currency: 'USD' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    // Free tier is 1%. Hardcoding a rate here is what caused the Stripe rail's
    // 50% revenue shortfall, so the tier has to reach the fee.
    expect(body.platform_fee_amount).toBe(1);
    expect(body.approve_url).toBe('https://paypal/approve');
    expect(body.checkout_url).toBe('https://paypal/approve');
    expect(mockCreateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 100,
        platformFee: 1,
        payeeMerchantId: 'MERCHANT1',
        platformFeePayeeMerchantId: 'PARTNER1',
        // custom_id must be the row id so the webhook can find it without
        // trusting anything the payer's browser sends back.
        customId: 'txn-1',
      })
    );
  });

  it('charges the paid-tier rate for a subscribed merchant', async () => {
    mockIsPaidTier.mockResolvedValue(true);
    const res = await POST(request({ businessId: 'biz-1', amount: 100 }));
    expect((await res.json()).platform_fee_amount).toBe(0.5);
  });

  it('takes no platform fee in self-serve mode', async () => {
    // PayPal rejects platform_fees on a first-party order, so this mode has to
    // come out at zero rather than sending a fee PayPal will refuse.
    mockResolveContext.mockResolvedValue(SELF_SERVE_CONTEXT);
    const res = await POST(request({ businessId: 'biz-1', amount: 100 }));
    const body = await res.json();

    expect(body.platform_fee_amount).toBe(0);
    expect(body.platform_fee_supported).toBe(false);
    expect(mockCreateOrder).toHaveBeenCalledWith(
      expect.objectContaining({ platformFee: null, payeeMerchantId: null })
    );
  });

  it('reads amount_cents as minor units', async () => {
    const res = await POST(request({ businessId: 'biz-1', amount_cents: 2500 }));
    expect((await res.json()).amount).toBe(25);
    expect(mockCreateOrder).toHaveBeenCalledWith(expect.objectContaining({ amount: 25 }));
  });

  it('rejects amount and amount_cents together rather than guessing', async () => {
    // The 100x bug this guards against is silent in both directions.
    const res = await POST(request({ businessId: 'biz-1', amount: 25, amount_cents: 2500 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not both/);
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it('rejects a fractional amount_cents', async () => {
    const res = await POST(request({ businessId: 'biz-1', amount_cents: 25.5 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/whole number/);
  });

  it('rejects a non-positive amount', async () => {
    const res = await POST(request({ businessId: 'biz-1', amount: 0 }));
    expect(res.status).toBe(400);
  });

  it('refuses when the caller is not authorized for the business', async () => {
    mockAuthorize.mockResolvedValue({ ok: false, status: 403, error: 'nope' });
    const res = await POST(request({ businessId: 'biz-1', amount: 10 }));

    expect(res.status).toBe(403);
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it('refuses when PayPal is not connected', async () => {
    mockResolveContext.mockResolvedValue({ error: 'PayPal is not connected', status: 400 });
    const res = await POST(request({ businessId: 'biz-1', amount: 10 }));

    expect(res.status).toBe(400);
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it('blocks a checkout the fraud screen rejects, before PayPal sees it', async () => {
    mockScreen.mockResolvedValue({
      decision: 'block',
      score: 90,
      findings: [{ code: 'BLOCKLIST' }],
      buyerMessage: 'This payment cannot be processed.',
    });

    const res = await POST(request({ businessId: 'biz-1', amount: 10 }));
    expect(res.status).toBe(403);
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it('lets an elevated-risk checkout through, since PayPal has no 3DS lever', async () => {
    mockScreen.mockResolvedValue({
      decision: 'verify',
      score: 60,
      findings: [{ code: 'VELOCITY' }],
      buyerMessage: '',
    });

    const res = await POST(request({ businessId: 'biz-1', amount: 10 }));
    expect(res.status).toBe(200);
    expect(mockCreateOrder).toHaveBeenCalled();
  });

  it('marks the row failed when PayPal refuses the order', async () => {
    mockCreateOrder.mockRejectedValue(new Error('PAYEE_ACCOUNT_RESTRICTED'));
    const res = await POST(request({ businessId: 'biz-1', amount: 10 }));

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/PAYEE_ACCOUNT_RESTRICTED/);
  });

  it('records the transaction before calling PayPal', async () => {
    await POST(request({ businessId: 'biz-1', amount: 40, customerEmail: 'buyer@example.com' }));

    // Written up front so the id can travel to PayPal as custom_id, and so a
    // payer who abandons checkout still leaves a trace.
    expect(insertedRow).toMatchObject({
      business_id: 'biz-1',
      amount: 40,
      status: 'pending',
      connection_mode: 'partner',
      customer_email: 'buyer@example.com',
    });
  });
});
