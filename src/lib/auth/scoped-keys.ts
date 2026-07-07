import type { SupabaseClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';
import { generateApiKey, validateApiKeyFormat } from './apikey';

/**
 * Scoped API keys
 * ---------------
 * A many-per-business, named, individually-revocable API key model with scopes,
 * stored in `business_api_keys` as a SHA-256 hash. This lives ALONGSIDE the
 * legacy `businesses.api_key` single key, which the auth layer treats as an
 * all-scopes ('*') key for backwards compatibility.
 */

export const API_SCOPES = [
  'payments:create',
  'payments:read',
  'payments:refund',
  'payouts:create',
  'wallet:read',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** Wildcard scope granted to legacy keys and merchant (JWT) auth. */
export const WILDCARD_SCOPE = '*';

export interface ScopedKeyBusiness {
  id: string;
  merchant_id: string;
  name: string;
  active: boolean;
}

export interface ScopedKeyResolution {
  business: ScopedKeyBusiness;
  scopes: string[];
  keyId: string;
}

export interface ScopedKeyRecord {
  id: string;
  business_id: string;
  prefix: string;
  name: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/**
 * Server-side pepper for key hashing. API keys are high-entropy random tokens
 * (not user passwords), so a fast digest is appropriate — but we key it with a
 * server secret (HMAC) so a database leak alone cannot verify or precompute
 * hashes. Falls back across configured secrets; the empty-key path only occurs
 * in tests where no secret is configured.
 */
function keyHashPepper(): string {
  return (
    process.env.API_KEY_HASH_PEPPER ||
    process.env.ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    ''
  );
}

/** Keyed (HMAC-SHA256) hash used as the at-rest representation of a raw key. */
export function hashApiKey(rawKey: string): string {
  return createHmac('sha256', keyHashPepper()).update(rawKey).digest('hex');
}

/** Display prefix: 'cp_live_' + first 8 chars of the random part. */
export function keyPrefix(rawKey: string): string {
  return rawKey.slice(0, 16);
}

/** Keep only recognized scopes; de-duplicate. Empty input stays empty. */
export function normalizeScopes(requested: string[] | undefined | null): string[] {
  if (!Array.isArray(requested)) return [];
  const valid = new Set<string>();
  for (const s of requested) {
    if ((API_SCOPES as readonly string[]).includes(s)) valid.add(s);
  }
  return [...valid];
}

/** True if `granted` satisfies `required` (wildcard always satisfies). */
export function scopesSatisfy(granted: string[], required: string): boolean {
  return granted.includes(WILDCARD_SCOPE) || granted.includes(required);
}

/**
 * Resolve a raw API key against the scoped-key table.
 * Returns null when the key is not a scoped key (caller should fall back to the
 * legacy `businesses.api_key` lookup). Revoked keys resolve to null.
 */
export async function resolveScopedKey(
  supabase: SupabaseClient,
  rawKey: string
): Promise<ScopedKeyResolution | null> {
  if (!validateApiKeyFormat(rawKey).valid) return null;

  // Any failure here (incl. the table not existing yet, before the migration
  // is applied) must fall through to the legacy key lookup, never break auth.
  try {
    const { data: keyRow, error } = await supabase
      .from('business_api_keys')
      .select('id, business_id, scopes, revoked_at')
      .eq('key_hash', hashApiKey(rawKey))
      .maybeSingle();

    if (error || !keyRow || keyRow.revoked_at) return null;

    const { data: business, error: bizErr } = await supabase
      .from('businesses')
      .select('id, merchant_id, name, active')
      .eq('id', keyRow.business_id)
      .single();

    if (bizErr || !business || !business.active) return null;

    // Best-effort last-used stamp; never block auth on it.
    void supabase
      .from('business_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyRow.id)
      .then(undefined, () => undefined);

    return {
      business: business as ScopedKeyBusiness,
      scopes: Array.isArray(keyRow.scopes) ? keyRow.scopes : [],
      keyId: keyRow.id as string,
    };
  } catch {
    return null;
  }
}

export interface CreateScopedKeyResult {
  success: boolean;
  apiKey?: string; // raw key, returned once
  record?: ScopedKeyRecord;
  error?: string;
}

/**
 * Mint a new scoped key for a business WITHOUT touching any existing key.
 * The raw key is returned once; only its hash is stored.
 */
export async function createScopedApiKey(
  supabase: SupabaseClient,
  businessId: string,
  input: { name: string; scopes: string[]; createdBy?: string }
): Promise<CreateScopedKeyResult> {
  const name = (input.name ?? '').trim();
  if (!name) return { success: false, error: 'Key name is required' };

  const scopes = normalizeScopes(input.scopes);
  if (scopes.length === 0) {
    return {
      success: false,
      error: `At least one valid scope is required (${API_SCOPES.join(', ')})`,
    };
  }

  const rawKey = generateApiKey();
  const { data, error } = await supabase
    .from('business_api_keys')
    .insert({
      business_id: businessId,
      key_hash: hashApiKey(rawKey),
      prefix: keyPrefix(rawKey),
      name,
      scopes,
      created_by: input.createdBy ?? null,
    })
    .select('id, business_id, prefix, name, scopes, created_at, last_used_at, revoked_at')
    .single();

  if (error || !data) {
    return { success: false, error: error?.message || 'Failed to create API key' };
  }
  return { success: true, apiKey: rawKey, record: data as ScopedKeyRecord };
}

/** List a business's scoped keys (metadata only — never the raw key or hash). */
export async function listScopedApiKeys(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ success: boolean; keys?: ScopedKeyRecord[]; error?: string }> {
  const { data, error } = await supabase
    .from('business_api_keys')
    .select('id, business_id, prefix, name, scopes, created_at, last_used_at, revoked_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });

  if (error) return { success: false, error: error.message };
  return { success: true, keys: (data ?? []) as ScopedKeyRecord[] };
}

/** Revoke a scoped key (idempotent). Scoped to the business for safety. */
export async function revokeScopedApiKey(
  supabase: SupabaseClient,
  businessId: string,
  keyId: string
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase
    .from('business_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('business_id', businessId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: 'Key not found or already revoked' };
  return { success: true };
}
