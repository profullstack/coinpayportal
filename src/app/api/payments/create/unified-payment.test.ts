import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockStripe, mockSupabase, mockAuthResult, mockLimitResult, mockCreatePayment } = vi.hoisted(() => {
  const mockStripe = {
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: 'cs_test_unified_123',
          url: 'https://checkout.stripe.com/pay/cs_test_unified_123',
        }),
      },
    },
  };

  const mockSupabase = {
    from: vi.fn(),
  };

  const mockAuthResult = {
    success: true,
    context: {
      type: 'merchant' as const,
      merchantId: 'merchant_123',
    },
  };

  const mockLimitResult = {
    allowed: true,
    currentUsage: 5,
    limit: 100,
    remaining: 95,
  };

  const mockCreatePayment = vi.fn();

  return { mockStripe, mockSupabase, mockAuthResult, mockLimitResult, mockCreatePayment };
});

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => mockStripe),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue(mockSupabase),
}));

vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: vi.fn().mockResolvedValue(mockAuthResult),
  isMerchantAuth: vi.fn().mockImplementation((ctx: any) => ctx.type === 'merchant'),
  isBusinessAuth: vi.fn().mockImplementation((ctx: any) => ctx.type === 'business'),
  hasScope: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/entitlements/middleware', () => ({
  withTransactionLimit: vi.fn().mockResolvedValue(mockLimitResult),
  createEntitlementErrorResponse: vi.fn(),
}));

vi.mock('@/lib/entitlements/service', () => ({
  // Quota is spent atomically at creation time (consume_transaction_quota),
  // not read-then-incremented, so the mock mirrors that contract.
  consumeTransactionQuota: vi.fn().mockResolvedValue({ allowed: true, currentUsage: 1 }),
  releaseTransactionQuota: vi.fn().mockResolvedValue(undefined),
  // The card branch used to read `businesses.tier`, a column that does not
  // exist, so the fee always fell through to the free rate. It now resolves the
  // tier through the merchant's subscription like every other rail.
  isBusinessPaidTier: (...args: unknown[]) => mockIsBusinessPaidTier(...args),
}));

const mockIsBusinessPaidTier = vi.fn();

// N-01: the card rail creates a real charge, so it is screened before the
// Stripe session exists. Default: allow.
const mockScreenCheckout = vi.fn();
vi.mock('@/lib/fraud/screen', () => ({
  screenCheckout: (...args: unknown[]) => mockScreenCheckout(...args),
}));

vi.mock('@/lib/payments/service', () => ({
  createPayment: mockCreatePayment,
  Blockchain: {},
}));

import { POST } from './route';
import { releaseTransactionQuota } from '@/lib/entitlements/service';

mockScreenCheckout.mockResolvedValue({
  decision: 'allow',
  score: 0,
  findings: [],
  signals: {},
  misrepresentation: null,
});
mockIsBusinessPaidTier.mockResolvedValue(false);

function mockSingleQuery(response: any) {
  const query: any = {
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue(response),
    // resolveBusinessRole() in the team-authz path reads businesses via
    // .eq('id', …).maybeSingle(); the Stripe fee lookup still uses .single().
    maybeSingle: vi.fn().mockResolvedValue(response),
  };
  query.eq.mockReturnValue(query);
  return query;
}

function mockIdempotencyLookup(response: any) {
  const query: any = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(response),
  };
  query.eq.mockReturnValue(query);
  return query;
}

function setupMockChain(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = {
    business_wallets: {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { wallet_address: '0xMerchantWallet123' },
              }),
            }),
          }),
        }),
      }),
    },
    stripe_accounts: {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { stripe_account_id: 'acct_connected_123', charges_enabled: true },
          }),
        }),
      }),
    },
    businesses: {
      select: vi.fn().mockReturnValue(mockSingleQuery({
        data: { id: 'biz_123', tier: 'free', merchant_id: 'merchant_123' },
      })),
    },
    payments: {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'payment_card_only_123',
              business_id: 'biz_123',
              amount: '50.00',
              status: 'pending',
              metadata: {},
            },
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [{}] }),
      }),
    },
  };

  const merged = { ...defaults, ...overrides };
  mockSupabase.from.mockImplementation((table: string) => merged[table] || {});
}

