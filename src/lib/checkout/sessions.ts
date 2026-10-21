import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { createPayment, type Blockchain } from '@/lib/payments/service';
import { safeReturnUrl } from '@/lib/payments/return-url';
import { getPaymentReceivingWallet, getSupportedWalletsForBusiness } from '@/lib/wallets/supported-coins';
import { isUsdtTronEnabled } from '@/lib/wallets/system-wallet';
import { withTransactionLimit } from '@/lib/entitlements/middleware';
import { consumeTransactionQuota, releaseTransactionQuota } from '@/lib/entitlements/service';
import { createPaypalPaymentForBusiness } from '@/lib/paypal/create-payment';
import { customerMetadata, normalizeProperty } from './customer';
import { CHECKOUT_COINS, PAYPAL_METHOD, type CheckoutMethod } from './methods';
import { markCheckoutSessionPaidFromWebhook } from './settle';
import { activateSubscriptionFromCheckoutSession } from '@/lib/subscriptions/activate';
import { billingBusinessId } from '@/lib/subscriptions/plans';

export { CHECKOUT_COINS, PAYPAL_METHOD };

export const SESSION_MIN_MINUTES = 15;
export const SESSION_MAX_MINUTES = 120;
export const SESSION_DEFAULT_MINUTES = 60;
const MAX_AMOUNT_USD = 1_000_000;
const MAX_METADATA_BYTES = 16 * 1024;
/** Each pick creates a payment (an HD address, a quote). Bound it per session. */
export const MAX_ATTEMPTS = 12;

export interface CheckoutSessionRow {
  id: string;
  business_id: string;
  merchant_id: string;
  amount: number | string;
  currency: string;
  description: string | null;
  customer_email: string;
  account_id: string;
  property: string;
  metadata: Record<string, unknown>;
  success_url: string | null;
  cancel_url: string | null;
  allowed_methods: string[] | null;
  expires_in_minutes: number;
  status: 'open' | 'paid' | 'expired';
  selected_method: string | null;
  payment_id: string | null;
  paypal_transaction_id: string | null;
  attempt_count: number;
  paid_method: string | null;
  paid_reference: string | null;
  paid_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export function generateSessionId(): string {
  // 24 base62-ish chars from 18 random bytes: unguessable, URL-safe.
  return 'cs_' + randomBytes(18).toString('base64').replace(/[^A-Za-z0-9]/g, '').padEnd(24, '0').slice(0, 24);
}

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^cs_[A-Za-z0-9]{16,64}$/.test(value);
}

const ALL_METHOD_CODES = new Set<string>([...CHECKOUT_COINS.map((c) => c.code), PAYPAL_METHOD]);

/** Parse allowed_methods: coin codes, "PAYPAL", or "CRYPTO" for every coin. */
export function parseAllowedMethods(raw: unknown):
  | { ok: true; methods: string[] | null }
  | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, methods: null };
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'allowed_methods must be a non-empty array of method codes' };
  }
  const out = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') return { ok: false, error: 'allowed_methods entries must be strings' };
    const code = item.trim().toUpperCase();
    if (code === 'CRYPTO') {
      CHECKOUT_COINS.forEach((c) => out.add(c.code));
      continue;
    }
    if (!ALL_METHOD_CODES.has(code)) {
      return {
        ok: false,
        error: `Unknown payment method "${item}". Use coin codes (${CHECKOUT_COINS.map((c) => c.code).join(', ')}), CRYPTO or PAYPAL.`,
      };
    }
    out.add(code);
  }
  return { ok: true, methods: Array.from(out) };
}

export type ValidatedSessionInput = {
  amount: number;
  currency: 'USD';
  description: string | null;
  customer_email: string;
  account_id: string;
  property: string;
  metadata: Record<string, unknown>;
  success_url: string | null;
  cancel_url: string | null;
  expires_in_minutes: number;
  allowed_methods: string[] | null;
};

export type ValidationResult =
  | { ok: true; value: ValidatedSessionInput }
  | { ok: false; error: string; code: string };

