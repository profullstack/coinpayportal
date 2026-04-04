import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getBalance, addCredits } from '@/lib/usage/service';
import { getJwtSecret } from '@/lib/secrets';

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

    const body = await request.json();
    const { user_email, amount_usd, payment_id, payment_method, tx_hash } = body;

    if (!user_email || !amount_usd) {
      return NextResponse.json(
        { success: false, error: 'user_email and amount_usd are required' },
        { status: 400 }
      );
    }

    if (typeof amount_usd !== 'number' || amount_usd <= 0) {
      return NextResponse.json(
        { success: false, error: 'amount_usd must be a positive number' },
        { status: 400 }
      );
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
