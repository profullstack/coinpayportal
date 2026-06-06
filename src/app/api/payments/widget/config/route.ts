import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const merchantId = request.nextUrl.searchParams.get('merchant_id');

    if (!merchantId) {
      return NextResponse.json(
        { success: false, error: 'merchant_id required' },
        { status: 400, headers: corsHeaders },
      );
    }

    const { data: merchant } = await supabase
      .from('merchants')
      .select('id')
      .eq('id', merchantId)
      .maybeSingle();

    if (!merchant) {
      return NextResponse.json(
        { success: false, error: 'merchant not found' },
        { status: 404, headers: corsHeaders },
      );
    }

    const [businessRes, stripeRes, walletsRes] = await Promise.all([
      supabase
        .from('businesses')
        .select('id, name')
        .eq('merchant_id', merchantId)
        .order('created_at', { ascending: true })
        .limit(1),
      supabase
        .from('stripe_accounts')
        .select('id')
        .eq('merchant_id', merchantId)
        .eq('charges_enabled', true)
        .limit(1),
      supabase
        .from('merchant_wallets')
        .select('cryptocurrency')
        .eq('merchant_id', merchantId)
        .eq('is_active', true),
    ]);

    const chains = Array.from(
      new Set(
        (walletsRes.data ?? [])
          .map((wallet: { cryptocurrency: string }) => wallet.cryptocurrency)
          .filter(Boolean),
      ),
    ).sort();
    const acceptsCard = (stripeRes.data?.length ?? 0) > 0;
    const business = businessRes.data?.[0] ?? null;

    return NextResponse.json(
      {
        success: true,
        merchant_id: merchantId,
        display_name: business?.name || 'CoinPay merchant',
        accepts_card: acceptsCard,
        accepts_crypto: chains.length > 0,
        chains,
        default_currency: chains.includes('USDC') ? 'USDC' : chains[0] || (acceptsCard ? 'card' : null),
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    console.error('[payments-widget-config] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: corsHeaders },
    );
  }
}
