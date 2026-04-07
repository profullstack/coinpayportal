import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import { getStripe } from '@/lib/server/optional-deps';
import { encrypt, decrypt } from '@/lib/crypto/encryption';

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY not set');
  return key;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

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
    if (!businessId) {
      return NextResponse.json({ success: false, error: 'business_id is required' }, { status: 400 });
    }
    const stripeAccountId = await getStripeAccountId(businessId);
    if (!stripeAccountId) {
      return NextResponse.json({ success: true, endpoints: [] });
    }

    const stripe = await getStripe();

    // List platform-level webhooks and filter STRICTLY by the requesting
    // business UUID stored in metadata. Webhooks belonging to other businesses
    // (even other businesses owned by the same merchant) must NOT be listed.
    // Endpoints must match BOTH the requesting business UUID AND the
    // stripe account currently linked to that business — defense in depth
    // so a stale/reassigned business UUID can't surface webhooks belonging
    // to a different connected account.
    const matches = (ep: any) =>
      ep.metadata?.business_id === businessId &&
      ep.metadata?.stripe_account_id === stripeAccountId;

    const platformEndpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const filteredPlatform = platformEndpoints.data.filter(matches);

    // List webhooks on the connected account itself, filtered the same way
    let accountEndpoints: any[] = [];
    try {
      const acctList = await stripe.webhookEndpoints.list(
        { limit: 100 },
        { stripeAccount: stripeAccountId }
      );
      accountEndpoints = acctList.data.filter(matches);
    } catch {
      // Connected account may not support webhook listing — that's ok
    }

    const results = [
      ...filteredPlatform.map((ep: any) => ({ ...ep, _scope: ep.metadata?.scope || 'platform' })),
      ...accountEndpoints.map((ep: any) => ({ ...ep, _scope: 'account' })),
    ];

    // Fetch stored secrets for these endpoints
    const endpointIds = results.map((ep: any) => ep.id);
    let secretMap: Record<string, string> = {};
    try {
      const supabase = getSupabase();
      const { data: secrets } = await supabase
        .from('stripe_webhook_secrets')
        .select('endpoint_id, encrypted_secret')
        .in('endpoint_id', endpointIds);
      if (secrets) {
        const encKey = getEncryptionKey();
        for (const s of secrets) {
          try {
            secretMap[s.endpoint_id] = decrypt(s.encrypted_secret, encKey);
          } catch { /* skip if decrypt fails */ }
        }
      }
    } catch { /* secrets table may not exist yet */ }

    return NextResponse.json({
      success: true,
      endpoints: results.map((ep: any) => ({
        id: ep.id,
        url: ep.url,
        status: ep.status,
        enabled_events: ep.enabled_events,
        created: ep.created,
        scope: ep._scope,
        has_secret: !!secretMap[ep.id],
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

    if (!business_id) {
      return NextResponse.json({ success: false, error: 'business_id is required' }, { status: 400 });
    }
    if (!url || !events?.length) {
      return NextResponse.json({ success: false, error: 'URL and events are required' }, { status: 400 });
    }

    // scope: "platform" = webhook on platform account listening for connect events
    //        "account"  = webhook on the connected account itself
    const scope = requestedScope === 'account' ? 'account' : 'platform';

    const stripeAccountId = await getStripeAccountId(business_id);
    if (!stripeAccountId) {
      return NextResponse.json({ success: false, error: 'Stripe account not found' }, { status: 404 });
    }

    const stripe = await getStripe();
    // Tie the webhook to the *business UUID* (not the stripe account) so that
    // listings/deletes can correctly scope per-business — a single merchant
    // may own multiple businesses sharing the same Stripe account.
    const metadata = { business_id, stripe_account_id: stripeAccountId, scope };

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

    // Store the signing secret encrypted in our DB (Stripe only returns it on creation)
    if (endpoint.secret) {
      try {
        const supabase = getSupabase();
        const encryptedSecret = encrypt(endpoint.secret, getEncryptionKey());
        await supabase.from('stripe_webhook_secrets').insert({
          endpoint_id: endpoint.id,
          business_id,
          encrypted_secret: encryptedSecret,
        });
      } catch (err) {
        console.error('Failed to store webhook secret:', err);
      }
    }

    return NextResponse.json({
      success: true,
      endpoint: {
        id: endpoint.id,
        url: endpoint.url,
        status: endpoint.status,
        enabled_events: endpoint.enabled_events,
        created: endpoint.created,
        secret: endpoint.secret, // Also returned to client on creation
        scope,
      },
    });
  } catch (error: any) {
    console.error('Create webhook endpoint error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 });
  }
}
