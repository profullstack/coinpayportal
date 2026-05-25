import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isBusinessAuth, isMerchantAuth } from '@/lib/auth/middleware';
import {
  coinToSupportedToken,
  getSupportedWalletsForBusiness,
  verifyBusinessAccess,
  walletToSupportedCoin,
} from '@/lib/wallets/supported-coins';

/**
 * GET /api/tokens
 *
 * Payment-option friendly view of /api/supported-coins.
 * Business wallets win; merchant global wallets are used as fallback.
 *
 * Query:
 * - business_id: required for JWT auth, optional for API keys when it matches scope
 * - active_only: if true, only active wallets are returned
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const authResult = await authenticateRequest(supabase, request.headers.get('authorization'));
    if (!authResult.success || !authResult.context) {
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const queryBusinessId = searchParams.get('business_id');
    const activeOnly = searchParams.get('active_only') === 'true';

    let businessId: string;
    let merchantId: string;

    if (isBusinessAuth(authResult.context)) {
      if (queryBusinessId && queryBusinessId !== authResult.context.businessId) {
        return NextResponse.json(
          { success: false, error: 'business_id does not match API key scope' },
          { status: 403 },
        );
      }
      businessId = authResult.context.businessId;
      merchantId = authResult.context.merchantId;
    } else if (isMerchantAuth(authResult.context)) {
      if (!queryBusinessId) {
        return NextResponse.json(
          { success: false, error: 'business_id is required when using JWT authentication' },
          { status: 400 },
        );
      }
      businessId = queryBusinessId;
      merchantId = authResult.context.merchantId;
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid authentication context' },
        { status: 401 },
      );
    }

    const access = await verifyBusinessAccess(supabase, businessId, merchantId);
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status ?? 404 },
      );
    }

    const walletResult = await getSupportedWalletsForBusiness(
      supabase,
      businessId,
      merchantId,
      activeOnly,
    );
    if (walletResult.error) {
      console.error('Error fetching tokens:', walletResult.error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch tokens' },
        { status: 500 },
      );
    }

    const coins = (walletResult.wallets || []).map(walletToSupportedCoin);
    const tokens = coins.map(coinToSupportedToken);

    return NextResponse.json({
      success: true,
      tokens,
      coins,
      business_id: businessId,
      merchant_id: merchantId,
      total: tokens.length,
    });
  } catch (error) {
    console.error('Tokens API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
