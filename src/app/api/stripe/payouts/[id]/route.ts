import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';

/**
 * GET /api/stripe/payouts/[id]
 * Get a specific payout by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    let decoded;
    try {
      decoded = verifyToken(token, jwtSecret);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const merchantId = decoded.userId;
    const { id } = await params;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: payout, error } = await supabase
      .from('stripe_payouts')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('id', id)
      .single();

    if (error || !payout) {
      return NextResponse.json(
        { success: false, error: 'Payout not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      payout: {
        id: payout.id,
        stripe_payout_id: payout.stripe_payout_id,
        amount_cents: payout.amount || 0,
        amount_usd: ((payout.amount || 0) / 100).toFixed(2),
        currency: payout.currency || 'usd',
        status: payout.status,
        arrival_date: payout.arrival_date,
        description: payout.description,
        created_at: payout.created_at,
        updated_at: payout.updated_at,
      },
    });
  } catch (error) {
    console.error('Get payout error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
