/**
 * OIDC UserInfo Endpoint
 * GET — returns user claims based on access token scopes
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAccessToken } from '@/lib/oauth/tokens';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing Bearer token' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
    );
  }

  const token = authHeader.substring(7);
  let decoded: any;

  try {
    decoded = verifyAccessToken(token);
  } catch (error) {
    return NextResponse.json(
      { error: 'invalid_token', error_description: error instanceof Error ? error.message : 'Invalid token' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' } }
    );
  }

  const scopes = (decoded.scope || '').split(' ');
  const userId = decoded.sub;

  // Get user info from database
  const supabase = getSupabase();
  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, email, name, updated_at')
    .eq('id', userId)
    .single();

  const claims: Record<string, any> = {
    sub: userId,
  };

  if (merchant) {
    if (scopes.includes('profile')) {
      if (merchant.name) claims.name = merchant.name;
      if (merchant.updated_at) claims.updated_at = Math.floor(new Date(merchant.updated_at).getTime() / 1000);
    }

    if (scopes.includes('email') && merchant.email) {
      claims.email = merchant.email;
      claims.email_verified = true;
    }
  }

  // wallet:read scope — return the merchant's configured payout/receive
  // wallet addresses from merchant_wallets (the table powering the
  // /settings/wallets page on coinpayportal). The legacy `wallets` table is
  // an HD-key store with no address column; reading from it always returned
  // empty, so OIDC clients silently got no wallets even when the merchant
  // had a full set configured.
  if (scopes.includes('wallet:read')) {
    const { data: wallets } = await supabase
      .from('merchant_wallets')
      .select('wallet_address, cryptocurrency, label')
      .eq('merchant_id', userId)
      .eq('is_active', true);

    if (wallets && wallets.length > 0) {
      claims.wallets = wallets.map((w: any) => ({
        address: w.wallet_address,
        chain: w.cryptocurrency,
        label: w.label || undefined,
      }));
    }
  }

  // DID scope — return the merchant's human DID from merchant_dids
  // (same source /api/reputation/did/me reads from). The legacy `reputation`
  // table doesn't carry the DID; reading from it returned empty for every
  // OIDC client, so downstream apps (d0rz, c0mpute, etc.) never learned the
  // user's CoinPay-issued DID after a successful OAuth handshake.
  if (scopes.includes('did')) {
    const { data: didRow } = await supabase
      .from('merchant_dids')
      .select('did')
      .eq('merchant_id', userId)
      .eq('did_kind', 'human')
      .maybeSingle();

    if (didRow?.did) {
      claims.did = didRow.did;
    }
  }

  return NextResponse.json(claims, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
