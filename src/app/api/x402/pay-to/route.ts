/**
 * GET /api/x402/pay-to
 *
 * Where x402 payments to this business should go, read from the business's
 * own wallets in CoinPay. A seller (an x402 gateway, a c0mpute node) holding
 * only a scoped key asks here instead of hard-coding an address, so changing
 * the receiving wallet in CoinPay changes it everywhere.
 *
 * Auth: `X-API-Key: <scoped key>` (or `Authorization: Bearer <key>`) with
 * `payments:read` or `payments:create`, the scopes an x402 key already has.
 * Only the key's own business is answered; no other business, no secrets.
 *
 * 200 {
 *   business_id, business_name,
 *   pay_to: "0x..." | null,              // Base if set, else the first EVM USDC wallet
 *   networks: { "eip155:8453": "0x...", "eip155:137": "0x...", "eip155:1": "0x..." }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveScopedKey, scopesSatisfy } from '@/lib/auth/scoped-keys';

/** CoinPay wallet currency -> CAIP-2 network for USDC (EIP-3009) on chains we settle. */
export const USDC_WALLET_NETWORKS: ReadonlyArray<[string, string]> = [
  ['USDC_BASE', 'eip155:8453'],
  ['USDC_POL', 'eip155:137'],
  ['USDC_ETH', 'eip155:1'],
];

function keyFrom(request: NextRequest): string | null {
  const direct = request.headers.get('x-api-key')?.trim();
  if (direct) return direct;
  const auth = request.headers.get('authorization') ?? '';
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() || null : null;
}

export async function GET(request: NextRequest) {
  const apiKey = keyFrom(request);
  if (!apiKey) {
    return NextResponse.json({ error: 'API key required' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }
  const supabase = createClient(url, serviceKey);

  const resolved = await resolveScopedKey(supabase, apiKey);
  if (!resolved) {
    return NextResponse.json({ error: 'Invalid or inactive API key' }, { status: 401 });
  }
  if (!scopesSatisfy(resolved.scopes, 'payments:read') && !scopesSatisfy(resolved.scopes, 'payments:create')) {
    return NextResponse.json(
      { error: 'API key missing required scope: payments:read' },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('business_wallets')
    .select('cryptocurrency, wallet_address')
    .eq('business_id', resolved.business.id)
    .eq('is_active', true);
  if (error) {
    return NextResponse.json({ error: 'Could not read wallets' }, { status: 500 });
  }

  const byCurrency = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ cryptocurrency: string; wallet_address: string }>) {
    if (row?.cryptocurrency && row?.wallet_address && !byCurrency.has(row.cryptocurrency)) {
      byCurrency.set(row.cryptocurrency, row.wallet_address);
    }
  }
  const networks: Record<string, string> = {};
  for (const [currency, network] of USDC_WALLET_NETWORKS) {
    const addr = byCurrency.get(currency);
    if (addr) networks[network] = addr;
  }
  const payTo = networks['eip155:8453'] ?? Object.values(networks)[0] ?? null;

  return NextResponse.json(
    {
      business_id: resolved.business.id,
      business_name: resolved.business.name,
      pay_to: payTo,
      networks,
    },
    { status: 200, headers: { 'cache-control': 'private, max-age=60' } },
  );
}
