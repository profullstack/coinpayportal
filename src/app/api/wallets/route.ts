import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import {
  createMerchantWallet,
  listMerchantWallets,
  type CreateMerchantWalletInput,
} from '@/lib/wallets/merchant-service';
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
 * GET /api/wallets
 * List all global wallets for the authenticated merchant
 */
export async function GET(request: NextRequest) {
  try {
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

    const result = await listMerchantWallets(supabase, auth.merchantId!);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: true, wallets: result.wallets },
      { status: 200 }
    );
  } catch (error) {
    console.error('List merchant wallets error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/wallets
 * Create a new global wallet for the authenticated merchant
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (auth.error) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status }
      );
    }

    const body = await request.json();
    const input: CreateMerchantWalletInput = {
      cryptocurrency: body.cryptocurrency,
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

    const result = await createMerchantWallet(supabase, auth.merchantId!, input);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: true, wallet: result.wallet },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create merchant wallet error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
