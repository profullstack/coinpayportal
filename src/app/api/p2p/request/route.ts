/**
 * POST /api/p2p/request
 *
 * Platform endpoint: an external platform (e.g. ugig.net) requests a payment
 * from one of its users to another. CoinPay auto-provisions the payee's
 * merchant + business behind the scenes — the user never sees CoinPay setup.
 *
 * Auth: Bearer token matching an active reputation_issuers.api_key.
 *
 * Body:
 *   payee:  { did, email, name?, payout: { crypto: {currency, address} } | { stripe_account_id } }
 *   payer:  { email, did?, name? }
 *   amount_usd: number
 *   crypto_currency?: string   // defaults from payee.payout.crypto.currency
 *   notes?: string
 *   due_date?: string (ISO)
 *
 * Returns: { invoice_id, invoice_number, pay_url, payment_address?, crypto_amount?, stripe_checkout_url? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { resolveOrProvisionPayee, resolveOrProvisionPayerClient } from '@/lib/p2p/resolve';
import { getFeePercentage } from '@/lib/payments/fees';
import { isBusinessPaidTier } from '@/lib/entitlements/service';
import { generatePaymentAddress, type SystemBlockchain } from '@/lib/wallets/system-wallet';
import { getCryptoPrice } from '@/lib/rates/tatum';
import { getStripe } from '@/lib/server/optional-deps';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

const requestSchema = z.object({
  payee: z.object({
    did: z.string().startsWith('did:'),
    email: z.string().email(),
    name: z.string().optional(),
    payout: z.union([
      z.object({
        crypto: z.object({
          currency: z.string().min(2),
          address: z.string().min(8),
        }),
      }),
      z.object({
        stripe_account_id: z.string().startsWith('acct_'),
      }),
    ]),
  }),
  payer: z.object({
    email: z.string().email(),
    did: z.string().startsWith('did:').optional(),
    name: z.string().optional(),
  }),
  amount_usd: z.number().positive(),
  crypto_currency: z.string().optional(),
  notes: z.string().optional(),
  due_date: z.string().datetime().optional(),
});

async function authenticatePlatform(
  supabase: ReturnType<typeof getSupabase>,
  request: NextRequest
): Promise<{ did: string; name: string } | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const apiKey = authHeader.slice(7);
  const { data } = await supabase
    .from('reputation_issuers')
    .select('did, name')
    .eq('api_key', apiKey)
    .eq('active', true)
    .single();
  return data;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();

    const platform = await authenticatePlatform(supabase, request);
    if (!platform) {
      return NextResponse.json({ success: false, error: 'Invalid or missing platform API key' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') },
        { status: 400 }
      );
    }
    const { payee, payer, amount_usd, crypto_currency, notes, due_date } = parsed.data;

    const payout = 'crypto' in payee.payout
      ? { kind: 'crypto' as const, cryptocurrency: payee.payout.crypto.currency.toUpperCase(), address: payee.payout.crypto.address }
      : { kind: 'stripe' as const, stripe_account_id: payee.payout.stripe_account_id };

    const provision = await resolveOrProvisionPayee(
      supabase,
      platform.name,
      { did: payee.did, email: payee.email, name: payee.name },
      payout
    );
    if (!provision.success) {
      return NextResponse.json({ success: false, error: provision.error }, { status: 500 });
    }
    const { merchantId, businessId } = provision.account;

    const clientId = await resolveOrProvisionPayerClient(
      supabase,
      merchantId,
      businessId,
      platform.name,
      payer
    );

    // Pick the crypto destination if available — invoice can also be paid
    // via Stripe Checkout if the payee has a Stripe Connect account.
    const cryptoCurrency = crypto_currency
      ?? (payout.kind === 'crypto' ? payout.cryptocurrency : undefined);
    const merchantWalletAddress = payout.kind === 'crypto' ? payout.address : null;

    // Next invoice number for this business
    const { data: maxInvoice } = await supabase
      .from('invoices')
      .select('invoice_number')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    let nextNum = 1;
    if (maxInvoice?.invoice_number) {
      const match = maxInvoice.invoice_number.match(/INV-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    const invoiceNumber = `INV-${String(nextNum).padStart(3, '0')}`;

    const isPaidTier = await isBusinessPaidTier(supabase, businessId);
    const feeRate = getFeePercentage(isPaidTier);
    const feeAmount = amount_usd * feeRate;

    // Optionally derive a fresh crypto payment address.
    let paymentAddress: string | null = null;
    let cryptoAmount: number | null = null;
    if (cryptoCurrency && merchantWalletAddress) {
      const baseCrypto = cryptoCurrency.startsWith('USDC_') ? 'USDC'
        : cryptoCurrency.startsWith('USDT_') ? 'USDT'
        : cryptoCurrency;
      try {
        cryptoAmount = await getCryptoPrice(amount_usd, 'USD', baseCrypto);
      } catch {
        cryptoAmount = null;
      }
    }

    const { data: invoice, error: insertErr } = await supabase
      .from('invoices')
      .insert({
        user_id: merchantId,
        business_id: businessId,
        client_id: clientId,
        invoice_number: invoiceNumber,
        status: 'sent',
        currency: 'USD',
        amount: amount_usd,
        crypto_currency: cryptoCurrency || null,
        crypto_amount: cryptoAmount?.toFixed(8) ?? null,
        merchant_wallet_address: merchantWalletAddress,
        fee_rate: feeRate,
        fee_amount: feeAmount,
        due_date: due_date || null,
        notes: notes || null,
        metadata: {
          p2p: true,
          platform: platform.name,
          payer_did: payer.did || null,
        },
      })
      .select('id, invoice_number')
      .single();

    if (insertErr || !invoice) {
      return NextResponse.json({ success: false, error: insertErr?.message ?? 'Insert failed' }, { status: 500 });
    }

    if (cryptoCurrency && merchantWalletAddress && cryptoAmount) {
      const baseBlockchain = (cryptoCurrency.startsWith('USDC_')
        ? cryptoCurrency.replace('USDC_', '')
        : cryptoCurrency.startsWith('USDT_')
          ? cryptoCurrency.replace('USDT_', '')
          : cryptoCurrency) as SystemBlockchain;
      const addrResult = await generatePaymentAddress(
        supabase,
        invoice.id,
        businessId,
        baseBlockchain,
        merchantWalletAddress,
        cryptoAmount,
        isPaidTier
      );
      if (addrResult.success && addrResult.address) {
        paymentAddress = addrResult.address;
        await supabase
          .from('invoices')
          .update({ payment_address: paymentAddress })
          .eq('id', invoice.id);
      }
    }

    let stripeCheckoutUrl: string | null = null;
    if (payout.kind === 'stripe') {
      try {
        const amountCents = Math.round(amount_usd * 100);
        const platformFeeAmount = Math.round(amountCents * feeRate);
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';
        const stripe = await getStripe();
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: 'usd',
                product_data: { name: `Invoice ${invoice.invoice_number}` },
                unit_amount: amountCents,
              },
              quantity: 1,
            },
          ],
          mode: 'payment',
          payment_intent_data: {
            application_fee_amount: platformFeeAmount,
            transfer_data: { destination: payout.stripe_account_id },
            metadata: {
              coinpay_invoice_id: invoice.id,
              business_id: businessId,
              merchant_id: merchantId,
            },
          },
          success_url: `${appUrl}/invoices/${invoice.id}/pay?status=success`,
          cancel_url: `${appUrl}/invoices/${invoice.id}/pay`,
          metadata: {
            coinpay_invoice_id: invoice.id,
            business_id: businessId,
            merchant_id: merchantId,
            platform_fee_amount: String(platformFeeAmount),
          },
        });
        stripeCheckoutUrl = session.url ?? null;
        if (stripeCheckoutUrl) {
          await supabase
            .from('invoices')
            .update({ stripe_checkout_url: stripeCheckoutUrl, stripe_session_id: session.id })
            .eq('id', invoice.id);
        }
      } catch (err) {
        console.error('[p2p/request] Stripe session error:', err);
      }
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';
    return NextResponse.json(
      {
        success: true,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        pay_url: `${appUrl}/invoices/${invoice.id}/pay`,
        payment_address: paymentAddress,
        crypto_currency: cryptoCurrency ?? null,
        crypto_amount: cryptoAmount?.toFixed(8) ?? null,
        stripe_checkout_url: stripeCheckoutUrl,
        fee_rate: feeRate,
        fee_amount_usd: feeAmount,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[p2p/request] error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
