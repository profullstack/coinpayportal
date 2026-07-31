/**
 * Web wallets associated with a CoinPay account.
 *
 * The non-custodial web wallet (`wallets` + `wallet_addresses`) is anonymous by
 * design — it has no owner column. `wallet_account_links` is the opt-in bridge:
 * once a holder proves control of a wallet (signed auth challenge) while signed
 * in to a merchant account, that wallet's derived addresses become a payee
 * source for invoices and proposals.
 *
 * Resolution order within this store is most-specific-first: a wallet linked to
 * the exact business beats an account-level link, and within a scope an explicit
 * default beats the oldest link.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface WalletAccountLink {
  id: string;
  wallet_id: string;
  merchant_id: string;
  business_id: string | null;
  label: string | null;
  is_default: boolean;
  created_at: string | null;
}

export interface LinkedWebWalletAddress {
  linkId: string;
  walletId: string;
  /** Chain code as stored on `wallet_addresses.chain` (e.g. BTC, USDC_SOL). */
  chain: string;
  address: string;
  label: string | null;
  /** True when the link is scoped to the business rather than the account. */
  businessScoped: boolean;
}

/**
 * Every wallet linked to `merchantId`, plus (when `businessId` is given) wallets
 * linked to that specific business. Ordered most-specific-first.
 */
export async function listWalletAccountLinks(
  supabase: SupabaseClient,
  input: { merchantId: string; businessId?: string | null },
): Promise<{ links?: WalletAccountLink[]; error?: string }> {
  const { data, error } = await supabase
    .from('wallet_account_links')
    .select('id, wallet_id, merchant_id, business_id, label, is_default, created_at')
    .eq('merchant_id', input.merchantId);

  if (error) {
    return { error: error.message };
  }

  const links = (data ?? []).filter(
    (link: WalletAccountLink) =>
      link.business_id === null ||
      (!!input.businessId && link.business_id === input.businessId),
  );

  links.sort((a: WalletAccountLink, b: WalletAccountLink) => {
    // Business-scoped links win over account-level ones.
    const aScoped = a.business_id ? 0 : 1;
    const bScoped = b.business_id ? 0 : 1;
    if (aScoped !== bScoped) return aScoped - bScoped;
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    return (a.created_at ?? '').localeCompare(b.created_at ?? '');
  });

  return { links };
}

/**
 * The first receive address for `cryptocurrency` across the account's linked web
 * wallets, or undefined when none of them can receive that coin.
 */
export async function getLinkedWebWalletAddress(
  supabase: SupabaseClient,
  input: { merchantId: string; businessId?: string | null; cryptocurrency: string },
): Promise<{ address?: LinkedWebWalletAddress; error?: string }> {
  const { links, error } = await listWalletAccountLinks(supabase, input);
  if (error) return { error };
  if (!links || links.length === 0) return {};

  const { data: addresses, error: addressError } = await supabase
    .from('wallet_addresses')
    .select('wallet_id, chain, address, derivation_index, is_active')
    .in(
      'wallet_id',
      links.map((link) => link.wallet_id),
    )
    .eq('chain', input.cryptocurrency)
    .eq('is_active', true)
    .order('derivation_index', { ascending: true });

  if (addressError) {
    return { error: addressError.message };
  }
  if (!addresses || addresses.length === 0) return {};

  // Walk the links in priority order and take the first that has an address for
  // this chain, so link precedence — not address insertion order — decides.
  for (const link of links) {
    const match = addresses.find(
      (row: { wallet_id: string; address: string }) => row.wallet_id === link.wallet_id,
    );
    if (match?.address) {
      return {
        address: {
          linkId: link.id,
          walletId: link.wallet_id,
          chain: input.cryptocurrency,
          address: match.address,
          label: link.label,
          businessScoped: link.business_id !== null,
        },
      };
    }
  }

  return {};
}