/** Validate a POST /api/checkout/sessions body. Pure; no I/O. */
export function validateCreateSessionInput(
  body: Record<string, unknown>,
  defaults: { businessName?: string | null } = {}
): ValidationResult {
  const fail = (error: string, code: string): ValidationResult => ({ ok: false, error, code });

  const amount = typeof body.amount === 'string' ? Number(body.amount) : body.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return fail('amount is required: a positive number of US dollars', 'INVALID_AMOUNT');
  }
  const rounded = Math.round(amount * 100) / 100;
  if (rounded < 0.01) return fail('amount must be at least 0.01 USD', 'INVALID_AMOUNT');
  if (rounded > MAX_AMOUNT_USD) return fail('amount exceeds the maximum of 1,000,000 USD', 'AMOUNT_TOO_LARGE');

  const currency = body.currency === undefined || body.currency === null ? 'USD' : String(body.currency).toUpperCase();
  if (currency !== 'USD') return fail("currency must be 'USD'", 'INVALID_CURRENCY');

  const customer = customerMetadata(body, { strict: true });
  if (!customer.ok) return fail(customer.error, customer.code);

  let property = customer.metadata.property ?? null;
  if (!property && defaults.businessName && defaults.businessName.trim()) {
    property = normalizeProperty(defaults.businessName.trim()).slice(0, 255);
  }
  if (!property) return fail('property is required: the site hostname this payment is for', 'MISSING_PROPERTY');

  let description: string | null = null;
  if (body.description !== undefined && body.description !== null && body.description !== '') {
    if (typeof body.description !== 'string') return fail('description must be a string', 'INVALID_DESCRIPTION');
    description = body.description.trim().slice(0, 500) || null;
  }

  let metadata: Record<string, unknown> = {};
  if (body.metadata !== undefined && body.metadata !== null) {
    if (typeof body.metadata !== 'object' || Array.isArray(body.metadata)) {
      return fail('metadata must be a JSON object', 'INVALID_METADATA');
    }
    metadata = body.metadata as Record<string, unknown>;
    if (JSON.stringify(metadata).length > MAX_METADATA_BYTES) {
      return fail('metadata must be at most 16 KB of JSON', 'INVALID_METADATA');
    }
  }

  let success_url: string | null = null;
  if (body.success_url !== undefined && body.success_url !== null && body.success_url !== '') {
    success_url = safeReturnUrl(body.success_url);
    if (!success_url) return fail('success_url must be an absolute http(s) URL', 'INVALID_SUCCESS_URL');
  }
  let cancel_url: string | null = null;
  if (body.cancel_url !== undefined && body.cancel_url !== null && body.cancel_url !== '') {
    cancel_url = safeReturnUrl(body.cancel_url);
    if (!cancel_url) return fail('cancel_url must be an absolute http(s) URL', 'INVALID_CANCEL_URL');
  }

  let expires_in_minutes = SESSION_DEFAULT_MINUTES;
  if (body.expires_in_minutes !== undefined && body.expires_in_minutes !== null && body.expires_in_minutes !== '') {
    const n = Number(body.expires_in_minutes);
    if (!Number.isFinite(n)) {
      return fail(`expires_in_minutes must be a number between ${SESSION_MIN_MINUTES} and ${SESSION_MAX_MINUTES}`, 'INVALID_EXPIRES_IN_MINUTES');
    }
    expires_in_minutes = Math.min(Math.max(Math.round(n), SESSION_MIN_MINUTES), SESSION_MAX_MINUTES);
  }

  const allowed = parseAllowedMethods(body.allowed_methods);
  if (!allowed.ok) return fail(allowed.error, 'INVALID_ALLOWED_METHODS');

  return {
    ok: true,
    value: {
      amount: rounded,
      currency: 'USD',
      description,
      customer_email: customer.metadata.customer_email!,
      account_id: customer.metadata.account_id!,
      property,
      metadata,
      success_url,
      cancel_url,
      expires_in_minutes,
      allowed_methods: allowed.methods,
    },
  };
}

