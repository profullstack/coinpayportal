/**
 * GET /api/onramp/quote
 *
 * Quote a fiat purchase across every configured on-ramp and return them ranked
 * by how much crypto actually lands in the wallet.
 *
 * Query params:
 *   fiat:    ISO 4217 currency being spent (default USD)
 *   amount:  fiat amount to spend
 *   asset:   our asset symbol, e.g. BTC or USDC_POL
 *   method:  optional rail — bank_transfer | card | apple_pay | google_pay | ewallet | pix
 *   country: optional ISO 3166-1 alpha-2; providers gate fees and availability on it
 *
 * Example: /api/onramp/quote?fiat=USD&amount=500&asset=BTC&method=bank_transfer
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getClientIp } from '@/lib/web-wallet/client-ip';
import { getOnrampQuotes } from '@/lib/onramp/router';
import { isOnrampAvailable } from '@/lib/onramp/providers';
import {
  ONRAMP_SUPPORTED_ASSETS,
  OnrampPaymentMethod,
  isOnrampSupported,
} from '@/lib/onramp/types';

const PAYMENT_METHODS: OnrampPaymentMethod[] = [
  'bank_transfer',
  'card',
  'apple_pay',
  'google_pay',
  'ewallet',
  'pix',
];

export async function GET(request: NextRequest) {
  try {
    // One request here fans out to every source, so it is a larger lever on our
    // third-party quota than a single-provider endpoint would be.
    const clientIp = getClientIp(request) || 'unknown';
    const rate = await checkRateLimitAsync(clientIp, 'onramp_quote');
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many quote requests. Please try again shortly.' },
        { status: 429 }
      );
    }

    const { searchParams } = new URL(request.url);
    const asset = searchParams.get('asset')?.toUpperCase();
    const amount = searchParams.get('amount');
    const fiat = (searchParams.get('fiat') || 'USD').toUpperCase();
    const method = searchParams.get('method')?.toLowerCase() as OnrampPaymentMethod | undefined;
    const country = searchParams.get('country') || undefined;

    if (!asset || !amount) {
      return NextResponse.json(
        {
          error: 'Missing required parameters',
          required: ['asset', 'amount'],
          example: '/api/onramp/quote?fiat=USD&amount=500&asset=BTC',
        },
        { status: 400 }
      );
    }

    if (!isOnrampSupported(asset)) {
      return NextResponse.json(
        { error: `Unsupported asset: ${asset}`, supported: ONRAMP_SUPPORTED_ASSETS },
        { status: 400 }
      );
    }

    const fiatAmount = Number(amount);
    if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) {
      return NextResponse.json(
        { error: 'Invalid amount: must be a positive number' },
        { status: 400 }
      );
    }

    if (method && !PAYMENT_METHODS.includes(method)) {
      return NextResponse.json(
        { error: `Unsupported payment method: ${method}`, supported: PAYMENT_METHODS },
        { status: 400 }
      );
    }

    // Distinguish "no provider could quote this" from "we have no providers".
    // The second is our problem and should read as an outage, not as the user
    // having asked for something unavailable.
    if (!isOnrampAvailable()) {
      return NextResponse.json(
        {
          error: 'No on-ramp provider is configured',
          detail: 'Set ONRAMPER_API_KEY or TRANSAK_API_KEY to enable fiat purchases.',
        },
        { status: 503 }
      );
    }

    const result = await getOnrampQuotes({
      fiatCurrency: fiat,
      fiatAmount,
      cryptoAsset: asset,
      paymentMethod: method,
      country,
    });

    if (result.quotes.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No provider could quote this purchase',
          unavailable: result.unavailable,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      request: { fiat, fiatAmount, asset, paymentMethod: method ?? null, country: country ?? null },
      // Mid-market at quote time. Published so the comparison can be audited
      // rather than taken on trust.
      spotRate: result.spotRate,
      best: result.best,
      quotes: result.quotes,
      unavailable: result.unavailable,
    });
  } catch (error) {
    console.error('[Onramp Quote] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to get quotes';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
