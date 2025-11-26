import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import {
  getWallet,
  updateWallet,
  deleteWallet,
  type Cryptocurrency,
  type UpdateWalletInput,
} from '@/lib/wallets/service';

/**
 * Helper to verify auth and get merchant ID
 */
async function verifyAuth(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing authorization header', status: 401 };
  }

  const token = authHeader.substring(7);
  const jwtSecret = process.env.JWT_SECRET;
  
  if (!jwtSecret) {
    return { error: 'Server configuration error', status: 500 };
  }

  try {
    const decoded = verifyToken(token, jwtSecret);
    return { merchantId: decoded.userId };
  } catch (error) {
    return { error: 'Invalid or expired token', status: 401 };
  }
}

/**
 * Helper to create Supabase client
 */
function createSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

/**
 * GET /api/businesses/[id]/wallets/[cryptocurrency]
 * Get a specific wallet by cryptocurrency
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; cryptocurrency: string }> }
) {
  try {
    const { id, cryptocurrency } = await params;
    const auth = await verifyAuth(request);
    if (auth.error) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status }
      );
    }

    const supabase = createSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const result = await getWallet(
      supabase,
      id,
      cryptocurrency as Cryptocurrency,
      auth.merchantId!
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: true, wallet: result.wallet },
      { status: 200 }
    );
  } catch (error) {
    console.error('Get wallet error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/businesses/[id]/wallets/[cryptocurrency]
 * Update a wallet
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; cryptocurrency: string }> }
) {
  try {
    const { id, cryptocurrency } = await params;
    const auth = await verifyAuth(request);
    if (auth.error) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status }
      );
    }

    const body = await request.json();
    const input: UpdateWalletInput = {
      wallet_address: body.wallet_address,
      is_active: body.is_active,
    };

    const supabase = createSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const result = await updateWallet(
      supabase,
      id,
      cryptocurrency as Cryptocurrency,
      auth.merchantId!,
      input
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: true, wallet: result.wallet },
      { status: 200 }
    );
  } catch (error) {
    console.error('Update wallet error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/businesses/[id]/wallets/[cryptocurrency]
 * Delete a wallet
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; cryptocurrency: string }> }
) {
  try {
    const { id, cryptocurrency } = await params;
    const auth = await verifyAuth(request);
    if (auth.error) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status }
      );
    }

    const supabase = createSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const result = await deleteWallet(
      supabase,
      id,
      cryptocurrency as Cryptocurrency,
      auth.merchantId!
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: true },
      { status: 200 }
    );
  } catch (error) {
    console.error('Delete wallet error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}