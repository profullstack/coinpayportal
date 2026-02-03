import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import {
  getMerchantWallet,
  updateMerchantWallet,
  deleteMerchantWallet,
  type UpdateMerchantWalletInput,
} from '@/lib/wallets/merchant-service';
import type { Cryptocurrency } from '@/lib/wallets/service';
import { getJwtSecret } from '@/lib/secrets';

/**
 * Helper to verify auth and get merchant ID
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
 * GET /api/wallets/[cryptocurrency]
 * Get a specific global wallet by cryptocurrency
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ cryptocurrency: string }> }
) {
  try {
    const { cryptocurrency } = await params;
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

    const result = await getMerchantWallet(
      supabase,
      auth.merchantId!,
      cryptocurrency.toUpperCase() as Cryptocurrency
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
    console.error('Get merchant wallet error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/wallets/[cryptocurrency]
 * Update a specific global wallet
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ cryptocurrency: string }> }
) {
  try {
    const { cryptocurrency } = await params;
    const auth = await verifyAuth(request);
    if (auth.error) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status }
      );
    }

    const body = await request.json();
    const input: UpdateMerchantWalletInput = {
      wallet_address: body.wallet_address,
      label: body.label,
      is_active: body.is_active,
    };

    const supabase = createSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const result = await updateMerchantWallet(
      supabase,
      auth.merchantId!,
      cryptocurrency.toUpperCase() as Cryptocurrency,
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
    console.error('Update merchant wallet error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/wallets/[cryptocurrency]
 * Delete a specific global wallet
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ cryptocurrency: string }> }
) {
  try {
    const { cryptocurrency } = await params;
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

    const result = await deleteMerchantWallet(
      supabase,
      auth.merchantId!,
      cryptocurrency.toUpperCase() as Cryptocurrency
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Delete merchant wallet error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
