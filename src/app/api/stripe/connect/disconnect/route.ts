import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/server/optional-deps';
import { resolveMerchant } from '@/lib/auth/merchant';
import { verifyBusinessAccess } from '@/lib/wallets/supported-coins';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function DELETE(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const body = await request.json();
    const businessId = body.businessId || body.business_id;

    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }

    const authResult = await resolveMerchant(supabase, request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    if (authResult.apiKeyBusinessId && authResult.apiKeyBusinessId !== businessId) {
      return NextResponse.json({ error: 'businessId does not match API key scope' }, { status: 403 });
    }
    const access = await verifyBusinessAccess(supabase, businessId, authResult.merchantId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status ?? 404 });
    }

    const { data: accountRecord } = await supabase
      .from('stripe_accounts')
      .select('stripe_account_id')
      .eq('business_id', businessId)
      .single();

    if (!accountRecord?.stripe_account_id) {
      return NextResponse.json({ error: 'No Stripe Connect account found for this business' }, { status: 404 });
    }

    const stripeAccountId = accountRecord.stripe_account_id;

    // Delete the Stripe Express account (irreversible)
    try {
      await (await getStripe()).accounts.del(stripeAccountId);
    } catch (stripeError: any) {
      // If Stripe says the account doesn't exist, proceed with local cleanup
      if (!stripeError?.message?.includes('No such account')) {
        throw stripeError;
      }
    }

    // Remove local record
    const { error: deleteError } = await supabase
      .from('stripe_accounts')
      .delete()
      .eq('business_id', businessId);

    if (deleteError) {
      console.error('Failed to remove stripe_accounts record:', deleteError);
      return NextResponse.json({ error: 'Stripe account deleted but failed to update local record' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Stripe Connect disconnect error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to disconnect Stripe account' },
      { status: 500 }
    );
  }
}
