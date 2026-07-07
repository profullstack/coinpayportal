import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth, isBusinessAuth } from '@/lib/auth/middleware';
import { createPayout } from '@/lib/payouts/service';

/**
 * POST /api/payouts/create
 *
 * Machine-to-machine payout endpoint. Sends a crypto payout from the
 * authenticated business's wallet to a recipient address. Mirrors the auth
 * pattern of /api/payments/create — accepts either a business API key (Bearer)
 * or a merchant JWT.
 *
 * With a business API key the business is implicit. With a merchant JWT the
 * caller must pass `business_id` (and own it).
 *
 * Body:
 *   {
 *     recipient_email: string,
 *     recipient_wallet: string,
 *     amount_usd: number,
 *     cryptocurrency?: string,      // e.g. "USDC_POL" (default "USDT")
 *     business_id?: string,         // required for merchant-JWT auth
 *     metadata?: Record<string, unknown>
 *   }
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = request.headers.get('authorization');
    const authResult = await authenticateRequest(supabase, authHeader);
    if (!authResult.success || !authResult.context) {
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));

    // Resolve the business the payout sends from.
    let businessId: string | null = null;
    if (isBusinessAuth(authResult.context)) {
      businessId = authResult.context.businessId;
      // A business key may only pay out from its own business.
      if (body.business_id && body.business_id !== businessId) {
        return NextResponse.json(
          { success: false, error: 'business_id does not match the authenticated business' },
          { status: 403 }
        );
      }
    } else if (isMerchantAuth(authResult.context)) {
      businessId = body.business_id ?? null;
      if (!businessId) {
        return NextResponse.json(
          { success: false, error: 'business_id is required for merchant authentication' },
          { status: 400 }
        );
      }
      // Verify the merchant owns the requested business.
      const { data: owned } = await supabase
        .from('businesses')
        .select('id')
        .eq('id', businessId)
        .eq('merchant_id', authResult.context.merchantId)
        .single();
      if (!owned) {
        return NextResponse.json(
          { success: false, error: 'Business not found or access denied' },
          { status: 404 }
        );
      }
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid authentication context' },
        { status: 401 }
      );
    }

    if (!body.recipient_email || !body.recipient_wallet || !body.amount_usd) {
      return NextResponse.json(
        {
          success: false,
          error: 'recipient_email, recipient_wallet, and amount_usd are required',
        },
        { status: 400 }
      );
    }

    const result = await createPayout(supabase, businessId!, {
      recipient_email: body.recipient_email,
      recipient_wallet: body.recipient_wallet,
      cryptocurrency: body.cryptocurrency,
      amount_usd: parseFloat(body.amount_usd),
      metadata: body.metadata,
    });

    if (!result.success) {
      // A payout record that was created but failed to send returns 422.
      const status = result.payout ? 422 : 400;
      return NextResponse.json(
        { success: false, error: result.error, payout: result.payout },
        { status }
      );
    }

    return NextResponse.json({ success: true, payout: result.payout }, { status: 201 });
  } catch (error) {
    console.error('Create payout (api-key) error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
