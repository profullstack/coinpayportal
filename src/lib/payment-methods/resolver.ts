import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CatalogMethod,
  BusinessPolicy,
  MerchantSetting,
  EffectiveMethod,
} from './types';

/**
 * W5 resolver: merge the platform catalog, a business's policy, and its store
 * settings into the effective set of payment methods a checkout may render.
 *
 * The restrict-only invariant and the platform kill switch are enforced HERE,
 * at merge time — not only at write time — so that a capability a business
 * loses after a merchant already enabled a method stops resolving immediately,
 * without any row rewrite.
 *
 * A method resolves into checkout iff ALL hold:
 *   1. catalog.force_disabled = false   (kill switch wins over everything)
 *   2. catalog.published = true         (platform has shipped it)
 *   3. business policy status = 'unlocked'
 *   4. merchant setting enabled = true  (store opted in)
 * Missing lower-layer rows mean "not granted" — the default is off, not on.
 */

// ── Cache ────────────────────────────────────────────────────────────────────
// Effective config is read on every checkout render, so it's cached per
// business. The cache is per-process; across instances the TTL bounds staleness.
// A 30s TTL keeps kill-switch / block propagation well inside the PRD's 1-minute
// requirement even on instances that never saw the write. Same-instance writes
// call invalidateBusiness()/invalidateAll() for immediate consistency.
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  value: EffectiveMethod[];
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

export function invalidateBusiness(businessId: string): void {
  cache.delete(businessId);
}

/** Clear everything — use after a catalog-layer write (e.g. force_disabled). */
export function invalidateAll(): void {
  cache.clear();
}

// ── Loaders ──────────────────────────────────────────────────────────────────
async function loadCatalog(supabase: SupabaseClient): Promise<CatalogMethod[]> {
  const { data } = await supabase
    .from('payment_method_catalog')
    .select('method_id, display_name, integration_type, published, force_disabled, default_config, feature_flags, sort_order');
  return (data || []).map((r) => ({
    methodId: r.method_id,
    displayName: r.display_name,
    integrationType: r.integration_type,
    published: r.published,
    forceDisabled: r.force_disabled,
    defaultConfig: r.default_config || {},
    featureFlags: r.feature_flags || {},
    sortOrder: r.sort_order ?? 100,
  }));
}

async function loadBusinessPolicy(
  supabase: SupabaseClient,
  businessId: string
): Promise<Map<string, BusinessPolicy>> {
  const { data } = await supabase
    .from('business_payment_policy')
    .select('method_id, status, entity_params')
    .eq('business_id', businessId);
  const map = new Map<string, BusinessPolicy>();
  for (const r of data || []) {
    map.set(r.method_id, { methodId: r.method_id, status: r.status, entityParams: r.entity_params || {} });
  }
  return map;
}

async function loadMerchantSettings(
  supabase: SupabaseClient,
  businessId: string
): Promise<Map<string, MerchantSetting>> {
  const { data } = await supabase
    .from('merchant_payment_settings')
    .select('method_id, enabled, min_order_value, max_order_value, currency_allowlist, display_order')
    .eq('business_id', businessId);
  const map = new Map<string, MerchantSetting>();
  for (const r of data || []) {
    map.set(r.method_id, {
      methodId: r.method_id,
      enabled: r.enabled,
      minOrderValue: r.min_order_value != null ? Number(r.min_order_value) : null,
      maxOrderValue: r.max_order_value != null ? Number(r.max_order_value) : null,
      currencyAllowlist: r.currency_allowlist ?? null,
      displayOrder: r.display_order ?? null,
    });
  }
  return map;
}

// ── Merge ────────────────────────────────────────────────────────────────────
/** Narrow a range: the lower layer may only tighten the bound, never widen it. */
function narrowMin(entityMin: unknown, merchantMin: number | null): number | null {
  const e = typeof entityMin === 'number' ? entityMin : null;
  if (e == null) return merchantMin;
  if (merchantMin == null) return e;
  return Math.max(e, merchantMin);
}
function narrowMax(entityMax: unknown, merchantMax: number | null): number | null {
  const e = typeof entityMax === 'number' ? entityMax : null;
  if (e == null) return merchantMax;
  if (merchantMax == null) return e;
  return Math.min(e, merchantMax);
}

/**
 * Pure merge of the three layers into the effective method list. Exported for
 * direct unit testing of the invariant without touching the DB or cache.
 */
export function mergeEffective(
  catalog: CatalogMethod[],
  policy: Map<string, BusinessPolicy>,
  settings: Map<string, MerchantSetting>
): EffectiveMethod[] {
  const out: EffectiveMethod[] = [];

  for (const method of catalog) {
    if (method.forceDisabled) continue; // (1) kill switch
    if (!method.published) continue; // (2) not shipped

    const p = policy.get(method.methodId);
    if (!p || p.status !== 'unlocked') continue; // (3) business must unlock

    const s = settings.get(method.methodId);
    if (!s || !s.enabled) continue; // (4) store must opt in

    out.push({
      methodId: method.methodId,
      displayName: method.displayName,
      integrationType: method.integrationType,
      minOrderValue: narrowMin(p.entityParams.min_order_value, s.minOrderValue),
      maxOrderValue: narrowMax(p.entityParams.max_order_value, s.maxOrderValue),
      currencyAllowlist: s.currencyAllowlist,
      sortOrder: s.displayOrder ?? method.sortOrder,
      config: { ...method.defaultConfig, ...p.entityParams },
    });
  }

  out.sort((a, b) => a.sortOrder - b.sortOrder || a.methodId.localeCompare(b.methodId));
  return out;
}

/**
 * Resolve the effective payment methods for a business (cached per business).
 */
export async function resolveEffectivePaymentMethods(
  supabase: SupabaseClient,
  businessId: string,
  opts: { skipCache?: boolean } = {}
): Promise<EffectiveMethod[]> {
  if (!opts.skipCache) {
    const hit = cache.get(businessId);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }

  const [catalog, policy, settings] = await Promise.all([
    loadCatalog(supabase),
    loadBusinessPolicy(supabase, businessId),
    loadMerchantSettings(supabase, businessId),
  ]);

  const value = mergeEffective(catalog, policy, settings);
  cache.set(businessId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
