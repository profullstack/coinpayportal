import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { resolvePeriod, boundPeriod, type EffectivePeriod } from './periods';
import { listAccounts, type AccountView } from './summary';
import { computeCoverage, summarizeCoverage, type ProviderCoverage } from './coverage';
import { parseExactAmount, sumAmounts, compareAmounts, isNegativeAmount, negateAmount, type ExactAmount } from './decimal';
import { createJob, type FinanceJobRow } from './jobs';
import { putObject, getObject, deleteObject, sha256Hex, objectExists } from './files';
import {
  canonicalJson,
  coverageExplanation,
  renderCsv,
  renderHtml,
  renderPdf,
  DATASET_SCHEMA,
  RENDERER_VERSION,
  GENERATED_BY_NOTICE,
  type ReportDataset,
  type ReportRow,
  type ReportAccount,
} from './render';
import { audit } from './audit';

/**
 * Period reports.
 *
 * A report is created as a row plus a job; the worker generates it. Its
 * dataset is taken by `finance_report_dataset()` in ONE SQL statement, so
 * the rows, their count and their per-currency totals all describe the same
 * Postgres snapshot — no page can see a row another page missed, and no
 * `updated_at <= cutoff` filter is needed or used. The totals are re-summed
 * here in exact decimal and must agree with the SQL, or the report fails.
 *
 * Once ready a report never changes. Re-running the same selection produces
 * a new revision and marks the old one superseded.
 */

export type ReportFormat = 'pdf' | 'html' | 'csv' | 'json';
export const REPORT_FORMATS: ReportFormat[] = ['pdf', 'html', 'csv', 'json'];

export interface FinanceReportRow {
  id: string;
  merchant_id: string;
  job_id: string | null;
  revision: number;
  supersedes_report_id: string | null;
  superseded_by_report_id: string | null;
  period_kind: string;
  period_selector: string;
  period_label: string;
  timezone: string;
  requested_start: string;
  requested_end: string;
  effective_end: string;
  period_to_date: boolean;
  cutoff: string;
  scope: string;
  account_ids: string[];
  include_hidden: boolean;
  include_pending: boolean;
  strict: boolean;
  status: string;
  local_export_complete: boolean | null;
  provider_coverage: ProviderCoverage | null;
  reconciliation_status: string;
  dataset_hash: string | null;
  row_count: number | null;
  pending_count: number | null;
  totals: unknown;
  warnings: string[];
  renderer_version: string | null;
  error_code: string | null;
  error_message: string | null;
  idempotency_key: string | null;
  created_at: string;
  generated_at: string | null;
  updated_at: string;
  deleted_at: string | null;
}

/** Everything but the dataset, which is large and has its own accessor. */
const REPORT_COLUMNS =
  'id, merchant_id, job_id, revision, supersedes_report_id, superseded_by_report_id, period_kind, period_selector, period_label, timezone, requested_start, requested_end, effective_end, period_to_date, cutoff, scope, account_ids, include_hidden, include_pending, strict, status, local_export_complete, provider_coverage, reconciliation_status, dataset_hash, row_count, pending_count, totals, warnings, renderer_version, error_code, error_message, idempotency_key, created_at, generated_at, updated_at, deleted_at';

export class ReportError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function toPublicReport(r: FinanceReportRow, artifacts: ArtifactRow[] = []) {
  return {
    id: r.id,
    revision: r.revision,
    supersedesReportId: r.supersedes_report_id,
    supersededByReportId: r.superseded_by_report_id,
    jobId: r.job_id,
    period: {
      kind: r.period_kind,
      selector: r.period_selector,
      label: r.period_label,
      timezone: r.timezone,
      start: r.requested_start,
      end: r.requested_end,
      effectiveEnd: r.effective_end,
      periodToDate: r.period_to_date,
      cutoff: r.cutoff,
    },
    scope: r.scope,
    accountIds: r.account_ids,
    includeHidden: r.include_hidden,
    includePending: r.include_pending,
    strict: r.strict,
    status: r.status,
    local_export_complete: r.local_export_complete,
    provider_coverage: r.provider_coverage,
    reconciliation_status: r.reconciliation_status,
    datasetHash: r.dataset_hash,
    rowCount: r.row_count,
    pendingCount: r.pending_count,
    totals: r.totals,
    warnings: r.warnings ?? [],
    rendererVersion: r.renderer_version,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    artifacts: artifacts
      .filter((a) => a.state === 'ready')
      .map((a) => ({ format: a.format, bytes: a.bytes, sha256: a.content_hash })),
    createdAt: r.created_at,
    generatedAt: r.generated_at,
    notice: GENERATED_BY_NOTICE,
  };
}

