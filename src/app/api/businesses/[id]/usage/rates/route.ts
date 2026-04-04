import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getRates, upsertRate, deleteRate } from '@/lib/usage/service';
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
 * GET /api/businesses/[id]/usage/rates
 * List all rates for a business
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

    const rates = await getRates(supabase, id);

    return NextResponse.json({ success: true, rates });
  } catch (error) {
    console.error('Get usage rates error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/businesses/[id]/usage/rates
 * Add or update a rate
 * Body: { action_type, cost_usd, unit?, description? }
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
    const { action_type, cost_usd, unit, description } = body;

    if (!action_type || cost_usd === undefined) {
      return NextResponse.json(
        { success: false, error: 'action_type and cost_usd are required' },
        { status: 400 }
      );
    }

    if (typeof cost_usd !== 'number' || cost_usd < 0) {
      return NextResponse.json(
        { success: false, error: 'cost_usd must be a non-negative number' },
        { status: 400 }
      );
    }

    const result = await upsertRate(supabase, id, action_type, cost_usd, unit, description);

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, rate: result.rate }, { status: 201 });
  } catch (error) {
    console.error('Upsert usage rate error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/businesses/[id]/usage/rates
 * Remove a rate
 * Body: { action_type }
 */
export async function DELETE(
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
    const { action_type } = body;

    if (!action_type) {
      return NextResponse.json(
        { success: false, error: 'action_type is required' },
        { status: 400 }
      );
    }

    const result = await deleteRate(supabase, id, action_type);

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete usage rate error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
