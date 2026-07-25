import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createMerchantWallet,
  type CreateMerchantWalletInput,
} from '@/lib/wallets/merchant-service';
import { listUserWallets, type WalletSource } from '@/lib/wallets/user-wallets';
import { resolveBearerAuth, hasScope } from '@/lib/auth/bearer';

/** Scope an OAuth client must hold to read wallets. */
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

/** Parse and validate the `source` query param. */
function parseSource(raw: string | null): WalletSource | 'all' | null {
  if (!raw) return 'all';
  if (raw === 'account' || raw === 'business' || raw === 'all') return raw;
  return null;
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
 * List the caller's wallet addresses: account-level ("global") wallets plus the
 * wallets of every business they can read. Most users keep addresses on a
 * business, so account-level-only listing looked empty to OAuth clients.
 *
 * Query params:
 *   - `source=account|business|all` (default `all`)
 *   - `business_id=<uuid>` — only that business's wallets (implies business scope)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = verifyAuth(request);
    if (!auth.ok) {
      return unauthorized(auth);
    }

    if (!hasScope(auth, WALLET_READ_SCOPE)) {
      return insufficientScope(WALLET_READ_SCOPE);
    }

    const { searchParams } = new URL(request.url);
    const source = parseSource(searchParams.get('source'));
    if (!source) {
      return NextResponse.json(
        { success: false, error: "Invalid source. Must be 'account', 'business', or 'all'" },
        { status: 400 }
      );
    }
    const businessId = searchParams.get('business_id') || undefined;

    const supabase = createSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const result = await listUserWallets(supabase, auth.userId, { source, businessId });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status ?? 400 }
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
 * Create a new global wallet for the authenticated merchant.
 *
 * Dashboard sessions only — no OAuth scope grants wallet writes, so third-party
 * access tokens are rejected here even though they may read wallets.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = verifyAuth(request);
    if (!auth.ok) {
      return unauthorized(auth);
    }

    if (auth.kind === 'oauth') {
      return insufficientScope('wallet:write');
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

    const result = await createMerchantWallet(supabase, auth.userId, input);

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
