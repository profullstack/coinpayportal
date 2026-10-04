import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { isValidTimeZone } from './periods';

/**
 * Per-merchant finance settings. Currently one thing: the timezone calendar
 * periods are resolved in. There is no server-zone fallback on purpose — a
 * report must say which zone its month is measured in, and "whatever the
 * container happened to be set to" is not an answer a merchant can repeat
 * next quarter.
 */

export interface FinanceSettings {
  merchant_id: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export async function getFinanceSettings(merchantId: string): Promise<FinanceSettings | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_settings')
    .select('merchant_id, timezone, created_at, updated_at')
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (error) throw new Error(`Could not read finance settings: ${error.message}`);
  return (data as FinanceSettings | null) ?? null;
}

/**
 * The timezone to use for a request. An explicit value wins and is remembered
 * when `remember` is set; otherwise the saved one; otherwise nothing — the
 * caller must ask rather than guess.
 */
export async function resolveFinanceTimezone(
  merchantId: string,
  explicit: unknown,
  { remember = true }: { remember?: boolean } = {},
): Promise<{ timezone: string; source: 'request' | 'saved' } | null> {
  if (typeof explicit === 'string' && explicit.trim()) {
    if (!isValidTimeZone(explicit)) {
      throw new Error(`Timezone must be an IANA name such as America/Los_Angeles (got ${explicit})`);
    }
    const timezone = explicit.trim();
    if (remember) await setFinanceTimezone(merchantId, timezone);
    return { timezone, source: 'request' };
  }
  const saved = await getFinanceSettings(merchantId);
  if (saved?.timezone && isValidTimeZone(saved.timezone)) {
    return { timezone: saved.timezone, source: 'saved' };
  }
  return null;
}

export async function setFinanceTimezone(merchantId: string, timezone: string): Promise<void> {
  if (!isValidTimeZone(timezone)) throw new Error(`Invalid timezone ${timezone}`);
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('finance_settings')
    .upsert(
      { merchant_id: merchantId, timezone, updated_at: new Date().toISOString() },
      { onConflict: 'merchant_id' },
    );
  if (error) throw new Error(`Could not save finance settings: ${error.message}`);
}
