/**
 * GET /api/remittance/corridors
 *
 * Where money can be sent, how the recipient can collect it, and which corridors
 * currently have a live partner.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getClientIp } from '@/lib/web-wallet/client-ip';
import { getProvidersForCorridor, getRemittanceProviders } from '@/lib/remittance/providers';
import { CORRIDORS, SUPPORTED_SEND_ASSETS, SUPPORTED_CORRIDORS } from '@/lib/remittance/types';

export async function GET(request: NextRequest) {
  try {
    const clientIp = getClientIp(request) || 'unknown';
    const rate = await checkRateLimitAsync(clientIp, 'remittance_quote');
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again shortly.' },
        { status: 429 }
      );
    }

    const corridors = SUPPORTED_CORRIDORS.map((corridor) => {
      const spec = CORRIDORS[corridor];
      const live = getProvidersForCorridor(corridor);

      return {
        corridor,
        destinationCountry: spec.destinationCountry,
        payoutCurrency: spec.payoutCurrency,
        methods: spec.methods,
        networks: spec.networks,
        available: live.length > 0,
        partners: live.map((provider) => provider.id),
      };
    });

    return NextResponse.json({
      success: true,
      // Senders fund with stablecoin they already hold — there is no fiat
      // collection leg, which is what keeps this outside money transmission.
      sendAssets: SUPPORTED_SEND_ASSETS,
      corridors,
      partners: getRemittanceProviders().map((provider) => ({
        id: provider.id,
        label: provider.label,
        corridors: provider.corridors,
        configured: provider.isConfigured(),
      })),
    });
  } catch (error) {
    console.error('[Remittance Corridors] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to list corridors';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
