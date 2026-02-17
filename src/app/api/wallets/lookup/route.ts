/**
 * GET /api/wallets/lookup?address=<addr>
 * Look up if a wallet address belongs to a registered CoinPay user.
 * Checks merchant_wallets and business_wallets → merchants.email.
 * Returns { found: true, email } or { found: false }.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

async function lookupEmailByAddress(supabase: ReturnType<typeof getSupabase>, address: string): Promise<string | null> {
  // 1. Check merchant_wallets → merchants
  try {
    const { data } = await supabase
      .from('merchant_wallets')
      .select('merchant_id, merchants!inner(email)')
      .eq('wallet_address', address)
      .eq('is_active', true)
      .limit(1)
      .single();

    const merchant = Array.isArray(data?.merchants) ? data.merchants[0] : data?.merchants;
    if (merchant?.email) return merchant.email;
  } catch {
    // Not found — continue
  }

  // 2. Check business_wallets → businesses → merchants
  try {
    const { data } = await supabase
      .from('business_wallets')
      .select('business_id, businesses!inner(merchant_id, merchants!inner(email))')
      .eq('wallet_address', address)
      .eq('is_active', true)
      .limit(1)
      .single();

    const biz = Array.isArray(data?.businesses) ? data.businesses[0] : data?.businesses;
    const merchant = biz ? (Array.isArray(biz.merchants) ? biz.merchants[0] : biz.merchants) : null;
    if (merchant?.email) return merchant.email;
  } catch {
    // Not found
  }

  return null;
}

export { lookupEmailByAddress };

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address')?.trim();

  if (!address || address.length < 10) {
    return NextResponse.json({ found: false });
  }

  try {
    const supabase = getSupabase();
    const email = await lookupEmailByAddress(supabase, address);

    if (email) {
      return NextResponse.json({ found: true, email });
    }

    return NextResponse.json({ found: false });
  } catch {
    return NextResponse.json({ found: false });
  }
}
