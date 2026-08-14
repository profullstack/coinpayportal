/**
 * Escrow statistics for the admin console.
 *
 * Thin typed wrapper over the `admin_escrow_stats()` and
 * `admin_escrow_summary()` Postgres functions. Both are granted to
 * `service_role` only and are reached through `/api/admin/escrows`, behind
 * `requireAdmin()` — this module does no authorization of its own, so nothing
 * outside an admin-guarded route should import it.
 *
 * Postgres returns `numeric` as a string over the wire (it does not fit a JS
 * number safely in general), so every figure is normalised through `toNumber`
 * here rather than in the component.
 *
 * The one exception is `amount`: chain amounts are `numeric(30, 18)` and a
 * value like 9859113112.000000000000000000 loses precision as a double, so the
 * raw string is kept for display and only the USD figure is a number. USD is
 * `numeric(20, 2)` and safe.
 */

import { getSupabaseAdmin } from '@/lib/supabase/server';

/** Sort keys the Postgres function accepts. Anything else falls back server-side. */
export const ESCROW_SORT_KEYS = [
  'created_at',
  'funded_at',
  'settled_at',
  'expires_at',
  'amount_usd',
  'chain',
  'status',
  'escrow_model',
  'business_name',
  'settle_attempts',
  'hours_to_fund',
  'hours_to_settle',
] as const;

export type EscrowSortKey = (typeof ESCROW_SORT_KEYS)[number];
export type SortDirection = 'asc' | 'desc';

export interface AdminEscrowRow {
  id: string;
  chain: string;
  status: string;
  escrowModel: string;
  /** Chain units, as a string — see the precision note above. */
  amount: string;
  amountUsd: number;
  depositedAmount: string | null;
  feeAmount: string | null;
  escrowAddress: string;
  depositorAddress: string;
  beneficiaryAddress: string;
  arbiterAddress: string | null;
  depositorEmail: string | null;
  beneficiaryEmail: string | null;
  depositTxHash: string | null;
  settlementTxHash: string | null;
  disputeStatus: string | null;
  disputeReason: string | null;
  inSeries: boolean;
  allowAutoRelease: boolean;
  settleAttempts: number;
  businessId: string | null;
  businessName: string | null;
  merchantEmail: string | null;
  createdAt: string;
  fundedAt: string | null;
  releasedAt: string | null;
  settledAt: string | null;
  disputedAt: string | null;
  refundedAt: string | null;
  expiresAt: string | null;
  hoursToFund: number | null;
  hoursToSettle: number | null;
  /** Funded, and neither settled nor refunded — money the platform still holds. */
  isHeld: boolean;
  /** Held past its own expiry: needs a rescan or a human. */
  isStranded: boolean;
}

