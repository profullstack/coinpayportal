import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { deductCredits } from '@/lib/usage/service';
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
 * POST /api/businesses/[id]/usage/deduct
 * Deduct credits for an action
 * Body: { user_email, action_type, quantity?, metadata? }
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
    const { user_email, action_type, quantity, metadata } = body;

    if (!user_email || !action_type) {
      return NextResponse.json(
        { success: false, error: 'user_email and action_type are required' },
        { status: 400 }
      );
    }

    const result = await deductCredits(
      supabase,
      id,
      user_email,
      action_type,
      quantity || 1,
      metadata || {}
    );

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          remaining_balance: result.remaining_balance,
          cost: result.cost,
          action_type: result.action_type,
        },
        { status: 402 }
      );
    }

    return NextResponse.json({
      success: true,
      remaining_balance: result.remaining_balance,
      cost: result.cost,
      action_type: result.action_type,
    });
  } catch (error) {
    console.error('Deduct usage credits error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
