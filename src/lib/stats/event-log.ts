/**
 * Fraud / risk event log, shared by the admin console and the merchant
 * dashboard.
 *
 * The only difference between the two views is `businessIds`:
 *   - `null`  → every business on the platform (admin only).
 *   - `[...]` → exactly the businesses the caller owns.
 *
 * A caller that cannot prove admin MUST pass an explicit array. Passing `null`
 * from a merchant route would leak every merchant's risk history, so the
 * scoping decision is made by the route, never inferred here.
 */

import { getSupabaseAdmin } from '@/lib/supabase/server';

/** Kinds the writer (`src/lib/fraud/store.ts`) currently emits. */
export const EVENT_KINDS = ['checkout_screen', 'card_declined', 'dispute'] as const;

export const EVENT_DECISIONS = ['allow', 'verify', 'block'] as const;

export const MAX_EVENT_LIMIT = 200;
export const DEFAULT_EVENT_LIMIT = 50;

export type EventLogFinding = { code?: string; label?: string; score?: number };

export type EventLogRow = {
  id: string;
  kind: string | null;
  decision: string | null;
  score: number | null;
  email: string | null;
  emailDomain: string | null;
  /** Withheld from merchant-scoped views: buyer IPs are not the merchant's data. */
  ip: string | null;
  /**
   * `fraud_events.amount` is stored in MAJOR units (25 means $25), unlike
   * `stripe_transactions.amount` which is minor units. Verified against live
   * rows on 2026-08-23 — do not divide by 100 here.
   */
  amount: number | null;
  currency: string | null;
  description: string | null;
  findings: EventLogFinding[];
  businessId: string | null;
  businessName: string | null;
  createdAt: string;
};

export type EventLogResult = {
  rows: EventLogRow[];
  /** Counts over the whole (scoped) table, not just this page. */
  summary: { kind: string; decision: string | null; count: number }[];
  total: number;
  generatedAt: string;
};

export type EventLogOptions = {
  /** `null` means platform-wide. Only an admin-guarded route may pass null. */
  businessIds: string[] | null;
  kind?: string | null;
  decision?: string | null;
  search?: string | null;
  limit?: number;
  /** Include buyer IP addresses. Admin views only. */
  includeIp?: boolean;
};

function normaliseFindings(raw: unknown): EventLogFinding[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      code: typeof entry.code === 'string' ? entry.code : undefined,
      label: typeof entry.label === 'string' ? entry.label : undefined,
      score: typeof entry.score === 'number' ? entry.score : undefined,
    }));
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * PostgREST `or=` takes a comma-separated filter list, so a search term
 * containing a comma or a parenthesis would break out of the group it is
 * placed in. Strip those rather than trying to quote them.
 */
function sanitiseSearch(term: string): string {
  return term.replace(/[,()*]/g, ' ').trim().slice(0, 120);
}

export async function getEventLog(options: EventLogOptions): Promise<EventLogResult> {
  const supabase = getSupabaseAdmin();
  const { businessIds, includeIp = false } = options;

  // An empty scope means "this merchant owns nothing" — return nothing rather
  // than falling through to an unfiltered query.
  if (Array.isArray(businessIds) && businessIds.length === 0) {
    return { rows: [], summary: [], total: 0, generatedAt: new Date().toISOString() };
  }

  const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_EVENT_LIMIT) || DEFAULT_EVENT_LIMIT, 1), MAX_EVENT_LIMIT);

  const scoped = (query: any) =>
    Array.isArray(businessIds) ? query.in('business_id', businessIds) : query;

  const filtered = (query: any) => {
    let q = scoped(query);
    if (options.kind && (EVENT_KINDS as readonly string[]).includes(options.kind)) {
      q = q.eq('kind', options.kind);
    }
    if (options.decision && (EVENT_DECISIONS as readonly string[]).includes(options.decision)) {
      q = q.eq('decision', options.decision);
    }
    const term = options.search ? sanitiseSearch(options.search) : '';
    if (term) {
      q = q.or(
        [
          `email.ilike.%${term}%`,
          `email_domain.ilike.%${term}%`,
          `description.ilike.%${term}%`,
        ].join(',')
      );
    }
    return q;
  };

  const columns =
    'id,business_id,kind,decision,score,email,email_domain,ip,amount,currency,description,findings,created_at';

  const [pageResult, summaryResult] = await Promise.all([
    filtered(supabase.from('fraud_events').select(columns))
      .order('created_at', { ascending: false })
      .limit(limit),
    // Summary counts ignore the kind/decision/search filters on purpose: they
    // are the legend for what exists, not a restatement of the current view.
    scoped(supabase.from('fraud_events').select('kind,decision')).limit(5000),
  ]);

  if (pageResult.error) throw new Error(`Failed to read fraud_events: ${pageResult.error.message}`);
  if (summaryResult.error) {
    throw new Error(`Failed to summarise fraud_events: ${summaryResult.error.message}`);
  }

  const rows = (pageResult.data ?? []) as any[];

  const businessIdsSeen = Array.from(
    new Set(rows.map((row) => row.business_id).filter(Boolean))
  ) as string[];
  const names = new Map<string, string>();
  if (businessIdsSeen.length > 0) {
    const { data: businesses } = await supabase
      .from('businesses')
      .select('id,name')
      .in('id', businessIdsSeen);
    for (const business of (businesses ?? []) as any[]) names.set(business.id, business.name);
  }

  const summaryMap = new Map<string, { kind: string; decision: string | null; count: number }>();
  for (const row of (summaryResult.data ?? []) as any[]) {
    const key = `${row.kind}::${row.decision ?? ''}`;
    const existing = summaryMap.get(key);
    if (existing) existing.count += 1;
    else summaryMap.set(key, { kind: row.kind, decision: row.decision ?? null, count: 1 });
  }

  return {
    rows: rows.map((row) => ({
      id: row.id,
      kind: row.kind ?? null,
      decision: row.decision ?? null,
      score: toNullableNumber(row.score),
      email: row.email ?? null,
      emailDomain: row.email_domain ?? null,
      ip: includeIp ? (row.ip ?? null) : null,
      amount: toNullableNumber(row.amount),
      currency: row.currency ?? null,
      description: row.description ?? null,
      findings: normaliseFindings(row.findings),
      businessId: row.business_id ?? null,
      businessName: row.business_id ? (names.get(row.business_id) ?? null) : null,
      createdAt: row.created_at,
    })),
    summary: Array.from(summaryMap.values()).sort((a, b) => b.count - a.count),
    total: (summaryResult.data ?? []).length,
    generatedAt: new Date().toISOString(),
  };
}
