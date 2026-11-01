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
      .select('did, public_key, verified, created_at, did_kind, lifetime, label, openprofile_url')
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
      openprofile_url: data.openprofile_url ?? null,
    });
  } catch (error) {
    console.error('DID lookup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/reputation/did/me — associate or remove this DID's OpenProfile URL. */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const auth = await authenticateRequest(supabase, request.headers.get('authorization'));

    if (!auth.success || !auth.context) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isMerchantAuth(auth.context)) {
      return NextResponse.json(
        { error: 'This endpoint requires account (session) authentication, not an API key' },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || !('openprofile_url' in body)) {
      return NextResponse.json({ error: 'openprofile_url is required' }, { status: 400 });
    }

    const raw = (body as { openprofile_url: unknown }).openprofile_url;
    let openprofile_url: string | null = null;
    if (raw !== null && raw !== '') {
      if (typeof raw !== 'string' || raw.length > 2048) {
        return NextResponse.json({ error: 'Enter an HTTPS OpenProfile URL (up to 2048 characters).' }, { status: 400 });
      }
      try {
        const url = new URL(raw.trim());
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid URL');
        url.hash = '';
        openprofile_url = url.toString();
      } catch {
        return NextResponse.json({ error: 'Enter a valid HTTPS OpenProfile URL.' }, { status: 400 });
      }
    }

    const { data, error } = await supabase
      .from('merchant_dids')
      .update({ openprofile_url })
      .eq('merchant_id', auth.context.merchantId)
      .eq('did_kind', 'human')
      .select('did, openprofile_url')
      .maybeSingle();
    if (error) {
      console.error('[DID] OpenProfile association update failed:', error.message);
      return NextResponse.json({ error: 'Could not save your OpenProfile URL.' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'No principal DID found for this account.' }, { status: 404 });

    return NextResponse.json({ did: data.did, openprofile_url: data.openprofile_url ?? null });
  } catch (error) {
    console.error('DID OpenProfile update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
