import type { SupabaseClient } from '@supabase/supabase-js';
import type { BusinessMethodStatus } from './types';
import { invalidateBusiness, invalidateAll } from './resolver';

/**
 * W5 write-side helpers. These enforce the restrict-only invariant at WRITE time
 * (a merchant can't enable what the business hasn't unlocked; a business can't
 * unlock what the platform hasn't published) and keep the resolver cache honest
 * by invalidating on every mutation. The resolver ALSO re-checks the invariant
 * at merge time, so a stale write can never leak into checkout.
 */

export interface PolicyResult {
  ok: boolean;
  error?: string;
  status?: number;
}

async function getCatalogMethod(supabase: SupabaseClient, methodId: string) {
  const { data } = await supabase
    .from('payment_method_catalog')
    .select('method_id, published, force_disabled')
    .eq('method_id', methodId)
    .single();
  return data;
}

/**
 * Platform → business: unlock/block/flag a method for a legal entity. A method
 * can only be unlocked if the platform has published it and not killed it.
 */
export async function setBusinessMethodStatus(
  supabase: SupabaseClient,
  businessId: string,
  methodId: string,
  status: BusinessMethodStatus,
  entityParams: Record<string, unknown> = {}
): Promise<PolicyResult> {
  const method = await getCatalogMethod(supabase, methodId);
  if (!method) {
    return { ok: false, error: `Unknown payment method: ${methodId}`, status: 404 };
  }
  if (status === 'unlocked' && (!method.published || method.force_disabled)) {
    return {
      ok: false,
      error: `Method ${methodId} is not available to unlock (unpublished or disabled by platform).`,
      status: 409,
    };
  }

  const { error } = await supabase.from('business_payment_policy').upsert(
    {
      business_id: businessId,
      method_id: methodId,
      status,
      entity_params: entityParams,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'business_id,method_id' }
  );
  if (error) return { ok: false, error: 'Failed to update business payment policy', status: 500 };

  invalidateBusiness(businessId);
  return { ok: true };
}

/**
 * Business → merchant/store: enable/configure a method for a store. Enabling is
 * rejected unless the business has the method unlocked (restrict-only). Caps and
 * display can always be written; only `enabled=true` requires an unlock.
 */
export async function setMerchantMethodSetting(
  supabase: SupabaseClient,
  businessId: string,
  methodId: string,
  patch: {
    enabled?: boolean;
    minOrderValue?: number | null;
    maxOrderValue?: number | null;
    currencyAllowlist?: string[] | null;
    displayOrder?: number | null;
  }
): Promise<PolicyResult> {
  if (patch.enabled === true) {
    const { data: policy } = await supabase
      .from('business_payment_policy')
      .select('status')
      .eq('business_id', businessId)
      .eq('method_id', methodId)
      .single();
    if (!policy || policy.status !== 'unlocked') {
      return {
        ok: false,
        error: `Cannot enable ${methodId}: the business has not unlocked this method.`,
        status: 409,
      };
    }
  }

  const row: Record<string, unknown> = {
    business_id: businessId,
    method_id: methodId,
    updated_at: new Date().toISOString(),
  };
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.minOrderValue !== undefined) row.min_order_value = patch.minOrderValue;
  if (patch.maxOrderValue !== undefined) row.max_order_value = patch.maxOrderValue;
  if (patch.currencyAllowlist !== undefined) row.currency_allowlist = patch.currencyAllowlist;
  if (patch.displayOrder !== undefined) row.display_order = patch.displayOrder;

  const { error } = await supabase
    .from('merchant_payment_settings')
    .upsert(row, { onConflict: 'business_id,method_id' });
  if (error) return { ok: false, error: 'Failed to update merchant payment settings', status: 500 };

  invalidateBusiness(businessId);
  return { ok: true };
}

/**
 * Platform kill switch. Flipping force_disabled affects every business, so the
 * whole resolver cache is cleared.
 */
export async function setMethodForceDisabled(
  supabase: SupabaseClient,
  methodId: string,
  forceDisabled: boolean
): Promise<PolicyResult> {
  const { error } = await supabase
    .from('payment_method_catalog')
    .update({ force_disabled: forceDisabled, updated_at: new Date().toISOString() })
    .eq('method_id', methodId);
  if (error) return { ok: false, error: 'Failed to update catalog', status: 500 };

  invalidateAll();
  return { ok: true };
}
