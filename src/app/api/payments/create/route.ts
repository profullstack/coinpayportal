import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { createPayment, Blockchain } from '@/lib/payments/service';
import { authenticateRequest, isMerchantAuth, isBusinessAuth, hasScope } from '@/lib/auth/middleware';
import {
  withTransactionLimit,
  createEntitlementErrorResponse,
} from '@/lib/entitlements/middleware';
import { consumeTransactionQuota, releaseTransactionQuota } from '@/lib/entitlements/service';
import { getStripe } from '@/lib/server/optional-deps';
import {
  getPaymentReceivingWallet,
  verifyBusinessAccess,
} from '@/lib/wallets/supported-coins';
import { isPlatformFeeWallet } from '@/lib/wallets/system-wallet';
import { isValidPayoutAddress } from '@/lib/blockchain/address-format';
import { authorizeBusiness } from '@/lib/auth/authz';
import { screenCheckout } from '@/lib/fraud/screen';
import { getClientIp } from '@/lib/web-wallet/client-ip';
import { isBusinessPaidTier } from '@/lib/entitlements/service';
import { getFeePercentage } from '@/lib/payments/fees';

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
    'usdt_eth': 'USDT_ETH',
    'usdt_pol': 'USDT_POL',
    'usdt_sol': 'USDT_SOL',
    'usdc': 'USDC',      // ERC-20 on Ethereum
    'usdc_eth': 'USDC_ETH',
    'usdc_pol': 'USDC_POL',
    'usdc_sol': 'USDC_SOL',
    'usdc_base': 'USDC_BASE',
  };
  return mapping[currency.toLowerCase()] || null;
}

/**
 * Map blockchain to cryptocurrency code for wallet lookup
 */
function blockchainToCrypto(blockchain: Blockchain): string {
  if (blockchain.startsWith('USDC_') || blockchain.startsWith('USDT_')) {
    return blockchain;
  }
  if (blockchain === 'USDT') {
    return 'USDT';
  }
  return blockchain;
}

type PaymentMethod = 'crypto' | 'card' | 'both';

type CardPaymentRow = {
  id: string;
  amount: string | number;
  currency: string;
  blockchain?: string | null;
  metadata?: Record<string, any> | null;
  [key: string]: any;
};

async function findCardPaymentByIdempotencyKey(
  supabase: any,
  businessId: string,
  idempotencyKey: string
): Promise<{ payment: CardPaymentRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('business_id', businessId)
    .eq('metadata->>idempotency_key', idempotencyKey)
    .maybeSingle();

  return {
    payment: data as CardPaymentRow | null,
    error: error?.message || null,
  };
}

function cardPaymentMatchesRequest(payment: CardPaymentRow, amount: number): boolean {
  return (
    Number(payment.amount) === amount &&
    payment.currency.toUpperCase() === 'USD' &&
    payment.metadata?.payment_method === 'card'
  );
}

