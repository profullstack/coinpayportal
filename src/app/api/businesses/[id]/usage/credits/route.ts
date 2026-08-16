import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getBalance, addCredits } from '@/lib/usage/service';
import { getJwtSecret } from '@/lib/secrets';

/**
 * Ceiling on a single credit top-up. The ledger is currency-denominated, so an
 * unbounded value distorts every aggregate that reads it.
 */
const MAX_TOPUP_USD = 100_000;

async function verifyAuth(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing authorization header', status: 401 };
  }

  const token = authHeader.substring(7);
  const jwtSecret = getJwtSecret();

  if (!jwtSecret) {
    return { error: 'Server configuration error', status: 500 };
  }

  try {
    const decoded = verifyToken(token, jwtSecret);
    return { merchantId: decoded.userId };
  } catch {
    return { error: 'Invalid or expired token', status: 401 };
  }
}

function createSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Confirm the authenticated merchant owns this business.
 *
 * Both handlers authenticated the caller and then used the `[id]` from the URL
 * without ever checking it belonged to them. A valid token for ANY merchant
 * could therefore read another business's credit balances and — far worse —
 * POST credits into another business's ledger. 404 rather than 403, so the
 * endpoint is not an existence oracle for business ids.
 */
async function verifyBusinessOwnership(
  supabase: NonNullable<ReturnType<typeof createSupabaseClient>>,
  businessId: string,
  merchantId: string,
): Promise<boolean> {
  const { data: business } = await supabase
    .from('businesses')
    .select('merchant_id')
    .eq('id', businessId)
    .single();

  return Boolean(business && (business as { merchant_id?: string }).merchant_id === merchantId);
}

/**
 * GET /api/businesses/[id]/usage/credits?email=user@example.com
 * Get credit balance for a user
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await verifyAuth(request);
    if (auth.error) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const supabase = createSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    if (!(await verifyBusinessOwnership(supabase, id, auth.merchantId!))) {
      return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
    }

    const email = request.nextUrl.searchParams.get('email');
    if (!email) {
      return NextResponse.json({ success: false, error: 'email query parameter is required' }, { status: 400 });
    }

    const balance = await getBalance(supabase, id, email);

    return NextResponse.json({
      success: true,
      credits: balance || {
        business_id: id,
        user_email: email,
        balance_usd: 0,
        lifetime_purchased_usd: 0,
        lifetime_used_usd: 0,
      },
    });
  } catch (error) {
    console.error('Get usage credits error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/businesses/[id]/usage/credits
 * Add credits / top-up
 * Body: { user_email, amount_usd, payment_id?, payment_method?, tx_hash? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await verifyAuth(request);
    if (auth.error) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const supabase = createSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    if (!(await verifyBusinessOwnership(supabase, id, auth.merchantId!))) {
      return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
    }

    const body = await request.json();
    const { user_email, amount_usd, payment_id, payment_method, tx_hash } = body;

    if (!user_email || !amount_usd) {
      return NextResponse.json(
        { success: false, error: 'user_email and amount_usd are required' },
        { status: 400 }
      );
    }

    if (typeof amount_usd !== 'number' || !Number.isFinite(amount_usd) || amount_usd <= 0) {
      return NextResponse.json(
        { success: false, error: 'amount_usd must be a positive number' },
        { status: 400 }
      );
    }

    if (amount_usd > MAX_TOPUP_USD) {
      return NextResponse.json(
        { success: false, error: `amount_usd exceeds the maximum of ${MAX_TOPUP_USD}` },
        { status: 400 }
      );
    }

    // When a top-up claims to be backed by a payment, that payment must exist,
    // belong to this business, be settled, and cover the amount being credited.
    // Without this, `payment_id` was decoration: any string was accepted and
    // the credit was granted regardless.
    if (payment_id) {
      const { data: backingPayment } = await supabase
        .from('payments')
        .select('id, business_id, status, amount')
        .eq('id', payment_id)
        .single();

      if (
        !backingPayment ||
        backingPayment.business_id !== id ||
        !['confirmed', 'forwarded'].includes(String(backingPayment.status))
      ) {
        return NextResponse.json(
          { success: false, error: 'payment_id does not reference a settled payment for this business' },
          { status: 400 }
        );
      }

      if (Number(backingPayment.amount) < amount_usd) {
        return NextResponse.json(
          {
            success: false,
            error: 'amount_usd exceeds the value of the referenced payment',
          },
          { status: 400 }
        );
      }

      // One payment funds one top-up.
      const { data: alreadyUsed } = await supabase
        .from('usage_topups')
        .select('id')
        .eq('payment_id', payment_id)
        .limit(1);

      if (alreadyUsed && alreadyUsed.length > 0) {
        return NextResponse.json(
          { success: false, error: 'This payment has already been credited' },
          { status: 409 }
        );
      }
    }

    const result = await addCredits(supabase, id, user_email, amount_usd, payment_id, payment_method, tx_hash);

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, credits: result.balance }, { status: 201 });
  } catch (error) {
    console.error('Add usage credits error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