export interface AdminEscrowPage {
  rows: AdminEscrowRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface EscrowStatusBucket {
  status: string;
  total: number;
  valueUsd: number;
}

export interface EscrowChainBucket {
  chain: string;
  total: number;
  settled: number;
  settledUsd: number;
  heldUsd: number;
}

export interface EscrowModelBucket {
  escrowModel: string;
  total: number;
  settled: number;
}

export interface EscrowMonthBucket {
  month: string;
  created: number;
  funded: number;
  settled: number;
  settledUsd: number;
}

export interface AdminEscrowSummary {
  escrowsTotal: number;
  firstCreatedAt: string | null;
  lastCreatedAt: string | null;
  everFunded: number;
  /** A settlement transaction was sent — on a release *or* a refund. */
  everDisbursed: number;
  everReleased: number;
  everDisputed: number;
  statusSettled: number;
  statusRefunded: number;
  expired: number;
  heldCount: number;
  strandedCount: number;
  disputesOpen: number;
  inSeries: number;
  autoRelease: number;
  withBusiness: number;
  businesses: number;
  created30d: number;
  settled30d: number;
  /** Quoted at creation, including escrows that never funded. Not money moved. */
  createdValueUsd: number;
  fundedValueUsd: number;
  /** releasedValueUsd + refundedValueUsd, by construction. */
  disbursedValueUsd: number;
  releasedValueUsd: number;
  refundedValueUsd: number;
  heldValueUsd: number;
  largestUsd: number;
  medianUsd: number;
  medianHoursToFund: number | null;
  medianHoursToSettle: number | null;
  byStatus: EscrowStatusBucket[];
  byChain: EscrowChainBucket[];
  byModel: EscrowModelBucket[];
  months: EscrowMonthBucket[];
}

type Numeric = number | string | null | undefined;

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Like `toNumber`, but keeps "not measured yet" distinct from zero. */
function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** Narrow an arbitrary string to a sort key, falling back to newest first. */
export function parseSortKey(value: string | null | undefined): EscrowSortKey {
  return (ESCROW_SORT_KEYS as readonly string[]).includes(value ?? '')
    ? (value as EscrowSortKey)
    : 'created_at';
}

export function parseSortDirection(value: string | null | undefined): SortDirection {
  return value?.toLowerCase() === 'asc' ? 'asc' : 'desc';
}

type RawRow = Record<string, unknown>;

function mapRow(raw: unknown): AdminEscrowRow {
  const row = (raw ?? {}) as RawRow;
  return {
    id: String(row.id ?? ''),
    chain: String(row.chain ?? ''),
    status: String(row.status ?? ''),
    escrowModel: String(row.escrow_model ?? ''),
    amount: row.amount === null || row.amount === undefined ? '0' : String(row.amount),
    amountUsd: toNumber(row.amount_usd),
    depositedAmount: row.deposited_amount == null ? null : String(row.deposited_amount),
    feeAmount: row.fee_amount == null ? null : String(row.fee_amount),
    escrowAddress: String(row.escrow_address ?? ''),
    depositorAddress: String(row.depositor_address ?? ''),
    beneficiaryAddress: String(row.beneficiary_address ?? ''),
    arbiterAddress: str(row.arbiter_address),
    depositorEmail: str(row.depositor_email),
    beneficiaryEmail: str(row.beneficiary_email),
    depositTxHash: str(row.deposit_tx_hash),
    settlementTxHash: str(row.settlement_tx_hash),
    disputeStatus: str(row.dispute_status),
    disputeReason: str(row.dispute_reason),
    inSeries: Boolean(row.in_series),
    allowAutoRelease: Boolean(row.allow_auto_release),
    settleAttempts: toNumber(row.settle_attempts),
    businessId: str(row.business_id),
    businessName: str(row.business_name),
    merchantEmail: str(row.merchant_email),
    createdAt: String(row.created_at ?? ''),
    fundedAt: str(row.funded_at),
    releasedAt: str(row.released_at),
    settledAt: str(row.settled_at),
    disputedAt: str(row.disputed_at),
    refundedAt: str(row.refunded_at),
    expiresAt: str(row.expires_at),
    hoursToFund: toNullableNumber(row.hours_to_fund),
    hoursToSettle: toNullableNumber(row.hours_to_settle),
    isHeld: Boolean(row.is_held),
    isStranded: Boolean(row.is_stranded),
  };
}

export interface GetAdminEscrowStatsOptions {
  search?: string | null;
  status?: string | null;
  chain?: string | null;
  model?: string | null;
  sort?: EscrowSortKey;
  direction?: SortDirection;
  limit?: number;
  offset?: number;
}

/**
 * One page of escrows.
 *
 * Throws on failure rather than returning an empty page: a silent zero here
 * would be indistinguishable from "there are no escrows", and for a custodial
 * service that is exactly the difference an admin is checking for.
 */
export async function getAdminEscrowStats(
  options: GetAdminEscrowStatsOptions = {},
): Promise<AdminEscrowPage> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('admin_escrow_stats', {
    p_search: options.search?.trim() || null,
    p_status: options.status?.trim() || null,
    p_chain: options.chain?.trim() || null,
    p_model: options.model?.trim() || null,
    p_sort: options.sort ?? 'created_at',
    p_dir: options.direction ?? 'desc',
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0,
  });