export interface ArtifactRow {
  id: string;
  report_id: string;
  format: ReportFormat;
  object_key: string;
  bytes: number;
  content_hash: string;
  state: string;
}

export interface CreateReportInput {
  merchantId: string;
  period?: string | null;
  from?: string | null;
  to?: string | null;
  timezone: string;
  accountIds?: string[] | null;
  scope?: 'all' | 'business' | 'personal';
  includeHidden?: boolean;
  includePending?: boolean;
  formats?: ReportFormat[];
  strict?: boolean;
  idempotencyKey?: string | null;
}

/**
 * Resolve the selection into a frozen account list. Every requested id must
 * be owned; an empty result is an error, never "all accounts".
 */
export async function resolveReportAccounts(
  merchantId: string,
  input: Pick<CreateReportInput, 'accountIds' | 'scope' | 'includeHidden'>,
): Promise<AccountView[]> {
  const all = await listAccounts(merchantId, { includeHidden: input.includeHidden ?? false });
  let selected = all;
  if (input.accountIds && input.accountIds.length > 0) {
    const wanted = new Set(input.accountIds);
    selected = all.filter((a) => wanted.has(a.id));
    if (selected.length !== wanted.size) {
      // Includes hidden accounts named explicitly.
      const withHidden = await listAccounts(merchantId, { includeHidden: true });
      selected = withHidden.filter((a) => wanted.has(a.id));
      if (selected.length !== wanted.size) throw new ReportError('not_found', 'One or more accounts were not found', 404);
    }
  }
  const scope = input.scope ?? 'all';
  if (scope !== 'all') selected = selected.filter((a) => a.effective_scope === scope);
  if (selected.length === 0) {
    throw new ReportError('invalid_request', 'No accounts match this selection; nothing to report on', 400);
  }
  return selected;
}

export async function createReport(input: CreateReportInput): Promise<{ report: FinanceReportRow; job: FinanceJobRow }> {
  const supabase = getSupabaseAdmin();
  const period = boundPeriod(
    resolvePeriod({ period: input.period, from: input.from, to: input.to, timezone: input.timezone }),
    new Date(),
  );
  const accounts = await resolveReportAccounts(input.merchantId, input);
  const accountIds = accounts.map((a) => a.id).sort();
  const formats = (input.formats?.length ? input.formats : REPORT_FORMATS).filter((f) => REPORT_FORMATS.includes(f));
  if (!formats.includes('json')) formats.push('json');
  const key = input.idempotencyKey?.trim() || null;

  const requestFingerprint = JSON.stringify({
    selector: period.selector, tz: period.timezone, accountIds, scope: input.scope ?? 'all',
    includeHidden: input.includeHidden ?? false, includePending: input.includePending ?? true, strict: input.strict ?? false,
  });

  if (key) {
    const { data: existing, error } = await supabase
      .from('finance_reports')
      .select(REPORT_COLUMNS)
      .eq('merchant_id', input.merchantId)
      .eq('idempotency_key', key)
      .maybeSingle();
    if (error) throw new Error(`Could not check the idempotency key: ${error.message}`);
    if (existing) {
      const r = existing as FinanceReportRow;
      const fp = JSON.stringify({
        selector: r.period_selector, tz: r.timezone, accountIds: [...r.account_ids].sort(), scope: r.scope,
        includeHidden: r.include_hidden, includePending: r.include_pending, strict: r.strict,
      });
      if (fp !== requestFingerprint) throw new ReportError('idempotency_conflict', 'This Idempotency-Key was already used with a different request', 409);
      const job = r.job_id ? await jobById(r.job_id, input.merchantId) : null;
      if (job) return { report: r, job };
    }
  }

  // Revision numbering across identical frozen selections.
  const { data: priors } = await supabase
    .from('finance_reports')
    .select('id, revision, account_ids')
    .eq('merchant_id', input.merchantId)
    .eq('period_selector', period.selector)
    .eq('timezone', period.timezone)
    .eq('scope', input.scope ?? 'all')
    .neq('status', 'deleted')
    .order('revision', { ascending: false })
    .limit(20);
  const samePrior = (priors ?? []).filter(
    (p) => JSON.stringify([...(p.account_ids as string[])].sort()) === JSON.stringify(accountIds),
  );
  const revision = samePrior.length ? Math.max(...samePrior.map((p) => p.revision as number)) + 1 : 1;
  const supersedes = samePrior[0]?.id ?? null;

  const { data: inserted, error: insertError } = await supabase
    .from('finance_reports')
    .insert({
      merchant_id: input.merchantId,
      revision,
      supersedes_report_id: supersedes,
      period_kind: period.kind,
      period_selector: period.selector,
      period_label: period.label,
      timezone: period.timezone,
      requested_start: period.start,
      requested_end: period.end,
      effective_end: period.effectiveEnd,
      period_to_date: period.periodToDate,
      cutoff: period.cutoff,
      scope: input.scope ?? 'all',
      account_ids: accountIds,
      include_hidden: input.includeHidden ?? false,
      include_pending: input.includePending ?? true,
      strict: input.strict ?? false,
      status: 'queued',
      idempotency_key: key,
    })
    .select(REPORT_COLUMNS)
    .single();
  if (insertError) throw new Error(`Could not create the report: ${insertError.message}`);
  const report = inserted as FinanceReportRow;

  const job = await createJob({
    merchantId: input.merchantId,
    kind: 'report',
    params: { reportId: report.id, formats },
  });
  await supabase.from('finance_reports').update({ job_id: job.id }).eq('id', report.id).eq('merchant_id', input.merchantId);
  report.job_id = job.id;
  await audit(input.merchantId, 'report.create', 'report', report.id, {
    period: period.selector, accounts: accountIds.length, revision, formats: formats.join(','),
  });
  return { report, job };
}

