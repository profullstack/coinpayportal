import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import { getStripe } from '@/lib/server/optional-deps';

async function getStripeAccountId(businessId: string): Promise<string | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data } = await supabase
    .from('stripe_accounts')
    .select('stripe_account_id')
    .eq('business_id', businessId)
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

    // List Connect webhooks from the platform account
    // (connected accounts can't manage their own webhooks)
    const allEndpoints = await (await getStripe()).webhookEndpoints.list({ limit: 100 });
    // Filter to only show endpoints relevant to this account
    const endpoints = {
      data: allEndpoints.data.filter((ep: any) =>
        ep.enabled_events?.includes('*') ||
        ep.url?.includes(stripeAccountId) ||
        ep.metadata?.business_id === stripeAccountId
      ),
    };
    // If no filtered results, show all Connect endpoints
    if (endpoints.data.length === 0) {
      endpoints.data = allEndpoints.data;
    }

    return NextResponse.json({
      success: true,
      endpoints: endpoints.data.map((ep: any) => ({
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

    // Create webhook on the platform account with connect=true
    // so it receives events from connected accounts
    const endpoint = await (await getStripe()).webhookEndpoints.create({
      url,
      enabled_events: events,
      connect: true,
      metadata: {
        business_id: stripeAccountId,
      },
    });

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
