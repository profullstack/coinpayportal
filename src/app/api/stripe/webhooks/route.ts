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
    // Use businessId as the merchant context (consistent with connect/status pattern)
    const stripeAccountId = await getStripeAccountId(businessId || authResult);
    if (!stripeAccountId) {
      return NextResponse.json({ success: true, endpoints: [] });
    }

    const endpoints = await getStripe().webhookEndpoints.list(
      { limit: 100 },
      { stripeAccount: stripeAccountId }
    );

    return NextResponse.json({
      success: true,
      endpoints: endpoints.data.map(ep => ({
        id: ep.id,
        url: ep.url,
        status: ep.status,
        enabled_events: ep.enabled_events,
        created: ep.created,
      })),
    });
  } catch (error: any) {
    console.error('List webhook endpoints error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = authenticate(request);
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json();
    const { business_id, url, events } = body;

    if (!url || !events?.length) {
      return NextResponse.json({ success: false, error: 'URL and events are required' }, { status: 400 });
    }

    const stripeAccountId = await getStripeAccountId(business_id || authResult);
    if (!stripeAccountId) {
      return NextResponse.json({ success: false, error: 'Stripe account not found' }, { status: 404 });
    }

    const endpoint = await getStripe().webhookEndpoints.create(
      { url, enabled_events: events },
      { stripeAccount: stripeAccountId }
    );

    return NextResponse.json({
      success: true,
      endpoint: {
        id: endpoint.id,
        url: endpoint.url,
        status: endpoint.status,
        enabled_events: endpoint.enabled_events,
        created: endpoint.created,
      },
    });
  } catch (error: any) {
    console.error('Create webhook endpoint error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 });
  }
}
