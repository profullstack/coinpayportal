import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPayment, type Blockchain } from './service';
import { getCryptoPrice } from '../rates/tatum';
import { getEstimatedNetworkFee } from './network-fees';
import { isBusinessPaidTier } from '../entitlements/service';
import { generatePaymentAddress } from '../wallets/system-wallet';

vi.mock('../rates/tatum', () => ({
  getCryptoPrice: vi.fn(),
}));

vi.mock('./network-fees', () => ({
  STATIC_NETWORK_FEES_USD: {},
  getEstimatedNetworkFee: vi.fn(),
  getStaticNetworkFee: vi.fn(),
}));

vi.mock('../entitlements/service', () => ({
  isBusinessPaidTier: vi.fn(),
}));

vi.mock('../wallets/system-wallet', () => ({
  generatePaymentAddress: vi.fn(),
}));

const businessId = '550e8400-e29b-41d4-a716-446655440000';
const merchantWallet = '0x1111111111111111111111111111111111111111';

function createInsertOnlySupabase() {
  let insertedPayment: Record<string, any> | undefined;

  const supabase = {
    from: vi.fn((table: string) => {
      if (table !== 'payments') {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        insert: vi.fn((payload: Record<string, any>) => {
          insertedPayment = payload;
          return {
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'payment-contract-id',
                  ...payload,
                  created_at: '2026-06-06T12:00:00.000Z',
                },
                error: null,
              }),
            })),
          };
        }),
      };
    }),
  } as unknown as SupabaseClient;

  return {
    supabase,
    getInsertedPayment: () => insertedPayment,
  };
}

describe('createPayment CoinPay contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEstimatedNetworkFee).mockResolvedValue(0);
    vi.mocked(generatePaymentAddress).mockResolvedValue({
      success: true,
      address: '0x2222222222222222222222222222222222222222',
    });
  });

  it.each([
    ['USDC_POL', 'USDC'],
    ['USDC_SOL', 'USDC'],
    ['USDT_POL', 'USDT'],
    ['USDT_SOL', 'USDT'],
  ] as Array<[Blockchain, string]>)(
    'keeps %s on the CoinPay address while pricing as %s',
    async (blockchain, priceTicker) => {
      const { supabase, getInsertedPayment } = createInsertOnlySupabase();
      vi.mocked(getCryptoPrice).mockResolvedValue(100);
      vi.mocked(isBusinessPaidTier).mockResolvedValue(false);

      const result = await createPayment(supabase, {
        business_id: businessId,
        amount: 100,
        currency: 'USD',
        blockchain,
        merchant_wallet_address: merchantWallet,
      });

      expect(result.success).toBe(true);
      expect(getCryptoPrice).toHaveBeenCalledWith(100, 'USD', priceTicker);
      expect(getInsertedPayment()).toEqual(expect.objectContaining({
        business_id: businessId,
        amount: 100,
        blockchain,
        crypto_currency: priceTicker,
        merchant_wallet_address: merchantWallet,
      }));
      expect(generatePaymentAddress).toHaveBeenCalledWith(
        supabase,
        'payment-contract-id',
        businessId,
        blockchain,
        merchantWallet,
        100,
        false
      );
    }
  );

  it('passes paid-tier status into CoinPay address generation for commission split', async () => {
    const { supabase } = createInsertOnlySupabase();
    vi.mocked(getCryptoPrice).mockResolvedValue(250);
    vi.mocked(isBusinessPaidTier).mockResolvedValue(true);

    await createPayment(supabase, {
      business_id: businessId,
      amount: 250,
      currency: 'USD',
      blockchain: 'USDC_POL',
      merchant_wallet_address: merchantWallet,
    });

    expect(generatePaymentAddress).toHaveBeenCalledWith(
      supabase,
      'payment-contract-id',
      businessId,
      'USDC_POL',
      merchantWallet,
      250,
      true
    );
  });
});
