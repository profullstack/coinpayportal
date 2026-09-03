import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPayment } from './service';
import { getCryptoPrice } from '../rates/tatum';
import { getUsdFxRate } from '../rates/fx';
import { getEstimatedNetworkFee } from './network-fees';
import { generatePaymentAddress } from '../wallets/system-wallet';

vi.mock('../rates/tatum', () => ({ getCryptoPrice: vi.fn() }));
vi.mock('../rates/fx', () => ({ getUsdFxRate: vi.fn() }));
vi.mock('./network-fees', () => ({
  STATIC_NETWORK_FEES_USD: {},
  getEstimatedNetworkFee: vi.fn(),
  getStaticNetworkFee: vi.fn(),
}));
vi.mock('../entitlements/service', () => ({ isBusinessPaidTier: vi.fn() }));
vi.mock('../wallets/system-wallet', () => ({ generatePaymentAddress: vi.fn() }));

const businessId = '550e8400-e29b-41d4-a716-446655440000';
const payment = {
  id: 'payment-existing',
  business_id: businessId,
  amount: 40,
  currency: 'USD',
  blockchain: 'SOL',
  status: 'pending',
  crypto_amount: 0.5,
  payment_address: 'So11111111111111111111111111111111111111112',
  metadata: { idempotency_key: 'invoice:inv-1:initial' },
  created_at: '2026-09-03T00:00:00.000Z',
};

function lookupResult(data: any, error: any = null) {
  const query: any = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  return query;
}

describe('createPayment idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEstimatedNetworkFee).mockResolvedValue(0);
    vi.mocked(getUsdFxRate).mockResolvedValue(1);
    vi.mocked(getCryptoPrice).mockResolvedValue(0.5);
  });

  it('returns an existing payment before pricing or allocating an address', async () => {
    const lookup = lookupResult(payment);
    const supabase = { from: vi.fn(() => lookup) } as unknown as SupabaseClient;

    const result = await createPayment(supabase, {
      business_id: businessId,
      amount: 40,
      currency: 'USD',
      blockchain: 'SOL',
      idempotency_key: ' invoice:inv-1:initial ',
    });

    expect(result).toMatchObject({ success: true, replayed: true, payment });
    expect(getCryptoPrice).not.toHaveBeenCalled();
    expect(generatePaymentAddress).not.toHaveBeenCalled();
    expect(lookup.eq).toHaveBeenCalledWith('metadata->>idempotency_key', 'invoice:inv-1:initial');
  });

  it('rejects reuse of a key with different payment parameters', async () => {
    const lookup = lookupResult(payment);
    const supabase = { from: vi.fn(() => lookup) } as unknown as SupabaseClient;

    const result = await createPayment(supabase, {
      business_id: businessId,
      amount: 41,
      currency: 'USD',
      blockchain: 'SOL',
      idempotency_key: 'invoice:inv-1:initial',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/different payment parameters/i);
    expect(getCryptoPrice).not.toHaveBeenCalled();
    expect(generatePaymentAddress).not.toHaveBeenCalled();
  });

  it('recovers the winning payment after a concurrent unique-index conflict', async () => {
    const firstLookup = lookupResult(null);
    const insert = {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value' },
          }),
        })),
      })),
    };
    const conflictLookup = lookupResult(payment);
    const from = vi
      .fn()
      .mockReturnValueOnce(firstLookup)
      .mockReturnValueOnce(insert)
      .mockReturnValueOnce(conflictLookup);
    const supabase = { from } as unknown as SupabaseClient;

    const result = await createPayment(supabase, {
      business_id: businessId,
      amount: 40,
      currency: 'USD',
      blockchain: 'SOL',
      idempotency_key: 'invoice:inv-1:initial',
    });

    expect(result).toMatchObject({ success: true, replayed: true, payment });
    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          idempotency_key: 'invoice:inv-1:initial',
        }),
      })
    );
    expect(generatePaymentAddress).not.toHaveBeenCalled();
  });

  it('does not let caller metadata opt into the idempotency namespace', async () => {
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { ...payment, id: 'payment-new', metadata: {} },
          error: null,
        }),
      })),
    }));
    const supabase = {
      from: vi.fn(() => ({ insert })),
    } as unknown as SupabaseClient;
    vi.mocked(generatePaymentAddress).mockResolvedValue({
      success: true,
      address: payment.payment_address,
    });

    const result = await createPayment(supabase, {
      business_id: businessId,
      amount: 40,
      currency: 'USD',
      blockchain: 'SOL',
      metadata: { idempotency_key: 'attacker-controlled', order_id: '42' },
    });

    expect(result.success).toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.not.objectContaining({ idempotency_key: expect.anything() }),
      })
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ order_id: '42' }),
      })
    );
  });

  it('releases the idempotency key after address allocation fails', async () => {
    const firstLookup = lookupResult(null);
    const insertedPayment = {
      ...payment,
      id: 'payment-new',
      payment_address: undefined,
      metadata: {
        idempotency_key: 'invoice:inv-1:initial',
        order_id: '42',
      },
    };
    const insert = {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: insertedPayment, error: null }),
        })),
      })),
    };
    const updateQuery = {
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    const update = {
      update: vi.fn(() => updateQuery),
    };
    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(firstLookup)
        .mockReturnValueOnce(insert)
        .mockReturnValueOnce(update),
    } as unknown as SupabaseClient;
    vi.mocked(generatePaymentAddress).mockResolvedValue({
      success: false,
      error: 'address pool unavailable',
    });

    const result = await createPayment(supabase, {
      business_id: businessId,
      amount: 40,
      currency: 'USD',
      blockchain: 'SOL',
      idempotency_key: 'invoice:inv-1:initial',
      metadata: { order_id: '42' },
    });

    expect(result).toMatchObject({ success: false });
    expect(update.update).toHaveBeenCalledWith({
      status: 'expired',
      metadata: expect.objectContaining({
        order_id: '42',
        failure_reason: 'address_generation_failed',
      }),
    });
    expect(update.update.mock.calls[0][0].metadata).not.toHaveProperty('idempotency_key');
  });
});
