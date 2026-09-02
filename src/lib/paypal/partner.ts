/**
 * PayPal Partner Referrals — the onboarding half of the Stripe Connect analogue.
 *
 * Flow, which mirrors `stripe.accountLinks.create` + `stripe.accounts.retrieve`:
 *
 *   1. `createPartnerReferral()` returns an `action_url`. We send the merchant
 *      there; they sign in to (or create) their own PayPal account and grant
 *      CoinPay third-party permissions.
 *   2. PayPal redirects back with `merchantIdInPayPal` on the query string, and
 *      also fires `MERCHANT.ONBOARDING.COMPLETED`. Either path lands us the id.
 *   3. `getMerchantIntegration()` is the authority on whether they can actually
 *      take money — `payments_receivable` and `primary_email_confirmed` are the
 *      PayPal equivalents of `charges_enabled` / `details_submitted`.
 *
 * `tracking_id` is our business uuid. PayPal enforces it unique per partner, so
 * a re-onboard of the same business reuses the row rather than orphaning one.
 */

import {
  paypalApiBase,
  getPaypalAccessToken,
  type PaypalCredentials,
} from './client';
import type { PaypalPlatformConfig } from './platform';

export interface CreateReferralParams {
  config: PaypalPlatformConfig;
  /** Our business id, used as PayPal's tracking_id. */
  trackingId: string;
  /** Where PayPal sends the merchant when onboarding finishes. */
  returnUrl: string;
  /** Prefills the signup form. Optional. */
  email?: string | null;
}

export interface PartnerReferral {
  /** Send the merchant here to onboard. */
  actionUrl: string;
  /** PayPal's id for the referral record itself, worth storing for support. */
  referralId: string | null;
}

function credsFrom(config: PaypalPlatformConfig): PaypalCredentials {
  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    environment: config.environment,
  };
}

/**
 * Create a Partner Referral and return the URL the merchant must visit.
 *
 * We request PPCP with the third-party features CoinPay needs: taking payments
 * on their behalf, refunding, reading transactions, and reading the balance for
 * the dashboard. A merchant who declines a permission still onboards — the
 * corresponding dashboard panel degrades rather than the connection failing.
 */
export async function createPartnerReferral(
  params: CreateReferralParams
): Promise<PartnerReferral> {
  const { config } = params;
  const token = await getPaypalAccessToken(credsFrom(config));

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (config.bnCode) {
    headers['PayPal-Partner-Attribution-Id'] = config.bnCode;
  }

  const res = await fetch(`${paypalApiBase(config.environment)}/v2/customer/partner-referrals`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tracking_id: params.trackingId,
      ...(params.email ? { email: params.email } : {}),
      operations: [
        {
          operation: 'API_INTEGRATION',
          api_integration_preference: {
            rest_api_integration: {
              integration_method: 'PAYPAL',
              integration_type: 'THIRD_PARTY',
              third_party_details: {
                features: [
                  'PAYMENT',
                  'REFUND',
                  'PARTNER_FEE',
                  'ACCESS_MERCHANT_INFORMATION',
                  'READ_SELLER_DISPUTE',
                  'UPDATE_SELLER_DISPUTE',
                ],
              },
            },
          },
        },
      ],
      products: ['PPCP'],
      legal_consents: [{ type: 'SHARE_DATA_CONSENT', granted: true }],
      partner_config_override: {
        return_url: params.returnUrl,
        return_url_description: 'Return to CoinPay to finish connecting PayPal.',
      },
    }),
  });

  if (!res.ok) {
    const detail = await safeDetail(res);
    throw new Error(`PayPal partner referral failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }

  const data = (await res.json()) as {
    links?: { href: string; rel: string }[];
    partner_referral_id?: string;
  };
  const action = data.links?.find((l) => l.rel === 'action_url');
  if (!action?.href) {
    throw new Error('PayPal partner referral response missing action_url');
  }

  return { actionUrl: action.href, referralId: data.partner_referral_id ?? null };
}

export interface MerchantIntegration {
  /** The merchant's PayPal payer id — what auth assertions must carry. */
  merchantIdInPaypal: string | null;
  trackingId: string | null;
  email: string | null;
  /** PayPal's `charges_enabled`: false means orders will be refused. */
  paymentsReceivable: boolean;
  /** PayPal's `details_submitted`: false means they must confirm their email. */
  primaryEmailConfirmed: boolean;
  /** True once CoinPay actually holds third-party permissions for them. */
  oauthThirdPartyGranted: boolean;
  /** Granted permission scopes, so the UI can explain a missing panel. */
  scopes: string[];
  /** PPCP product vetting status, e.g. SUBSCRIBED / NEED_MORE_DATA / DENIED. */
  productStatus: string | null;
}

export interface GetIntegrationParams {
  config: PaypalPlatformConfig;
  /** Either the merchant's PayPal id or our tracking id — PayPal accepts both. */
  merchantIdOrTrackingId: string;
}

/**
 * Read a merchant's onboarding state. Returns null when PayPal has no record,
 * which is the normal answer for a business that started but abandoned
 * onboarding — callers render "not connected" rather than an error.
 */
export async function getMerchantIntegration(
  params: GetIntegrationParams
): Promise<MerchantIntegration | null> {
  const { config } = params;
  const token = await getPaypalAccessToken(credsFrom(config));

  const url =
    `${paypalApiBase(config.environment)}/v1/customer/partners/` +
    `${encodeURIComponent(config.partnerMerchantId)}/merchant-integrations/` +
    `${encodeURIComponent(params.merchantIdOrTrackingId)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    const detail = await safeDetail(res);
    throw new Error(
      `PayPal merchant integration lookup failed (${res.status})${detail ? `: ${detail}` : ''}`
    );
  }

  const data = (await res.json()) as any;
  const oauth = Array.isArray(data?.oauth_integrations) ? data.oauth_integrations : [];
  const scopes: string[] = [];
  for (const integration of oauth) {
    for (const third of integration?.oauth_third_party ?? []) {
      for (const scope of third?.scopes ?? []) {
        // Scopes come back as full URIs; the trailing segment is the readable part.
        scopes.push(String(scope).split('/').pop() || String(scope));
      }
    }
  }

  const ppcp = (Array.isArray(data?.products) ? data.products : []).find(
    (p: any) => p?.name === 'PPCP'
  );

  return {
    merchantIdInPaypal: data?.merchant_id ?? null,
    trackingId: data?.tracking_id ?? null,
    email: data?.primary_email ?? null,
    paymentsReceivable: !!data?.payments_receivable,
    primaryEmailConfirmed: !!data?.primary_email_confirmed,
    oauthThirdPartyGranted: scopes.length > 0,
    scopes,
    productStatus: ppcp?.vetting_status ?? ppcp?.status ?? null,
  };
}

async function safeDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const detail = Array.isArray(body?.details) && body.details.length
      ? body.details.map((d: any) => d?.issue || d?.description).filter(Boolean).join('; ')
      : '';
    return [body?.message || body?.name || '', detail].filter(Boolean).join(' — ');
  } catch {
    return '';
  }
}
