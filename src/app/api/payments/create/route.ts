import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createPayment, Blockchain } from '@/lib/payments/service';
import { authenticateRequest, isMerchantAuth, isBusinessAuth } from '@/lib/auth/middleware';
import {
  withTransactionLimit,
  createEntitlementErrorResponse,
} from '@/lib/entitlements/middleware';
import { incrementTransactionCount } from '@/lib/entitlements/service';

/**
 * Map frontend currency values to blockchain types
 */
function mapCurrencyToBlockchain(currency: string): Blockchain | null {
  const mapping: Record<string, Blockchain> = {
    // Native cryptocurrencies
    'btc': 'BTC',
    'bch': 'BCH',
    'eth': 'ETH',
    'pol': 'POL',
    'sol': 'SOL',
    'doge': 'DOGE',
    'xrp': 'XRP',
    'ada': 'ADA',
    'bnb': 'BNB',
    // Stablecoins (use parent chain)
    'usdt': 'USDT',      // ERC-20 on Ethereum
    'usdc': 'USDC',      // ERC-20 on Ethereum
    'usdc_eth': 'USDC_ETH',
    'usdc_pol': 'USDC_POL',
    'usdc_sol': 'USDC_SOL',
  };
  return mapping[currency.toLowerCase()] || null;
}

/**
 * Map blockchain to cryptocurrency code for wallet lookup
 */
function blockchainToCrypto(blockchain: Blockchain): string {
  if (blockchain.startsWith('USDC_')) {
    return 'USDC';
  }
  if (blockchain === 'USDT') {
    return 'USDT';
  }
  return blockchain;
}

/**
 * POST /api/payments/create
 * Create a new payment
 *
 * Requires authentication via JWT token or API key.
 * Enforces transaction limits based on subscription plan.
 */
export async function POST(request: NextRequest) {
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

    // Get merchant ID from auth context
    let merchantId: string;
    if (isMerchantAuth(authResult.context)) {
      merchantId = authResult.context.merchantId;
    } else if (isBusinessAuth(authResult.context)) {
      merchantId = authResult.context.merchantId;
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid authentication context' },
        { status: 401 }
      );
    }

    // Check transaction limit before creating payment
    const limitCheck = await withTransactionLimit(supabase, merchantId);
    if (!limitCheck.allowed) {
      if (limitCheck.error) {
        return createEntitlementErrorResponse(limitCheck.error);
      }
      return NextResponse.json(
        {
          success: false,
          error: 'Monthly transaction limit exceeded',
          usage: {
            current: limitCheck.currentUsage,
            limit: limitCheck.limit,
            remaining: limitCheck.remaining,
          }
        },
        { status: 429 }
      );
    }

    const body = await request.json();
    
    // Transform frontend data to service format
    const { business_id, amount_usd, amount, currency, blockchain, description, metadata } = body;
    
    // Determine the blockchain type
    const blockchainType = blockchain
      ? (blockchain.toUpperCase() as Blockchain)
      : currency
        ? mapCurrencyToBlockchain(currency)
        : null;
    
    if (!blockchainType) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing cryptocurrency type' },
        { status: 400 }
      );
    }
    
    // Determine the amount (support both amount_usd and amount)
    const paymentAmount = amount_usd ?? amount;
    if (!paymentAmount || paymentAmount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing payment amount' },
        { status: 400 }
      );
    }
    
    // Look up the merchant's wallet address for this cryptocurrency
    const cryptoCode = blockchainToCrypto(blockchainType);
    const { data: wallet, error: walletError } = await supabase
      .from('business_wallets')
      .select('wallet_address')
      .eq('business_id', business_id)
      .eq('cryptocurrency', cryptoCode)
      .eq('is_active', true)
      .single();
    
    if (walletError || !wallet) {
      return NextResponse.json(
        {
          success: false,
          error: `No ${cryptoCode} wallet configured for this business. Please add a wallet address in the business settings.`
        },
        { status: 400 }
      );
    }
    
    // Create the payment with transformed data
    const result = await createPayment(supabase, {
      business_id,
      amount: paymentAmount,
      currency: 'USD', // Always USD for now
      blockchain: blockchainType,
      merchant_wallet_address: wallet.wallet_address,
      metadata: metadata || (description ? { description } : undefined),
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    // Increment transaction count after successful payment creation
    await incrementTransactionCount(supabase, merchantId);

    // Transform payment response to include expected field names
    const payment = result.payment;
    
    const transformedPayment = {
      ...payment,
      amount_usd: payment?.amount,
      amount_crypto: payment?.crypto_amount,
      currency: payment?.blockchain?.toLowerCase(),
      // QR code is available at GET /api/payments/{id}/qr
    };

    return NextResponse.json(
      {
        success: true,
        payment: transformedPayment,
        usage: {
          current: limitCheck.currentUsage + 1,
          limit: limitCheck.limit,
          remaining: limitCheck.remaining !== null ? limitCheck.remaining - 1 : null,
        }
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create payment error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}