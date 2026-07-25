/**
 * Unified wallet listing for a CoinPay user.
 *
 * A user's receive addresses live in two places:
 *   - `merchant_wallets` — account-level ("global") wallets, keyed by
 *     `merchant_id` = the merchant/account id. Managed at /settings/wallets.
 *   - `business_wallets` — per-business wallets, keyed by `business_id`.
 *     Managed under Business > Wallets, and the setup most users actually use.
 *
 * Anything that answers "what wallet addresses does this user have?" — most
 * notably `GET /api/wallets` and the OIDC `wallet:read` claim — must look at
 * both, otherwise users who keep their addresses on a business appear to have
 * no wallets at all. (The 'Merchant ID' shown on a business page is the
 * *business* id; it is never a value in `merchant_wallets.merchant_id`, which
 * is a foreign key to `merchants(id)`.)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccessibleBusinessRoles } from '@/lib/auth/authz';
import { can } from '@/lib/auth/permissions';

export type WalletSource = 'account' | 'business';

/** A wallet address from either store, in one shape. */
export interface UnifiedWallet {
  id: string;
  /** Which store this row came from. */
  source: WalletSource;
  /** Account owner — set for account-level wallets, null for business wallets. */
  merchant_id: string | null;
  /** Owning business — set for business wallets, null for account-level ones. */
  business_id: string | null;
  business_name: string | null;
  cryptocurrency: string;
  wallet_address: string;
  label: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface ListUserWalletsOptions {
  /** 'all' (default) merges both stores. */
  source?: WalletSource | 'all';
  /**
   * Restrict business wallets to a single business. Implies business scope, so
   * account-level wallets are excluded. The caller must be able to read the
   * business or the call fails with 404.
   */
  businessId?: string;
  /** Drop wallets flagged inactive. */
  activeOnly?: boolean;
}

export interface ListUserWalletsResult {
  success: boolean;
  wallets?: UnifiedWallet[];
  error?: string;
  /** Suggested HTTP status when `success` is false. */
  status?: number;
}

/** Same address for the same coin, however it is capitalised, is one wallet. */
function dedupeKey(cryptocurrency: string, address: string): string {
  return `${(cryptocurrency || '').toUpperCase()}:${(address || '').trim().toLowerCase()}`;
}

function sortWallets(wallets: UnifiedWallet[]): UnifiedWallet[] {
  return [...wallets].sort((a, b) => {
    const byCrypto = a.cryptocurrency.localeCompare(b.cryptocurrency);
    if (byCrypto !== 0) return byCrypto;
    // Account-level entries first so they win deduplication — business wallets
    // are usually imported copies of them.
    if (a.source !== b.source) return a.source === 'account' ? -1 : 1;
    return (a.created_at || '').localeCompare(b.created_at || '');
  });
}

/**
 * List every wallet address visible to `userId`: account-level wallets plus the
 * wallets of every business the user can read (owned, or via org / per-business
 * team membership).
 *
 * Duplicates — the same address for the same coin appearing in more than one
 * place, which happens whenever global wallets are imported into a business —
 * are collapsed to a single entry, preferring the account-level row.
 */
export async function listUserWallets(
  supabase: SupabaseClient,
  userId: string,
  options: ListUserWalletsOptions = {}
): Promise<ListUserWalletsResult> {
  const { businessId, activeOnly = false } = options;
  const source = businessId ? 'business' : options.source ?? 'all';

  if (businessId && options.source === 'account') {
    return {
      success: false,
      error: 'business_id cannot be combined with source=account',
      status: 400,
    };
  }

  if (!userId) {
    return { success: false, error: 'Missing user id', status: 401 };
  }

  try {
    const wallets: UnifiedWallet[] = [];

    if (source === 'all' || source === 'account') {
      let query = supabase
        .from('merchant_wallets')
        .select('*')
        .eq('merchant_id', userId);
      if (activeOnly) query = query.eq('is_active', true);

      const { data, error } = await query;
      if (error) return { success: false, error: error.message, status: 400 };

      for (const row of data || []) {
        wallets.push({
          id: row.id,
          source: 'account',
          merchant_id: row.merchant_id,
          business_id: null,
          business_name: null,
          cryptocurrency: row.cryptocurrency,
          wallet_address: row.wallet_address,
          label: row.label ?? null,
          is_active: row.is_active ?? true,
          created_at: row.created_at ?? null,
          updated_at: row.updated_at ?? null,
        });
      }
    }

    if (source === 'all' || source === 'business') {
      const roles = await getAccessibleBusinessRoles(supabase, userId);
      const readableIds = [...roles.entries()]
        .filter(([, role]) => can(role, 'business.read'))
        .map(([id]) => id);

      let targetIds = readableIds;
      if (businessId) {
        if (!readableIds.includes(businessId)) {
          return { success: false, error: 'Business not found', status: 404 };
        }
        targetIds = [businessId];
      }

      if (targetIds.length > 0) {
        const { data: businesses } = await supabase
          .from('businesses')
          .select('id, name')
          .in('id', targetIds);

        const nameById = new Map<string, string | null>(
          (businesses || []).map((b: { id: string; name: string | null }) => [b.id, b.name ?? null])
        );

        let query = supabase
          .from('business_wallets')
          .select('*')
          .in('business_id', targetIds);
        if (activeOnly) query = query.eq('is_active', true);

        const { data, error } = await query;
        if (error) return { success: false, error: error.message, status: 400 };

        for (const row of data || []) {
          wallets.push({
            id: row.id,
            source: 'business',
            merchant_id: null,
            business_id: row.business_id,
            business_name: nameById.get(row.business_id) ?? null,
            cryptocurrency: row.cryptocurrency,
            // business_wallets has no label column.
            wallet_address: row.wallet_address,
            label: row.label ?? null,
            is_active: row.is_active ?? true,
            created_at: row.created_at ?? null,
            updated_at: row.updated_at ?? null,
          });
        }
      }
    }

    const seen = new Set<string>();
    const deduped = sortWallets(wallets).filter((w) => {
      const key = dedupeKey(w.cryptocurrency, w.wallet_address);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { success: true, wallets: deduped };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list wallets',
      status: 500,
    };
  }
}
