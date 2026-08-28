/**
 * POST /api/onramp/session
 *
 * Hand the user off to a provider's hosted buy flow, normally the one that won
 * the quote.
 *
 * Body:
 *   asset:         our asset symbol, e.g. BTC or USDC_POL
 *   amount:        fiat amount to spend
 *   walletAddress: destination address; the ramp delivers straight here
 *   fiat:          ISO 4217, default USD
 *   source:        which integration to use — defaults to the first configured
 *   provider:      pin to one ramp behind that integration
 *   method:        optional rail
 *   country:       optional ISO 3166-1 alpha-2
 *   redirectUrl:   where the provider returns the user afterwards
 *   externalId:    our correlation id, echoed back on the provider's webhooks
 *
 * No authentication: this endpoint creates no record, moves no money and holds
 * no custody — it composes a URL to a third party's flow. The user pays the
 * ramp directly and the ramp delivers to the address given here, which is
 * precisely why the chargeback risk sits with them rather than with us. It is
 * rate limited because it is a cheap way to burn our provider quota.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getClientIp } from '@/lib/web-wallet/client-ip';
import { getConfiguredProviders, getProviderById } from '@/lib/onramp/providers';
import {
  ONRAMP_SUPPORTED_ASSETS,
  OnrampPaymentMethod,
  isOnrampSupported,
  settlementChain,
} from '@/lib/onramp/types';
import { validateAddress } from '@/lib/blockchain/wallets';
import type { BlockchainType } from '@/lib/blockchain/providers';

/** Chains `validateAddress` can actually judge. Anything else it returns false for. */
const VALIDATABLE_CHAINS = new Set(['BTC', 'BCH', 'ETH', 'POL', 'SOL']);

export async function POST(request: NextRequest) {
  try {
    const clientIp = getClientIp(request) || 'unknown';
    const rate = await checkRateLimitAsync(clientIp, 'onramp_quote');
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again shortly.' },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const asset = typeof body.asset === 'string' ? body.asset.toUpperCase() : '';
    const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress.trim() : '';
    const fiat = (typeof body.fiat === 'string' ? body.fiat : 'USD').toUpperCase();
    const fiatAmount = Number(body.amount);

    if (!asset || !walletAddress || !body.amount) {
      return NextResponse.json(
        {
          error: 'Missing required parameters',
          required: ['asset', 'amount', 'walletAddress'],
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

    if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) {
      return NextResponse.json(
        { error: 'Invalid amount: must be a positive number' },
        { status: 400 }
      );
    }

    // A purchase delivered to a wrong-chain address is unrecoverable, and the
    // ramp will not catch it. Check where we can; where the validator has no
    // opinion, do not invent one and reject a perfectly good address.
    const chain = settlementChain(asset);
    if (chain && VALIDATABLE_CHAINS.has(chain)) {
      if (!validateAddress(walletAddress, chain as BlockchainType)) {
        return NextResponse.json(
          { error: `Invalid ${chain} address for ${asset}` },
          { status: 400 }
        );
      }
    }

    const configured = getConfiguredProviders();
    if (configured.length === 0) {
      return NextResponse.json(
        {
          error: 'No on-ramp provider is configured',
          detail: 'Set ONRAMPER_API_KEY or TRANSAK_API_KEY to enable fiat purchases.',
        },
        { status: 503 }
      );
    }

    const requestedSource = typeof body.source === 'string' ? body.source : null;
    const provider = requestedSource ? getProviderById(requestedSource) : configured[0];

    if (!provider) {
      return NextResponse.json(
        { error: `Unknown on-ramp source: ${requestedSource}` },
        { status: 400 }
      );
    }
    if (!provider.isConfigured()) {
      return NextResponse.json(
        { error: `On-ramp source is not configured: ${provider.id}` },
        { status: 503 }
      );
    }

    const session = await provider.createSession({
      fiatCurrency: fiat,
      fiatAmount,
      cryptoAsset: asset,
      walletAddress,
      provider: typeof body.provider === 'string' ? body.provider : undefined,
      paymentMethod:
        typeof body.method === 'string' ? (body.method as OnrampPaymentMethod) : undefined,
      country: typeof body.country === 'string' ? body.country : undefined,
      redirectUrl: typeof body.redirectUrl === 'string' ? body.redirectUrl : undefined,
      externalId: typeof body.externalId === 'string' ? body.externalId : undefined,
    });

    return NextResponse.json({ success: true, session });
  } catch (error) {
    console.error('[Onramp Session] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create on-ramp session';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
