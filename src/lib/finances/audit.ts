import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';

/**
 * Metadata-only audit trail for finance actions.
 *
 * Records who did what to which object and when. Never an amount, a
 * description, a balance or a file name: the metadata is counts, kinds,
 * formats and ids. A failure to audit is logged and swallowed — the action
 * itself already happened and refusing to answer would not undo it.
 */
export async function audit(
  merchantId: string,
  action: string,
  objectType: string,
  objectId: string | null,
  metadata: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('finance_audit_events').insert({
      merchant_id: merchantId,
      action,
      object_type: objectType,
      object_id: objectId,
      metadata,
    });
    if (error) console.error('[finances/audit] insert failed', error.message);
  } catch (err) {
    console.error('[finances/audit] failed', err instanceof Error ? err.message : err);
  }
}

/** Look up a prior receipt by an idempotency key, for one-shot actions. */
export async function findReceipt(
  merchantId: string,
  action: string,
  key: string,
): Promise<{ object_id: string | null; metadata: Record<string, unknown> } | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_audit_events')
    .select('object_id, metadata')
    .eq('merchant_id', merchantId)
    .eq('action', action)
    .contains('metadata', { idempotencyKey: key })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read receipts: ${error.message}`);
  return (data as { object_id: string | null; metadata: Record<string, unknown> } | null) ?? null;
}
