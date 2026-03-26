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

    const stripe = await getStripe();

    // List platform-level webhooks relevant to this account
    const platformEndpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const filteredPlatform = platformEndpoints.data.filter((ep: any) =>
      ep.metadata?.business_id === stripeAccountId ||
      ep.enabled_events?.includes('*') ||
      ep.url?.includes(stripeAccountId)
    );

    // List webhooks on the connected account itself
    let accountEndpoints: any[] = [];
    try {
      const acctList = await stripe.webhookEndpoints.list(
        { limit: 100 },
        { stripeAccount: stripeAccountId }
      );
      accountEndpoints = acctList.data;
    } catch {
      // Connected account may not support webhook listing — that's ok
    }

    const allEndpoints = [
      ...filteredPlatform.map((ep: any) => ({ ...ep, _scope: ep.metadata?.scope || 'platform' })),
      ...accountEndpoints.map((ep: any) => ({ ...ep, _scope: 'account' })),
    ];

    // If no filtered results, fall back to showing all platform endpoints
    const results = allEndpoints.length > 0 ? allEndpoints : platformEndpoints.data.map((ep: any) => ({ ...ep, _scope: 'platform' }));

    return NextResponse.json({
      success: true,
      endpoints: results.map((ep: any) => ({
        id: ep.id,
        url: ep.url,
        status: ep.status,
        enabled_events: ep.enabled_events,
        created: ep.created,
        scope: ep._scope,
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
    const { business_id, url, events, scope: requestedScope } = body;

    if (!url || !events?.length) {
      return NextResponse.json({ success: false, error: 'URL and events are required' }, { status: 400 });
    }

    // scope: "platform" = webhook on platform account listening for connect events
    //        "account"  = webhook on the connected account itself
    const scope = requestedScope === 'account' ? 'account' : 'platform';

    const stripeAccountId = await getStripeAccountId(business_id || authResult);
    if (!stripeAccountId) {
      return NextResponse.json({ success: false, error: 'Stripe account not found' }, { status: 404 });
    }

    const stripe = await getStripe();
    const metadata = { business_id: stripeAccountId, scope };

    let endpoint;
    if (scope === 'account') {
      // Create webhook directly on the connected account
      endpoint = await stripe.webhookEndpoints.create(
        { url, enabled_events: events, metadata },
        { stripeAccount: stripeAccountId }
      );
    } else {
      // Create webhook on the platform account with connect=true
      // so it receives events from connected accounts
      endpoint = await stripe.webhookEndpoints.create({
        url,
        enabled_events: events,
        connect: true,
        metadata,
      });
    }

    return NextResponse.json({
      success: true,
      endpoint: {
        id: endpoint.id,
        url: endpoint.url,
        status: endpoint.status,
        enabled_events: endpoint.enabled_events,
        created: endpoint.created,
        scope,
      },
    });
  } catch (error: any) {
    console.error('Create webhook endpoint error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 });
  }
}