  if (error || !data) {
    throw new Error(`admin_escrow_stats failed: ${error?.message ?? 'no data'}`);
  }

  const payload = data as { rows?: unknown[]; total?: Numeric; limit?: Numeric; offset?: Numeric };
  return {
    rows: (payload.rows ?? []).map(mapRow),
    total: toNumber(payload.total),
    limit: toNumber(payload.limit),
    offset: toNumber(payload.offset),
  };
}

function mapStatusBucket(raw: unknown): EscrowStatusBucket {
  const row = (raw ?? {}) as RawRow;
  return {
    status: String(row.status ?? ''),
    total: toNumber(row.total),
    valueUsd: toNumber(row.value_usd),
  };
}

function mapChainBucket(raw: unknown): EscrowChainBucket {
  const row = (raw ?? {}) as RawRow;
  return {
    chain: String(row.chain ?? ''),
    total: toNumber(row.total),
    settled: toNumber(row.settled),
    settledUsd: toNumber(row.settled_usd),
    heldUsd: toNumber(row.held_usd),
  };
}

function mapModelBucket(raw: unknown): EscrowModelBucket {
  const row = (raw ?? {}) as RawRow;
  return {
    escrowModel: String(row.escrow_model ?? ''),
    total: toNumber(row.total),
    settled: toNumber(row.settled),
  };
}

function mapMonthBucket(raw: unknown): EscrowMonthBucket {
  const row = (raw ?? {}) as RawRow;
  return {
    month: String(row.month ?? ''),
    created: toNumber(row.created),
    funded: toNumber(row.funded),
    settled: toNumber(row.settled),
    settledUsd: toNumber(row.settled_usd),
  };
}

/** All-time totals, breakdowns and monthly history. Unaffected by the filters. */
export async function getAdminEscrowSummary(): Promise<AdminEscrowSummary> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('admin_escrow_summary');

  if (error || !data) {
    throw new Error(`admin_escrow_summary failed: ${error?.message ?? 'no data'}`);
  }

  const raw = data as Record<string, unknown>;
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

  return {
    escrowsTotal: toNumber(raw.escrows_total),
    firstCreatedAt: str(raw.first_created_at),
    lastCreatedAt: str(raw.last_created_at),
    everFunded: toNumber(raw.ever_funded),
    everDisbursed: toNumber(raw.ever_disbursed),
    everReleased: toNumber(raw.ever_released),
    everDisputed: toNumber(raw.ever_disputed),
    statusSettled: toNumber(raw.status_settled),
    statusRefunded: toNumber(raw.status_refunded),
    expired: toNumber(raw.expired),
    heldCount: toNumber(raw.held_count),
    strandedCount: toNumber(raw.stranded_count),
    disputesOpen: toNumber(raw.disputes_open),
    inSeries: toNumber(raw.in_series),
    autoRelease: toNumber(raw.auto_release),
    withBusiness: toNumber(raw.with_business),
    businesses: toNumber(raw.businesses),
    created30d: toNumber(raw.created_30d),
    settled30d: toNumber(raw.settled_30d),
    createdValueUsd: toNumber(raw.created_value_usd),
    fundedValueUsd: toNumber(raw.funded_value_usd),
    disbursedValueUsd: toNumber(raw.disbursed_value_usd),
    releasedValueUsd: toNumber(raw.released_value_usd),
    refundedValueUsd: toNumber(raw.refunded_value_usd),
    heldValueUsd: toNumber(raw.held_value_usd),
    largestUsd: toNumber(raw.largest_usd),
    medianUsd: toNumber(raw.median_usd),
    medianHoursToFund: toNullableNumber(raw.median_hours_to_fund),
    medianHoursToSettle: toNullableNumber(raw.median_hours_to_settle),
    byStatus: list(raw.by_status).map(mapStatusBucket),
    byChain: list(raw.by_chain).map(mapChainBucket),
    byModel: list(raw.by_model).map(mapModelBucket),
    months: list(raw.months).map(mapMonthBucket),
  };
}
