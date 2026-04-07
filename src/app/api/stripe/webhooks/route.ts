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

    // Merchants only ever see webhooks that live on their own connected
    // account. Platform-level webhooks belong to CoinPay infrastructure
    // (the single coinpayportal.com/api/stripe/webhook endpoint) and are
    // never exposed in the merchant UI — they aren't theirs to view, edit,
    // or delete. The strict business_id + stripe_account_id match is
    // defense in depth so a stale UUID can't surface another tenant's
    // webhook.
    const matches = (ep: any) =>
      ep.metadata?.business_id === businessId &&
      ep.metadata?.stripe_account_id === stripeAccountId;

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

    const results = accountEndpoints.map((ep: any) => ({ ...ep, _scope: 'account' }));

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

    // Merchants are ONLY allowed to create webhooks on their OWN connected
    // account (scope='account'). Platform-scoped webhooks listen for events
    // across every business on the platform — they belong to CoinPay infra,
    // not merchants. A misconfigured merchant URL here would silently hijack
    // checkout.session.completed / payment_intent.* for every payment on the
    // platform and route them away from CoinPay's own ingestion endpoint at
    // /api/stripe/webhook (which is exactly the d0rz incident).
    //
    // We also forbid platform-only event types on the merchant's connected
    // account: the merchant has no legitimate reason to subscribe to events
    // that destination-charge / Connect flows route through the platform.
    if (requestedScope === 'platform') {
      return NextResponse.json(
        {
          success: false,
          error:
            'Platform-scoped webhooks cannot be created by merchants. ' +
            'CoinPay manages the single platform-level Stripe webhook ' +
            '(coinpayportal.com/api/stripe/webhook). Use scope="account" ' +
            'to register a webhook on your own connected account.',
        },
        { status: 403 }
      );
    }
    const scope = 'account' as const;

    const PLATFORM_RESERVED_EVENTS = new Set<string>([
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed',
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
      'payment_intent.processing',
      'payment_intent.canceled',
      'charge.succeeded',
      'charge.failed',
      'charge.refunded',
      'charge.dispute.created',
      'payout.created',
      'payout.paid',
      'payout.failed',
      'account.updated',
    ]);
    const offending = (events as string[]).filter((e) => PLATFORM_RESERVED_EVENTS.has(e));
    if (offending.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            `These events are handled by CoinPay's platform webhook and cannot ` +
            `be subscribed to from a merchant endpoint: ${offending.join(', ')}. ` +
            `CoinPay forwards the corresponding payment.* events to your ` +
            `business webhook_url after processing.`,
        },
        { status: 400 }
      );
    }

    const stripeAccountId = await getStripeAccountId(business_id);
    if (!stripeAccountId) {
      return NextResponse.json({ success: false, error: 'Stripe account not found' }, { status: 404 });
    }

    const stripe = await getStripe();
    // Tie the webhook to the *business UUID* (not the stripe account) so that
    // listings/deletes can correctly scope per-business — a single merchant
    // may own multiple businesses sharing the same Stripe account.
    const metadata = { business_id, stripe_account_id: stripeAccountId, scope };

    // Always create on the connected account itself.
    const endpoint = await stripe.webhookEndpoints.create(
      { url, enabled_events: events, metadata },
      { stripeAccount: stripeAccountId }
    );

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
