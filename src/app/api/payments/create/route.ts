import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createPayment, Blockchain } from '@/lib/payments/service';
import { authenticateRequest, isMerchantAuth, isBusinessAuth } from '@/lib/auth/middleware';
import {
  withTransactionLimit,
  createEntitlementErrorResponse,
} from '@/lib/entitlements/middleware';
import { incrementTransactionCount } from '@/lib/entitlements/service';
import { getStripe } from '@/lib/server/optional-deps';

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

type PaymentMethod = 'crypto' | 'card' | 'both';

/**
 * Create a Stripe Checkout Session for a payment using the merchant's connected account.
 * Returns { stripe_checkout_url, stripe_session_id } or throws.
 */
async function createStripeCheckoutSession(
  supabase: any,
  businessId: string,
  merchantId: string,
  amountCents: number,
  description: string | undefined,
  paymentId: string,
  successUrl?: string,
  cancelUrl?: string,
): Promise<{ stripe_checkout_url: string; stripe_session_id: string }> {
  // Look up stripe connected account
  const { data: stripeAccount } = await supabase
    .from('stripe_accounts')
    .select('stripe_account_id, charges_enabled')
    .eq('merchant_id', merchantId)
    .single() as { data: { stripe_account_id: string; charges_enabled: boolean } | null };

  if (!stripeAccount?.stripe_account_id || !stripeAccount.charges_enabled) {
    throw new Error('STRIPE_NOT_CONNECTED');
  }

  // Determine tier for fee calculation
  const { data: business } = await supabase
    .from('businesses')
    .select('tier')
    .eq('id', businessId)
    .single() as { data: { tier: string } | null };

  const tier = business?.tier || 'free';
  const platformFeeRate = tier === 'pro' ? 0.005 : 0.01;
  const platformFeeAmount = Math.round(amountCents * platformFeeRate);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';

  const stripe = await getStripe();
  const session = await stripe.checkout.sessions.create({
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: description || 'Payment' },
          unit_amount: amountCents,
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    payment_intent_data: {
      application_fee_amount: platformFeeAmount,
      transfer_data: {
        destination: stripeAccount.stripe_account_id,
      },
      metadata: {
        coinpay_payment_id: paymentId,
        business_id: businessId,
        merchant_id: merchantId,
      },
    },
    success_url: successUrl || `${appUrl}/pay/${paymentId}?status=success`,
    cancel_url: cancelUrl || `${appUrl}/pay/${paymentId}`,
    metadata: {
      coinpay_payment_id: paymentId,
      business_id: businessId,
      merchant_id: merchantId,
      platform_fee_amount: platformFeeAmount.toString(),
    },
  });

  return {
    stripe_checkout_url: session.url!,
    stripe_session_id: session.id,
  };
}