/** Replace {CHECKOUT_SESSION_ID} with the session id; {PAYMENT_ID} is left for the pay page. */
export function sessionReturnUrl(url: string | null, sessionId: string): string | null {
  if (!url) return null;
  return url.replace(/(?:\{|%7B)CHECKOUT_SESSION_ID(?:\}|%7D)/gi, encodeURIComponent(sessionId));
}

/** The final success URL for a paid session: both placeholders filled. */
export function resolvedSuccessUrl(session: Pick<CheckoutSessionRow, 'id' | 'success_url' | 'paid_reference'>): string | null {
  const url = sessionReturnUrl(session.success_url, session.id);
  if (!url) return null;
  return url.replace(/(?:\{|%7B)PAYMENT_ID(?:\}|%7D)/gi, encodeURIComponent(session.paid_reference || session.id));
}

/**
 * Methods this session's buyer may choose: the coins the business can receive
 * (business wallet, else account-global wallet), filtered by feature flags and
 * the session's allowed_methods, in display order, plus PayPal when connected.
 */
export async function eligibleMethods(
  supabase: SupabaseClient,
  session: Pick<CheckoutSessionRow, 'business_id' | 'merchant_id' | 'allowed_methods'>
): Promise<CheckoutMethod[]> {
  const allowed = session.allowed_methods ? new Set(session.allowed_methods.map((m) => m.toUpperCase())) : null;
  const { wallets } = await getSupportedWalletsForBusiness(supabase, session.business_id, session.merchant_id, true);
  const have = new Set((wallets ?? []).filter((w) => w.wallet_address).map((w) => w.cryptocurrency.toUpperCase()));

  const methods: CheckoutMethod[] = [];
  for (const coin of CHECKOUT_COINS) {
    if (!have.has(coin.code)) continue;
    if (allowed && !allowed.has(coin.code)) continue;
    if (coin.code === 'USDT_TRON' && !isUsdtTronEnabled()) continue;
    // The bare ERC-20 aliases duplicate the explicit Ethereum entries.
    if (coin.code === 'USDC' && have.has('USDC_ETH')) continue;
    if (coin.code === 'USDT' && have.has('USDT_ETH')) continue;
    methods.push(coin);
  }

  if (!allowed || allowed.has(PAYPAL_METHOD)) {
    const { data: pp } = await supabase
      .from('paypal_accounts')
      .select('connected')
      .eq('business_id', session.business_id)
      .maybeSingle();
    if (pp?.connected) {
      methods.push({ code: PAYPAL_METHOD, label: 'PayPal', ticker: 'PayPal', chain: null, group: 'paypal' });
    }
  }
  return methods;
}

/** Remaining whole minutes in the session; the payment window derives from it. */
export function paymentWindowFor(session: Pick<CheckoutSessionRow, 'expires_at'>, now = Date.now()): number {
  const remaining = Math.ceil((Date.parse(session.expires_at) - now) / 60_000);
  return Math.min(Math.max(remaining, SESSION_MIN_MINUTES), SESSION_MAX_MINUTES);
}

/** Metadata copied onto the underlying payment so its webhooks carry it. */
export function paymentMetadataFor(session: CheckoutSessionRow): Record<string, unknown> {
  const merchant = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
  const meta: Record<string, unknown> = {
    ...merchant,
    checkout_session_id: session.id,
    customer_email: session.customer_email,
    account_id: session.account_id,
    property: session.property,
  };
  if (session.description) meta.description = session.description;
  return meta;
}

export type SelectResult =
  | { ok: true; redirect_url: string; method: string; payment_id?: string; paypal_transaction_id?: string; reused?: boolean }
  | { ok: false; status: number; error: string; code?: string };

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';

/**
 * The buyer picked a method. Create (or reuse) the underlying payment and say
 * where to send them. Re-picking the same coin while its payment is still
 * pending reuses it; picking a different one starts a new payment.
 */
