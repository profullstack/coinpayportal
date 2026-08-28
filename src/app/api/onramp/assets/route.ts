/**
 * GET /api/onramp/assets
 *
 * What can be bought, with what, and through which sources.
 *
 * Reports the assets we support locally rather than the union of everything our
 * providers offer: we can only deliver into a chain the wallet understands, so
 * a provider supporting an asset we cannot receive is not a purchasable option.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getClientIp } from '@/lib/web-wallet/client-ip';
import { getOnrampProviders } from '@/lib/onramp/providers';
import { ONRAMP_SUPPORTED_ASSETS } from '@/lib/onramp/types';

export async function GET(request: NextRequest) {
  try {
    const clientIp = getClientIp(request) || 'unknown';
    const rate = await checkRateLimitAsync(clientIp, 'onramp_quote');
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again shortly.' },
        { status: 429 }
      );
    }

    const providers = getOnrampProviders();
    const configured = providers.filter((provider) => provider.isConfigured());

    return NextResponse.json({
      success: true,
      // Assets we can actually receive. The provider-side lists are a superset
      // and are not what a caller should render a picker from.
      assets: ONRAMP_SUPPORTED_ASSETS,
      paymentMethods: ['bank_transfer', 'card', 'apple_pay', 'google_pay', 'pix'],
      sources: providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        configured: provider.isConfigured(),
      })),
      available: configured.length > 0,
    });
  } catch (error) {
    console.error('[Onramp Assets] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to list on-ramp assets';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
