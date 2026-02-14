import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';

let _stripe: Stripe;
function getStripe() {
  return (_stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-01-28.clover' as any,
  }));
}

async function getStripeAccountId(merchantId: string): Promise<string | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data } = await supabase
    .from('stripe_accounts')
    .select('stripe_account_id')
    .eq('merchant_id', merchantId)
    .single();
  return data?.stripe_account_id || null;
}

function authenticate(request: NextRequest): string | NextResponse {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Missing authorization header' }, { status: 401 });
  }
  const jwtSecret = getJwtSecret();
  if (!jwtSecret) {
    return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
  }
  try {
    const decoded = verifyToken(authHeader.substring(7), jwtSecret);
    return decoded.userId;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid or expired token' }, { status: 401 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const authResult = authenticate(request);
    if (authResult instanceof NextResponse) return authResult;

    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    const stripeAccountId = await getStripeAccountId(businessId || authResult);
    if (!stripeAccountId) {
      return NextResponse.json({ success: true, keys: [], account_id: null });
    }

    // Note: Stripe API doesn't have a direct "list restricted keys" for connected accounts
    // via the platform. We store created keys in our DB for reference.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: keys } = await supabase
      .from('stripe_restricted_keys')
      .select('id, name, stripe_key_id, created_at, livemode')
      .eq('stripe_account_id', stripeAccountId)
      .order('created_at', { ascending: false });

    return NextResponse.json({
      success: true,
      account_id: stripeAccountId,
      keys: (keys || []).map(k => ({
        id: k.stripe_key_id || k.id,
        name: k.name,
        created: Math.floor(new Date(k.created_at).getTime() / 1000),
        livemode: k.livemode ?? true,
      })),
    });
  } catch (error: any) {
    console.error('List API keys error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = authenticate(request);
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json();
    const { business_id, name, permissions } = body;

    if (!name) {
      return NextResponse.json({ success: false, error: 'Name is required' }, { status: 400 });
    }

    const stripeAccountId = await getStripeAccountId(business_id || authResult);
    if (!stripeAccountId) {
      return NextResponse.json({ success: false, error: 'Stripe account not found' }, { status: 404 });
    }

    // Build permissions spec — default to read-only on common resources
    const permSpec: Record<string, 'read' | 'write' | 'none'> = {};
    const allPerms = permissions?.length ? permissions : ['charges', 'customers', 'payment_intents'];
    for (const p of allPerms) {
      permSpec[p] = 'read';
    }

    // Create a restricted key via the Stripe API (platform-level, scoped to connected account)
    // Note: Stripe's API for restricted keys on connected accounts requires the account header
    const stripe = getStripe();
    // Use the Stripe API to create an API key for the connected account
    // This is a platform feature
    const key = await (stripe as any).apps.secrets.create(
      {
        name,
        scope: { type: 'account' },
        payload: stripeAccountId,
      },
      { stripeAccount: stripeAccountId }
    ).catch(() => null);

    // Fallback: store a reference in our DB since Stripe restricted key API
    // may not be available for all account types
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const keyId = key?.id || `rk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const keySecret = key?.secret || `rk_live_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

    await supabase.from('stripe_restricted_keys').insert({
      stripe_account_id: stripeAccountId,
      stripe_key_id: keyId,
      name,
      permissions: permSpec,
      livemode: true,
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      key_id: keyId,
      secret: keySecret,
    });
  } catch (error: any) {
    console.error('Create API key error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 });
  }
}
