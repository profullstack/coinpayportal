/**
 * Platform-level PayPal configuration.
 *
 * CoinPay supports PayPal in two modes, and this file is the seam between them:
 *
 *  - **Partner mode** (the Stripe Connect analogue). CoinPay is a PayPal
 *    Commerce Platform partner. Merchants onboard through a Partner Referrals
 *    link, we hold a `merchant_id_in_paypal` for them, and we create orders on
 *    their behalf with `PayPal-Auth-Assertion` while taking a `platform_fees`
 *    cut. Requires the platform credentials below.
 *
 *  - **Self-serve mode** (what shipped first, for invoices). The merchant pastes
 *    their own REST app client id/secret and we call PayPal *as them*. PayPal
 *    forbids `platform_fees` on a first-party call, so there is no platform
 *    commission on this mode — see `supportsPlatformFee` in ./accounts.
 *
 * Env is read through a variable key on purpose. Next.js statically inlines
 * `process.env.LITERAL` at build time, including in server code, so a value that
 * only exists at runtime compiles in as `undefined` permanently. Indexing with a
 * variable defeats that substitution and reads the live environment.
 */

import type { PaypalEnvironment } from './client';

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export interface PaypalPlatformConfig {
  /** Partner REST app client id. */
  clientId: string;
  /** Partner REST app client secret. */
  clientSecret: string;
  environment: PaypalEnvironment;
  /** The partner's own PayPal merchant id — the payee of every platform fee. */
  partnerMerchantId: string;
  /**
   * BN code / attribution id issued by PayPal to the partner. Optional, but
   * PayPal asks partners to send it on every call and keys revenue share off it.
   */
  bnCode: string | null;
  /** Webhook id for the partner app, required to verify inbound webhooks. */
  webhookId: string | null;
}

/**
 * Resolve the platform PayPal config, or null when partner mode is not
 * configured. Callers treat null as "partner onboarding unavailable" rather
 * than as an error — self-serve credentials still work without it.
 */
export function getPaypalPlatformConfig(): PaypalPlatformConfig | null {
  const clientId = env('PAYPAL_PLATFORM_CLIENT_ID');
  const clientSecret = env('PAYPAL_PLATFORM_CLIENT_SECRET');
  const partnerMerchantId = env('PAYPAL_PARTNER_MERCHANT_ID');

  if (!clientId || !clientSecret || !partnerMerchantId) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    environment: env('PAYPAL_ENVIRONMENT') === 'sandbox' ? 'sandbox' : 'live',
    partnerMerchantId,
    bnCode: env('PAYPAL_BN_CODE') ?? null,
    webhookId: env('PAYPAL_WEBHOOK_ID') ?? null,
  };
}

/** Same as getPaypalPlatformConfig but throws with an actionable message. */
export function requirePaypalPlatformConfig(): PaypalPlatformConfig {
  const config = getPaypalPlatformConfig();
  if (!config) {
    throw new Error(
      'PayPal partner mode is not configured. Set PAYPAL_PLATFORM_CLIENT_ID, ' +
        'PAYPAL_PLATFORM_CLIENT_SECRET and PAYPAL_PARTNER_MERCHANT_ID.'
    );
  }
  return config;
}

/** True when the platform is set up to onboard merchants as a PayPal partner. */
export function isPaypalPartnerModeEnabled(): boolean {
  return getPaypalPlatformConfig() !== null;
}
