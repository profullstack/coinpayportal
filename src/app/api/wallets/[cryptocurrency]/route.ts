import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getMerchantWallet,
  updateMerchantWallet,
  deleteMerchantWallet,
  type UpdateMerchantWalletInput,
} from '@/lib/wallets/merchant-service';
import type { Cryptocurrency } from '@/lib/wallets/service';
import { resolveBearerAuth, hasScope } from '@/lib/auth/bearer';

const WALLET_READ_SCOPE = 'wallet:read';

/**
 * Verify auth, accepting a dashboard session token or an OAuth2 access token.
 */
function verifyAuth(request: NextRequest) {
  return resolveBearerAuth(request.headers.get('authorization'));
}

function insufficientScope(scope: string) {
  return NextResponse.json(
    {
      success: false,
      error: `insufficient_scope: this token is missing the '${scope}' scope`,
    },
    {
      status: 403,
      headers: {
        'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${scope}"`,
      },
    }
  );
}

function unauthorized(auth: { status: number; error: string; wwwAuthenticate?: string }) {
  return NextResponse.json(
    { success: false, error: auth.error },
    {
      status: auth.status,
      ...(auth.wwwAuthenticate
        ? { headers: { 'WWW-Authenticate': auth.wwwAuthenticate } }
        : {}),
    }
  );
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
    const auth = verifyAuth(request);
    if (!auth.ok) {
      return unauthorized(auth);
    }

    if (!hasScope(auth, WALLET_READ_SCOPE)) {
      return insufficientScope(WALLET_READ_SCOPE);
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
      auth.userId,
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
    const auth = verifyAuth(request);
    if (!auth.ok) {
      return unauthorized(auth);
    }

    // No OAuth scope grants wallet writes.
    if (auth.kind === 'oauth') {
      return insufficientScope('wallet:write');
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
      auth.userId,
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
    const auth = verifyAuth(request);
    if (!auth.ok) {
      return unauthorized(auth);
    }

    // No OAuth scope grants wallet writes.
    if (auth.kind === 'oauth') {
      return insufficientScope('wallet:write');
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
      auth.userId,
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
