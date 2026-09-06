/**
 * ACH pay-in, and the hold that goes with it.
 *
 * ## What this hold is, and what it is not
 *
 * A card charge is authorised before it clears. An ACH debit is not: Stripe
 * reports the PaymentIntent as succeeded once the debit is submitted, and the
 * bank may still return it afterwards. R01 (insufficient funds) and R02
 * (account closed) typically land two to five business days later, and
 * administrative returns can arrive up to sixty days out.
 *
 * So the risk is that a merchant reads "paid", ships the goods, and the debit
 * comes back. The hold exists to break that sequence: on the ACH rail we do not
 * tell the merchant the payment is complete until the hold expires.
 *
 * **It gates our completion signal, not Stripe's money movement.** These are
 * destination charges — funds route to the merchant's connected account on
 * Stripe's own schedule whatever we record here. Holding the money instead
 * would mean taking it onto the platform account first and transferring it out
 * later, and a platform that holds merchant funds is doing money transmission,
 * which `plans/fiat-onramp-strategy.md` rules out as explicitly not a CoinPay
 * project. That is a licensing decision, not a config value, so it is not made
 * here.
 *
 * **Twenty-four hours does not cover the ACH return window.** It is the
 * configured policy, not a safe one: it stops a merchant fulfilling in the
 * first minutes against a debit that has not begun to clear, and it does not
 * survive an R01 four days later. `ACH_HOLD_HOURS` exists so the window can be
 * widened without a deploy.
 */

export const DEFAULT_ACH_HOLD_HOURS = 24;

/** Rails recorded on `stripe_transactions.rail`. */
export type PaymentRail = 'card' | 'ach';

/**
 * The hold window, in hours.
 *
 * A missing, unparseable or negative value falls back to the default rather
 * than disabling the hold. A misconfigured env var must not silently turn a
 * risk control off — the failure has to be a hold that is too long, never one
 * that is not there.
 */
export function achHoldHours(): number {
  const raw = process.env.ACH_HOLD_HOURS;
  if (raw === undefined || raw === '') return DEFAULT_ACH_HOLD_HOURS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_ACH_HOLD_HOURS;
  return parsed;
}

/**
 * Whether to offer ACH on a given checkout.
 *
 * Three conditions, and each is load-bearing:
 *
 * 1. `STRIPE_ACH_ENABLED` gates the rollout. Naming `payment_method_types` at
 *    all overrides whatever a merchant has configured in their Stripe
 *    dashboard, and a connected account without ACH enabled would fail the
 *    session outright — so this stays off until an account is known good.
 * 2. ACH is USD-only at Stripe. Offering it on any other currency is an error
 *    at session creation, not a declined payment.
 * 3. Elevated fraud risk excludes it. The `verify` decision forces 3-D Secure,
 *    which moves liability for a stolen card to the issuer. There is no
 *    equivalent for a bank debit: leaving ACH on the menu would let a buyer we
 *    have already flagged pick the one rail where we carry the loss.
 */
export function achPayInEnabled(currency: string, screeningDecision: string): boolean {
  if (process.env.STRIPE_ACH_ENABLED !== '1') return false;
  if (currency.toLowerCase() !== 'usd') return false;
  return screeningDecision === 'allow';
}

/**
 * Which rail a Stripe charge arrived on.
 *
 * Read from `payment_method_details.type` rather than assumed. The webhook
 * previously hardcoded `rail: 'card'` on every row, which was harmless while
 * card was the only rail and becomes a mislabelled bank debit the moment ACH
 * is enabled — including in the merchant dashboard and the fraud history.
 */
export function railFromCharge(charge: unknown): PaymentRail {
  const type = (charge as { payment_method_details?: { type?: unknown } } | null)
    ?.payment_method_details?.type;
  return type === 'us_bank_account' ? 'ach' : 'card';
}

/** True for rails whose settlement can be reversed after we are told it succeeded. */
export function railIsHeld(rail: PaymentRail): boolean {
  return rail === 'ach';
}

/**
 * When a payment on this rail may be reported complete.
 *
 * Null for rails that are not held, which is the signal to complete straight
 * away rather than a missing value.
 */
export function holdUntilFor(rail: PaymentRail, succeededAt: Date, hours = achHoldHours()): string | null {
  if (!railIsHeld(rail)) return null;
  return new Date(succeededAt.getTime() + hours * 60 * 60 * 1000).toISOString();
}

/** The status a freshly-succeeded payment on this rail should be recorded as. */
export function settlementStatusFor(rail: PaymentRail): 'completed' | 'held' {
  return railIsHeld(rail) ? 'held' : 'completed';
}

/**
 * Whether a hold has run out.
 *
 * A row with no `hold_until` is treated as released: the column is nullable and
 * every pre-ACH row has it null, so the alternative would strand historical
 * card transactions in a hold that never ends.
 */
export function isHoldExpired(holdUntil: string | null | undefined, now: Date = new Date()): boolean {
  if (!holdUntil) return true;

  const expiry = Date.parse(holdUntil);
  // An unparseable timestamp is not evidence the hold is over. Keep holding and
  // let it be looked at, rather than releasing on a value we cannot read.
  if (Number.isNaN(expiry)) return false;

  return now.getTime() >= expiry;
}

/** A held transaction that has come due. */
export interface ReleasedHold {
  id: string;
  business_id: string | null;
  merchant_id: string | null;
  amount: number | null;
  currency: string | null;
  stripe_payment_intent_id: string | null;
}

/**
 * The slice of a Supabase client this needs.
 *
 * Deliberately loose. Typing the builder chain precisely makes tsc walk
 * Supabase's generics far enough to hit "type instantiation is excessively
 * deep", and a PostgREST builder is thenable rather than a real Promise, so an
 * exact structural type rejects the very client that is passed in production.
 */
interface HoldReleaseClient {
  from: (table: string) => any;
}

/**
 * Flip held ACH transactions to completed once their hold has run out.
 *
 * Returns the rows it released so the caller can fire the merchant webhook that
 * was withheld at succeeded-time. Nothing here sends that webhook: this runs
 * inside the payments cron, and a delivery failure must not roll back the
 * release or stall the rest of the cycle.
 *
 * The update filters on `status = 'held'` as well as on the timestamp, so two
 * overlapping cron ticks cannot both release the same row and notify the
 * merchant twice.
 */
export async function releaseExpiredAchHolds(
  supabase: HoldReleaseClient,
  now: Date = new Date()
): Promise<ReleasedHold[]> {
  const { data, error } = (await supabase
    .from('stripe_transactions')
    .update({ status: 'completed', updated_at: now.toISOString() })
    .eq('status', 'held')
    .lte('hold_until', now.toISOString())
    .select('id, business_id, merchant_id, amount, currency, stripe_payment_intent_id')) as {
    data: ReleasedHold[] | null;
    error: unknown;
  };

  if (error) {
    console.error('[ACH] Failed to release expired holds', error);
    return [];
  }

  return data ?? [];
}
