import type { SupabaseClient } from '@supabase/supabase-js';

export interface EnabledManualMethod {
  method_id: string;
  display_name: string;
  handle: string;
  instructions: string;
}

/**
 * The manual P2P methods (Venmo/Cash App/Zelle) a business currently has enabled,
 * with the merchant's handle. A method counts only if the platform published it
 * (manual integration), the business unlocked it, and the store enabled it with a
 * handle. Snapshotted onto an invoice at send time so the public pay page can
 * render "send X to <handle>" without a live cascade lookup.
 */
export async function getEnabledManualMethods(
  supabase: SupabaseClient,
  businessId: string
): Promise<EnabledManualMethod[]> {
  const [{ data: catalog }, { data: policy }, { data: settings }] = await Promise.all([
    supabase
      .from('payment_method_catalog')
      .select('method_id, display_name, sort_order')
      .eq('integration_type', 'manual')
      .eq('published', true)
      .eq('force_disabled', false)
      .order('sort_order'),
    supabase
      .from('business_payment_policy')
      .select('method_id, status')
      .eq('business_id', businessId)
      .eq('status', 'unlocked'),
    supabase
      .from('merchant_payment_settings')
      .select('method_id, enabled, config')
      .eq('business_id', businessId)
      .eq('enabled', true),
  ]);

  const unlocked = new Set((policy || []).map((p) => p.method_id));
  const settingByMethod = new Map((settings || []).map((s) => [s.method_id, s]));

  const out: EnabledManualMethod[] = [];
  for (const m of catalog || []) {
    if (!unlocked.has(m.method_id)) continue;
    const s = settingByMethod.get(m.method_id);
    if (!s) continue;
    const config = (s.config || {}) as { handle?: string; instructions?: string };
    const handle = (config.handle || '').trim();
    if (!handle) continue;
    out.push({
      method_id: m.method_id,
      display_name: m.display_name,
      handle,
      instructions: (config.instructions || '').trim(),
    });
  }
  return out;
}
