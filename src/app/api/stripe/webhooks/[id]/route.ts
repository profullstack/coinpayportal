import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import { getStripe } from '@/lib/server/optional-deps';
import { decrypt } from '@/lib/crypto/encryption';

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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Missing authorization header' }, { status: 401 });
    }
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }
    let decoded;
    try {
      decoded = verifyToken(authHeader.substring(7), jwtSecret);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid or expired token' }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    // Verify the user owns this business / has a Stripe account
    const stripeAccountId = await getStripeAccountId(businessId || decoded.userId);
    if (!stripeAccountId) {
      return NextResponse.json({ success: false, error: 'Stripe account not found' }, { status: 404 });
    }

    const stripe = await getStripe();

    // Try to retrieve from platform first, then from connected account
    let endpoint: any;
    let resolvedScope: 'platform' | 'account' = 'platform';
    try {
      endpoint = await stripe.webhookEndpoints.retrieve(id);
    } catch {
      // Not found on platform — try the connected account
      try {
        endpoint = await stripe.webhookEndpoints.retrieve(id, { stripeAccount: stripeAccountId });
        resolvedScope = 'account';
      } catch {
        return NextResponse.json({ success: false, error: 'Webhook endpoint not found' }, { status: 404 });
      }
    }

    // Use stored scope from metadata if available, otherwise use where we found it
    const scope = endpoint.metadata?.scope || resolvedScope;

    // Verify the webhook belongs to this business before deleting
    if (endpoint.metadata?.business_id && endpoint.metadata.business_id !== stripeAccountId) {
      return NextResponse.json({ success: false, error: 'Webhook does not belong to this business' }, { status: 403 });
    }

    // Delete from the correct location based on scope
    if (scope === 'account') {
      await stripe.webhookEndpoints.del(id, { stripeAccount: stripeAccountId });
    } else {
      await stripe.webhookEndpoints.del(id);
    }

    // Clean up stored secret
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      await supabase.from('stripe_webhook_secrets').delete().eq('endpoint_id', id);
    } catch { /* ignore if table doesn't exist yet */ }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete webhook endpoint error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Missing authorization header' }, { status: 401 });
    }
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }
    let decoded;
    try {
      decoded = verifyToken(authHeader.substring(7), jwtSecret);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid or expired token' }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    const stripeAccountId = await getStripeAccountId(businessId || decoded.userId);
    if (!stripeAccountId) {
      return NextResponse.json({ success: false, error: 'Stripe account not found' }, { status: 404 });
    }

    // Look up stored secret
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: secretRow } = await supabase
      .from('stripe_webhook_secrets')
      .select('encrypted_secret')
      .eq('endpoint_id', id)
      .eq('business_id', stripeAccountId)
      .single();

    if (!secretRow) {
      return NextResponse.json({ success: false, error: 'No stored secret for this endpoint' }, { status: 404 });
    }

    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    const secret = decrypt(secretRow.encrypted_secret, encryptionKey);
    return NextResponse.json({ success: true, secret });
  } catch (error: any) {
    console.error('Get webhook secret error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 });
  }
}
