/**
 * GET /api/remittance/quote
 *
 * Quote a crypto-funded remittance across every partner serving the corridor,
 * ranked by the local currency the recipient actually receives.
 *
 * Query params:
 *   asset:   stablecoin the sender is funding with, e.g. USDC or USDC_POL
 *   amount:  amount of that asset
 *   to:      destination country, ISO 3166-1 alpha-2 — MX or PH
 *   method:  optional payout rail — bank | ewallet | cash_pickup | debit_card
 *   network: optional named rail, e.g. spei or gcash
 *
 * Example: /api/remittance/quote?asset=USDC&amount=500&to=MX
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getClientIp } from '@/lib/web-wallet/client-ip';
import { getRemittanceQuotes } from '@/lib/remittance/router';
import { isCorridorAvailable } from '@/lib/remittance/providers';
import {
  PayoutMethod,
  SUPPORTED_SEND_ASSETS,
  corridorFor,
  isSupportedSendAsset,
} from '@/lib/remittance/types';

const PAYOUT_METHODS: PayoutMethod[] = ['bank', 'ewallet', 'cash_pickup', 'debit_card'];

export async function GET(request: NextRequest) {
  try {
    const clientIp = getClientIp(request) || 'unknown';
    const rate = await checkRateLimitAsync(clientIp, 'remittance_quote');
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many quote requests. Please try again shortly.' },
        { status: 429 }
      );
    }

    const { searchParams } = new URL(request.url);
    const asset = searchParams.get('asset')?.toUpperCase();
    const amount = searchParams.get('amount');
    const to = searchParams.get('to')?.toUpperCase();
    const method = searchParams.get('method')?.toLowerCase() as PayoutMethod | undefined;
    const network = searchParams.get('network')?.toLowerCase() || undefined;

    if (!asset || !amount || !to) {
      return NextResponse.json(
        {
          error: 'Missing required parameters',
          required: ['asset', 'amount', 'to'],
          example: '/api/remittance/quote?asset=USDC&amount=500&to=MX',
        },
        { status: 400 }
      );
    }

    if (!isSupportedSendAsset(asset)) {
      return NextResponse.json(
        {
          error: `Unsupported send asset: ${asset}`,
          detail: 'Senders fund with stablecoin they already hold.',
          supported: SUPPORTED_SEND_ASSETS,
        },
        { status: 400 }
      );
    }

    const spec = corridorFor(to);
    if (!spec) {
      return NextResponse.json(
        { error: `Unsupported destination: ${to}`, supported: ['MX', 'PH'] },
        { status: 400 }
      );
    }

    const sendAmount = Number(amount);
    if (!Number.isFinite(sendAmount) || sendAmount <= 0) {
      return NextResponse.json(
        { error: 'Invalid amount: must be a positive number' },
        { status: 400 }
      );
    }

    if (method && !PAYOUT_METHODS.includes(method)) {
      return NextResponse.json(
        { error: `Unknown payout method: ${method}`, supported: PAYOUT_METHODS },
        { status: 400 }
      );
    }

    if (method && !spec.methods.includes(method)) {
      return NextResponse.json(
        {
          error: `${spec.corridor} does not support payout method: ${method}`,
          supported: spec.methods,
        },
        { status: 400 }
      );
    }

    // Distinguish "no partner could quote" from "we have no partner here".
    // The second is our problem and should read as an outage.
    if (!isCorridorAvailable(spec.corridor)) {
      return NextResponse.json(
        {
          error: `No partner is configured for ${spec.corridor}`,
          detail: 'Set TRANSFI_API_KEY to enable this corridor.',
        },
        { status: 503 }
      );
    }

    const result = await getRemittanceQuotes({
      sendAsset: asset,
      sendAmount,
      destinationCountry: to,
      payoutMethod: method,
      payoutNetwork: network,
    });

    if (result.quotes.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No partner could quote this transfer',
          unavailable: result.unavailable,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      request: {
        asset,
        sendAmount,
        destinationCountry: to,
        payoutMethod: method ?? null,
        payoutNetwork: network ?? null,
      },
      corridor: result.corridor,
      payoutCurrency: result.payoutCurrency,
      sendValueUsd: result.sendValueUsd,
      // Published so the FX-margin figure on each quote can be audited rather
      // than taken on trust.
      midMarketFxRate: result.midMarketFxRate,
      best: result.best,
      quotes: result.quotes,
      unavailable: result.unavailable,
    });
  } catch (error) {
    console.error('[Remittance Quote] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to get quotes';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
