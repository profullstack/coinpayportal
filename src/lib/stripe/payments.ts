import type Stripe from 'stripe';
import { getStripeClient } from './client';

export type MerchantTier = 'free' | 'pro';

/**
 * Calculate platform fee based on merchant tier
 * Free tier: 1%, Pro tier: 0.5%
 * All amounts in cents
 */
export function calculatePlatformFee(amount: number, tier: MerchantTier): number {
  const rate = tier === 'pro' ? 0.005 : 0.01;
  return Math.round(amount * rate);
}

export interface CreateGatewayChargeParams {
  amount: number;
  currency: string;
  stripeAccountId: string;
  merchantTier: MerchantTier;
  description?: string;
  metadata?: Record<string, string>;
}

/**
 * Create a destination charge (gateway mode)
 * Funds go directly to merchant's connected account minus platform fee
 */
export async function createGatewayCharge(
  params: CreateGatewayChargeParams
): Promise<Stripe.PaymentIntent> {
  const stripe = getStripeClient();
  const platformFee = calculatePlatformFee(params.amount, params.merchantTier);

  return stripe.paymentIntents.create({
    amount: params.amount,
    currency: params.currency,
    application_fee_amount: platformFee,
    transfer_data: {
      destination: params.stripeAccountId,
    },
    description: params.description,
    metadata: {
      ...params.metadata,
      mode: 'gateway',
      platform_fee: String(platformFee),
    },
  });
}

export interface CreateEscrowChargeParams {
  amount: number;
  currency: string;
  merchantId: string;
  merchantTier: MerchantTier;
  releaseAfterDays?: number;
  description?: string;
  metadata?: Record<string, string>;
}

/**
 * Create a platform charge (escrow mode)
 * Funds land in platform balance, transferred to merchant on release
 */
export async function createEscrowCharge(
  params: CreateEscrowChargeParams
): Promise<Stripe.PaymentIntent> {
  const stripe = getStripeClient();
  const platformFee = calculatePlatformFee(params.amount, params.merchantTier);

  return stripe.paymentIntents.create({
    amount: params.amount,
    currency: params.currency,
    description: params.description,
    metadata: {
      ...params.metadata,
      mode: 'escrow',
      coinpay_merchant_id: params.merchantId,
      platform_fee: String(platformFee),
      release_after_days: String(params.releaseAfterDays ?? 7),
    },
  });
}
