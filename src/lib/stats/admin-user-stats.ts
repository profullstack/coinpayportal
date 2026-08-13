/**
 * Per-user statistics for the admin console.
 *
 * Thin typed wrapper over the `admin_user_stats()` and `admin_platform_stats()`
 * Postgres functions. Both are granted to `service_role` only and are reached
 * through `/api/admin/users`, behind `requireAdmin()` — this module does no
 * authorization of its own, so nothing outside an admin-guarded route should
 * import it.
 *
 * Postgres returns `numeric` as a string over the wire (it does not fit a JS
 * number safely in general), so every figure is normalised through `toNumber`
 * here rather than in the component. A `NaN` in a currency column would render
 * as "$NaN" in the table, which is worse than a zero.
 */

import { getSupabaseAdmin } from '@/lib/supabase/server';

/** Sort keys the Postgres function accepts. Anything else falls back server-side. */
export const USER_SORT_KEYS = [
  'email',
  'name',
  'created_at',
  'last_login_at',
  'last_activity_at',
  'businesses_count',
  'payments_total',
  'payments_settled',
  'settled_volume_usd',
  'invoices_total',
  'invoices_paid_usd',
  'escrows_total',
  'stripe_volume_usd',
  'total_volume_usd',
] as const;

export type UserSortKey = (typeof USER_SORT_KEYS)[number];
export type SortDirection = 'asc' | 'desc';

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  authProvider: string | null;
  subscriptionPlanId: string | null;
  subscriptionStatus: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  /** Most recent of: login, business, payment, invoice, escrow, Stripe charge. */
  lastActivityAt: string | null;
  businessesCount: number;
  activeBusinessesCount: number;
  paymentsTotal: number;
  paymentsSettled: number;
  settledVolumeUsd: number;
  invoicesTotal: number;
  invoicesPaid: number;
  /** USD-denominated paid invoices only — crypto-denominated ones are counted, not summed. */
  invoicesPaidUsd: number;
  invoiceFeesUsd: number;
  escrowsTotal: number;
  escrowsSettled: number;
  escrowVolumeUsd: number;
  stripeTotal: number;
  stripeCompleted: number;
  stripeVolumeUsd: number;
  /** Settled crypto + paid invoices + settled escrows + completed Stripe. */
  totalVolumeUsd: number;
}

