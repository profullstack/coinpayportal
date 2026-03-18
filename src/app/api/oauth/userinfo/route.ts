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

  // wallet:read scope — fetch wallet addresses
  if (scopes.includes('wallet:read')) {
    const { data: wallets } = await supabase
      .from('wallets')
      .select('address, chain, label')
      .eq('user_id', userId);

    if (wallets && wallets.length > 0) {
      claims.wallets = wallets.map((w: any) => ({
        address: w.address,
        chain: w.chain,
        label: w.label || undefined,
      }));
    }
  }

  // DID scope — check reputation system
  if (scopes.includes('did')) {
    const { data: rep } = await supabase
      .from('reputation')
      .select('did')
      .eq('user_id', userId)
      .single();

    if (rep?.did) {
      claims.did = rep.did;
    }
  }

  return NextResponse.json(claims, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
