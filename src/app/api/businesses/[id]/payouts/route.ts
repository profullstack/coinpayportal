import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import { createPayout, listPayouts } from '@/lib/payouts/service';

/**
 * Verify JWT auth and extract merchant ID.
 * Mirrors the pattern used in businesses/[id]/wallets/route.ts.
 */
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
 * Verify the authenticated merchant owns this business.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function verifyBusinessOwnership(
  supabase: any,
  businessId: string,
  merchantId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .eq('merchant_id', merchantId)
    .single();
  return !!data;
}

// ─── GET /api/businesses/[id]/payouts ────────────────────────────
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

    const owns = await verifyBusinessOwnership(supabase, id, auth.merchantId!);
    if (!owns) {
      return NextResponse.json({ success: false, error: 'Business not found or access denied' }, { status: 404 });
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status') || undefined;
    const email = url.searchParams.get('email') || undefined;
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const result = await listPayouts(supabase, id, { status, email, limit, offset });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      payouts: result.payouts,
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('List payouts error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST /api/businesses/[id]/payouts ───────────────────────────
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

    const owns = await verifyBusinessOwnership(supabase, id, auth.merchantId!);
    if (!owns) {
      return NextResponse.json({ success: false, error: 'Business not found or access denied' }, { status: 404 });
    }

    const body = await request.json();

    if (!body.recipient_email || !body.recipient_wallet || !body.amount_usd) {
      return NextResponse.json(
        { success: false, error: 'recipient_email, recipient_wallet, and amount_usd are required' },
        { status: 400 }
      );
    }

    const result = await createPayout(supabase, id, {
      recipient_email: body.recipient_email,
      recipient_wallet: body.recipient_wallet,
      cryptocurrency: body.cryptocurrency,
      amount_usd: parseFloat(body.amount_usd),
      metadata: body.metadata,
    });

    if (!result.success) {
      // If a payout record was created but failed, return 422 with the record
      const status = result.payout ? 422 : 400;
      return NextResponse.json(
        { success: false, error: result.error, payout: result.payout },
        { status }
      );
    }

    return NextResponse.json({ success: true, payout: result.payout }, { status: 201 });
  } catch (error) {
    console.error('Create payout error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
