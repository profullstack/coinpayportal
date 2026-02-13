import type Stripe from 'stripe';
import { getStripeClient } from './client';

export interface CreateExpressAccountParams {
  merchantId: string;
  email: string;
  country?: string;
}

export interface OnboardingLinkParams {
  stripeAccountId: string;
  refreshUrl: string;
  returnUrl: string;
}

/**
 * Create a Stripe Express connected account
 */
export async function createExpressAccount(
  params: CreateExpressAccountParams
): Promise<Stripe.Account> {
  const stripe = getStripeClient();
  return stripe.accounts.create({
    type: 'express',
    email: params.email,
    country: params.country || 'US',
    metadata: {
      coinpay_merchant_id: params.merchantId,
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  });
}

/**
 * Generate an onboarding link for an Express account
 */
export async function generateOnboardingLink(
  params: OnboardingLinkParams
): Promise<Stripe.AccountLink> {
  const stripe = getStripeClient();
  return stripe.accountLinks.create({
    account: params.stripeAccountId,
    refresh_url: params.refreshUrl,
    return_url: params.returnUrl,
    type: 'account_onboarding',
  });
}

/**
 * Get the status of a connected account
 */
export async function getAccountStatus(
  stripeAccountId: string
): Promise<Stripe.Account> {
  const stripe = getStripeClient();
  return stripe.accounts.retrieve(stripeAccountId);
}

/**
 * Handle account.updated webhook event — returns fields to update in DB
 */
export function handleAccountUpdated(account: Stripe.Account) {
  return {
    charges_enabled: account.charges_enabled ?? false,
    payouts_enabled: account.payouts_enabled ?? false,
    details_submitted: account.details_submitted ?? false,
    country: account.country ?? null,
    email: account.email ?? null,
    updated_at: new Date().toISOString(),
  };
}