export async function selectCheckoutMethod(
  supabase: SupabaseClient,
  session: CheckoutSessionRow,
  rawMethod: unknown,
  ctx: { clientIp?: string | null } = {}
): Promise<SelectResult> {
  if (session.status === 'paid') return { ok: false, status: 409, error: 'This checkout is already paid', code: 'ALREADY_PAID' };
  if (session.status === 'expired' || Date.parse(session.expires_at) <= Date.now()) {
    return { ok: false, status: 410, error: 'This checkout has expired. Start a new one on the merchant site.', code: 'EXPIRED' };
  }
  const method = typeof rawMethod === 'string' ? rawMethod.trim().toUpperCase() : '';
  const methods = await eligibleMethods(supabase, session);
  const chosen = methods.find((m) => m.code === method);
  if (!chosen) return { ok: false, status: 400, error: 'That payment method is not available for this checkout', code: 'METHOD_NOT_AVAILABLE' };

  // Re-pick of the current method: reuse the live payment.
  if (session.selected_method === method) {
    if (method !== PAYPAL_METHOD && session.payment_id) {
      const { data: p } = await supabase
        .from('payments')
        .select('id, status, expires_at')
        .eq('id', session.payment_id)
        .maybeSingle();
      if (p && p.status === 'pending' && (!p.expires_at || Date.parse(p.expires_at) > Date.now())) {
        return { ok: true, redirect_url: `${appUrl()}/pay/${p.id}`, method, payment_id: p.id, reused: true };
      }
    }
  }

  if (session.attempt_count >= MAX_ATTEMPTS) {
    return { ok: false, status: 429, error: 'Too many payment attempts on this checkout. Start a new one on the merchant site.', code: 'TOO_MANY_ATTEMPTS' };
  }

  const metadata = paymentMetadataFor(session);
  const successUrl = sessionReturnUrl(session.success_url, session.id);
  const checkoutUrl = `${appUrl()}/checkout/${session.id}`;

  if (method === PAYPAL_METHOD) {
    const result = await createPaypalPaymentForBusiness(supabase, {
      businessId: session.business_id,
      amount: Number(session.amount),
      currency: 'USD',
      description: session.description,
      metadata,
      successUrl,
      cancelUrl: checkoutUrl,
      // PayPal returns the payer to our capture page, which then goes back to
      // the session (paid, redirecting to success_url). Cancel goes back to the
      // picker so they can choose a coin instead.
      paypalReturnUrl: (tx) => `${appUrl()}/pay/paypal/return?transaction_id=${tx}&checkout_session=${session.id}`,
      paypalCancelUrl: () => checkoutUrl,
      customerEmail: session.customer_email,
      clientIp: ctx.clientIp ?? null,
    });
    if (!result.ok) return { ok: false, status: result.status, error: result.error };
    await recordSelection(supabase, session, method, { paypal_transaction_id: result.response.transaction_id });
    return {
      ok: true,
      redirect_url: result.response.approve_url,
      method,
      paypal_transaction_id: result.response.transaction_id,
    };
  }

  // Crypto: same path as POST /api/payments/create without a payee override.
  const limit = await withTransactionLimit(supabase, session.merchant_id);
  if (!limit.allowed) {
    return { ok: false, status: 429, error: 'This merchant has reached its monthly transaction limit', code: 'LIMIT' };
  }
  const wallet = await getPaymentReceivingWallet(supabase, {
    businessId: session.business_id,
    merchantId: session.merchant_id,
    cryptocurrency: method,
  });
  if (!wallet.walletAddress) {
    return { ok: false, status: 400, error: wallet.error || `No ${method} wallet configured for this business` };
  }
  const quota = await consumeTransactionQuota(supabase, session.merchant_id, limit.limit ?? null);
  if (!quota.allowed) {
    return { ok: false, status: quota.error ? 500 : 429, error: quota.error ? 'Could not verify transaction limit' : 'Monthly transaction limit exceeded' };
  }
  const created = await createPayment(supabase, {
    business_id: session.business_id,
    amount: Number(session.amount),
    currency: 'USD',
    blockchain: method as Blockchain,
    merchant_wallet_address: wallet.walletAddress,
    expires_in_minutes: paymentWindowFor(session),
    metadata: {
      ...metadata,
      ...(successUrl ? { redirect_url: successUrl } : {}),
      ...(session.cancel_url ? { cancel_url: sessionReturnUrl(session.cancel_url, session.id) } : {}),
      wallet_source: wallet.source ?? 'business',
    },
  });
  if (!created.success || !created.payment) {
    await releaseTransactionQuota(supabase, session.merchant_id);
    return { ok: false, status: 400, error: created.error || 'Could not create the payment' };
  }
  await recordSelection(supabase, session, method, { payment_id: created.payment.id });
  return { ok: true, redirect_url: `${appUrl()}/pay/${created.payment.id}`, method, payment_id: created.payment.id };
}

