import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';

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

    const stripeAccountId = await getStripeAccountId(businessId || decoded.userId);
    if (!stripeAccountId) {
      return NextResponse.json({ success: false, error: 'Stripe account not found' }, { status: 404 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error } = await supabase
      .from('stripe_restricted_keys')
      .delete()
      .eq('stripe_key_id', id)
      .eq('stripe_account_id', stripeAccountId);

    if (error) {
      return NextResponse.json({ success: false, error: 'Failed to revoke key' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete API key error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 });
  }
}
