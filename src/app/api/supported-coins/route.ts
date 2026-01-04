import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth, isBusinessAuth } from '@/lib/auth/middleware';

/**
 * Cryptocurrency name mapping
 */
const CRYPTO_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  BCH: 'Bitcoin Cash',
  ETH: 'Ethereum',
  POL: 'Polygon',
  SOL: 'Solana',
  USDT: 'Tether',
  USDC: 'USD Coin',
  BNB: 'BNB',
  XRP: 'XRP',
  ADA: 'Cardano',
  DOGE: 'Dogecoin',
};

/**
 * Supported coin response type
 */
interface SupportedCoin {
  symbol: string;
  name: string;
  is_active: boolean;
  has_wallet: boolean;
}

/**
 * Business wallet from database
 */
interface BusinessWallet {
  cryptocurrency: string;
  wallet_address: string;
  is_active: boolean;
}

/**
 * Get the human-readable name for a cryptocurrency symbol
 */
function getCryptoName(symbol: string): string {
  return CRYPTO_NAMES[symbol] || symbol;
}

/**
 * Transform a wallet record to a supported coin response
 */
function transformWalletToSupportedCoin(wallet: BusinessWallet): SupportedCoin {
  return {
    symbol: wallet.cryptocurrency,
    name: getCryptoName(wallet.cryptocurrency),
    is_active: wallet.is_active,
    has_wallet: true,
  };
}

/**
 * GET /api/supported-coins
 * 
 * Returns the list of supported cryptocurrencies (wallets) configured for a business.
 * 
 * Authentication:
 * - API Key: Business ID is derived from the API key
 * - JWT: Requires business_id query parameter
 * 
 * Query Parameters:
 * - business_id (required for JWT auth): The business UUID
 * - active_only (optional): If "true", only return active wallets
 * 
 * Response:
 * {
 *   success: true,
 *   coins: [{ symbol, name, is_active, has_wallet }],
 *   business_id: string,
 *   total: number
 * }
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate request
    const authHeader = request.headers.get('authorization');
    const authResult = await authenticateRequest(supabase, authHeader);

    if (!authResult.success || !authResult.context) {
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const queryBusinessId = searchParams.get('business_id');
    const activeOnly = searchParams.get('active_only') === 'true';

    // Resolve business ID based on auth type
    let businessId: string;
    let merchantId: string;

    if (isBusinessAuth(authResult.context)) {
      // API key auth - business ID comes from the API key
      businessId = authResult.context.businessId;
      merchantId = authResult.context.merchantId;
    } else if (isMerchantAuth(authResult.context)) {
      // JWT auth - business ID must be provided in query params
      if (!queryBusinessId) {
        return NextResponse.json(
          { success: false, error: 'business_id is required when using JWT authentication' },
          { status: 400 }
        );
      }
      businessId = queryBusinessId;
      merchantId = authResult.context.merchantId;
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid authentication context' },
        { status: 401 }
      );
    }

    // Verify business belongs to merchant (for JWT auth)
    if (isMerchantAuth(authResult.context)) {
      const { data: business, error: businessError } = await supabase
        .from('businesses')
        .select('id')
        .eq('id', businessId)
        .eq('merchant_id', merchantId)
        .single();

      if (businessError || !business) {
        return NextResponse.json(
          { success: false, error: 'Business not found or access denied' },
          { status: 404 }
        );
      }
    }

    // Fetch wallets for the business
    let query = supabase
      .from('business_wallets')
      .select('cryptocurrency, wallet_address, is_active')
      .eq('business_id', businessId)
      .order('cryptocurrency', { ascending: true });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    const { data: wallets, error: walletsError } = await query;

    if (walletsError) {
      console.error('Error fetching wallets:', walletsError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch supported coins' },
        { status: 500 }
      );
    }

    // Transform wallets to supported coins format
    const coins: SupportedCoin[] = (wallets || []).map((wallet) =>
      transformWalletToSupportedCoin(wallet as BusinessWallet)
    );

    return NextResponse.json(
      {
        success: true,
        coins,
        business_id: businessId,
        total: coins.length,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Supported coins error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