function makeRequest(body: Record<string, any>, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/payments/create', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test_token',
      ...headers,
    },
  });
}

describe('Unified Payment Creation - POST /api/payments/create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks wipes implementations, so restore the defaults each test.
    mockIsBusinessPaidTier.mockResolvedValue(false);
    mockScreenCheckout.mockResolvedValue({
      decision: 'allow',
      score: 0,
      findings: [],
      signals: {},
      misrepresentation: null,
    });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.NEXT_PUBLIC_APP_URL = 'https://coinpayportal.com';
    setupMockChain();
  });

  describe('payment_method=crypto (default)', () => {
    it('returns quota when the service resolves a concurrent idempotent retry', async () => {
      const existing = {
        id: 'pay_existing',
        business_id: 'biz_123',
        amount: '40.00',
        crypto_amount: '0.5',
        blockchain: 'SOL',
        status: 'pending',
        payment_address: 'So11111111111111111111111111111111111111112',
      };
      const paymentTable = {
        select: vi.fn().mockReturnValue(mockSingleQuery({ data: null, error: null })),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [{}] }),
        }),
      };
      setupMockChain({ payments: paymentTable });
      mockCreatePayment.mockResolvedValue({
        success: true,
        payment: existing,
        replayed: true,
      });

      const response = await POST(
        makeRequest(
          {
            business_id: 'biz_123',
            amount_usd: 40,
            currency: 'sol',
            payment_method: 'both',
          },
          { 'Idempotency-Key': 'invoice:inv-1:initial' }
        )
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        success: true,
        idempotent_replay: true,
        payment: { id: 'pay_existing' },
      });
      expect(releaseTransactionQuota).toHaveBeenCalledWith(mockSupabase, 'merchant_123');
      expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('should create a crypto payment when no payment_method is specified', async () => {
      mockCreatePayment.mockResolvedValue({
        success: true,
        payment: {
          id: 'pay_crypto_123',
          business_id: 'biz_123',
          amount: '100.00',
          crypto_amount: '0.00234',
          blockchain: 'BTC',
          status: 'pending',
          payment_address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        },
      });

      const request = makeRequest({
        business_id: 'biz_123',
        amount_usd: 100,
        currency: 'btc',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.payment.id).toBe('pay_crypto_123');
      expect(data.payment.amount_usd).toBe('100.00');
      expect(data.payment.amount_crypto).toBe('0.00234');
      // No stripe fields
      expect(data.payment.stripe_checkout_url).toBeUndefined();
      expect(data.payment.stripe_session_id).toBeUndefined();
    });

    it('should create a crypto payment when payment_method=crypto', async () => {
      mockCreatePayment.mockResolvedValue({
        success: true,
        payment: {
          id: 'pay_crypto_456',
          amount: '50.00',
          crypto_amount: '50.01',
          blockchain: 'USDC_POL',
          status: 'pending',
        },
      });

      const request = makeRequest({
        business_id: 'biz_123',
        amount_usd: 50,
        currency: 'usdc_pol',
        payment_method: 'crypto',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.payment.stripe_checkout_url).toBeUndefined();
    });
  });

  describe('payment_method=card', () => {
    it('should create a card-only payment with Stripe Checkout session', async () => {
      const request = makeRequest({
        business_id: 'biz_123',
        amount_usd: 50,
        payment_method: 'card',
        description: 'Test card payment',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.payment.stripe_checkout_url).toBe('https://checkout.stripe.com/pay/cs_test_unified_123');
      expect(data.payment.stripe_session_id).toBe('cs_test_unified_123');
      // Stripe session was created
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    });

    it('replays an existing card payment without creating another Stripe session', async () => {
      const existing = {
        id: 'payment_card_existing',
        business_id: 'biz_123',
        amount: '50.00',
        currency: 'USD',
        blockchain: 'ETH',
        status: 'pending',
        metadata: {
          payment_method: 'card',
          idempotency_key: 'card-order-1',
          stripe_checkout_url: 'https://checkout.stripe.com/pay/cs_existing',
          stripe_session_id: 'cs_existing',
        },
      };
      const lookup = mockIdempotencyLookup({ data: existing, error: null });
      const paymentTable = {
        select: vi.fn(() => lookup),
        insert: vi.fn(),
      };
      setupMockChain({ payments: paymentTable });

      const response = await POST(
        makeRequest(
          {
            business_id: 'biz_123',
            amount_usd: 50,
            payment_method: 'card',
          },
          { 'Idempotency-Key': 'card-order-1' }
        )
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        success: true,
        idempotent_replay: true,
        payment: {
          id: 'payment_card_existing',
          stripe_checkout_url: 'https://checkout.stripe.com/pay/cs_existing',
          stripe_session_id: 'cs_existing',
        },
      });
      expect(paymentTable.insert).not.toHaveBeenCalled();
      expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('rejects a card idempotency key reused for a different amount', async () => {
      const lookup = mockIdempotencyLookup({
        data: {
          id: 'payment_card_existing',
          amount: '51.00',
          currency: 'USD',
          metadata: { payment_method: 'card', idempotency_key: 'card-order-1' },
        },
        error: null,
      });
      setupMockChain({ payments: { select: vi.fn(() => lookup) } });

      const response = await POST(
        makeRequest(
          {
            business_id: 'biz_123',
            amount_usd: 50,
            payment_method: 'card',
          },
          { 'Idempotency-Key': 'card-order-1' }
        )
      );
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('recovers the winning card payment after a concurrent insert', async () => {
      const winner = {
        id: 'payment_card_winner',
        business_id: 'biz_123',
        amount: '50.00',
        currency: 'USD',
        blockchain: 'ETH',
        status: 'pending',
        metadata: {
          payment_method: 'card',
          idempotency_key: 'card-order-race',
          stripe_checkout_url: 'https://checkout.stripe.com/pay/cs_winner',
          stripe_session_id: 'cs_winner',
        },
      };
      const emptyLookup = mockIdempotencyLookup({ data: null, error: null });
      const winnerLookup = mockIdempotencyLookup({ data: winner, error: null });
      const paymentTable = {
        select: vi.fn().mockReturnValueOnce(emptyLookup).mockReturnValueOnce(winnerLookup),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: '23505', message: 'duplicate key value' },
            }),
          })),
        })),
      };
      setupMockChain({ payments: paymentTable });

      const response = await POST(
        makeRequest(
          {
            business_id: 'biz_123',
            amount_usd: 50,
            payment_method: 'card',
          },
          { 'Idempotency-Key': 'card-order-race' }
        )
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        idempotent_replay: true,
        payment: { id: 'payment_card_winner' },
      });
      expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('uses a stable Stripe key when resuming an incomplete card payment', async () => {
      const existing = {
        id: 'payment_card_incomplete',
        business_id: 'biz_123',
        amount: '50.00',
        currency: 'USD',
        blockchain: 'ETH',
        status: 'pending',
        metadata: {
          payment_method: 'card',
          idempotency_key: 'card-order-incomplete',
        },
      };
      const lookup = mockIdempotencyLookup({ data: existing, error: null });
      const paymentTable = {
        select: vi.fn(() => lookup),
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      };
      setupMockChain({ payments: paymentTable });

      const response = await POST(
        makeRequest(
          {
            business_id: 'biz_123',
            amount_usd: 50,
            payment_method: 'card',
          },
          { 'Idempotency-Key': 'card-order-incomplete' }
        )
      );

      expect(response.status).toBe(200);
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ idempotencyKey: expect.stringMatching(/^payment:/) })
      );
      expect(paymentTable.update).toHaveBeenCalledTimes(1);
    });

    it('should return 400 when card is requested but no Stripe connect', async () => {
      setupMockChain({
        stripe_accounts: {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
              }),
            }),
          }),
        },
      });

      const request = makeRequest({
        business_id: 'biz_123',
        amount_usd: 50,
        payment_method: 'card',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Stripe Connect');
    });

    it('should return 400 when Stripe charges are not enabled', async () => {
      setupMockChain({
        stripe_accounts: {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { stripe_account_id: 'acct_123', charges_enabled: false },
              }),
            }),
          }),
        },
      });

      const request = makeRequest({
        business_id: 'biz_123',
        amount_usd: 50,
        payment_method: 'card',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Stripe Connect');
    });
  });

  describe('payment_method=both', () => {
    it('should create both crypto payment and Stripe session', async () => {
      mockCreatePayment.mockResolvedValue({
        success: true,
        payment: {
          id: 'pay_both_123',
          business_id: 'biz_123',
          amount: '100.00',
          crypto_amount: '100.50',
          blockchain: 'USDC_POL',
          status: 'pending',
          payment_address: '0xPaymentAddress123',
          metadata: {},
        },
      });

      const request = makeRequest({
        business_id: 'biz_123',
        amount_usd: 100,
        currency: 'usdc_pol',
        payment_method: 'both',
        description: 'Order #999',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.payment.id).toBe('pay_both_123');
      expect(data.payment.amount_crypto).toBe('100.50');
      expect(data.payment.stripe_checkout_url).toBe('https://checkout.stripe.com/pay/cs_test_unified_123');
      expect(data.payment.stripe_session_id).toBe('cs_test_unified_123');
      // Both createPayment and stripe sessions were called
      expect(mockCreatePayment).toHaveBeenCalledTimes(1);
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    });

    it('should use correct platform fee for pro tier', async () => {
      // Was expressed as `tier: 'pro'` on the businesses row. That column does
      // not exist in the database, which is exactly why this rail charged every
      // business the free rate (CP-P5) — the query errored, the row came back
      // null, and the fee fell through to the default. The tier now comes from
      // the merchant's subscription, like every other rail.
      mockIsBusinessPaidTier.mockResolvedValue(true);
      setupMockChain({
        businesses: {
          select: vi.fn().mockReturnValue(mockSingleQuery({
            data: { id: 'biz_123', merchant_id: 'merchant_123' },
          })),
        },
      });

      mockCreatePayment.mockResolvedValue({
        success: true,
        payment: {
          id: 'pay_pro_123',
          amount: '200.00',
          crypto_amount: '200.50',
          blockchain: 'ETH',
          status: 'pending',
          metadata: {},
        },
      });

      const request = makeRequest({
        business_id: 'biz_123',
        amount_usd: 200,
        currency: 'eth',
        payment_method: 'both',
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      // Pro tier: 0.5% of 20000 cents = 100 cents
      const stripeCallArgs = mockStripe.checkout.sessions.create.mock.calls[0][0];
      expect(stripeCallArgs.payment_intent_data.application_fee_amount).toBe(100);
    });

    it('should use correct platform fee for free tier', async () => {
      mockCreatePayment.mockResolvedValue({
        success: true,
        payment: {
          id: 'pay_free_123',
          amount: '100.00',
          crypto_amount: '100.50',
          blockchain: 'ETH',
          status: 'pending',
          metadata: {},
        },
      });

      const request = makeRequest({
        business_id: 'biz_123',
        amount_usd: 100,
        currency: 'eth',
        payment_method: 'both',
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      // Free tier: 1% of 10000 cents = 100 cents
      const stripeCallArgs = mockStripe.checkout.sessions.create.mock.calls[0][0];
      expect(stripeCallArgs.payment_intent_data.application_fee_amount).toBe(100);
    });
  });

  describe('validation', () => {
    it('should return 400 when amount is missing', async () => {
      const request = makeRequest({
        business_id: 'biz_123',
        currency: 'btc',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('amount');
    });

    it('should return 400 when crypto currency is missing for crypto payment', async () => {
      const request = makeRequest({
        business_id: 'biz_123',
        amount_usd: 100,
        payment_method: 'crypto',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('cryptocurrency');
    });

    it('should allow card payment without crypto currency', async () => {
      const request = makeRequest({
        business_id: 'biz_123',
        amount_usd: 100,
        payment_method: 'card',
      });

      const response = await POST(request);
      const data = await response.json();

      // Should succeed (card doesn't need blockchain type)
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
    });
  });
});