async function jobById(jobId: string, merchantId: string): Promise<FinanceJobRow | null> {
  const { getJob } = await import('./jobs');
  return getJob(jobId, merchantId);
}

export async function getReport(reportId: string, merchantId: string): Promise<FinanceReportRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_reports')
    .select(REPORT_COLUMNS)
    .eq('id', reportId)
    .eq('merchant_id', merchantId)
    .neq('status', 'deleted')
    .maybeSingle();
  if (error) throw new Error(`Could not read the report: ${error.message}`);
  return (data as FinanceReportRow | null) ?? null;
}

export async function getReportDataset(reportId: string, merchantId: string): Promise<ReportDataset | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_reports')
    .select('dataset')
    .eq('id', reportId)
    .eq('merchant_id', merchantId)
    .neq('status', 'deleted')
    .maybeSingle();
  if (error) throw new Error(`Could not read the report dataset: ${error.message}`);
  return ((data as { dataset: ReportDataset | null } | null)?.dataset as ReportDataset | null) ?? null;
}

export async function listReports(
  merchantId: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<{ reports: FinanceReportRow[]; total: number }> {
  const supabase = getSupabaseAdmin();
  const l = Math.min(Math.max(limit, 1), 200);
  const o = Math.max(offset, 0);
  const { data, error, count } = await supabase
    .from('finance_reports')
    .select(REPORT_COLUMNS, { count: 'exact' })
    .eq('merchant_id', merchantId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })
    .range(o, o + l - 1);
  if (error) throw new Error(`Could not list reports: ${error.message}`);
  return { reports: (data ?? []) as FinanceReportRow[], total: count ?? 0 };
}

export async function listArtifacts(reportId: string): Promise<ArtifactRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_report_artifacts')
    .select('id, report_id, format, object_key, bytes, content_hash, state')
    .eq('report_id', reportId);
  if (error) throw new Error(`Could not list report artifacts: ${error.message}`);
  return (data ?? []) as ArtifactRow[];
}

// ---------------------------------------------------------------------------
// Generation (runs in the worker)
// ---------------------------------------------------------------------------

interface RawDataset {
  snapshot_at: string;
  accounts: Array<Record<string, unknown>>;
  posted: Array<Record<string, unknown>>;
  pending: Array<Record<string, unknown>>;
  totals: Array<{ currency: string; credits: string; debits: string; net: string; rows: number }>;
  account_totals: Array<{ account_id: string; credits: string; debits: string; net: string; rows: number }>;
  posted_count: number;
  pending_count: number;
}

