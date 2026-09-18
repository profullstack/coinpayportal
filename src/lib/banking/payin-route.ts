/**
 * The public "pay by bank" handler shared by payments and invoices.
 *
 * Both surfaces need the same thing: say whether ACH is offered here, accept a
 * buyer's bank details once, and report the pay-in's progress while the page
 * polls. What differs is where the amount, currency and business come from,
 * so the caller passes a loader and this file does the rest.
 *
 * Who is offered ACH: the rail is configured, the charge is in USD, the
 * payment or invoice is still payable, and the fraud layer said `allow`. A
 * `verify` decision means 3-D Secure on the card rail; there is no equivalent
 * for a bank debit, so a flagged buyer is not handed the one rail where the
 * merchant carries the loss.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { screenCheckout } from '@/lib/fraud/screen';
import { getClientIp, getRateLimitKey } from '@/lib/web-wallet/client-ip';
import { checkRateLimit } from '@/lib/web-wallet/rate-limit';
import { isBusinessPaidTier } from '@/lib/entitlements/service';
import { getFeePercentage } from '@/lib/payments/fees';
import { bankTransfersEnabled, getActiveBankProvider } from './providers';
import { SupabaseBankStore } from './store';
import { BankTransferError, holdDays, originatePayin, payerTransferView } from './service';

export interface PayinTarget {
  /** Exactly one of these. */
  paymentId?: string;
  invoiceId?: string;
  businessId: string;
  merchantId: string;
  /** Major units as stored ("12.50"), converted to minor here. */
  amount: string | number;
  currency: string;
  /** Whether the buyer may still pay. */
  payable: boolean;
  description?: string | null;
}

export type PayinTargetLoader = (id: string) => Promise<PayinTarget | null>;

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

function toMinor(amount: string | number): number {
  return Math.round(Number(amount) * 100);
}

/** GET: is bank payment offered here, and where is the current attempt. */
export async function handlePayinStatus(id: string, load: PayinTargetLoader): Promise<NextResponse> {
  const target = await load(id);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const provider = getActiveBankProvider();
  const store = new SupabaseBankStore(getSupabaseAdmin());
  const attempts = await store.listPayinsFor({ paymentId: target.paymentId, invoiceId: target.invoiceId });
  const current = attempts.find((row) => row.status !== 'failed' && row.status !== 'canceled') ?? attempts[0] ?? null;

  const available =
    provider !== null && target.currency.toUpperCase() === 'USD' && provider.currencies.includes('USD');

  return NextResponse.json(
    {
      available,
      payable: target.payable,
      holdDays: holdDays(),
      transfer: current ? payerTransferView(current) : null,
    },
    NO_STORE,
  );
}

/** POST: originate the debit from the buyer's bank. */
export async function handlePayinCreate(
  req: NextRequest,
  id: string,
  load: PayinTargetLoader,
  context: string,
): Promise<NextResponse> {
  if (!bankTransfersEnabled()) {
    return NextResponse.json({ error: 'Bank payments are not enabled' }, { status: 404 });
  }

  // The same bucket the other public payment routes use: a form that creates
  // a bank debit must not be a free way to hammer the originator.
  const limit = checkRateLimit(getRateLimitKey(req, 'ach-payin'), 'payment_create');
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again shortly.' }, { status: 429 });
  }

  const target = await load(id);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!target.payable) return NextResponse.json({ error: 'This is no longer payable' }, { status: 409 });
  if (target.currency.toUpperCase() !== 'USD') {
    return NextResponse.json({ error: 'Bank payment is available for USD only' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const accountType = str(body.accountType) || 'checking';
  if (accountType !== 'checking' && accountType !== 'savings') {
    return NextResponse.json({ error: 'accountType must be checking or savings' }, { status: 400 });
  }
  const email = str(body.email) || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'email is not valid' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const screening = await screenCheckout(supabase, {
    businessId: target.businessId,
    email,
    ip: getClientIp(req),
    amount: toMinor(target.amount),
    currency: 'usd',
    description: target.description ?? undefined,
  });
  if (screening.decision !== 'allow') {
    console.warn('[banking] payin refused by screening', {
      businessId: target.businessId,
      decision: screening.decision,
      score: screening.score,
    });
    return NextResponse.json(
      { error: screening.decision === 'block' ? screening.buyerMessage : 'Bank payment is not available for this order. Please pay another way.' },
      { status: 403 },
    );
  }

  const amountMinor = toMinor(target.amount);
  const feeMinor = Math.round(amountMinor * getFeePercentage(await isBusinessPaidTier(supabase, target.businessId)));

  try {
    const row = await originatePayin(
      {
        paymentId: target.paymentId ?? null,
        invoiceId: target.invoiceId ?? null,
        merchantId: target.merchantId,
        businessId: target.businessId,
        amountMinor,
        currency: 'USD',
        feeMinor,
        description: target.description ?? null,
        payer: {
          holderName: str(body.holderName),
          routingNumber: str(body.routingNumber),
          accountNumber: str(body.accountNumber),
          accountType,
          email,
        },
      },
      { store: new SupabaseBankStore(supabase) },
    );
    return NextResponse.json(
      { transfer: payerTransferView(row), holdDays: holdDays() },
      { status: row.status === 'failed' ? 200 : 201, ...NO_STORE },
    );
  } catch (err) {
    if (err instanceof BankTransferError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(`[${context}] payin failed`, err);
    return NextResponse.json({ error: 'Could not start the bank payment' }, { status: 502 });
  }
}
