import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';
import { isAgeRange, type AgeRange } from '@/lib/did/age-range';

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
      .select('did, public_key, verified, created_at, did_kind, lifetime, label, openprofile_url, age_range')
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
      age_range: data.age_range ?? null,
    });
  } catch (error) {
    console.error('DID lookup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/reputation/did/me — update optional DID profile fields.
 * Body may carry either or both of:
 *   openprofile_url: HTTPS URL | null   (associate or remove an OpenProfile.md)
 *   age_range: one of AGE_RANGES | null (self-declared band; null = prefer not to say)
 */
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
    const hasOpenProfile = !!body && typeof body === 'object' && 'openprofile_url' in body;
    const hasAgeRange = !!body && typeof body === 'object' && 'age_range' in body;
    if (!hasOpenProfile && !hasAgeRange) {
      return NextResponse.json({ error: 'openprofile_url or age_range is required' }, { status: 400 });
    }

    const update: { openprofile_url?: string | null; age_range?: AgeRange | null; age_range_updated_at?: string } = {};

    if (hasOpenProfile) {
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
      update.openprofile_url = openprofile_url;
    }

    if (hasAgeRange) {
      const raw = (body as { age_range: unknown }).age_range;
      if (raw === null || raw === '') {
        update.age_range = null;
      } else if (isAgeRange(raw)) {
        update.age_range = raw;
      } else {
        return NextResponse.json({ error: 'Choose one of the listed age ranges, or none.' }, { status: 400 });
      }
      update.age_range_updated_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('merchant_dids')
      .update(update)
      .eq('merchant_id', auth.context.merchantId)
      .eq('did_kind', 'human')
      .select('did, openprofile_url, age_range')
      .maybeSingle();
    if (error) {
      console.error('[DID] profile update failed:', error.message);
      return NextResponse.json({ error: 'Could not save your DID profile.' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'No principal DID found for this account.' }, { status: 404 });

    return NextResponse.json({
      did: data.did,
      openprofile_url: data.openprofile_url ?? null,
      age_range: data.age_range ?? null,
    });
  } catch (error) {
    console.error('DID profile update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