function toRow(raw: Record<string, unknown>): ReportRow {
  const amount = parseExactAmount(raw.amount);
  if (amount === null) throw new ReportError('export_incomplete', `Transaction ${String(raw.id)} has an amount that cannot be represented exactly`, 500);
  return {
    id: String(raw.id),
    accountId: String(raw.account_id),
    externalId: String(raw.external_id),
    posted: (raw.posted as string | null) ?? null,
    transactedAt: (raw.transacted_at as string | null) ?? null,
    amount,
    description: (raw.description as string | null) ?? null,
    payee: (raw.payee as string | null) ?? null,
    memo: (raw.memo as string | null) ?? null,
    mcc: (raw.mcc as string | null) ?? null,
    category: (raw.category as string | null) ?? null,
    revision: typeof raw.revision === 'number' ? raw.revision : 1,
  };
}

function exact(value: unknown, what: string): ExactAmount {
  const v = parseExactAmount(value);
  if (v === null) throw new ReportError('export_incomplete', `${what} is not an exact decimal`, 500);
  return v;
}

/** Re-sum in exact decimal and require agreement with Postgres. */
function verifyTotals(rows: ReportRow[], accounts: ReportAccount[], sqlTotals: RawDataset['totals']) {
  const byCurrency = new Map<string, { credits: ExactAmount[]; debits: ExactAmount[]; all: ExactAmount[] }>();
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));
  for (const row of rows) {
    const currency = currencyOf.get(row.accountId);
    if (!currency) throw new ReportError('export_count_mismatch', 'A transaction belongs to an account outside the report', 500);
    const bucket = byCurrency.get(currency) ?? { credits: [], debits: [], all: [] };
    bucket.all.push(row.amount);
    if (isNegativeAmount(row.amount)) bucket.debits.push(negateAmount(row.amount));
    else bucket.credits.push(row.amount);
    byCurrency.set(currency, bucket);
  }
  const computed = [...byCurrency.entries()]
    .map(([currency, b]) => ({ currency, credits: sumAmounts(b.credits), debits: sumAmounts(b.debits), net: sumAmounts(b.all), rows: b.all.length }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  const fromSql = sqlTotals
    .map((t) => ({ currency: t.currency, credits: exact(t.credits, 'credits'), debits: exact(t.debits, 'debits'), net: exact(t.net, 'net'), rows: t.rows }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  if (computed.length !== fromSql.length) throw new ReportError('export_count_mismatch', 'Currency totals disagree between snapshot and rows', 500);
  for (let i = 0; i < computed.length; i += 1) {
    const a = computed[i];
    const b = fromSql[i];
    if (a.currency !== b.currency || a.rows !== b.rows || compareAmounts(a.credits, b.credits) !== 0 || compareAmounts(a.debits, b.debits) !== 0 || compareAmounts(a.net, b.net) !== 0) {
      throw new ReportError('export_count_mismatch', `Totals for ${a.currency} do not agree between the snapshot and its rows`, 500);
    }
  }
  return computed;
}

export interface GenerateOutcome {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  summary: Record<string, unknown>;
}

/**
 * Build the dataset, verify it, render every requested format, and mark
 * the report ready. Called by the job worker with a heartbeat callback that
 * returns false when cancellation was requested.
 */
export async function generateReport(
  reportId: string,
  merchantId: string,
  { heartbeat }: { heartbeat?: () => Promise<boolean> } = {},
): Promise<GenerateOutcome> {
  const supabase = getSupabaseAdmin();
  const report = await getReport(reportId, merchantId);
  if (!report) return { ok: false, errorCode: 'not_found', errorMessage: 'Report not found', summary: {} };
  if (report.status === 'ready') return { ok: true, summary: { reportId, alreadyReady: true } };

  const fail = async (code: string, message: string): Promise<GenerateOutcome> => {
    await supabase
      .from('finance_reports')
      .update({ status: 'failed', error_code: code, error_message: message.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq('id', reportId)
      .eq('merchant_id', merchantId);
    return { ok: false, errorCode: code, errorMessage: message, summary: { reportId } };
  };

  await supabase.from('finance_reports').update({ status: 'generating', updated_at: new Date().toISOString() }).eq('id', reportId).eq('merchant_id', merchantId);

  try {
    const job = report.job_id ? await jobById(report.job_id, merchantId) : null;
    const formats = ((job?.params.formats as ReportFormat[] | undefined) ?? REPORT_FORMATS).filter((f) => REPORT_FORMATS.includes(f));

    // --- one statement, one snapshot -----------------------------------------
    const { data: rawData, error: rpcError } = await supabase.rpc('finance_report_dataset', {
      p_merchant: merchantId,
      p_account_ids: report.account_ids,
      p_start: report.requested_start,
      p_end: report.effective_end,
      p_include_pending: report.include_pending,
    });
    if (rpcError) throw new Error(`Snapshot failed: ${rpcError.message}`);
    const raw = rawData as RawDataset;

    if (!raw || !Array.isArray(raw.accounts) || !Array.isArray(raw.posted)) {
      return fail('export_incomplete', 'The snapshot returned no dataset');
    }
    if (raw.accounts.length !== report.account_ids.length) {
      return fail('export_count_mismatch', `Expected ${report.account_ids.length} accounts in the snapshot, found ${raw.accounts.length}`);
    }
    if (raw.posted.length !== raw.posted_count || raw.pending.length !== raw.pending_count) {
      return fail('export_count_mismatch', 'Row counts disagree inside the snapshot');
    }
    if (heartbeat && !(await heartbeat())) return fail('cancelled', 'Cancelled');

    const accounts: ReportAccount[] = raw.accounts.map((a) => ({
      id: String(a.id),
      name: String(a.name ?? ''),
      orgName: (a.org_name as string | null) ?? null,
      currency: String(a.currency ?? 'USD'),
      kind: String(a.kind_override ?? a.kind ?? 'unknown'),
      scope: String(a.scope_override ?? 'unspecified'),
      isHidden: a.is_hidden === true,
      identityState: String(a.identity_state ?? 'ok'),
      currentBalance: parseExactAmount(a.balance),
      currentBalanceAsOf: (a.balance_date as string | null) ?? null,
      availableBalance: parseExactAmount(a.available_balance),
      openingBalance: null,
      closingBalance: null,
      balanceProvenance: 'unavailable',
    }));
    // Scope as the UI derives it, so the report agrees with the page.
    const views = await listAccounts(merchantId, { includeHidden: true });
    for (const a of accounts) {
      const v = views.find((x) => x.id === a.id);
      if (v) a.scope = v.effective_scope;
    }

    const posted = raw.posted.map(toRow);
    const pending = raw.pending.map(toRow);
    const totals = verifyTotals(posted, accounts, raw.totals);
    const accountTotals = raw.account_totals.map((t) => ({
      accountId: t.account_id,
      credits: exact(t.credits, 'credits'),
      debits: exact(t.debits, 'debits'),
      net: exact(t.net, 'net'),
      rows: t.rows,
    }));

    // --- coverage -------------------------------------------------------------
    const coverage = await computeCoverage(report.account_ids, report.requested_start, report.effective_end);
    const providerCoverage = summarizeCoverage(coverage);
    const warnings: string[] = [];
    for (const c of coverage) {
      const account = accounts.find((a) => a.id === c.accountId);
      const name = account?.name ?? c.accountId;
      if (c.coverage === 'unknown') warnings.push(`${name}: no part of this period was fetched from the provider.`);
      else if (c.coverage === 'partial') warnings.push(`${name}: ${c.gaps.length} interval(s) of this period were never fetched.`);
      if (c.capped) warnings.push(`${name}: the provider cut at least one requested range short.`);
      if (c.rowsRejected > 0) warnings.push(`${name}: ${c.rowsRejected} row(s) were rejected during import for an unusable amount or date.`);
      for (const w of c.warnings) warnings.push(`${name}: ${w}`);
      if (account?.identityState === 'identity_review_required') warnings.push(`${name}: account identity needs review; two upstream logins reported the same account id.`);
    }
    const dedupedWarnings = [...new Set(warnings)].slice(0, 50);

    if (report.strict) {
      if (providerCoverage !== 'available_window_fetched') {
        return fail(providerCoverage === 'partial' ? 'provider_coverage_partial' : 'provider_coverage_unknown', `Strict mode: provider coverage is ${providerCoverage}. ${dedupedWarnings[0] ?? ''}`.trim());
      }
      if (dedupedWarnings.length > 0) {
        return fail('provider_coverage_partial', `Strict mode: ${dedupedWarnings[0]}`);
      }
    }

    // Statements already imported for these accounts and this period.
    const { data: stmts } = await supabase
      .from('finance_statements')
      .select('id, account_id, institution_label, period_start, period_end')
      .eq('merchant_id', merchantId)
      .eq('state', 'active')
      .in('account_id', report.account_ids)
      .lt('period_start', report.effective_end.slice(0, 10))
      .gt('period_end', report.requested_start.slice(0, 10));

    const generatedAt = new Date().toISOString();
    const dataset: ReportDataset = {
      schema: DATASET_SCHEMA,
      report: {
        id: report.id,
        revision: report.revision,
        merchantId,
        periodKind: report.period_kind,
        periodSelector: report.period_selector,
        periodLabel: report.period_label,
        timezone: report.timezone,
        requestedStart: report.requested_start,
        requestedEnd: report.requested_end,
        effectiveEnd: report.effective_end,
        periodToDate: report.period_to_date,
        cutoff: report.cutoff,
        scope: report.scope,
        includeHidden: report.include_hidden,
        includePending: report.include_pending,
        generatedAt,
        snapshotAt: raw.snapshot_at,
        rendererVersion: RENDERER_VERSION,
      },
      accounts,
      posted,
      pending,
      totals,
      accountTotals,
      coverage: {
        local_export_complete: true,
        provider_coverage: providerCoverage,
        reconciliation_status: 'not_attempted',
        accounts: coverage,
        warnings: dedupedWarnings,
        explanation: coverageExplanation(providerCoverage, report.period_to_date),
      },
      statements: (stmts ?? []).map((s) => ({
        id: s.id as string,
        accountId: s.account_id as string,
        institutionLabel: (s.institution_label as string | null) ?? null,
        periodStart: s.period_start as string,
        periodEnd: s.period_end as string,
      })),
      disclaimers: [
        GENERATED_BY_NOTICE,
        'Credits and debits are gross bank flows. A credit is not automatically revenue; a debit is not automatically a deductible expense.',
        'Each currency is reported separately. Nothing is converted, and reward points are not money.',
        'Opening and closing balances are unavailable unless entered from a statement. The current balance carries the provider’s own timestamp and is not a period balance.',
        'Pending items are listed in an appendix and excluded from every total.',
        'CoinPay payment revenue, card payouts and bank deposits are not combined here; a payout arriving in a bank account appears only as a bank credit.',
        `Rows are exactly those selected at ${raw.snapshot_at}; a later import produces a new revision, never a change to this one.`,
      ],
    };

    const json = canonicalJson(dataset);
    const datasetHash = sha256Hex(json);

    // --- artifacts ------------------------------------------------------------
    const artifactRows: Record<string, unknown>[] = [];
    const produced: Record<string, { bytes: number; sha256: string }> = {};
    for (const format of formats) {
      if (heartbeat && !(await heartbeat())) return fail('cancelled', 'Cancelled');
      let bytes: Buffer;
      if (format === 'json') bytes = Buffer.from(json, 'utf8');
      else if (format === 'csv') bytes = Buffer.from(renderCsv(dataset), 'utf8');
      else if (format === 'html') bytes = Buffer.from(renderHtml(dataset), 'utf8');
      else bytes = await renderPdf(dataset);
      const stored = await putObject('reports', merchantId, bytes);
      artifactRows.push({
        report_id: report.id,
        format,
        object_key: stored.objectKey,
        bytes: stored.bytes,
        content_hash: stored.sha256,
        state: 'ready',
      });
      produced[format] = { bytes: stored.bytes, sha256: stored.sha256 };
    }
    const { error: artifactError } = await supabase
      .from('finance_report_artifacts')
      .upsert(artifactRows, { onConflict: 'report_id,format' });
    if (artifactError) throw new Error(`Could not record artifacts: ${artifactError.message}`);

    // Ready only once bytes, hashes and metadata all agree.
    const { error: readyError } = await supabase
      .from('finance_reports')
      .update({
        status: 'ready',
        dataset,
        dataset_hash: datasetHash,
        row_count: posted.length,
        pending_count: pending.length,
        totals,
        warnings: dedupedWarnings,
        local_export_complete: true,
        provider_coverage: providerCoverage,
        renderer_version: RENDERER_VERSION,
        generated_at: generatedAt,
        error_code: null,
        error_message: null,
        updated_at: generatedAt,
      })
      .eq('id', report.id)
      .eq('merchant_id', merchantId);
    if (readyError) throw new Error(`Could not mark the report ready: ${readyError.message}`);

    if (report.supersedes_report_id) {
      await supabase
        .from('finance_reports')
        .update({ status: 'superseded', superseded_by_report_id: report.id, updated_at: generatedAt })
        .eq('id', report.supersedes_report_id)
        .eq('merchant_id', merchantId)
        .eq('status', 'ready');
    }
    await audit(merchantId, 'report.ready', 'report', report.id, {
      rows: posted.length, pending: pending.length, coverage: providerCoverage, formats: formats.join(','),
    });

    return {
      ok: true,
      summary: { reportId: report.id, rows: posted.length, pending: pending.length, datasetHash, providerCoverage, artifacts: produced },
    };
  } catch (err) {
    if (err instanceof ReportError) return fail(err.code, err.message);
    throw err;
  }
}

/** Fetch (or re-render from the dataset) one artifact's bytes. */
export async function readArtifact(
  report: FinanceReportRow,
  format: ReportFormat,
): Promise<{ bytes: Buffer; contentType: string; filename: string; sha256: string } | null> {
  if (report.status !== 'ready') return null;
  const artifacts = await listArtifacts(report.id);
  const artifact = artifacts.find((a) => a.format === format && a.state === 'ready');
  let bytes: Buffer | null = null;
  if (artifact && (await objectExists(artifact.object_key))) {
    bytes = await getObject(artifact.object_key);
    if (sha256Hex(bytes) !== artifact.content_hash) bytes = null;
  }
  if (!bytes) {
    // The file is missing on this replica or its bytes changed: re-render
    // from the frozen dataset, which is the source of truth.
    const dataset = await getReportDataset(report.id, report.merchant_id);
    if (!dataset) return null;
    if (format === 'json') bytes = Buffer.from(canonicalJson(dataset), 'utf8');
    else if (format === 'csv') bytes = Buffer.from(renderCsv(dataset), 'utf8');
    else if (format === 'html') bytes = Buffer.from(renderHtml(dataset), 'utf8');
    else bytes = await renderPdf(dataset);
    if (format !== 'pdf' && artifact && sha256Hex(bytes) !== artifact.content_hash) {
      throw new ReportError('export_incomplete', 'Re-rendered artifact does not match its recorded hash', 500);
    }
  }
  const contentType =
    format === 'pdf' ? 'application/pdf' : format === 'csv' ? 'text/csv; charset=utf-8' : format === 'html' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8';
  const safeLabel = report.period_selector.replace(/[^0-9A-Za-z_.-]/g, '_');
  return { bytes, contentType, filename: `coinpay-activity-report-${safeLabel}-r${report.revision}.${format}`, sha256: sha256Hex(bytes) };
}

/** Delete a report's dataset and artifacts. Source accounts and rows stay. */
export async function deleteReport(reportId: string, merchantId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const report = await getReport(reportId, merchantId);
  if (!report) return false;
  const artifacts = await listArtifacts(report.id);
  for (const a of artifacts) {
    await deleteObject(a.object_key).catch(() => undefined);
  }
  await supabase.from('finance_report_artifacts').update({ state: 'deleted' }).eq('report_id', report.id);
  await supabase
    .from('finance_reconciliations')
    .update({ state: 'invalidated', invalidated_at: new Date().toISOString() })
    .eq('report_id', report.id)
    .eq('merchant_id', merchantId)
    .neq('state', 'invalidated');
  const { error } = await supabase
    .from('finance_reports')
    .update({ status: 'deleted', dataset: null, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', report.id)
    .eq('merchant_id', merchantId);
  if (error) throw new Error(`Could not delete the report: ${error.message}`);
  if (report.job_id) {
    await supabase.from('finance_jobs').update({ cancel_requested: true }).eq('id', report.job_id).eq('merchant_id', merchantId).in('status', ['queued', 'running', 'waiting_for_budget']);
  }
  await audit(merchantId, 'report.delete', 'report', report.id, { artifacts: artifacts.length });
  return true;
}

export type { EffectivePeriod };
