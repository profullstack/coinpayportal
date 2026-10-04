import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import { getPayout, retryPayout, resolveIndeterminatePayout } from '@/lib/payouts/service';

/**
 * Verify JWT auth and extract merchant ID.
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

// ─── GET /api/businesses/[id]/payouts/[payoutId] ─────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; payoutId: string }> }
) {
  try {
    const { id, payoutId } = await params;
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

    const result = await getPayout(supabase, id, payoutId);

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 404 });
    }

    return NextResponse.json({ success: true, payout: result.payout });
  } catch (error) {
    console.error('Get payout error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ─── PATCH /api/businesses/[id]/payouts/[payoutId] ───────────────
// Retry a failed payout
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; payoutId: string }> }
) {
  try {
    const { id, payoutId } = await params;
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

    // N-03: `indeterminate` had no exit at all.
    //
    // A payout lands there when the broadcast outcome is unknown — a timeout
    // after the node may already have accepted the transaction — and
    // `retryPayout` refuses to touch one, correctly, because re-sending could
    // pay the recipient twice. Its error told the operator to mark the payout
    // completed with its tx_hash, or failed and retry, and there was no way to
    // do either. The state described a procedure nobody could carry out.
    //
    // `{ resolution: 'completed' | 'failed' }` in the body is that transition.
    // It stays manual: only someone who has looked at the chain can say which
    // way it went, and a wrong automatic answer either pays twice or strands a
    // real payment.
    const body = await request.json().catch(() => ({}));
    const resolution = body?.resolution;

    if (resolution === 'completed' || resolution === 'failed') {
      const resolved = await resolveIndeterminatePayout(
        supabase,
        id,
        payoutId,
        resolution,
        typeof body?.tx_hash === 'string' ? body.tx_hash : undefined
      );

      if (!resolved.success) {
        return NextResponse.json({ success: false, error: resolved.error }, { status: 400 });
      }
      return NextResponse.json({ success: true, payout: resolved.payout });
    }

    if (resolution !== undefined) {
      return NextResponse.json(
        { success: false, error: "resolution must be 'completed' or 'failed'" },
        { status: 400 }
      );
    }

    const result = await retryPayout(supabase, id, payoutId);

    if (!result.success) {
      const status = result.payout ? 422 : 400;
      return NextResponse.json(
        { success: false, error: result.error, payout: result.payout },
        { status }
      );
    }

    return NextResponse.json({ success: true, payout: result.payout });
  } catch (error) {
    console.error('Retry payout error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
