import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

// Mock Stripe
const mockStripe = {
  paymentIntents: {
    create: vi.fn().mockResolvedValue({
      id: 'pi_test123',
      amount: 5000,
      currency: 'usd',
      status: 'requires_payment_method',
    }),
  },
  checkout: {
    sessions: {
      create: vi.fn().mockResolvedValue({
        id: 'cs_test123',
        url: 'https://checkout.stripe.com/pay/cs_test123',
      }),
    },
  },
};

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => mockStripe),
}));

// Mock Supabase
const mockSupabase = {
  from: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            tier: 'free',
            merchant_id: 'merchant_123',
          },
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ id: 'transaction_123' }],
      }),
    }),
  }),
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue(mockSupabase),
}));

describe('POST /api/stripe/payments/create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://coinpayportal.com';

    // Mock successful business and stripe account lookups
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn()
            .mockResolvedValueOnce({
              data: {
                tier: 'free',
                merchant_id: 'merchant_123',
              },
            })
            .mockResolvedValueOnce({
              data: {
                stripe_account_id: 'acct_test123',
                charges_enabled: true,
              },
            }),
        }),
      }),
      insert: vi.fn().mockResolvedValue({
        data: [{ id: 'transaction_123' }],
      }),
    });
  });

  it('should create a card payment successfully', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/payments/create', {
      method: 'POST',
      body: JSON.stringify({
        businessId: 'biz_123',
        amount: 5000,
        currency: 'usd',
        description: 'Test payment',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.payment_intent_id).toBe('pi_test123');
    expect(data.checkout_url).toBe('https://checkout.stripe.com/pay/cs_test123');
    expect(data.amount).toBe(5000);
    expect(data.platform_fee_amount).toBe(50); // 1% of 5000 for free tier
  });

  it('should create escrow mode payment', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/payments/create', {
      method: 'POST',
      body: JSON.stringify({
        businessId: 'biz_123',
        amount: 5000,
        currency: 'usd',
        description: 'Test escrow payment',
        escrowMode: true,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.escrow_mode).toBe(true);
    expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5000,
        currency: 'usd',
        description: '[ESCROW] Test escrow payment',
        metadata: expect.objectContaining({
          escrow_mode: 'true',
        }),
      })
    );
  });

  it('should calculate pro tier fees correctly', async () => {
    // Mock pro tier business
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn()
            .mockResolvedValueOnce({
              data: {
                tier: 'pro',
                merchant_id: 'merchant_123',
              },
            })
            .mockResolvedValueOnce({
              data: {
                stripe_account_id: 'acct_test123',
                charges_enabled: true,
              },
            }),
        }),
      }),
      insert: vi.fn().mockResolvedValue({
        data: [{ id: 'transaction_123' }],
      }),
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/payments/create', {
      method: 'POST',
      body: JSON.stringify({
        businessId: 'biz_123',
        amount: 5000,
        currency: 'usd',
        description: 'Test payment',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.platform_fee_amount).toBe(25); // 0.5% of 5000 for pro tier
  });

  it('should return 400 for missing required fields', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/payments/create', {
      method: 'POST',
      body: JSON.stringify({
        businessId: 'biz_123',
        // Missing amount and currency
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('required');
  });

  it('should return 404 for non-existent business', async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
          }),
        }),
      }),
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/payments/create', {
      method: 'POST',
      body: JSON.stringify({
        businessId: 'nonexistent_biz',
        amount: 5000,
        currency: 'usd',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Business not found');
  });
});