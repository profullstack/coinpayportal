import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/**
 * GET /api/reputation/did/me
 * Return the authenticated merchant's DID
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const authHeader = request.headers.get('authorization');
    const auth = await authenticateRequest(supabase, authHeader);

    if (!auth.success || !auth.context) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const merchantId = isMerchantAuth(auth.context)
      ? auth.context.merchantId
      : auth.context.merchantId;

    const { data, error } = await supabase
      .from('merchant_dids')
      .select('did, public_key, verified, created_at, did_kind, lifetime, label')
      .eq('merchant_id', merchantId)
      .eq('did_kind', 'human')
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'No DID found for this merchant' }, { status: 404 });
    }

    return NextResponse.json({
      did: data.did,
      public_key: data.public_key,
      verified: data.verified,
      created_at: data.created_at,
      did_kind: data.did_kind,
      lifetime: data.lifetime,
      label: data.label,
    });
  } catch (error) {
    console.error('DID lookup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