export interface AdminUserPage {
  rows: AdminUserRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminPlatformStats {
  usersTotal: number;
  usersNew7d: number;
  usersNew30d: number;
  usersActive30d: number;
  businessesTotal: number;
  businessesActive: number;
  paymentsTotal: number;
  paymentsSettled: number;
  paymentsVolumeUsd: number;
  invoicesTotal: number;
  invoicesPaid: number;
  invoicesPaidUsd: number;
  escrowsTotal: number;
  escrowsSettled: number;
  escrowVolumeUsd: number;
  stripeCompleted: number;
  stripeVolumeUsd: number;
}

type Numeric = number | string | null | undefined;

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Narrow an arbitrary string to a sort key, falling back to last activity. */
export function parseSortKey(value: string | null | undefined): UserSortKey {
  return (USER_SORT_KEYS as readonly string[]).includes(value ?? '')
    ? (value as UserSortKey)
    : 'last_activity_at';
}

export function parseSortDirection(value: string | null | undefined): SortDirection {
  return value?.toLowerCase() === 'asc' ? 'asc' : 'desc';
}

/** One row as it comes back from `admin_user_stats()`, before normalisation. */
type RawUserRow = Record<string, string | number | boolean | null | undefined>;

function mapRow(raw: unknown): AdminUserRow {
  const row = (raw ?? {}) as RawUserRow;
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  return {
    id: String(row.id ?? ''),
    email: String(row.email ?? ''),
    name: str(row.name),
    isAdmin: Boolean(row.is_admin),
    authProvider: str(row.auth_provider),
    subscriptionPlanId: str(row.subscription_plan_id),
    subscriptionStatus: str(row.subscription_status),
    createdAt: String(row.created_at ?? ''),
    lastLoginAt: str(row.last_login_at),
    lastActivityAt: str(row.last_activity_at),
    businessesCount: toNumber(row.businesses_count),
    activeBusinessesCount: toNumber(row.active_businesses_count),
    paymentsTotal: toNumber(row.payments_total),
    paymentsSettled: toNumber(row.payments_settled),
    settledVolumeUsd: toNumber(row.settled_volume_usd),
    invoicesTotal: toNumber(row.invoices_total),
    invoicesPaid: toNumber(row.invoices_paid),
    invoicesPaidUsd: toNumber(row.invoices_paid_usd),
    invoiceFeesUsd: toNumber(row.invoice_fees_usd),
    escrowsTotal: toNumber(row.escrows_total),
    escrowsSettled: toNumber(row.escrows_settled),
    escrowVolumeUsd: toNumber(row.escrow_volume_usd),
    stripeTotal: toNumber(row.stripe_total),
    stripeCompleted: toNumber(row.stripe_completed),
    stripeVolumeUsd: toNumber(row.stripe_volume_usd),
    totalVolumeUsd: toNumber(row.total_volume_usd),
  };
}

export interface GetAdminUserStatsOptions {
  search?: string | null;
  sort?: UserSortKey;
  direction?: SortDirection;
  limit?: number;
  offset?: number;
}

/**
 * One page of per-user statistics.
 *
 * Throws on failure rather than returning an empty page: unlike the public
 * landing counters, a silent zero here would be indistinguishable from "you
 * have no users", and the caller needs to surface the difference.
 */
export async function getAdminUserStats(
  options: GetAdminUserStatsOptions = {},
): Promise<AdminUserPage> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('admin_user_stats', {
    p_search: options.search?.trim() || null,
    p_sort: options.sort ?? 'last_activity_at',
    p_dir: options.direction ?? 'desc',
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0,
  });

  if (error || !data) {
    throw new Error(`admin_user_stats failed: ${error?.message ?? 'no data'}`);
  }

  const payload = data as { rows?: unknown[]; total?: Numeric; limit?: Numeric; offset?: Numeric };
  return {
    rows: (payload.rows ?? []).map(mapRow),
    total: toNumber(payload.total),
    limit: toNumber(payload.limit),
    offset: toNumber(payload.offset),
  };
}

/** Platform-wide totals for the page header. Unaffected by the search filter. */
export async function getAdminPlatformStats(): Promise<AdminPlatformStats> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('admin_platform_stats');

  if (error || !data) {
    throw new Error(`admin_platform_stats failed: ${error?.message ?? 'no data'}`);
  }

  const raw = data as Record<string, Numeric>;
  return {
    usersTotal: toNumber(raw.users_total),
    usersNew7d: toNumber(raw.users_new_7d),
    usersNew30d: toNumber(raw.users_new_30d),
    usersActive30d: toNumber(raw.users_active_30d),
    businessesTotal: toNumber(raw.businesses_total),
    businessesActive: toNumber(raw.businesses_active),
    paymentsTotal: toNumber(raw.payments_total),
    paymentsSettled: toNumber(raw.payments_settled),
    paymentsVolumeUsd: toNumber(raw.payments_volume_usd),
    invoicesTotal: toNumber(raw.invoices_total),
    invoicesPaid: toNumber(raw.invoices_paid),
    invoicesPaidUsd: toNumber(raw.invoices_paid_usd),
    escrowsTotal: toNumber(raw.escrows_total),
    escrowsSettled: toNumber(raw.escrows_settled),
    escrowVolumeUsd: toNumber(raw.escrow_volume_usd),
    stripeCompleted: toNumber(raw.stripe_completed),
    stripeVolumeUsd: toNumber(raw.stripe_volume_usd),
  };
}
