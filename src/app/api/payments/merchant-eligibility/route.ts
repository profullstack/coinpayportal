/**
 * GET /api/payments/merchant-eligibility?merchant_id=<uuid>
 *
 * Lightweight read-only probe network apps use to decide which payment
 * options to show on a checkout button. Returns:
 *
 *   {
 *     success: true,
 *     merchant_id,
 *     accepts_card: boolean,            // a stripe_accounts row with
 *                                       // charges_enabled=true exists
 *     accepts_crypto: boolean,          // any active merchant_wallets row
 *     chains: string[],                 // active cryptocurrency codes
 *   }
 *
 * Auth: Bearer token matching a registered reputation_issuers API key
 * — same as the other platform endpoints.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

async function authenticatePlatform(
  supabase: ReturnType<typeof getSupabase>,
  request: NextRequest,
): Promise<{ did: string; name: string } | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const apiKey = authHeader.slice(7);

  const { data } = await supabase
    .from('reputation_issuers')
    .select('did, name')
    .eq('api_key', apiKey)
    .eq('active', true)
    .single();

  return data;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const platform = await authenticatePlatform(supabase, request);
    if (!platform) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing API key' },
        { status: 401 },
      );
    }

    const merchant_id = new URL(request.url).searchParams.get('merchant_id');
    if (!merchant_id) {
      return NextResponse.json(
        { success: false, error: 'merchant_id required' },
        { status: 400 },
      );
    }

    const [stripeRes, walletsRes] = await Promise.all([
      supabase
        .from('stripe_accounts')
        .select('id')
        .eq('merchant_id', merchant_id)
        .eq('charges_enabled', true)
        .limit(1),
      supabase
        .from('merchant_wallets')
        .select('cryptocurrency')
        .eq('merchant_id', merchant_id)
        .eq('is_active', true),
    ]);

    const accepts_card = (stripeRes.data?.length ?? 0) > 0;
    const chains = Array.from(
      new Set(
        (walletsRes.data ?? [])
          .map((r: { cryptocurrency: string }) => r.cryptocurrency)
          .filter(Boolean),
      ),
    );

    return NextResponse.json({
      success: true,
      merchant_id,
      accepts_card,
      accepts_crypto: chains.length > 0,
      chains,
    });
  } catch (error) {
    console.error('[merchant-eligibility] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
