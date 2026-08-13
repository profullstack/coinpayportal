/**
 * Identity linkage between businesses.
 *
 * One person running several accounts is the pattern behind most merchant-side
 * abuse: an account gets shut down, a new one appears the same week selling the
 * same thing. They rarely change everything — the payout wallet, the Stripe
 * account, the webhook domain or the mailbox usually carries over.
 *
 * Nothing here is proof on its own. It surfaces candidates for a human, and
 * feeds one input into scoring.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeEmail } from './signals';

export type LinkKind =
  | 'same_merchant'
  | 'merchant_email'
  | 'stripe_account'
  | 'stripe_email'
  | 'wallet_address'
  | 'webhook_domain'
  | 'checkout_ip';

export interface BusinessLink {
  businessId: string;
  kinds: LinkKind[];
  /** The shared values, for a reviewer to eyeball. */
  evidence: string[];
}

export interface LinkageResult {
  businessId: string;
  links: BusinessLink[];
  linkedBusinessIds: string[];
  linkedToBlockedBusiness: boolean;
}

function hostOf(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Find businesses sharing an identity signal with `businessId`.
 *
 * Best-effort: any individual lookup that fails is skipped rather than failing
 * the whole call, because this runs inline on the checkout path.
 */
export async function findLinkedBusinesses(
  supabase: SupabaseClient,
  businessId: string
): Promise<LinkageResult> {
  const links = new Map<string, BusinessLink>();
  const addLink = (id: string, kind: LinkKind, evidence: string) => {
    if (!id || id === businessId) return;
    const existing = links.get(id);
    if (existing) {
      if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
      if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence);
      return;
    }
    links.set(id, { businessId: id, kinds: [kind], evidence: [evidence] });
  };

  const { data: business } = await supabase
    .from('businesses')
    .select('id, merchant_id, webhook_url')
    .eq('id', businessId)
    .maybeSingle();

  if (!business) {
    return { businessId, links: [], linkedBusinessIds: [], linkedToBlockedBusiness: false };
  }

  // Same owner — the cheapest link, and the one that matters most.
  if (business.merchant_id) {
    const { data: siblings } = await supabase
      .from('businesses')
      .select('id')
      .eq('merchant_id', business.merchant_id);
    for (const sibling of siblings ?? []) {
      addLink(sibling.id, 'same_merchant', business.merchant_id);
    }

    // Same human behind different merchant accounts: gmail dots and +suffixes
    // make one mailbox look like many, so compare normalized addresses.
    const { data: owner } = await supabase
      .from('merchants')
      .select('email')
      .eq('id', business.merchant_id)
      .maybeSingle();

    const normalized = normalizeEmail(owner?.email);
    if (normalized) {
      const { data: merchants } = await supabase.from('merchants').select('id, email');
      const twins = (merchants ?? []).filter(
        (candidate: { id: string; email: string | null }) =>
          candidate.id !== business.merchant_id && normalizeEmail(candidate.email) === normalized
      );
      if (twins.length > 0) {
        const { data: twinBusinesses } = await supabase
          .from('businesses')
          .select('id')
          .in(
            'merchant_id',
            twins.map((t: { id: string }) => t.id)
          );
        for (const b of twinBusinesses ?? []) {
          addLink(b.id, 'merchant_email', normalized);
        }
      }
    }
  }

  // Shared Stripe account or Stripe-side email.
  const { data: stripeAccount } = await supabase
    .from('stripe_accounts')
    .select('stripe_account_id, email')
    .eq('business_id', businessId)
    .maybeSingle();

  if (stripeAccount?.stripe_account_id) {
    const { data: shared } = await supabase
      .from('stripe_accounts')
      .select('business_id')
      .eq('stripe_account_id', stripeAccount.stripe_account_id);
    for (const row of shared ?? []) {
      if (row.business_id) addLink(row.business_id, 'stripe_account', stripeAccount.stripe_account_id);
    }
  }

  const stripeEmail = normalizeEmail(stripeAccount?.email);
  if (stripeEmail) {
    const { data: accounts } = await supabase.from('stripe_accounts').select('business_id, email');
    for (const row of accounts ?? []) {
      if (row.business_id && normalizeEmail(row.email) === stripeEmail) {
        addLink(row.business_id, 'stripe_email', stripeEmail);
      }
    }
  }

  // Shared payout wallet — money landing in one place is a hard link.
  const { data: wallets } = await supabase
    .from('business_wallets')
    .select('wallet_address')
    .eq('business_id', businessId);

  const addresses = (wallets ?? [])
    .map((w: { wallet_address: string | null }) => w.wallet_address)
    .filter((a: string | null): a is string => !!a);

  if (addresses.length > 0) {
    const { data: shared } = await supabase
      .from('business_wallets')
      .select('business_id, wallet_address')
      .in('wallet_address', addresses);
    for (const row of shared ?? []) {
      if (row.business_id) addLink(row.business_id, 'wallet_address', row.wallet_address);
    }
  }

  // Shared webhook host — same backend behind two storefronts.
  const host = hostOf(business.webhook_url);
  if (host) {
    const { data: others } = await supabase
      .from('businesses')
      .select('id, webhook_url')
      .not('webhook_url', 'is', null);
    for (const row of others ?? []) {
      if (hostOf(row.webhook_url) === host) addLink(row.id, 'webhook_domain', host);
    }
  }

  const linkedBusinessIds = [...links.keys()];

  // Does any linked business carry a hard stop of its own?
  let linkedToBlockedBusiness = false;
  if (linkedBusinessIds.length > 0) {
    const { data: linkedBusinesses } = await supabase
      .from('businesses')
      .select('id, risk_level, review_status')
      .in('id', linkedBusinessIds);

    linkedToBlockedBusiness = (linkedBusinesses ?? []).some(
      (b: { risk_level: string | null; review_status: string | null }) =>
        b.risk_level === 'prohibited' || b.review_status === 'rejected'
    );

    if (!linkedToBlockedBusiness) {
      const { data: blocked } = await supabase
        .from('fraud_blocklist')
        .select('value')
        .eq('kind', 'business')
        .eq('action', 'block')
        .in('value', linkedBusinessIds);
      linkedToBlockedBusiness = (blocked ?? []).length > 0;
    }
  }

  return {
    businessId,
    links: [...links.values()],
    linkedBusinessIds,
    linkedToBlockedBusiness,
  };
}