/**
 * POST /api/payments/create
 * Create a new payment
 *
 * Requires authentication via JWT token or API key.
 * Enforces transaction limits based on subscription plan.
 *
 * Supports optional `payment_method` field:
 *   - "crypto" (default) — existing crypto payment flow
 *   - "card" — creates a Stripe Checkout session via connected account
 *   - "both" — creates crypto payment AND returns stripe_checkout_url as fallback
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
    const {
      business_id,
      amount_usd,
      amount,
      currency,
      blockchain,
      description,
      metadata,
      redirect_url,
      payment_method: rawPaymentMethod,
      success_url,
      cancel_url,
    } = body;

    const paymentMethod: PaymentMethod = (['crypto', 'card', 'both'].includes(rawPaymentMethod))
      ? rawPaymentMethod
      : 'crypto';

    // Determine the amount (support both amount_usd and amount)
    const paymentAmount = amount_usd ?? amount;
    if (!paymentAmount || paymentAmount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing payment amount' },
        { status: 400 }
      );
    }

    // For crypto or both, we need blockchain info
    const needsCrypto = paymentMethod === 'crypto' || paymentMethod === 'both';
    const needsCard = paymentMethod === 'card' || paymentMethod === 'both';

    // Determine the blockchain type (required for crypto, optional for card-only)
    let blockchainType: Blockchain | null = null;
    if (blockchain) {
      blockchainType = blockchain.toUpperCase() as Blockchain;
    } else if (currency) {
      blockchainType = mapCurrencyToBlockchain(currency);
    }

    if (needsCrypto && !blockchainType) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing cryptocurrency type' },
        { status: 400 }
      );
    }

    // Build metadata with optional redirect_url and description
    const paymentMetadata: Record<string, any> = { ...metadata };
    if (description) {
      paymentMetadata.description = description;
    }
    if (redirect_url) {
      paymentMetadata.redirect_url = redirect_url;
    }

    let cryptoPaymentResult: any = null;
    let stripeResult: { stripe_checkout_url: string; stripe_session_id: string } | null = null;

    // --- Crypto payment creation ---
    if (needsCrypto && blockchainType) {
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

      const result = await createPayment(supabase, {
        business_id,
        amount: paymentAmount,
        currency: 'USD',
        blockchain: blockchainType,
        merchant_wallet_address: wallet.wallet_address,
        metadata: Object.keys(paymentMetadata).length > 0 ? paymentMetadata : undefined,
      });

      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 400 }
        );
      }

      cryptoPaymentResult = result.payment;
    }

    // --- Card-only payment: create a stub payment record ---
    if (paymentMethod === 'card' && !cryptoPaymentResult) {
      // For card-only, we still need a payment record. Create a minimal one.
      const paymentId = crypto.randomUUID();
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      const { data: cardPayment, error: cardPaymentError } = await supabase
        .from('payments')
        .insert({
          id: paymentId,
          business_id,
          amount: paymentAmount.toString(),
          currency: 'USD',
          blockchain: blockchainType || 'ETH', // fallback, not used for card
          status: 'pending',
          payment_address: '', // no crypto address for card-only
          payment_address_id: null,
          merchant_wallet_address: '',
          metadata: {
            ...paymentMetadata,
            payment_method: 'card',
          },
          created_at: now,
          updated_at: now,
          expires_at: expiresAt,
        })
        .select()
        .single();

      if (cardPaymentError || !cardPayment) {
        console.error('Failed to create card payment record:', cardPaymentError);
        return NextResponse.json(
          { success: false, error: 'Failed to create payment record' },
          { status: 500 }
        );
      }

      cryptoPaymentResult = cardPayment;
    }

    const paymentId = cryptoPaymentResult?.id;

    // --- Stripe Checkout Session ---
    if (needsCard && paymentId) {
      try {
        const amountCents = Math.round(paymentAmount * 100);
        stripeResult = await createStripeCheckoutSession(
          supabase,
          business_id,
          merchantId,
          amountCents,
          description,
          paymentId,
          success_url,
          cancel_url,
        );

        // Store stripe info on the payment record
        await supabase
          .from('payments')
          .update({
            metadata: {
              ...cryptoPaymentResult.metadata,
              stripe_checkout_url: stripeResult.stripe_checkout_url,
              stripe_session_id: stripeResult.stripe_session_id,
              payment_method: paymentMethod,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', paymentId);

      } catch (err: any) {
        if (err.message === 'STRIPE_NOT_CONNECTED') {
          return NextResponse.json(
            {
              success: false,
              error: 'Card payments require Stripe Connect. Please complete Stripe onboarding at /api/stripe/connect/onboard first.'
            },
            { status: 400 }
          );
        }
        // For "both" mode, log the error but still return crypto payment
        if (paymentMethod === 'both') {
          console.error('Stripe checkout session creation failed (both mode):', err);
        } else {
          throw err;
        }
      }
    }

    // Increment transaction count after successful payment creation
    await incrementTransactionCount(supabase, merchantId);

    // Transform payment response to include expected field names
    const payment = cryptoPaymentResult;

    const transformedPayment = {
      ...payment,
      amount_usd: payment?.amount,
      amount_crypto: payment?.crypto_amount,
      currency: payment?.blockchain?.toLowerCase(),
      ...(stripeResult && {
        stripe_checkout_url: stripeResult.stripe_checkout_url,
        stripe_session_id: stripeResult.stripe_session_id,
      }),
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
