import type { SupabaseClient } from '@supabase/supabase-js';
import { configureManualMethod } from './policy';

export interface AccountManualDefault {
  method_id: string;
  display_name: string;
  handle: string;
  instructions: string;
}

/**
 * A merchant's account-level manual-method handles (the "global" setup). Lists
 * every published manual method with the merchant's saved default (blank if none).
 */
export async function getAccountManualDefaults(
  supabase: SupabaseClient,
  merchantId: string
): Promise<AccountManualDefault[]> {
  const [{ data: catalog }, { data: defaults }] = await Promise.all([
    supabase
      .from('payment_method_catalog')
      .select('method_id, display_name, sort_order')
      .eq('integration_type', 'manual')
      .eq('published', true)
      .eq('force_disabled', false)
      .order('sort_order'),
    supabase.from('merchant_payment_defaults').select('method_id, config').eq('merchant_id', merchantId),
  ]);

  const byMethod = new Map((defaults || []).map((d) => [d.method_id, d.config || {}]));
  return (catalog || []).map((m) => {
    const config = (byMethod.get(m.method_id) || {}) as { handle?: string; instructions?: string };
    return {
      method_id: m.method_id,
      display_name: m.display_name,
      handle: config.handle || '',
      instructions: config.instructions || '',
    };
  });
}

/** Save (or clear) a merchant's account-level default handle for a manual method. */
export async function setAccountManualDefault(
  supabase: SupabaseClient,
  merchantId: string,
  methodId: string,
  input: { handle?: string; instructions?: string }
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const { data: method } = await supabase
    .from('payment_method_catalog')
    .select('method_id, integration_type, published')
    .eq('method_id', methodId)
    .single();
  if (!method || method.integration_type !== 'manual' || !method.published) {
    return { ok: false, error: `Method ${methodId} is not an available manual method.`, status: 400 };
  }

  const { error } = await supabase.from('merchant_payment_defaults').upsert(
    {
      merchant_id: merchantId,
      method_id: methodId,
      config: { handle: (input.handle || '').trim(), instructions: (input.instructions || '').trim() },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'merchant_id,method_id' }
  );
  if (error) return { ok: false, error: 'Failed to save account default', status: 500 };
  return { ok: true };
}

/**
 * Import the merchant's account-level manual defaults into a business: for each
 * default that has a handle, unlock + enable that method on the business with the
 * saved handle (via the W5 cascade). Returns how many methods were applied.
 */
export async function importManualDefaultsToBusiness(
  supabase: SupabaseClient,
  merchantId: string,
  businessId: string
): Promise<{ ok: boolean; imported: number; error?: string; status?: number }> {
  const defaults = await getAccountManualDefaults(supabase, merchantId);
  const withHandles = defaults.filter((d) => d.handle);

  let imported = 0;
  for (const d of withHandles) {
    const res = await configureManualMethod(supabase, businessId, d.method_id, {
      handle: d.handle,
      instructions: d.instructions,
      enabled: true,
    });
    if (res.ok) imported++;
  }
  return { ok: true, imported };
}