async function recordSelection(
  supabase: SupabaseClient,
  session: CheckoutSessionRow,
  method: string,
  ref: { payment_id?: string; paypal_transaction_id?: string }
) {
  const { error } = await supabase
    .from('checkout_sessions')
    .update({
      selected_method: method,
      payment_id: ref.payment_id ?? null,
      paypal_transaction_id: ref.paypal_transaction_id ?? null,
      attempt_count: session.attempt_count + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id);
  if (error) console.error('[Checkout] record selection failed:', error);
}

export async function loadSession(supabase: SupabaseClient, id: string): Promise<CheckoutSessionRow | null> {
  if (!isSessionId(id)) return null;
  const { data } = await supabase.from('checkout_sessions').select('*').eq('id', id).maybeSingle();
  return (data as CheckoutSessionRow | null) ?? null;
}

/**
 * Bring a session's status up to date: paid if its current payment settled
 * (in case the webhook path has not run yet), expired if its window passed with
 * nothing in flight. Returns the fresh row.
 */
export async function refreshSessionStatus(
  supabase: SupabaseClient,
  session: CheckoutSessionRow
): Promise<CheckoutSessionRow> {
  if (session.status === 'paid' && session.business_id === billingBusinessId()) {
    // A plan checkout whose grant failed on the webhook path retries here.
    await activateSubscriptionFromCheckoutSession(supabase, session.id).catch((e) =>
      console.error('[Checkout] subscription activation retry failed:', e)
    );
  }
  if (session.status !== 'open') return session;

  if (session.payment_id) {
    const { data: p } = await supabase
      .from('payments')
      .select('id, status, blockchain')
      .eq('id', session.payment_id)
      .maybeSingle();
    if (p && ['confirmed', 'forwarding', 'forwarded', 'forwarding_failed'].includes(p.status)) {
      await markCheckoutSessionPaidFromWebhook(supabase, { sessionId: session.id, paymentId: p.id, method: p.blockchain, businessId: session.business_id });
      return (await loadSession(supabase, session.id)) ?? session;
    }
  }
  if (session.paypal_transaction_id) {
    const { data: t } = await supabase
      .from('paypal_transactions')
      .select('id, status')
      .eq('id', session.paypal_transaction_id)
      .maybeSingle();
    if (t && t.status === 'completed') {
      await markCheckoutSessionPaidFromWebhook(supabase, { sessionId: session.id, paymentId: t.id, method: PAYPAL_METHOD, businessId: session.business_id });
      return (await loadSession(supabase, session.id)) ?? session;
    }
  }

  if (Date.parse(session.expires_at) <= Date.now()) {
    // A payment picked near the end keeps its own window; only expire the
    // session once nothing is still payable.
    let inFlight = false;
    if (session.payment_id) {
      const { data: p } = await supabase.from('payments').select('status, expires_at').eq('id', session.payment_id).maybeSingle();
      inFlight = !!p && ['pending', 'detected'].includes(p.status) && !!p.expires_at && Date.parse(p.expires_at) > Date.now();
    }
    if (!inFlight) {
      await supabase
        .from('checkout_sessions')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('id', session.id)
        .eq('status', 'open');
      return { ...session, status: 'expired' };
    }
  }
  return session;
}
