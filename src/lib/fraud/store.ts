/**
 * Database access for fraud screening: velocity counters, the blocklist, and
 * the append-only event log.
 *
 * Screening sits inline on the checkout path, so every read here is
 * fail-open — a database hiccup must not stop legitimate payments. The one
 * exception is recording, which is fire-and-forget.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Decision, Finding, VelocitySnapshot } from './rules';
import type { CheckoutSignals } from './signals';

/** Amounts (in minor units) below this count as "small" for card testing. */
export const SMALL_AMOUNT_MINOR = 500;

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function countRows(
  supabase: SupabaseClient,
  build: (q: any) => any
): Promise<number> {
  try {
    const { count, error } = await build(
      supabase.from('fraud_events').select('id', { count: 'exact', head: true })
    );
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Gather every velocity counter the rules need. Counters that cannot be
 * computed (no IP, no email) come back as 0 so they simply never fire.
 */
export async function getVelocitySnapshot(
  supabase: SupabaseClient,
  signals: CheckoutSignals
): Promise<VelocitySnapshot> {
  const tenMin = minutesAgo(10);
  const oneHour = minutesAgo(60);
  const thirtyDays = minutesAgo(60 * 24 * 30);

  const ipKey = signals.ipPrefix ?? signals.ip;

  const [
    attemptsPerIp10m,
    attemptsPerEmail10m,
    declinesPerBusiness1h,
    declinesPerIp1h,
    smallAmountAttempts10m,
    disputesPerBusiness30d,
    distinctEmailsPerIp1h,
  ] = await Promise.all([
    ipKey
      ? countRows(supabase, (q) =>
          q
            .eq('kind', 'checkout_screen')
            .eq(signals.ipPrefix ? 'ip_prefix' : 'ip', ipKey)
            .gte('created_at', tenMin)
        )
      : Promise.resolve(0),

    signals.emailNormalized
      ? countRows(supabase, (q) =>
          q
            .eq('kind', 'checkout_screen')
            .eq('email_normalized', signals.emailNormalized)
            .gte('created_at', tenMin)
        )
      : Promise.resolve(0),

    countRows(supabase, (q) =>
      q.eq('kind', 'card_declined').eq('business_id', signals.businessId).gte('created_at', oneHour)
    ),

    ipKey
      ? countRows(supabase, (q) =>
          q
            .eq('kind', 'card_declined')
            .eq(signals.ipPrefix ? 'ip_prefix' : 'ip', ipKey)
            .gte('created_at', oneHour)
        )
      : Promise.resolve(0),

    countRows(supabase, (q) =>
      q
        .eq('kind', 'checkout_screen')
        .eq('business_id', signals.businessId)
        .lt('amount', SMALL_AMOUNT_MINOR)
        .gte('created_at', tenMin)
    ),

    countRows(supabase, (q) =>
      q.eq('kind', 'dispute').eq('business_id', signals.businessId).gte('created_at', thirtyDays)
    ),

    countDistinctEmailsForIp(supabase, signals, oneHour),
  ]);

  return {
    attemptsPerIp10m,
    distinctEmailsPerIp1h,
    attemptsPerEmail10m,
    declinesPerBusiness1h,
    declinesPerIp1h,
    smallAmountAttempts10m,
    disputesPerBusiness30d,
  };
}

/**
 * Distinct buyer mailboxes seen on one network in the window. Postgrest has no
 * count(distinct), so this pulls the column and dedupes — capped, because the
 * only thing the rules care about is "more than a handful".
 */
async function countDistinctEmailsForIp(
  supabase: SupabaseClient,
  signals: CheckoutSignals,
  since: string
): Promise<number> {
  const ipKey = signals.ipPrefix ?? signals.ip;
  if (!ipKey) return 0;

  try {
    const { data, error } = await supabase
      .from('fraud_events')
      .select('email_normalized')
      .eq('kind', 'checkout_screen')
      .eq(signals.ipPrefix ? 'ip_prefix' : 'ip', ipKey)
      .gte('created_at', since)
      .not('email_normalized', 'is', null)
      .limit(200);

    if (error || !data) return 0;
    return new Set(data.map((row: { email_normalized: string }) => row.email_normalized)).size;
  } catch {
    return 0;
  }
}

export interface BlocklistHit {
  action: 'block' | 'verify';
  reason: string | null;
  kind: string;
  value: string;
}

/**
 * Look for a blocklist entry matching any signal on this attempt. Block beats
 * verify when several match.
 */
export async function checkBlocklist(
  supabase: SupabaseClient,
  signals: CheckoutSignals,
  merchantId?: string | null
): Promise<BlocklistHit | null> {
  const candidates: Array<{ kind: string; value: string }> = [];
  if (signals.emailNormalized) candidates.push({ kind: 'email', value: signals.emailNormalized });
  if (signals.emailDomain) candidates.push({ kind: 'email_domain', value: signals.emailDomain });
  if (signals.ip) candidates.push({ kind: 'ip', value: signals.ip });
  if (signals.ipPrefix) candidates.push({ kind: 'ip_prefix', value: signals.ipPrefix });
  candidates.push({ kind: 'business', value: signals.businessId });
  if (merchantId) candidates.push({ kind: 'merchant', value: merchantId });

  try {
    const { data, error } = await supabase
      .from('fraud_blocklist')
      .select('kind, value, action, reason, expires_at')
      .in(
        'value',
        candidates.map((c) => c.value)
      );

    if (error || !data || data.length === 0) return null;

    const now = Date.now();
    const hits = data.filter((row: any) => {
      if (row.expires_at && new Date(row.expires_at).getTime() < now) return false;
      return candidates.some((c) => c.kind === row.kind && c.value === row.value);
    });

    if (hits.length === 0) return null;
    const blocking = hits.find((h: any) => h.action === 'block');
    const chosen = blocking ?? hits[0];
    return {
      action: chosen.action,
      reason: chosen.reason ?? null,
      kind: chosen.kind,
      value: chosen.value,
    };
  } catch {
    return null;
  }
}

export interface RecordEventInput {
  businessId?: string | null;
  merchantId?: string | null;
  kind: 'checkout_screen' | 'card_declined' | 'dispute' | 'payment_succeeded';
  decision?: Decision | null;
  score?: number | null;
  signals?: Partial<CheckoutSignals> | null;
  findings?: Finding[];
  stripePaymentIntentId?: string | null;
}

/**
 * Append to the event log. Never throws — a failed write costs us a future
 * velocity data point, not this payment.
 */
export async function recordFraudEvent(
  supabase: SupabaseClient,
  input: RecordEventInput
): Promise<void> {
  try {
    await supabase.from('fraud_events').insert({
      business_id: input.businessId ?? null,
      merchant_id: input.merchantId ?? null,
      kind: input.kind,
      decision: input.decision ?? null,
      score: input.score ?? null,
      email: input.signals?.email ?? null,
      email_domain: input.signals?.emailDomain ?? null,
      email_normalized: input.signals?.emailNormalized ?? null,
      ip: input.signals?.ip ?? null,
      ip_prefix: input.signals?.ipPrefix ?? null,
      amount: input.signals?.amount ?? null,
      currency: input.signals?.currency ?? null,
      description: input.signals?.description ?? null,
      findings: input.findings ?? [],
      stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
    });
  } catch (error) {
    console.error('[Fraud] Failed to record event:', error);
  }
}

/**
 * Recent payment descriptions for a business, used to compare what they
 * actually sell against what they declared.
 */
export async function getRecentDescriptions(
  supabase: SupabaseClient,
  businessId: string,
  limit = 50
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('fraud_events')
      .select('description')
      .eq('business_id', businessId)
      .not('description', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];
    return data
      .map((row: { description: string | null }) => row.description)
      .filter((d: string | null): d is string => !!d);
  } catch {
    return [];
  }
}