function cardStripeIdempotencyKey(businessId: string, idempotencyKey: string): string {
  const digest = createHash('sha256').update(`${businessId}:${idempotencyKey}`).digest('hex');
  return `payment:${digest}`;
}

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
  clientIp?: string | null,
  successUrl?: string,
  cancelUrl?: string,
  idempotencyKey?: string
): Promise<{ stripe_checkout_url: string; stripe_session_id: string }> {
  // Look up stripe connected account by business
  const { data: stripeAccount } = await supabase
    .from('stripe_accounts')
    .select('stripe_account_id, charges_enabled')
    .eq('business_id', businessId)
    .single() as { data: { stripe_account_id: string; charges_enabled: boolean } | null };

  if (!stripeAccount?.stripe_account_id || !stripeAccount.charges_enabled) {
    throw new Error('STRIPE_NOT_CONNECTED');
  }

  // Determine tier for fee calculation.
  //
  // This selected `businesses.tier`, a column that does not exist — confirmed
  // against the live schema. PostgREST rejected the query, `business` came back
  // null, and the fee fell through to the 'free' branch, so every business was
  // charged the 1% minimum on this rail no matter what plan they were on.
  // `isBusinessPaidTier` resolves the tier through the merchant's subscription,
  // which is how the other rails do it.
  const isPaidTier = await isBusinessPaidTier(supabase, businessId);
  const platformFeeAmount = Math.round(amountCents * getFeePercentage(isPaidTier));

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';

  // Screen before the Stripe session exists. This is one of the seven paths
  // that create a real card charge; only one of the seven was screened.
  const screening = await screenCheckout(supabase, {
    businessId,
    ip: clientIp ?? null,
    amount: amountCents / 100,
    currency: 'USD',
    description,
  });

  if (screening.decision === 'block') {
    console.warn('[Fraud] Blocked card checkout', {
      businessId,
      score: screening.score,
      findings: screening.findings.map((f) => f.code).join(', '),
    });
    throw new Error('FRAUD_BLOCKED');
  }

  const stripe = await getStripe();
  const session = await stripe.checkout.sessions.create(
    {
      // Elevated risk: force 3-D Secure so liability for a stolen card moves back
      // to the issuer.
      ...(screening.decision === 'verify'
        ? { payment_method_options: { card: { request_three_d_secure: 'any' as const } } }
        : {}),
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
    },
    idempotencyKey ? { idempotencyKey } : undefined
  );

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
/**
 * Ceiling on a single payment, in USD.
 *
 * Well above any plausible checkout while still bounding quote cost, address
 * consumption, and the effect of one payment on aggregate volume figures.
 */
const MAX_PAYMENT_AMOUNT_USD = 1_000_000;

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
    let authBusinessId: string | null = null;
    if (isMerchantAuth(authResult.context)) {
      merchantId = authResult.context.merchantId;
    } else if (isBusinessAuth(authResult.context)) {
      merchantId = authResult.context.merchantId;
      authBusinessId = authResult.context.businessId;
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid authentication context' },
        { status: 401 }
      );
    }

    // Enforce scope for API-key auth (legacy keys hold '*', so they pass).
    if (!hasScope(authResult.context, 'payments:create')) {
      return NextResponse.json(
        { success: false, error: 'API key missing required scope: payments:create' },
        { status: 403 }
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
      business_id: requestedBusinessId,
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
      merchant_wallet_address: requestedMerchantWallet,
    } = body;

    const paymentMethod: PaymentMethod = (['crypto', 'card', 'both'].includes(rawPaymentMethod))
      ? rawPaymentMethod
      : 'crypto';

    // Idempotency.
    //
    // Creating a payment allocates an HD address, spends a unit of monthly
    // quota and quotes a price. A client that retries after a timeout — which
    // is the normal thing for a client to do, and which the SDK does — used to
    // get a second payment for the same order every time. Callers may now send
    // an Idempotency-Key; a repeat with the same key returns the original
    // payment instead of creating another.
    const idempotencyKey =
      request.headers.get('idempotency-key')?.trim() ||
      (typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : '') ||
      null;

    if (idempotencyKey && idempotencyKey.length > 255) {
      return NextResponse.json(
        { success: false, error: 'Idempotency-Key must be at most 255 characters' },
        { status: 400 }
      );
    }

    let business_id: string;
    if (authBusinessId) {
      if (requestedBusinessId && requestedBusinessId !== authBusinessId) {
        return NextResponse.json(
          { success: false, error: 'business_id does not match API key scope' },
          { status: 403 }
        );
      }
      business_id = authBusinessId;
    } else {
      if (!requestedBusinessId) {
        return NextResponse.json(
          { success: false, error: 'business_id is required' },
          { status: 400 }
        );
      }
      business_id = requestedBusinessId;
    }

    const access = await verifyBusinessAccess(supabase, business_id, merchantId);
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status ?? 404 }
      );
    }

    // Determine the amount (support both amount_usd and amount)
    const paymentAmount = amount_usd ?? amount;
    if (typeof paymentAmount !== 'number' || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing payment amount' },
        { status: 400 }
      );
    }

    // Upper bound. Only `> 0` was checked, so a $999,999,999 payment was
    // accepted and quoted at ~15,868 BTC: it burns an HD address and a rate
    // lookup, inflates public volume metrics, and amplifies every downstream
    // fee calculation. No real checkout is anywhere near this.
    if (paymentAmount > MAX_PAYMENT_AMOUNT_USD) {
      return NextResponse.json(
        {
          success: false,
          error: `Payment amount exceeds the maximum of ${MAX_PAYMENT_AMOUNT_USD.toLocaleString('en-US')} USD`,
          code: 'AMOUNT_TOO_LARGE',
        },
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

    // Build metadata with optional redirect_url and description. Idempotency is
    // an authenticated request field, not part of the caller-controlled bag.
    const paymentMetadata: Record<string, any> =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {};
    delete paymentMetadata.idempotency_key;
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

      // Determine where the merchant (post-fee) leg forwards to.
      //
      // An explicit merchant_wallet_address in the request overrides the
      // business's own configured wallet. This is what lets an invoice forward
      // the 99% net to the *invoice recipient* (e.g. a ugig worker) while the
      // platform fee is still split off as usual. Without an override we keep
      // the original B2C behaviour: forward to the business/merchant-global
      // wallet, where the business itself is the recipient.
      let recipientAddress: string;
      let walletSource: string;

      const overrideAddress =
        typeof requestedMerchantWallet === 'string' ? requestedMerchantWallet.trim() : '';

      if (overrideAddress) {
        // `false` = malformed for this chain → reject. `null` = chain we have
        // no validator for → trust the caller rather than block a legitimate
        // payout.
        if (isValidPayoutAddress(overrideAddress, blockchainType) === false) {
          return NextResponse.json(
            {
              success: false,
              error: `Invalid ${cryptoCode} merchant_wallet_address`,
            },
            { status: 400 }
          );
        }

        // Never let the merchant leg be pointed at a platform fee wallet. That
        // would make the split indistinguishable from a fee payment and
        // corrupts reconciliation on both legs.
        if (isPlatformFeeWallet(overrideAddress)) {
          return NextResponse.json(
            {
              success: false,
              error: 'merchant_wallet_address may not be a platform wallet',
              code: 'PAYEE_RESERVED',
            },
            { status: 400 }
          );
        }

        // A third-party payee is a legitimate flow (an invoice forwards the 99%
        // net to the invoice recipient, not to the business), so the address
        // need not belong to the account — but WHO may name it is a separate
        // question, and the answer is the owner.
        //
        // Recording `authorized_by_merchant_id` makes the action answerable
        // after the fact; it does not restrict who can take it. A `writer` (or,
        // via the permissive capability default, a `readonly` member) could
        // point a payment at any address they liked, against the project's own
        // invariant that funds movement is owner-only.
        //
        // Session callers are checked here. An API key is scoped to one
        // business rather than to a role, so it is governed by its own scope.
        if (!authBusinessId) {
          const fundsAuthz = await authorizeBusiness(
            supabase,
            merchantId,
            business_id,
            'funds.move',
          );
          if (!fundsAuthz.ok) {
            return NextResponse.json(
              {
                success: false,
                error: 'Naming a payout address requires owner permissions',
                code: 'PAYEE_FORBIDDEN',
              },
              { status: 403 }
            );
          }
        }

        recipientAddress = overrideAddress;
        walletSource = 'request_override';
        paymentMetadata.payee_override = {
          address: overrideAddress,
          authorized_by_merchant_id: merchantId,
          authorized_via: authBusinessId ? 'api_key' : 'session',
          authorized_at: new Date().toISOString(),
        };
      } else {
        const wallet = await getPaymentReceivingWallet(supabase, {
          businessId: business_id,
          merchantId,
          cryptocurrency: cryptoCode,
        });

        if (!wallet.walletAddress) {
          return NextResponse.json(
            {
              success: false,
              error:
                wallet.error ||
                `No ${cryptoCode} wallet configured for this business. Please add a business wallet or merchant global wallet.`
            },
            { status: 400 }
          );
        }
        recipientAddress = wallet.walletAddress;
        walletSource = wallet.source ?? 'business';
      }

      // Spend the quota atomically, immediately before creating the payment.
      //
      // The advisory check earlier in the request gives fast feedback but is a
      // plain read — concurrent requests all saw the same under-the-limit count
      // and all proceeded past it. This RPC does the bounded increment in one
      // statement, so exactly as many payments are created as there is quota for.
      // Placed here, after validation, so a malformed request cannot burn a
      // merchant's monthly allowance.
      const quota = await consumeTransactionQuota(supabase, merchantId, limitCheck.limit ?? null);
      if (!quota.allowed) {
        return NextResponse.json(
          {
            success: false,
            error: quota.error
              ? `Could not verify transaction limit: ${quota.error}`
              : 'Monthly transaction limit exceeded',
            usage: { current: quota.currentUsage, limit: limitCheck.limit },
          },
          { status: quota.error ? 500 : 429 }
        );
      }

      const result = await createPayment(supabase, {
        business_id,
        amount: paymentAmount,
        currency: 'USD',
        blockchain: blockchainType,
        merchant_wallet_address: recipientAddress,
        idempotency_key: idempotencyKey || undefined,
        metadata: Object.keys(paymentMetadata).length > 0
          ? { ...paymentMetadata, wallet_source: walletSource }
          : { wallet_source: walletSource },
      });

      if (!result.success) {
        // Hand the quota back: nothing was created, so nothing should be billed.
        await releaseTransactionQuota(supabase, merchantId);
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 400 }
        );
      }

      if (result.replayed) {
        // Two identical requests can both pass the route-level pre-read. The
        // service resolves the unique-index race to the winning payment; return
        // the quota consumed by this retry and do not create another card
        // session for an existing payment.
        await releaseTransactionQuota(supabase, merchantId);
        const existing = result.payment;
        return NextResponse.json({
          success: true,
          idempotent_replay: true,
          payment: {
            ...existing,
            amount_usd: existing?.amount,
            amount_crypto: existing?.crypto_amount,
            currency: existing?.blockchain?.toLowerCase(),
          },
        });
      }

      cryptoPaymentResult = result.payment;
    }

    let cardPaymentReplay = false;

    // --- Card-only payment: create or resume one stub payment record ---
    if (paymentMethod === 'card' && !cryptoPaymentResult) {
      if (idempotencyKey) {
        const existing = await findCardPaymentByIdempotencyKey(
          supabase,
          business_id,
          idempotencyKey
        );
        if (existing.error) {
          return NextResponse.json(
            { success: false, error: 'Failed to verify payment idempotency' },
            { status: 500 }
          );
        }
        if (existing.payment) {
          if (!cardPaymentMatchesRequest(existing.payment, paymentAmount)) {
            return NextResponse.json(
              {
                success: false,
                error: 'Idempotency key was already used with different payment parameters',
                code: 'IDEMPOTENCY_KEY_REUSED',
              },
              { status: 409 }
            );
          }
          cryptoPaymentResult = existing.payment;
          cardPaymentReplay = true;
        }
      }

      // For card-only, we still need a payment record. Create a minimal one.
      if (!cryptoPaymentResult) {
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
            // `payment_address_id` is not a column on `payments` — it was dropped in a
            // November 2025 migration and its absence is confirmed against the live
            // schema. PostgREST rejects an insert naming an unknown column outright,
            // so every card payment through this route failed with a 500 before it
            // ever reached Stripe.
            merchant_wallet_address: '',
            metadata: {
              ...paymentMetadata,
              payment_method: 'card',
              ...(idempotencyKey && { idempotency_key: idempotencyKey }),
            },
            created_at: now,
            updated_at: now,
            expires_at: expiresAt,
          })
          .select()
          .single();

        if (cardPaymentError || !cardPayment) {
          if (idempotencyKey && cardPaymentError?.code === '23505') {
            const winner = await findCardPaymentByIdempotencyKey(
              supabase,
              business_id,
              idempotencyKey
            );
            if (winner.payment && cardPaymentMatchesRequest(winner.payment, paymentAmount)) {
              cryptoPaymentResult = winner.payment;
              cardPaymentReplay = true;
            } else if (winner.payment) {
              return NextResponse.json(
                {
                  success: false,
                  error: 'Idempotency key was already used with different payment parameters',
                  code: 'IDEMPOTENCY_KEY_REUSED',
                },
                { status: 409 }
              );
            } else {
              return NextResponse.json(
                {
                  success: false,
                  error: winner.error || 'Idempotent payment is still being created; retry shortly',
                  code: 'PAYMENT_CREATION_IN_PROGRESS',
                },
                { status: 409 }
              );
            }
          } else {
            console.error('Failed to create card payment record:', cardPaymentError);
            return NextResponse.json(
              { success: false, error: 'Failed to create payment record' },
              { status: 500 }
            );
          }
        } else {
          cryptoPaymentResult = cardPayment;
        }
      }
    }

    const paymentId = cryptoPaymentResult?.id;
    if (cardPaymentReplay) {
      const replayMetadata = cryptoPaymentResult?.metadata;
      if (
        typeof replayMetadata?.stripe_checkout_url === 'string' &&
        typeof replayMetadata?.stripe_session_id === 'string'
      ) {
        stripeResult = {
          stripe_checkout_url: replayMetadata.stripe_checkout_url,
          stripe_session_id: replayMetadata.stripe_session_id,
        };
      }
    }

    // --- Stripe Checkout Session ---
    if (needsCard && paymentId && !stripeResult) {
      try {
        const amountCents = Math.round(paymentAmount * 100);
        stripeResult = await createStripeCheckoutSession(
          supabase,
          business_id,
          merchantId,
          amountCents,
          description,
          paymentId,
          getClientIp(request),
          success_url,
          cancel_url,
          idempotencyKey ? cardStripeIdempotencyKey(business_id, idempotencyKey) : undefined
        );

        // Store stripe info on the payment record
        const { error: stripeUpdateError } = await supabase
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
        if (stripeUpdateError) {
          throw new Error('STRIPE_PAYMENT_UPDATE_FAILED');
        }
      } catch (err: any) {
        if (
          paymentMethod === 'card' &&
          idempotencyKey &&
          !cardPaymentReplay &&
          (err.message === 'FRAUD_BLOCKED' || err.message === 'STRIPE_NOT_CONNECTED')
        ) {
          const failedMetadata = {
            ...(cryptoPaymentResult?.metadata || {}),
            failure_reason: err.message.toLowerCase(),
          };
          delete failedMetadata.idempotency_key;
          const { error: releaseError } = await supabase
            .from('payments')
            .update({
              status: 'expired',
              metadata: failedMetadata,
              updated_at: new Date().toISOString(),
            })
            .eq('id', paymentId);
          if (releaseError) {
            console.error('Failed to release card payment idempotency key:', releaseError);
          }
        }

        if (err.message === 'FRAUD_BLOCKED') {
          // Deliberately vague, matching the direct Stripe rail: telling a
          // fraudster which signal tripped is a tuning guide.
          return NextResponse.json(
            {
              success: false,
              error: 'This payment could not be processed. Please contact the merchant.',
            },
            { status: 403 }
          );
        }
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

    // Quota was spent atomically just before creation; see consumeTransactionQuota.

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
        ...(cardPaymentReplay && { idempotent_replay: true }),
        payment: transformedPayment,
        usage: {
          current: limitCheck.currentUsage + (cardPaymentReplay ? 0 : 1),
          limit: limitCheck.limit,
          remaining: limitCheck.remaining !== null
            ? limitCheck.remaining - (cardPaymentReplay ? 0 : 1)
            : null,
        },
      },
      { status: cardPaymentReplay ? 200 : 201 }
    );
  } catch (error) {
    console.error('Create payment error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
