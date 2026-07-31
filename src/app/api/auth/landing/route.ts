import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';
import { decideLanding, hasAnyPayeeSource } from '@/lib/auth/landing';

function client() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * GET /api/auth/landing
 * Where the client should navigate right after signing in.
 *
 * Reading this also stamps `last_login_at`, so the "you have been away a while"
 * check measures the gap since the previous sign-in rather than firing forever.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = client();
    const auth = await resolveMerchant(supabase, request);
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const { data: merchant } = await supabase
      .from('merchants')
      .select('last_login_at, wallets_reviewed_at')
      .eq('id', auth.merchantId)
      .maybeSingle();

    const decision = decideLanding({
      hasPayeeSource: await hasAnyPayeeSource(supabase, auth.merchantId),
      lastLoginAt: merchant?.last_login_at ?? null,
      walletsReviewedAt: merchant?.wallets_reviewed_at ?? null,
    });

    await supabase
      .from('merchants')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', auth.merchantId);

    return NextResponse.json({ success: true, ...decision });
  } catch (error) {
    console.error('Landing decision error:', error);
    // Never block sign-in on this — fall back to the dashboard.
    return NextResponse.json({ success: true, path: '/dashboard', reason: null });
  }
}

/**
 * POST /api/auth/landing/reviewed is expressed here as a POST to the same path:
 * marks the wallet settings as reviewed so the lapsed-login prompt stands down.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = client();
    const auth = await resolveMerchant(supabase, request);
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    await supabase
      .from('merchants')
      .update({ wallets_reviewed_at: new Date().toISOString() })
      .eq('id', auth.merchantId);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
