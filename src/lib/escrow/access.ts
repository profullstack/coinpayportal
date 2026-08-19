import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthContext } from '../auth/middleware';
import { getAccessibleBusinessRoles } from '../auth/authz';

/**
 * Whether an authenticated caller may read an escrow.
 *
 * `GET /api/escrow/:id` and `GET /api/escrow/:id/events` both authenticated the
 * caller and then fetched the escrow by UUID with no ownership check at all —
 * so any merchant's API key read any escrow: counterparty emails, amounts,
 * address hashes, dispute reasons. The token-based path in the same handlers
 * *was* checked, which is what made the gap easy to miss.
 *
 * Shared rather than copied, because the two routes are clones of each other
 * and the audit found several pairs where a check present in one had never been
 * propagated to its sibling.
 *
 * An escrow is scoped by `business_id`, and its two counterparties are
 * identified by email. A business API key may read escrows on its own business;
 * a merchant JWT may read escrows on any business they can access, or any
 * escrow naming them as depositor or beneficiary.
 */
export type EscrowOwnershipFields = {
  business_id?: string | null;
  depositor_email?: string | null;
  beneficiary_email?: string | null;
};

export async function callerOwnsEscrow(
  supabase: SupabaseClient,
  context: AuthContext,
  escrow: EscrowOwnershipFields,
): Promise<boolean> {
  if (context.type === 'business') {
    return !!escrow.business_id && escrow.business_id === context.businessId;
  }

  const { data: merchant } = await supabase
    .from('merchants')
    .select('email')
    .eq('id', context.merchantId)
    .maybeSingle();

  const email = merchant?.email?.toLowerCase();
  if (email) {
    if (escrow.depositor_email?.toLowerCase() === email) return true;
    if (escrow.beneficiary_email?.toLowerCase() === email) return true;
  }

  if (!escrow.business_id) return false;
  const roles = await getAccessibleBusinessRoles(supabase, context.merchantId);
  return roles.has(escrow.business_id);
}
